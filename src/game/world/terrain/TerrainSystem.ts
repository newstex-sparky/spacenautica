import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { BiomeSample, GameContext, GameSystem, WorldQuery } from '../../core/Types';
import type { PbrMaps, TextureLibrary } from '../../assets/TextureLibrary';
import type { TextureId } from '../../assets/TextureIds';
import { BIOMES, BIOME_MAP, BiomeMap } from './Biomes';
import type { BiomeDef } from './Biomes';
import { TerrainField } from './TerrainField';
import { ChunkTemplate, meshChunk } from './ChunkMesher';
import type { ChunkBuild } from './ChunkMesher';
import { archSolid, buildArch } from './Arches';
import type { ArchBuild } from './Arches';
import {
  TERRAIN_LAYERS,
  createTerrainMaterial,
  packTerrainTextures,
  probeTerrainTextures,
} from './TerrainMaterial';
import type { LayerConfig, PackedTerrainTextures, TerrainMaterialBundle } from './TerrainMaterial';

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

/** World size of a level-0 chunk, metres. */
const LOD0_SIZE = 32;
/** LOD range multiplier: level L is used out to LOD0_SIZE * 2^L * K metres. */
const RANGE_K = 2.15;
/** Hard cap on levels so a silly viewDistance cannot explode the tree. */
const MAX_LEVELS = 7;
/** Milliseconds of chunk meshing allowed per frame. */
const BUILD_BUDGET_MS = 3.6;
/** Chunks meshed synchronously during init so frame 1 is already correct. */
const WARM_CAP = 120;

const LAYER_IDS: TextureId[] = ['sand_rippled', 'gravel', 'rock_basalt', 'mud_silt', 'rock_limestone'];

/**
 * Per-layer tiling size, roughness and a *relative* albedo modifier. These are
 * modifiers rather than absolute colours: the biome vertex tint carries the hue,
 * so a biome transition re-grades every layer coherently.
 *
 * The tints run well above 1 on purpose. Two reasons, both about being *under*
 * water rather than about taste:
 *
 *  - The baked source maps sit at 0.05-0.11 linear reflectance for gravel,
 *    basalt and silt. That is defensible for dry rock in air, but a surface that
 *    dark underwater contributes nothing to the frame: the view ray's
 *    transmittance is already down to a few percent, so albedo * T disappears
 *    under the additive inscatter and the floor reads as a flat wash. Submerged
 *    rock is also never that dark in reality — it carries a film of sediment and
 *    pale coralline crust.
 *  - Extinction is wavelength-dependent, so only the BLUE channel survives past
 *    ~15 m (red is gone by 5 m). Warm-tinted ground therefore loses all of its
 *    texture at distance. Every tint here is biased cool so the surviving channel
 *    is the one carrying the contrast.
 */
const LAYER_CFG: LayerConfig[] = [
  { metres: 1.9, roughness: 1.0, tint: new THREE.Color(1.3, 1.36, 1.52) },   // sand
  { metres: 2.7, roughness: 0.95, tint: new THREE.Color(2.6, 2.7, 2.95) },   // gravel
  { metres: 4.8, roughness: 0.86, tint: new THREE.Color(3.0, 3.3, 3.9) },    // basalt
  { metres: 3.2, roughness: 1.0, tint: new THREE.Color(2.1, 2.2, 2.5) },     // silt
  { metres: 3.7, roughness: 0.8, tint: new THREE.Color(1.7, 1.75, 1.9) },    // coral rock
];

/* ------------------------------------------------------------------ *
 * Chunk record
 * ------------------------------------------------------------------ */

interface Chunk {
  level: number;
  gx: number;
  gz: number;
  size: number;
  build: ChunkBuild | null;
  mesh: THREE.Mesh | null;
  queued: boolean;
  lastUsed: number;
}

/* Module-scope scratch — nothing in update() allocates. */
const _v3 = new THREE.Vector3();
const _rayP = new THREE.Vector3();
const _rayD = new THREE.Vector3();
const _tintA = new THREE.Color();
const _tintB = new THREE.Color();
const _flow2 = { x: 1, y: 0 };

function keyOf(gx: number, gz: number): number {
  return ((gx & 0xffff) << 16) | (gz & 0xffff);
}

/** Horizontal distance from a point to an axis-aligned XZ box footprint. */
function distXZToBox(px: number, pz: number, x0: number, z0: number, size: number): number {
  const dx = px < x0 ? x0 - px : px > x0 + size ? px - (x0 + size) : 0;
  const dz = pz < z0 ? z0 - pz : pz > z0 + size ? pz - (z0 + size) : 0;
  return Math.sqrt(dx * dx + dz * dz);
}

/* ------------------------------------------------------------------ *
 * System
 * ------------------------------------------------------------------ */

export class TerrainSystem implements GameSystem, WorldQuery {
  readonly name = 'world.terrain';
  readonly phase = Phase.World;
  readonly seed = 20260728;
  readonly bounds = { min: -560, max: -6 };
  readonly biomes: ReadonlyMap<string, BiomeDef> = BIOME_MAP;

  /** Exposed for flora / props / fauna placement — additive API. */
  readonly field: TerrainField;
  readonly biomeMap: BiomeMap;

  private group = new THREE.Group();
  private template: ChunkTemplate | null = null;
  private bundle: TerrainMaterialBundle | null = null;
  private packed: PackedTerrainTextures | null = null;

  private levelMaps: Array<Map<number, Chunk>> = [];
  private ranges: number[] = [];
  private maxLevel = 4;
  private gridRes = 32;
  private viewDistance = 760;
  private settingsRevision = -1;

  private buildQueue: Chunk[] = [];
  private visible = new Set<Chunk>();
  private prevVisible = new Set<Chunk>();
  private frame = 0;

  private arches: ArchBuild[] = [];
  private archMeshes: THREE.Mesh[] = [];

  private camX = 0;
  private camZ = 0;
  private lastSelectX = Infinity;
  private lastSelectZ = Infinity;
  private lastSelectFrame = -999;
  private csmLinked = false;
  private srcSets: PbrMaps[] = [];
  private renderer: THREE.WebGLRenderer | null = null;
  private ownsWaterUniforms = false;

  constructor() {
    this.field = new TerrainField(this.seed);
    this.biomeMap = new BiomeMap(
      this.seed,
      (x, z) => this.field.macroDepth(x, z),
      // Point queries gate on the real floor, so `biomeAt` agrees with the depth
      // the player reads on the HUD and with the vertex tint the mesher bakes.
      (x, z) => -this.field.height(x, z),
    );
  }

  /* ---------------------------------------------------------------- *
   * Init
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    ctx.world = this;
    this.group.name = 'world.terrain';
    this.group.matrixAutoUpdate = false;
    ctx.scene.add(this.group);

    this.configureForSettings(ctx);
    this.buildMaterial(ctx);
    this.buildArches();

    // Warm the region around the spawn so the very first frame is correct.
    this.camX = ctx.camera.position.x;
    this.camZ = ctx.camera.position.z;
    this.select();
    let warmed = 0;
    while (this.buildQueue.length && warmed < WARM_CAP) {
      const c = this.buildQueue.shift()!;
      c.queued = false;
      this.meshInto(c);
      warmed++;
    }
    this.select();
    this.applyVisibility();
  }

  private configureForSettings(ctx: GameContext): void {
    const g = ctx.settings.graphics;
    this.settingsRevision = ctx.settings.revision;
    this.viewDistance = Math.max(120, g.viewDistance);
    this.gridRes = g.tier === 'low' ? 16 : g.tier === 'medium' ? 24 : g.tier === 'ultra' ? 40 : 32;

    this.ranges.length = 0;
    for (let l = 0; l < MAX_LEVELS; l++) this.ranges.push(LOD0_SIZE * (1 << l) * RANGE_K);
    this.maxLevel = MAX_LEVELS - 1;
    for (let l = 0; l < MAX_LEVELS; l++) {
      if (this.ranges[l] >= this.viewDistance) {
        this.maxLevel = l;
        break;
      }
    }

    this.levelMaps = [];
    for (let l = 0; l <= this.maxLevel; l++) this.levelMaps.push(new Map());

    this.template?.dispose();
    this.template = new ChunkTemplate(this.gridRes);
  }

  private buildMaterial(ctx: GameContext): void {
    const lib = ctx.tryGet<TextureLibrary & GameSystem>('assets.textures');
    const size = ctx.settings.at('high') ? 512 : 256;
    const sets: PbrMaps[] = [];
    for (let i = 0; i < TERRAIN_LAYERS; i++) {
      const id = LAYER_IDS[i];
      const maps = lib ? lib.get(id, size) : null;
      sets.push(
        maps ?? {
          map: new THREE.Texture(),
          normalMap: new THREE.Texture(),
          roughnessMap: new THREE.Texture(),
          aoMap: new THREE.Texture(),
        },
      );
    }

    const aniso = Math.min(
      ctx.settings.graphics.anisotropy,
      ctx.renderer.capabilities.getMaxAnisotropy(),
    );
    this.srcSets = sets;
    this.renderer = ctx.renderer;
    this.packed = packTerrainTextures(ctx.renderer, sets, size, aniso);

    const detail = lib ? lib.get('detail_grunge', 256).normalMap : new THREE.Texture();
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;

    const water = ctx.tryGet<GameSystem & {
      sharedUniforms: Record<string, THREE.IUniform>;
      causticsTexture: THREE.Texture | null;
    }>('world.water');
    const caustics =
      water?.causticsTexture ?? (lib ? lib.get('caustic_tile', 256).map : new THREE.Texture());
    caustics.wrapS = caustics.wrapT = THREE.RepeatWrapping;

    // When the ocean is absent (verification harness, or a boot where it failed)
    // we own the underwater uniforms and must drive them ourselves.
    this.ownsWaterUniforms = !water?.sharedUniforms;

    this.bundle = createTerrainMaterial({
      packed: this.packed,
      detailNormal: detail,
      caustics,
      layers: LAYER_CFG,
      waterUniforms: water?.sharedUniforms ?? {},
      stochastic: ctx.settings.at('high'),
      rockTint: new THREE.Color(0.9, 0.92, 0.96),
    });

    const g = ctx.settings.graphics;
    this.bundle.uniforms.uMacroAmt.value = g.tier === 'low' ? 0.24 : 0.34;
    this.bundle.uniforms.uDetailAmt.value = ctx.settings.at('medium') ? 0.9 : 0.5;
    this.bundle.uniforms.uRippleAmt.value = 0.9;
    this.bundle.uniforms.uCausticAmt.value = water?.causticsTexture ? 1.0 : 0.55;
    this.bundle.uniforms.uTriSharp.value = 5.5;
  }

  private buildArches(): void {
    if (!this.bundle) return;
    for (const piece of this.field.arches) {
      const arch = buildArch(this.field, this.biomeMap, piece);
      this.arches.push(arch);
      const mesh = new THREE.Mesh(arch.geometry, this.bundle.material);
      mesh.position.set(piece.x, 0, piece.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = this.bundle.depthMaterial;
      mesh.name = `terrain.arch`;
      this.group.add(mesh);
      this.archMeshes.push(mesh);
    }
  }

  /* ---------------------------------------------------------------- *
   * Streaming
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    this.frame++;
    const cam = ctx.camera.position;
    this.camX = cam.x;
    this.camZ = cam.z;

    if (ctx.settings.revision !== this.settingsRevision) {
      this.rebuildAll(ctx);
    }

    const moved =
      Math.abs(cam.x - this.lastSelectX) + Math.abs(cam.z - this.lastSelectZ) > LOD0_SIZE * 0.2;
    if (moved || this.frame - this.lastSelectFrame > 20) {
      this.select();
      this.applyVisibility();
      this.lastSelectX = cam.x;
      this.lastSelectZ = cam.z;
      this.lastSelectFrame = this.frame;
    }

    if (!this.waterRef) {
      const w = ctx.tryGet<GameSystem & { surfaceHeightAt?: (x: number, z: number, t: number) => number }>(
        'world.water',
      );
      if (w && typeof w.surfaceHeightAt === 'function') {
        this.waterRef = w as unknown as { surfaceHeightAt(x: number, z: number, t: number): number };
      }
    }

    this.processBuildQueue();
    if ((this.frame & 63) === 0) this.evict();

    this.updateUniforms(dt, ctx);
    if (!this.csmLinked) this.tryLinkCsm(ctx);
  }

  private rebuildAll(ctx: GameContext): void {
    for (const map of this.levelMaps) {
      for (const c of map.values()) this.destroyChunk(c);
      map.clear();
    }
    this.buildQueue.length = 0;
    this.visible.clear();
    this.prevVisible.clear();
    this.configureForSettings(ctx);
    if (this.bundle) {
      this.bundle.uniforms.uStochastic.value = ctx.settings.at('high') ? 1 : 0;
      this.bundle.uniforms.uDetailAmt.value = ctx.settings.at('medium') ? 0.9 : 0.5;
    }
    this.select();
  }

  /** Walks the quadtree and fills `visible` + the build queue. */
  private select(): void {
    const tmp = this.prevVisible;
    this.prevVisible = this.visible;
    this.visible = tmp;
    this.visible.clear();

    const rootSize = LOD0_SIZE * (1 << this.maxLevel);
    const r = this.viewDistance;
    const gx0 = Math.floor((this.camX - r) / rootSize);
    const gx1 = Math.floor((this.camX + r) / rootSize);
    const gz0 = Math.floor((this.camZ - r) / rootSize);
    const gz1 = Math.floor((this.camZ + r) / rootSize);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        this.selectNode(this.maxLevel, gx, gz);
      }
    }
  }

  private selectNode(level: number, gx: number, gz: number): void {
    const size = LOD0_SIZE * (1 << level);
    const d = distXZToBox(this.camX, this.camZ, gx * size, gz * size, size);
    if (d > this.viewDistance) return;

    if (level > 0 && d < this.ranges[level - 1]) {
      const c = 2;
      this.selectNode(level - 1, gx * c, gz * c);
      this.selectNode(level - 1, gx * c + 1, gz * c);
      this.selectNode(level - 1, gx * c, gz * c + 1);
      this.selectNode(level - 1, gx * c + 1, gz * c + 1);
      return;
    }

    const chunk = this.getOrCreate(level, gx, gz);
    chunk.lastUsed = this.frame;
    if (chunk.mesh) {
      this.visible.add(chunk);
      return;
    }
    if (!chunk.queued) {
      chunk.queued = true;
      this.buildQueue.push(chunk);
    }
    // Show the nearest ready ancestor until this one is meshed.
    let l = level + 1;
    let ax = gx >> 1;
    let az = gz >> 1;
    while (l <= this.maxLevel) {
      const anc = this.levelMaps[l].get(keyOf(ax, az));
      if (anc?.mesh) {
        anc.lastUsed = this.frame;
        this.visible.add(anc);
        return;
      }
      ax >>= 1;
      az >>= 1;
      l++;
    }
  }

  private getOrCreate(level: number, gx: number, gz: number): Chunk {
    const map = this.levelMaps[level];
    const key = keyOf(gx, gz);
    let c = map.get(key);
    if (!c) {
      c = {
        level,
        gx,
        gz,
        size: LOD0_SIZE * (1 << level),
        build: null,
        mesh: null,
        queued: false,
        lastUsed: this.frame,
      };
      map.set(key, c);
    }
    return c;
  }

  private processBuildQueue(): void {
    if (!this.buildQueue.length) return;
    // Nearest first; the queue is short so a sort per frame is cheap.
    this.buildQueue.sort(
      (a, b) =>
        distXZToBox(this.camX, this.camZ, a.gx * a.size, a.gz * a.size, a.size) -
        distXZToBox(this.camX, this.camZ, b.gx * b.size, b.gz * b.size, b.size),
    );
    const t0 = performance.now();
    let built = 0;
    while (this.buildQueue.length) {
      const c = this.buildQueue[0];
      // Dropped from the selection while queued.
      if (this.frame - c.lastUsed > 120) {
        this.buildQueue.shift();
        c.queued = false;
        continue;
      }
      this.buildQueue.shift();
      c.queued = false;
      this.meshInto(c);
      built++;
      if (performance.now() - t0 > BUILD_BUDGET_MS) break;
    }
    if (built) {
      // Re-select so freshly meshed chunks replace the coarse stand-ins.
      this.select();
      this.applyVisibility();
    }
  }

  private meshInto(c: Chunk): void {
    if (!this.template || !this.bundle) return;
    const L = c.level;
    const rEnd = this.ranges[L];
    const rPrev = L > 0 ? this.ranges[L - 1] : 0;
    // Morph over the outer part of the band. Everything that can touch a coarser
    // neighbour is beyond rEnd, so it is guaranteed fully morphed there.
    const morphStart = rPrev + (rEnd - rPrev) * 0.45;

    const build = meshChunk({
      field: this.field,
      biomes: this.biomeMap,
      template: this.template,
      size: c.size,
      gx: c.gx,
      gz: c.gz,
      morphStart,
      morphEnd: rEnd,
    });
    c.build = build;

    const mesh = new THREE.Mesh(build.geometry, this.bundle.material);
    mesh.position.set(c.gx * c.size, 0, c.gz * c.size);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    // Only the near levels cast: further chunks contribute nothing a viewer can
    // see through the water column and would eat the whole shadow atlas.
    mesh.castShadow = L <= 2;
    mesh.customDepthMaterial = this.bundle.depthMaterial;
    mesh.visible = false;
    mesh.name = `terrain.chunk.${L}.${c.gx}.${c.gz}`;
    c.mesh = mesh;
    this.group.add(mesh);

    if (build.minY < this.bounds.min) this.bounds.min = build.minY;
    if (build.maxY > this.bounds.max) this.bounds.max = build.maxY;
  }

  private applyVisibility(): void {
    for (const c of this.prevVisible) {
      if (c.mesh && !this.visible.has(c)) c.mesh.visible = false;
    }
    for (const c of this.visible) {
      if (c.mesh) c.mesh.visible = true;
    }
  }

  private evict(): void {
    const cutoff = this.frame - 420;
    for (let l = 0; l <= this.maxLevel; l++) {
      const map = this.levelMaps[l];
      if (map.size < 24) continue;
      for (const [key, c] of map) {
        if (c.lastUsed > cutoff || this.visible.has(c)) continue;
        this.destroyChunk(c);
        map.delete(key);
      }
    }
  }

  private destroyChunk(c: Chunk): void {
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    this.visible.delete(c);
    this.prevVisible.delete(c);
    c.build = null;
  }

  /* ---------------------------------------------------------------- *
   * Per-frame uniforms + optional CSM
   * ---------------------------------------------------------------- */

  private updateUniforms(dt: number, ctx: GameContext): void {
    const u = this.bundle?.uniforms;
    if (!u) return;
    u.uTerrainTime.value = ctx.time;

    // Only when nobody else owns them — the ocean's uniform objects are shared by
    // reference and writing them here would fight the ocean every frame.
    if (this.ownsWaterUniforms) {
      u.uwCameraDepth.value = Math.max(0, -ctx.camera.position.y);
      u.uwTime.value = ctx.time;
    }

    // The ocean generates its caustics during *its* init, which runs after ours,
    // so pick the real texture up as soon as it exists and follow the tile size
    // and strength it publishes. `uwCausticsParams.w` is 0 when the ocean runs a
    // screen-space caustics pass, in which case we stay out of its way.
    const water = ctx.tryGet<GameSystem & {
      causticsTexture?: THREE.Texture | null;
      sharedUniforms?: Record<string, THREE.IUniform>;
    }>('world.water');
    const causticTex = water?.causticsTexture ?? null;
    if (causticTex && u.tCaustics.value !== causticTex) {
      causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
      u.tCaustics.value = causticTex;
    }
    const cp = water?.sharedUniforms?.uwCausticsParams?.value as THREE.Vector4 | undefined;
    if (cp) {
      u.uCausticTile.value = Math.max(1, cp.y);
      u.uCausticFall.value = Math.max(0.002, cp.z);
      // Own-pass strength when the ocean is not doing screen-space caustics,
      // otherwise a light touch so the two do not stack into blown highlights.
      u.uCausticAmt.value = cp.w > 0.5 ? cp.x : cp.x * 0.35;
    }

    // Rock tint follows the biome you are actually in, so cliffs stay in family
    // with the sand. Lerped so a biome border does not snap.
    const s = this.biomeMap.sample(this.camX, this.camZ);
    const def = BIOME_MAP.get(s.id);
    if (def) {
      const rock = def.rockColor ?? def.floorColor;
      _tintA.setRGB(
        rock.r / Math.max(def.floorColor.r, 0.02),
        rock.g / Math.max(def.floorColor.g, 0.02),
        rock.b / Math.max(def.floorColor.b, 0.02),
      );
      _tintB.copy(u.uRockTint.value as THREE.Color);
      _tintB.lerp(_tintA, Math.min(1, dt * 1.5));
      (u.uRockTint.value as THREE.Color).copy(_tintB);
    }

    // Wetness/sheen tracks how much sun is actually reaching the floor.
    const sky = ctx.tryGet<GameSystem & { sunIntensity?: number }>('world.sky');
    const sun = sky?.sunIntensity ?? 2;
    u.uWetness.value = 0.28 + 0.35 * Math.min(1, sun / 3);
  }

  /**
   * If the sky system runs cascaded shadow maps, register our material with it.
   * Duck-typed and defensive: the sky agent owns that API and it may not exist.
   */
  private tryLinkCsm(ctx: GameContext): void {
    this.csmLinked = true;
    const mat = this.bundle?.material;
    if (!mat) return;
    const sky = ctx.tryGet<GameSystem & Record<string, unknown>>('world.sky');
    const csm = sky ? (sky.csm as { setupMaterial?: (m: THREE.Material) => void } | undefined) : undefined;
    try {
      if (csm && typeof csm.setupMaterial === 'function') {
        const mine = mat.onBeforeCompile;
        csm.setupMaterial(mat);
        const theirs = mat.onBeforeCompile;
        if (theirs !== mine) {
          mat.onBeforeCompile = (shader, renderer) => {
            theirs.call(mat, shader, renderer);
            mine.call(mat, shader, renderer);
          };
        }
        mat.needsUpdate = true;
      } else if (typeof sky?.registerShadowMaterial === 'function') {
        (sky.registerShadowMaterial as (m: THREE.Material) => void)(mat);
      }
    } catch (err) {
      console.warn('[terrain] CSM link failed, falling back to the plain shadow map', err);
    }
  }

  /* ---------------------------------------------------------------- *
   * WorldQuery
   * ---------------------------------------------------------------- */

  /** Finest *meshed* chunk containing (x, z), or null. */
  private finestChunkAt(x: number, z: number): Chunk | null {
    for (let l = 0; l <= this.maxLevel; l++) {
      const size = LOD0_SIZE * (1 << l);
      const c = this.levelMaps[l].get(keyOf(Math.floor(x / size), Math.floor(z / size)));
      if (c && c.build) return c;
    }
    return null;
  }

  /**
   * Sea-floor height. Reads the resident chunk's sampled lattice using the same
   * triangulation the mesh uses, so the player collides with exactly what is
   * drawn; falls back to the analytic field outside the streamed region.
   */
  heightAt(x: number, z: number): number {
    const c = this.finestChunkAt(x, z);
    if (!c || !c.build) return this.field.height(x, z);
    const b = c.build;
    const fx = (x - b.hOriginX) / b.hStep;
    const fz = (z - b.hOriginZ) / b.hStep;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    const lim = b.hSide - 2;
    if (i < 0) i = 0;
    else if (i > lim) i = lim;
    if (j < 0) j = 0;
    else if (j > lim) j = lim;
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const h = b.heights;
    const row = j * b.hSide + i;
    const h00 = h[row];
    const h10 = h[row + 1];
    const h01 = h[row + b.hSide];
    const h11 = h[row + b.hSide + 1];
    // The mesh splits each quad along the (0,1)-(1,0) diagonal.
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.6;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  biomeAt(x: number, z: number): BiomeSample {
    return this.biomeMap.sample(x, z);
  }

  isSolid(x: number, y: number, z: number): boolean {
    if (y < this.heightAt(x, z)) return true;
    for (let i = 0; i < this.arches.length; i++) {
      if (archSolid(this.arches[i], x, y, z)) return true;
    }
    return false;
  }

  waterHeightAt(x: number, z: number, time: number): number {
    const w = this.waterRef;
    return w ? w.surfaceHeightAt(x, z, time) : 0;
  }

  private waterRef: { surfaceHeightAt(x: number, z: number, t: number): number } | null = null;

  /**
   * Ambient current: a slowly turning horizontal field from the terrain flow
   * map, damped with depth, plus a tidal breath and a weak vertical component
   * over slopes so kelp and particulate never look static.
   */
  currentAt(x: number, y: number, z: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const strength = this.field.flowInto(x, z, _flow2);
    const depth = Math.max(0, -y);
    // Surface-driven flow decays with depth; deep water keeps a slow drift.
    const depthFactor = 0.22 + 0.78 * Math.exp(-depth / 90);
    const tide = 0.72 + 0.28 * Math.sin(time * 0.07 + x * 0.002 + z * 0.0017);
    const mag = (0.16 + 0.5 * strength) * depthFactor * tide;
    // Upwelling over steep ground.
    this.normalAt(x, z, _v3);
    const slope = 1 - Math.min(1, Math.max(0, _v3.y));
    const floor = this.heightAt(x, z);
    const nearFloor = Math.exp(-Math.max(0, y - floor) / 12);
    const vy = slope * nearFloor * 0.28 * Math.sin(time * 0.21 + x * 0.03);
    return out.set(_flow2.x * mag, vy, _flow2.y * mag);
  }

  /**
   * Sphere-traced raycast against the heightfield. Steps proportionally to the
   * clearance above the floor, then bisects, so it is both cheap and accurate.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): THREE.Vector3 | null {
    _rayD.copy(dir).normalize();
    _rayP.copy(origin);
    let t = 0;
    let prevT = 0;
    let prevGap = _rayP.y - this.heightAt(_rayP.x, _rayP.z);
    if (prevGap <= 0) return origin.clone();
    while (t < maxDist) {
      const step = Math.min(Math.max(0.35, prevGap * 0.7), 24);
      t += step;
      if (t > maxDist) t = maxDist;
      _rayP.copy(origin).addScaledVector(_rayD, t);
      const gap = _rayP.y - this.heightAt(_rayP.x, _rayP.z);
      if (gap <= 0) {
        // bisect between prevT and t
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) * 0.5;
          _rayP.copy(origin).addScaledVector(_rayD, mid);
          if (_rayP.y - this.heightAt(_rayP.x, _rayP.z) <= 0) hi = mid;
          else lo = mid;
        }
        return _rayP.copy(origin).addScaledVector(_rayD, hi).clone();
      }
      prevT = t;
      prevGap = gap;
      if (t >= maxDist) break;
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * Housekeeping
   * ---------------------------------------------------------------- */

  resize(): void {
    /* nothing resolution-dependent */
  }

  /**
   * Diagnostic: reads one texel per splat layer back off the GPU so a headless
   * harness can prove the packed arrays hold real content. Never called on a
   * normal frame.
   */
  /** Diagnostic: see `uDebugView` in TerrainMaterial. 0 restores the real look. */
  debugSetView(mode: number): void {
    if (this.bundle) this.bundle.uniforms.uDebugView.value = mode;
  }

  debugProbeTextures(lod = 0): Record<string, number[]> | null {
    if (!this.renderer || !this.packed) return null;
    return probeTerrainTextures(this.renderer, this.packed, this.srcSets, lod);
  }

  dispose(): void {
    for (const map of this.levelMaps) {
      for (const c of map.values()) this.destroyChunk(c);
      map.clear();
    }
    this.buildQueue.length = 0;
    for (const m of this.archMeshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.archMeshes.length = 0;
    this.arches.length = 0;
    this.template?.dispose();
    this.bundle?.dispose();
    this.packed?.dispose();
    this.group.removeFromParent();
  }

  /** Late binding so the water system does not need to exist during our init. */
  linkWater(w: { surfaceHeightAt(x: number, z: number, t: number): number }): void {
    this.waterRef = w;
  }
}

/** Re-exported so consumers can `import { BIOMES } from './terrain/TerrainSystem'`. */
export { BIOMES };

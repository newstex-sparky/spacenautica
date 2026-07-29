/**
 * `world.flora` — the instanced vegetation layer: kelp forests, seagrass
 * meadows, coral gardens, mushroom stands and bioluminescent thickets.
 *
 * Pipeline
 *   init    bake N seeded geometry variants per species per LOD, software-bake a
 *           billboard impostor from each simplified variant, build one material
 *           per (species, LOD) and one InstancedMesh per (species, LOD, variant).
 *   stream  a spatial hash of 24 m cells is filled lazily, a few cells per frame,
 *           from biome flora densities, terrain depth/slope and a clump field.
 *   fill    every ~0.3 s (or when the camera moves) the live cells are walked,
 *           per-instance frustum- and budget-culled, and written into the
 *           instance buffers of whichever LOD bands their distance falls in.
 *   frame   only uniforms change: time, the shared current field, player
 *           position/velocity for the parting push, and the dither jitter.
 *
 * All motion and all LOD crossfading happen on the GPU, so the per-frame CPU
 * cost between fills is a handful of uniform writes.
 */
import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { GameContext, GameSystem } from '../../core/Types';
import type { TextureLibrary } from '../../assets/TextureLibrary';
import { crossCard } from './FloraGeometry';
import {
  createFloraGlobals,
  createFloraMaterial,
  fallbackWaterUniforms,
} from './FloraMaterial';
import type { FloraGlobals, FloraMaterial } from './FloraMaterial';
import { FloraField } from './FloraPopulation';
import type { FloraCell } from './FloraPopulation';
import { SPECIES } from './FloraSpecies';
import type { SpeciesDef } from './FloraSpecies';
import { bakeImpostor, generateFloraMaps } from './FloraTextures';
import type { FloraFamily, FloraMapSet } from './FloraTextures';

/* ------------------------------------------------------------------ *
 * Module-scope scratch — nothing in update() allocates.
 * ------------------------------------------------------------------ */
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _v3d = new THREE.Vector3();
const _scaleV = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quatTilt = new THREE.Quaternion();
const _quatYaw = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _projView = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _up = new THREE.Vector3(0, 1, 0);
const _identityQ = new THREE.Quaternion();

const LOD_COUNT = 3;
/** Fraction of each LOD boundary used as the dithered crossfade window. */
const BAND = 0.13;
/** Instance-slot share of the global budget per LOD level. */
const LOD_SHARE = [0.16, 0.20, 0.26];
const BASE_BUDGET = 6000;
/**
 * Radius in metres that is always populated at full density. Budget pressure is
 * absorbed entirely by the far field, so a tight foliage budget makes the
 * distance thin out — it never hollows out the plants at your mask.
 */
const NEAR_FULL = 26;
/** Wall-clock cell-generation budget, milliseconds: [burst, high, low]. */
const STREAM_MS = [26, 3.5, 2.2];
/** Cells around the camera that are generated unconditionally, ignoring the clock. */
const CORE_CELLS = 2;

const nowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

interface Bucket {
  species: number;
  lod: number;
  variant: number;
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: FloraMaterial;
  aInst: THREE.InstancedBufferAttribute;
  aWarp: THREE.InstancedBufferAttribute;
  aTint: THREE.InstancedBufferAttribute;
  matrices: Float32Array;
  capacity: number;
  count: number;
}

interface SpeciesRuntime {
  def: SpeciesDef;
  /** Measured height in metres at scale 1. */
  height: number;
  variants: number[];
  /** [lod][variant] */
  buckets: Bucket[][];
  /** Distance boundaries in metres. */
  bounds: [number, number, number];
}

export class FloraSystem implements GameSystem {
  readonly name = 'world.flora';
  readonly phase = Phase.World;

  protected group = new THREE.Group();
  private globals: FloraGlobals = createFloraGlobals();
  private waterUniforms: Record<string, THREE.IUniform> = fallbackWaterUniforms();
  private maps = new Map<FloraFamily, FloraMapSet>();
  private runtime: SpeciesRuntime[] = [];
  private buckets: Bucket[] = [];
  private ownedTextures: THREE.Texture[] = [];
  private field: FloraField | null = null;
  private liveCells: FloraCell[] = [];
  private cellOffsets: Int32Array = new Int32Array(0);
  /** Index (in `cellOffsets` units) one past the last core-ring cell. */
  private coreEnd = 0;
  private fallbackNoise: THREE.Texture | null = null;

  private cellSize = 24;
  private candidateRes = 16;
  private radius = 200;
  private cellRadius = 10;
  private budget = BASE_BUDGET;
  private densityScale = 1;
  private settingsRevision = -1;

  /**
   * Streaming/LOD origin. `player.position` when the player system publishes it,
   * because `player.camera` resolves `ctx.camera` in `Phase.Camera` — a whole
   * frame *after* `Phase.World` — so keying off the camera makes flora stream to
   * where the player was last frame. Harmless at 60 fps, fatal on a teleport at
   * low frame rates: the plants get placed and culled for the old viewpoint and
   * the new one renders bare.
   */
  private anchor = new THREE.Vector3(1e9, 1e9, 1e9);
  /** One fill that ignores the frustum, used right after a teleport. */
  private wideFill = true;
  private lastFillPos = new THREE.Vector3(1e9, 1e9, 1e9);
  private lastFillDir = new THREE.Vector3();
  private lastFillTime = -1e9;
  private lastStreamCell = { x: 1e9, z: 1e9 };
  private warm = false;
  private drawn = 0;
  private cullCam = new THREE.PerspectiveCamera();

  /** Total instances drawn last fill — read by the HUD/debug overlay. */
  get instanceCount(): number {
    return this.drawn;
  }

  /* ---------------------------------------------------------------- *
   * init
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.group.name = 'world.flora';
    this.group.matrixAutoUpdate = false;
    ctx.scene.add(this.group);

    const g = ctx.settings.graphics;
    const aniso = Math.min(g.anisotropy, ctx.renderer.capabilities.getMaxAnisotropy());

    // Shared water uniforms — a single change to water colour must propagate here.
    const water = ctx.tryGet<GameSystem & { sharedUniforms?: Record<string, THREE.IUniform> }>('world.water');
    if (water?.sharedUniforms) this.waterUniforms = water.sharedUniforms;

    const textures = ctx.tryGet<TextureLibrary>('assets.textures');
    if (textures?.blueNoise) {
      this.globals.uBlueNoise.value = textures.blueNoise;
    } else {
      this.fallbackNoise = makeFallbackNoise(64);
      this.globals.uBlueNoise.value = this.fallbackNoise;
    }
    const noiseSize = (this.globals.uBlueNoise.value?.image as { width?: number } | undefined)?.width ?? 128;
    this.globals.uBlueNoiseScale.value.set(1 / noiseSize, 1 / noiseSize);

    const texSize = ctx.settings.at('high') ? 256 : g.tier === 'medium' ? 192 : 128;
    for (const family of ['blade', 'crust', 'flesh'] as FloraFamily[]) {
      this.maps.set(family, generateFloraMaps(family, texSize, 0x5e2 + family.length * 7717, aniso));
    }

    this.applyQuality(ctx, aniso);
    this.settingsRevision = ctx.settings.revision;
    // Candidate sites per cell edge. This is the hard ceiling on plants per
    // square metre (1 / step^2), so 16 over a 24 m cell caps a seagrass meadow
    // at 0.44 plants/m^2 — and saturating a jittered grid is exactly what makes
    // foliage read as "gridded". A finer grid both raises the ceiling and leaves
    // the Poisson rejection room to scatter.
    this.candidateRes = ctx.settings.at('high') ? 22 : ctx.settings.at('medium') ? 18 : 13;
    this.buildCellOffsets();
  }

  /**
   * The field is built on the first frame rather than in `init` so it always
   * captures the real `ctx.world` that the terrain system installs, regardless
   * of registration order.
   */
  private ensureField(ctx: GameContext): FloraField {
    if (!this.field) {
      this.field = new FloraField(
        {
          cellSize: this.cellSize,
          gridRes: 13,
          candidates: this.candidateRes,
          plantsPerM2: 0.17,
          seed: 20260728,
        },
        ctx.world,
        this.runtime.map((r) => r.height),
      );
    }
    return this.field;
  }

  /** Builds every geometry, material and instanced mesh for the current tier. */
  private applyQuality(ctx: GameContext, aniso: number): void {
    const g = ctx.settings.graphics;
    this.budget = Math.max(400, Math.round(BASE_BUDGET * g.foliageDensity));
    this.radius = Math.min(230, Math.max(90, g.viewDistance * 0.30));
    this.cellRadius = Math.ceil(this.radius / this.cellSize) + 1;

    const lowTier = !ctx.settings.at('medium');
    const midTier = !ctx.settings.at('high');

    for (const sp of SPECIES) {
      const variantCounts = [
        lowTier ? 1 : midTier ? Math.min(2, sp.variants[0]) : sp.variants[0],
        lowTier ? 1 : sp.variants[1],
        1,
      ];
      const maps = this.maps.get(sp.family)!;

      // --- LOD 0 / 1: real meshes ---
      const geoms: THREE.BufferGeometry[][] = [[], [], []];
      let height = 0.5;
      for (let lod = 0; lod < 2; lod++) {
        for (let v = 0; v < variantCounts[lod]; v++) {
          const geo = sp.build(hashSeed(sp.id, lod, v), lod);
          geoms[lod].push(geo);
          const bb = geo.boundingBox;
          if (bb) height = Math.max(height, bb.max.y);
        }
      }

      // --- LOD 2: impostor cards baked from the simplified mesh ---
      const cardTextures: THREE.Texture[] = [];
      for (let v = 0; v < variantCounts[2]; v++) {
        const src = geoms[1][v % geoms[1].length];
        const tint = sp.color.clone();
        const imp = bakeImpostor(src, tint, lowTier ? 48 : 64, lowTier ? 96 : 128, aniso);
        cardTextures.push(imp.texture);
        this.ownedTextures.push(imp.texture);
        const bb = src.boundingBox;
        const h = bb ? bb.max.y : height;
        geoms[2].push(crossCard(h * imp.aspect, h, sp.cardQuads, sp.emissiveStrength > 0 ? 0.5 : 0, sp.cardHorizontal));
      }

      const bounds: [number, number, number] = [
        sp.lodDist[0],
        sp.lodDist[1],
        Math.min(sp.lodDist[2], this.radius + 12),
      ];

      const buckets: Bucket[][] = [];
      for (let lod = 0; lod < LOD_COUNT; lod++) {
        const card = lod === 2;
        const inWin: [number, number] =
          lod === 0 ? [-2, -1] : [bounds[lod - 1] * (1 - BAND), bounds[lod - 1] * (1 + BAND)];
        const outWin: [number, number] = [bounds[lod] * (1 - BAND), bounds[lod] * (1 + BAND)];

        const mat = createFloraMaterial(
          {
            color: sp.color,
            maps: card
              ? { map: cardTextures[0], normalMap: null, roughnessMap: null }
              : { map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap },
            roughness: sp.roughness,
            metalness: sp.metalness,
            normalScale: sp.normalScale * (lod === 1 ? 0.8 : 1),
            swayAmp: sp.swayAmp,
            swayFreq: sp.swayFreq,
            stiffness: sp.stiffness,
            undulate: sp.undulate,
            waveScale: sp.waveScale,
            flutter: card ? sp.flutter * 0.4 : sp.flutter,
            plantHeight: height,
            texScale: sp.texScale,
            microScale: sp.microScale,
            microAmt: g.tier === 'low' ? sp.microAmt * 0.5 : sp.microAmt,
            macroScale: sp.macroScale,
            macroAmt: sp.macroAmt,
            aoAmt: sp.aoAmt,
            transColor: sp.transColor,
            transStrength: sp.transStrength * (card ? 1.25 : 1),
            transPower: sp.transPower,
            sheen: card ? sp.sheen * 0.5 : sp.sheen,
            sheenGloss: sp.sheenGloss,
            emissiveColor: sp.emissiveColor,
            emissiveStrength: sp.emissiveStrength,
            emissivePulse: sp.emissivePulse,
            lodIn: inWin,
            lodOut: outWin,
            // Complementary dither parity: neighbouring LODs must invert.
            ditherInvert: lod === 1,
            alphaMode: card ? 'card' : sp.alphaMode,
            alphaTest: card ? 0.33 : sp.alphaTest,
            card,
            depthWrite: true,
            name: `flora.${sp.id}.lod${lod}`,
          },
          this.globals,
          this.waterUniforms,
        );

        const row: Bucket[] = [];
        const cap = Math.max(48, Math.round((this.budget * LOD_SHARE[lod]) / variantCounts[lod]));
        for (let v = 0; v < variantCounts[lod]; v++) {
          row.push(this.makeBucket(SPECIES.indexOf(sp), lod, v, geoms[lod][v], mat, cap));
        }
        buckets.push(row);
      }

      this.runtime.push({ def: sp, height, variants: variantCounts, buckets, bounds });
    }
  }

  private makeBucket(
    species: number,
    lod: number,
    variant: number,
    geometry: THREE.BufferGeometry,
    material: FloraMaterial,
    capacity: number,
  ): Bucket {
    const aInst = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const aWarp = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const aTint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    aInst.setUsage(THREE.DynamicDrawUsage);
    aWarp.setUsage(THREE.DynamicDrawUsage);
    aTint.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aInst', aInst);
    geometry.setAttribute('aWarp', aWarp);
    geometry.setAttribute('aTint', aTint);

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    // Culling is done per instance on the CPU; the batch itself spans the disc.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = `flora.${SPECIES[species].id}.l${lod}.v${variant}`;
    this.group.add(mesh);

    const bucket: Bucket = {
      species,
      lod,
      variant,
      mesh,
      geometry,
      material,
      aInst,
      aWarp,
      aTint,
      matrices: mesh.instanceMatrix.array as Float32Array,
      capacity,
      count: 0,
    };
    this.buckets.push(bucket);
    return bucket;
  }

  /** Cell offsets inside the streaming radius, nearest first. */
  private buildCellOffsets(): void {
    const r = this.cellRadius;
    const list: Array<[number, number, number]> = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > r + 0.5) continue;
        list.push([dx, dz, d]);
      }
    }
    list.sort((a, b) => a[2] - b[2]);
    this.cellOffsets = new Int32Array(list.length * 2);
    this.coreEnd = 0;
    for (let i = 0; i < list.length; i++) {
      this.cellOffsets[i * 2] = list[i][0];
      this.cellOffsets[i * 2 + 1] = list[i][1];
      // Core ring: never deferred by the streaming clock, so the ground you can
      // actually reach out and touch is populated on the frame you arrive.
      if (list[i][2] <= CORE_CELLS + 0.5) this.coreEnd = (i + 1) * 2;
    }
  }

  /* ---------------------------------------------------------------- *
   * update
   * ---------------------------------------------------------------- */

  update(_dt: number, ctx: GameContext): void {
    if (this.buckets.length === 0) return;
    this.ensureField(ctx);

    if (ctx.settings.revision !== this.settingsRevision) {
      this.settingsRevision = ctx.settings.revision;
      const g = ctx.settings.graphics;
      this.budget = Math.max(400, Math.round(BASE_BUDGET * g.foliageDensity));
      const newRadius = Math.min(230, Math.max(90, g.viewDistance * 0.30));
      if (Math.abs(newRadius - this.radius) > 1) {
        this.radius = newRadius;
        this.cellRadius = Math.ceil(this.radius / this.cellSize) + 1;
        this.buildCellOffsets();
        this.lastStreamCell.x = 1e9;
      }
      this.lastFillTime = -1e9;
    }

    // Resolve the streaming origin before anything reads it.
    const player = ctx.tryGet<GameSystem & { position?: THREE.Vector3 }>('player');
    _v3d.copy(player?.position ?? ctx.camera.position);
    // A teleport (spawn, load, vehicle exit) needs one omnidirectional fill: the
    // camera's own orientation still lags a frame, so a frustum-culled fill would
    // populate the direction we *were* facing.
    if (_v3d.distanceToSquared(this.anchor) > 900) this.wideFill = true;
    this.anchor.copy(_v3d);

    this.updateUniforms(ctx);
    this.stream(ctx);

    ctx.camera.getWorldDirection(_v3a);
    const moved = this.anchor.distanceToSquared(this.lastFillPos);
    const turned = 1 - _v3a.dot(this.lastFillDir);
    if (this.wideFill || moved > 2.25 || turned > 0.045 || ctx.time - this.lastFillTime > 0.3) {
      this.lastFillPos.copy(this.anchor);
      this.lastFillDir.copy(_v3a);
      this.lastFillTime = ctx.time;
      this.fill(ctx);
    }
  }

  private updateUniforms(ctx: GameContext): void {
    const gl = this.globals;
    gl.uTime.value = ctx.time;

    // --- shared current field: base + linear XZ gradient from three probes ---
    const cam = ctx.camera;
    const t = ctx.time;
    const D = 64;
    ctx.world.currentAt(cam.position.x, cam.position.y, cam.position.z, t, _v3b);
    if (_v3b.lengthSq() < 0.0064) {
      // The world has no current field yet — keep the water alive anyway.
      _v3b.set(Math.cos(t * 0.07), 0, Math.sin(t * 0.07)).multiplyScalar(0.45);
    }
    ctx.world.currentAt(cam.position.x + D, cam.position.y, cam.position.z, t, _v3c);
    ctx.world.currentAt(cam.position.x, cam.position.y, cam.position.z + D, t, _v3d);
    gl.uFlowOrigin.value.copy(cam.position);
    gl.uFlowBase.value.copy(_v3b).multiplyScalar(1.7);
    if (gl.uFlowBase.value.lengthSq() > 3.24) gl.uFlowBase.value.setLength(1.8);
    gl.uFlowGradX.value.subVectors(_v3c, _v3b).multiplyScalar(1.7 / D);
    gl.uFlowGradZ.value.subVectors(_v3d, _v3b).multiplyScalar(1.7 / D);
    gl.uGustAmp.value = 0.42;

    // --- player parting ---
    const player = ctx.tryGet<GameSystem & { position?: THREE.Vector3; velocity?: THREE.Vector3 }>('player');
    const pos = player?.position ?? cam.position;
    gl.uPlayerPos.value.copy(pos);
    if (player?.velocity) gl.uPlayerVel.value.copy(player.velocity);
    else gl.uPlayerVel.value.set(0, 0, 0);
    gl.uPushRadius.value = 2.6;
    gl.uPushStrength.value = 1.15;

    // --- dither jitter so TAA can resolve the crossfade ---
    if (ctx.settings.graphics.taa) {
      gl.uDitherOffset.value.set(
        (ctx.frame * 0.7548776662) % 1,
        (ctx.frame * 0.5698402909) % 1,
      );
    } else {
      gl.uDitherOffset.value.set(0, 0);
    }
  }

  /**
   * Fills cells nearest-first against a **wall-clock** budget rather than a
   * fixed per-frame quota.
   *
   * A fixed quota is wrong at the two moments that matter most: the first frame
   * after load and the frame after a teleport. The streaming disc holds a few
   * hundred cells, so two cells a frame means the world is visibly bare for
   * seconds — and if the frame rate is low (a slow GPU, or a headless capture
   * where a frame costs a second) it is bare more or less permanently. So a
   * jump of more than one cell, or a cold field, triggers a one-off burst that
   * populates as much of the disc as fits in ~26 ms; steady swimming then costs
   * only a couple of milliseconds a frame.
   */
  private stream(ctx: GameContext): void {
    const field = this.field!;
    const ccx = Math.floor(this.anchor.x / this.cellSize);
    const ccz = Math.floor(this.anchor.z / this.cellSize);

    const jumped =
      !this.warm ||
      Math.abs(ccx - this.lastStreamCell.x) > 1 ||
      Math.abs(ccz - this.lastStreamCell.z) > 1;
    const budgetMs = jumped ? STREAM_MS[0] : ctx.settings.at('high') ? STREAM_MS[1] : STREAM_MS[2];
    // Always make progress even if the clock says the budget is already gone.
    const minCells = jumped ? 12 : 1;

    const t0 = nowMs();
    let generated = 0;
    const offsets = this.cellOffsets;
    for (let i = 0; i < offsets.length; i += 2) {
      const cx = ccx + offsets[i];
      const cz = ccz + offsets[i + 1];
      if (field.has(cx, cz)) continue;
      if (i >= this.coreEnd && generated >= minCells && nowMs() - t0 > budgetMs) break;
      field.ensure(cx, cz);
      generated++;
    }
    this.warm = true;

    if (generated > 0 || ccx !== this.lastStreamCell.x || ccz !== this.lastStreamCell.z) {
      this.lastStreamCell.x = ccx;
      this.lastStreamCell.z = ccz;
      this.liveCells.length = 0;
      for (let i = 0; i < offsets.length; i += 2) {
        const cell = field.get(ccx + offsets[i], ccz + offsets[i + 1]);
        if (cell && cell.count > 0) this.liveCells.push(cell);
      }
      this.lastFillTime = -1e9;
    }
    for (const cell of this.liveCells) cell.touched = ctx.frame;
    // A teleport leaves a whole disc of cells behind it. `cellOffsets` holds two
    // ints per cell, so its length is exactly 2x the live disc — use it as a
    // "twice the working set" cap and drop everything stale the moment we exceed
    // it, rather than waiting for the slow periodic sweep.
    if (field.cells.size > this.cellOffsets.length) field.evictUntouched(ctx.frame, 0);
    else if (ctx.frame % 240 === 0) field.evictUntouched(ctx.frame, 900);
  }

  /**
   * Walks the live cells and writes each surviving instance into every LOD band
   * it currently overlaps. An instance in a transition window is written to both
   * neighbouring LODs; their complementary dither keeps total coverage at 1.
   */
  private fill(ctx: GameContext): void {
    const cam = ctx.camera;
    for (const b of this.buckets) b.count = 0;

    // Widened frustum so a refill lagging a fast turn never pops a plant in.
    this.cullCam.matrixWorld.copy(cam.matrixWorld);
    this.cullCam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    this.cullCam.fov = Math.min(150, cam.fov * 1.55);
    this.cullCam.aspect = cam.aspect * 1.3;
    this.cullCam.near = 0.05;
    this.cullCam.far = this.radius + 60;
    this.cullCam.updateProjectionMatrix();
    _projView.multiplyMatrices(this.cullCam.projectionMatrix, this.cullCam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projView);

    // Distances are measured from the streaming anchor, which leads the camera.
    const camX = this.anchor.x;
    const camY = this.anchor.y;
    const camZ = this.anchor.z;
    const wide = this.wideFill;
    this.wideFill = false;
    const radius2 = this.radius * this.radius;
    const density = this.densityScale;
    // The budget controller shortens the thinning ramp instead of scaling it.
    // Scaling a fixed ramp thins the whole disc uniformly, which puts holes in
    // the bed at your mask; shortening it keeps `NEAR_FULL` metres at full
    // density and pulls the falloff in toward you as the budget tightens.
    const fadeEnd = NEAR_FULL + Math.max(14, (this.radius - NEAR_FULL) * density);
    let total = 0;

    for (const cell of this.liveCells) {
      const dxC = cell.centreX - camX;
      const dzC = cell.centreZ - camZ;
      if (dxC * dxC + dzC * dzC > (this.radius + this.cellSize) * (this.radius + this.cellSize)) continue;
      if (!wide) {
        _sphere.center.set(cell.centreX, cell.centreY, cell.centreZ);
        _sphere.radius = cell.radius;
        if (!_frustum.intersectsSphere(_sphere)) continue;
      }

      const { species, variant, pos, nrm, data, warp, tint, xform } = cell;
      for (let i = 0; i < cell.count; i++) {
        const x = pos[i * 3];
        const y = pos[i * 3 + 1];
        const z = pos[i * 3 + 2];
        const dx = x - camX;
        const dz = z - camZ;
        const flat2 = dx * dx + dz * dz;
        if (flat2 > radius2) continue;

        const si = species[i];
        const rt = this.runtime[si];
        const dy = y - camY;
        const dist = Math.sqrt(flat2 + dy * dy);
        if (dist > rt.bounds[2] * (1 + BAND)) continue;

        // Stable, hash-based distance thinning: never flickers, always the same
        // plants survive at the same range.
        const keep = 1 - 0.97 * smoothstep(NEAR_FULL, fadeEnd, dist);
        if (data[i * 4 + 3] > keep) continue;

        const scale = xform[i * 2];
        if (!wide) {
          _sphere.center.set(x, y + rt.height * scale * 0.5, z);
          _sphere.radius = rt.height * scale * 0.62 + 1.5;
          if (!_frustum.intersectsSphere(_sphere)) continue;
        }

        // Which LOD bands does this distance fall in?
        const lo = lodLow(dist, rt.bounds);
        const hi = lodHigh(dist, rt.bounds);
        for (let lod = lo; lod <= hi; lod++) {
          const row = rt.buckets[lod];
          const b = row[variant[i] % row.length];
          if (b.count >= b.capacity) continue;

          const k = b.count++;
          total++;

          // Orientation: partial alignment to the sea-floor normal, then the
          // plant's own spin about its axis.
          _v3a.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
          const align = rt.def.alignToNormal;
          if (align > 0.01) {
            _quatTilt.setFromUnitVectors(_up, _v3a);
            _quat.slerpQuaternions(_identityQ, _quatTilt, align);
          } else {
            _quat.identity();
          }
          _quatYaw.setFromAxisAngle(_up, xform[i * 2 + 1]);
          _quat.multiply(_quatYaw);
          _v3b.set(x, y, z);
          _scaleV.setScalar(scale);
          _mat4.compose(_v3b, _quat, _scaleV);
          _mat4.toArray(b.matrices, k * 16);

          const ia = b.aInst.array as Float32Array;
          ia[k * 4] = data[i * 4];
          ia[k * 4 + 1] = data[i * 4 + 1];
          ia[k * 4 + 2] = data[i * 4 + 2];
          ia[k * 4 + 3] = data[i * 4 + 3];
          const wa = b.aWarp.array as Float32Array;
          wa[k * 4] = warp[i * 4];
          wa[k * 4 + 1] = warp[i * 4 + 1];
          wa[k * 4 + 2] = warp[i * 4 + 2];
          wa[k * 4 + 3] = warp[i * 4 + 3];
          const ta = b.aTint.array as Float32Array;
          ta[k * 3] = tint[i * 3];
          ta[k * 3 + 1] = tint[i * 3 + 1];
          ta[k * 3 + 2] = tint[i * 3 + 2];
        }
      }
      // `liveCells` is ordered nearest-first, so an overrun only ever drops the
      // furthest cells — and it bounds the walk on very dense sea floors.
      if (total > this.budget * 1.6) break;
    }

    for (const b of this.buckets) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      if (b.count === 0) continue;
      markRange(b.mesh.instanceMatrix, b.count * 16);
      markRange(b.aInst, b.count * 4);
      markRange(b.aWarp, b.count * 4);
      markRange(b.aTint, b.count * 3);
    }

    this.drawn = total;
    // Self-tuning density so the budget is respected on any terrain. A wide fill
    // covers the whole sphere instead of the view cone, so its count says nothing
    // about the steady-state cost — never let it drive the controller.
    if (wide) return;
    if (total > this.budget * 1.05) this.densityScale = Math.max(0.06, this.densityScale * 0.9);
    else if (total < this.budget * 0.72) this.densityScale = Math.min(1, this.densityScale * 1.06);
  }

  /* ---------------------------------------------------------------- *
   * teardown
   * ---------------------------------------------------------------- */

  dispose(): void {
    for (const b of this.buckets) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
      b.geometry.dispose();
    }
    // Materials are shared per (species, lod); dispose each exactly once.
    const seen = new Set<THREE.Material>();
    for (const b of this.buckets) {
      if (seen.has(b.material)) continue;
      seen.add(b.material);
      b.material.dispose();
    }
    this.buckets.length = 0;
    this.runtime.length = 0;

    for (const set of this.maps.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
    }
    this.maps.clear();
    for (const t of this.ownedTextures) t.dispose();
    this.ownedTextures.length = 0;
    this.fallbackNoise?.dispose();
    this.fallbackNoise = null;

    this.field?.clear();
    this.field = null;
    this.liveCells.length = 0;
    this.group.removeFromParent();
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

/** Lowest LOD level whose band still contains `d`. */
function lodLow(d: number, bounds: [number, number, number]): number {
  if (d < bounds[0] * (1 + BAND)) return 0;
  if (d < bounds[1] * (1 + BAND)) return 1;
  return 2;
}

/** Highest LOD level whose band already contains `d`. */
function lodHigh(d: number, bounds: [number, number, number]): number {
  if (d < bounds[0] * (1 - BAND)) return 0;
  if (d < bounds[1] * (1 - BAND)) return 1;
  return 2;
}

function markRange(attr: THREE.BufferAttribute | THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}

function hashSeed(id: string, lod: number, variant: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= Math.imul(lod + 1, 0x9e3779b1);
  h ^= Math.imul(variant + 7, 0x85ebca6b);
  return h >>> 0;
}

/** Used only if `assets.textures` has not published a blue-noise texture. */
function makeFallbackNoise(size: number): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = (Math.random() * 255) | 0;
    data[i * 4] = v;
    data[i * 4 + 1] = (Math.random() * 255) | 0;
    data[i * 4 + 2] = (Math.random() * 255) | 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

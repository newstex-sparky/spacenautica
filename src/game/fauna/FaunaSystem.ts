/**
 * Fauna + AI.
 *
 * One parametric body builder produces every species; one instanced draw call
 * per (species, shape variant, LOD) renders them; all swimming motion is
 * analytic in the vertex shader. Simulation is CPU-side but budgeted with three
 * distance tiers, and population streams in and out around the player
 * deterministically from the world seed.
 *
 *   BodyBuilder      parametric meshes (spine sweep + membranes + limbs + eyes)
 *   CreatureMaterial skin shading + vertex animation + underwater fog
 *   Boids            schooling for the small species
 *   PredatorAI       utility state machine for the large species
 *   ContactShadows   grounding blobs
 *   Bubbles          gill bubbles
 */
import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import { hash2, mulberry32 } from '../core/Noise';
import { UNDERWATER_GLSL } from '../world/water/UnderwaterFog';
import { BIOME_MAP } from '../world/terrain/Biomes';
import type { PbrMaps } from '../assets/TextureLibrary';
import type { TextureId } from '../assets/TextureIds';
import { buildCreature } from './BodyBuilder';
import type { BodySpec } from './BodyBuilder';
import { SPECIES } from './Species';
import type { SpeciesDef } from './Species';
import { createCreatureMaterial } from './CreatureMaterial';
import type { CreatureMaterialSet } from './CreatureMaterial';
import { Agent, LOD_CHEAP, LOD_FROZEN, LOD_FULL, SpatialHash, ST_PATROL } from './Agents';
import { steerCheap, steerDrifter, steerFrozen, steerSchool } from './Boids';
import type { SimEnv } from './Boids';
import { steerPredator } from './PredatorAI';
import type { PredatorHooks } from './PredatorAI';
import { ContactShadows } from './ContactShadows';
import { Bubbles } from './Bubbles';

/* ------------------------------------------------------------------ *
 * Structural views of the systems we read. Declared locally so this module
 * has no compile-time dependency on files another agent owns.
 * ------------------------------------------------------------------ */

interface PlayerLike extends GameSystem {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  sprinting?: boolean;
  inVehicle?: string | null;
  addImpulse?(v: THREE.Vector3): void;
  damage?(amount: number, source: string): void;
}
interface WaterLike extends GameSystem {
  causticsTexture?: THREE.Texture | null;
  sharedUniforms?: Record<string, THREE.IUniform>;
  surfaceHeightAt?(x: number, z: number, t: number): number;
}
interface TerrainLike extends GameSystem {
  seed?: number;
}
interface TexturesLike extends GameSystem {
  get(id: TextureId, size?: number): PbrMaps;
  white?: THREE.Texture;
  flatNormal?: THREE.Texture;
}
interface ViewModelLike extends GameSystem {
  flashlightOn?: boolean;
  lightOn?: boolean;
  torchOn?: boolean;
}
interface PropsLike extends GameSystem {
  looseMetal?: THREE.Object3D[];
}

/* ------------------------------------------------------------------ *
 * Instance batches
 * ------------------------------------------------------------------ */

interface Batch {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
  extra: THREE.InstancedBufferAttribute;
  n: number;
}

interface Pool {
  def: SpeciesDef;
  index: number;
  mats: CreatureMaterialSet;
  hi: Batch[];
  lo: Batch;
  halfWidth: number;
  gill: THREE.Vector3;
  jaw: THREE.Vector3;
  maxCount: number;
  live: number;
}

interface SalvageItem {
  obj: THREE.Object3D;
  owned: boolean;
  claimedBy: number;
}

/* ------------------------------------------------------------------ *
 * Module scratch — nothing in update() allocates.
 * ------------------------------------------------------------------ */

const _m4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _camPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _colorScratch = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _one = new THREE.Vector3(1, 1, 1);
const _camMat = new THREE.Matrix4();

const CELL = 28;
/**
 * Expected agents per square metre per unit of `BiomeDef.fauna` density, per
 * behaviour class, at the 'high' budget. These are deliberately high enough that
 * every class saturates its share of the budget well inside KEEP_RADIUS: cells
 * are spawned nearest-first, so a cap-limited density is what puts the animals
 * in front of the diver instead of smeared over the horizon.
 */
const DENSITY: Record<string, number> = {
  school: 0.0075,
  drifter: 0.0006,
  predator: 0.0005,
};
/**
 * Radius in metres inside which each behaviour class is populated, and outside
 * which it is despawned. The budget is a fixed number of animals, so the radius
 * is really a density knob: a 0.5 m fish subtends under 4 px past 80 m and is
 * the same colour as the water there, so agents spent out at 250 m buy nothing
 * and starve the near field where the eye actually is. Rays and predators are
 * metres long and read much further out, so they get more room.
 */
const KEEP_RADIUS: Record<string, number> = {
  school: 82,
  drifter: 170,
  predator: 115,
};
/**
 * Hysteresis for eviction: an existing animal is only recycled to make room for
 * a nearer one if it is at least this much farther away, so a diver hovering on
 * a cell boundary does not thrash the population.
 */
const EVICT_MARGIN = 26;
const NEIGHBOUR_CAP = 96;

export class FaunaSystem implements GameSystem {
  readonly name = 'fauna';
  readonly phase = Phase.Simulation;

  protected group = new THREE.Group();

  private pools: Pool[] = [];
  private agents: Agent[] = [];
  private freeList: number[] = [];
  private hash = new SpatialHash(7, 1024, 1);
  private neighbours = new Int32Array(NEIGHBOUR_CAP);
  private predatorList: Agent[] = [];

  private shadows: ContactShadows | null = null;
  private bubbles: Bubbles | null = null;

  private activeCells = new Map<number, number>();
  private cellQueue: number[] = [];
  private cellQueueSet = new Set<number>();
  private lastCellScan = -1e9;
  private scanCx = 0;
  private scanCz = 0;

  /**
   * The point we cull and LOD against. Normally the render camera, but the
   * camera rig resolves at Phase.Camera — after us — so on the frame the player
   * is teleported (or on any frame the rig has not caught up) `camera.position`
   * is still at the old vantage. Culling against that throws away every creature
   * at the new one, which is exactly how a warp lands on an empty frame.
   */
  private readonly eye = new THREE.Vector3();

  private seed = 20260728;
  private budget = 280;
  private variants = 3;
  private hiDist = 42;
  private cheapDist = 130;
  private streamRadius = 150;

  private salvage: SalvageItem[] = [];
  private salvageGeo: THREE.BufferGeometry | null = null;
  private salvageMat: THREE.MeshStandardMaterial | null = null;

  private env: SimEnv = {
    world: null as unknown as SimEnv['world'],
    time: 0,
    dt: 0.016,
    playerPos: new THREE.Vector3(),
    playerVel: new THREE.Vector3(),
    playerNoise: 0,
    playerLight: 0,
    playerInVehicle: false,
    surfaceY: 0,
  };

  private player: PlayerLike | undefined;
  private water: WaterLike | undefined;
  private viewmodel: ViewModelLike | undefined;
  private bus: GameContext['bus'] | null = null;
  private sharedUniforms: Record<string, THREE.IUniform> = {};
  private lastLight = 0;
  private settingsRevision = -1;
  private hooks: PredatorHooks;

  /** Live agent count, for the HUD / debug overlay. */
  get activeCount(): number {
    return this.agents.length - this.freeList.length;
  }

  constructor() {
    this.hooks = {
      bite: (a, sp, dir) => this.onBite(a, sp, dir),
      aggro: (a, sp, dist) => {
        this.bus?.emit('creature:aggro', { species: sp.id, distance: dist });
        this.bus?.emit('audio:cue', {
          id: `creature.growl.${sp.id}`,
          position: [a.pos.x, a.pos.y, a.pos.z],
          gain: 0.9,
        });
      },
      findSalvage: (a, range) => this.findSalvage(a, range),
      salvagePos: (i, out) => this.salvagePos(i, out),
      claimSalvage: (a, i) => this.claimSalvage(a, i),
      releaseSalvage: (a) => this.releaseSalvage(a),
    };
  }

  /* ---------------------------------------------------------------- *
   * Init
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.group.name = 'fauna';
    this.group.matrixAutoUpdate = false;
    ctx.scene.add(this.group);
    this.bus = ctx.bus;

    const g = ctx.settings.graphics;
    this.settingsRevision = ctx.settings.revision;
    this.budget = Math.max(24, Math.round(g.faunaBudget));
    this.variants = ctx.settings.at('high') ? 3 : ctx.settings.at('medium') ? 2 : 1;
    this.hiDist = ctx.settings.at('high') ? 46 : 30;
    this.cheapDist = Math.min(g.viewDistance * 0.45, ctx.settings.at('high') ? 150 : 95);
    this.env.world = ctx.world;

    const terrain = ctx.tryGet<TerrainLike>('world.terrain');
    if (typeof terrain?.seed === 'number') this.seed = terrain.seed >>> 0;

    this.water = ctx.tryGet<WaterLike>('world.water');
    this.sharedUniforms = this.water?.sharedUniforms ?? {};
    this.player = ctx.tryGet<PlayerLike>('player');
    this.viewmodel = ctx.tryGet<ViewModelLike>('player.viewmodel');

    const textures = ctx.tryGet<TexturesLike>('assets.textures');
    // Presence signal only — the creature shader samples `uwCausticsMap` and
    // reads the tile size, strength and depth falloff out of `uwCausticsParams`
    // in the shared block, so the dapple on a fish always matches the dapple on
    // the sand under it even after a quality change rebuilds the water system.
    const caustics = this.water?.causticsTexture ?? null;

    /* --- agent pool ------------------------------------------------ */
    // Sized for the ultra budget so a runtime quality change never reallocates.
    const poolCap = Math.round(420 * 1.4) + 24;
    this.agents = new Array(poolCap);
    for (let i = poolCap - 1; i >= 0; i--) {
      this.agents[i] = new Agent();
      this.freeList.push(i);
    }
    this.hash = new SpatialHash(7, 2048, poolCap);

    /* --- geometry + materials per species -------------------------- */
    const skinSize = ctx.settings.at('high') ? 512 : 256;
    for (let s = 0; s < SPECIES.length; s++) {
      const def = SPECIES[s];
      const maps = safeMaps(textures, def.skin, skinSize);
      const base = buildCreature(def.body, 1);
      const capacity = Math.max(3, Math.round(420 * def.budgetShare) + 2);

      const mats = createCreatureMaterial({
        species: def,
        maps,
        shared: this.sharedUniforms,
        caustics,
        halfWidth: base.halfWidth,
        shadows: def.shadow && ctx.settings.at('high'),
      });

      const hi: Batch[] = [];
      for (let v = 0; v < this.variants; v++) {
        const geo = v === 0 ? base.geometry : buildCreature(variantSpec(def.body, v), 1).geometry;
        hi.push(this.makeBatch(geo, mats, capacity, `fauna.${def.id}.v${v}`, def));
      }
      const loGeo = buildCreature(def.body, 0.45).geometry;
      const lo = this.makeBatch(loGeo, mats, capacity, `fauna.${def.id}.lo`, def);

      this.pools.push({
        def,
        index: s,
        mats,
        hi,
        lo,
        halfWidth: base.halfWidth,
        gill: base.gill,
        jaw: base.jaw,
        maxCount: Math.max(2, Math.round(this.budget * def.budgetShare)),
        live: 0,
      });
    }

    /* --- extras ---------------------------------------------------- */
    this.shadows = new ContactShadows(Math.min(256, poolCap), this.sharedUniforms);
    this.group.add(this.shadows.mesh);

    if (g.particulate > 0.05) {
      this.bubbles = new Bubbles(ctx.settings.at('high') ? 256 : 96, this.sharedUniforms);
      this.bubbles.resize(ctx.height);
      this.group.add(this.bubbles.points);
    }

    // Loose metal already placed by the props system, if it exposes any.
    const props = ctx.tryGet<PropsLike>('world.props');
    if (props && Array.isArray(props.looseMetal)) {
      for (const o of props.looseMetal) this.registerLooseMetal(o);
    }
    this.ensureSalvageAssets(ctx);
  }

  private makeBatch(
    geo: THREE.BufferGeometry,
    mats: CreatureMaterialSet,
    capacity: number,
    name: string,
    def: SpeciesDef,
  ): Batch {
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const extra = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    anim.setUsage(THREE.DynamicDrawUsage);
    tint.setUsage(THREE.DynamicDrawUsage);
    extra.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnim', anim);
    geo.setAttribute('iTint', tint);
    geo.setAttribute('iExtra', extra);

    const mesh = new THREE.InstancedMesh(geo, mats.material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.visible = false;
    // Instances are scattered across the whole streaming radius, so the mesh
    // bound is meaningless; we cull per instance while filling instead.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = def.shadow && mats.depthMaterial !== null;
    mesh.receiveShadow = false;
    if (mats.depthMaterial) mesh.customDepthMaterial = mats.depthMaterial;
    this.group.add(mesh);
    return { mesh, anim, tint, extra, n: 0 };
  }

  resize(_w: number, h: number): void {
    this.bubbles?.resize(h);
  }

  /* ---------------------------------------------------------------- *
   * Public API for other systems
   * ---------------------------------------------------------------- */

  /** Register a loose metal object stalkers may pick up. */
  registerLooseMetal(obj: THREE.Object3D): void {
    if (this.salvage.some((s) => s.obj === obj)) return;
    this.salvage.push({ obj, owned: false, claimedBy: -1 });
  }

  /** Startle nearby creatures — used for lights snapping on, impacts, sonar. */
  startle(pos: THREE.Vector3, radius: number, amount = 1): void {
    const r2 = radius * radius;
    for (const a of this.agents) {
      if (!a.active) continue;
      if (a.pos.distanceToSquared(pos) > r2) continue;
      a.startle = Math.min(1.4, a.startle + amount);
    }
  }

  /** Nearest live creature to a point, for the scanner / HUD / audio. */
  nearest(pos: THREE.Vector3, maxDist: number): { species: string; position: THREE.Vector3; distance: number } | null {
    let best: Agent | null = null;
    let bestD = maxDist * maxDist;
    for (const a of this.agents) {
      if (!a.active) continue;
      const d = a.pos.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (!best) return null;
    return {
      species: SPECIES[best.species].id,
      position: best.pos,
      distance: Math.sqrt(bestD),
    };
  }

  /* ---------------------------------------------------------------- *
   * Update
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    if (ctx.settings.revision !== this.settingsRevision) this.applySettings(ctx);

    const env = this.env;
    env.world = ctx.world;
    env.time = ctx.time;
    env.dt = dt;
    this.lastDt = dt;

    const p = this.player;
    if (p) {
      env.playerPos.copy(p.position);
      env.playerVel.copy(p.velocity);
      env.playerInVehicle = !!p.inVehicle;
      env.playerNoise = (p.sprinting ? 0.85 : 0.18) + (p.inVehicle ? 0.5 : 0);
    } else {
      env.playerPos.copy(ctx.camera.position);
      env.playerVel.set(0, 0, 0);
      env.playerNoise = 0.2;
    }
    env.playerNoise = Math.min(1, env.playerNoise);

    const vm = this.viewmodel;
    const lightOn = !!(vm?.flashlightOn ?? vm?.lightOn ?? vm?.torchOn);
    env.playerLight = lightOn ? 1 : 0;
    if (lightOn && this.lastLight === 0) {
      // A torch snapping on makes everything in the beam flinch.
      ctx.camera.getWorldDirection(_fwd);
      _v.copy(env.playerPos).addScaledVector(_fwd, 9);
      this.startle(_v, 13, 0.9);
    }
    this.lastLight = env.playerLight;

    env.surfaceY = this.water?.surfaceHeightAt
      ? this.water.surfaceHeightAt(env.playerPos.x, env.playerPos.z, ctx.time)
      : 0;

    // Only ever queue cells something could actually live in.
    this.streamRadius = Math.min(ctx.settings.graphics.viewDistance * 0.5, KEEP_RADIUS.drifter + CELL);

    this.eye.copy(ctx.camera.position);
    if (p && this.eye.distanceToSquared(env.playerPos) > 4) this.eye.copy(env.playerPos);

    this.stream(ctx);
    this.simulate(ctx);
    this.fill(ctx);

    const t = ctx.time;
    for (const pool of this.pools) pool.mats.uniforms.uTime.value = t;
    this.bubbles?.update(dt, t, env.surfaceY);
  }

  private applySettings(ctx: GameContext): void {
    this.settingsRevision = ctx.settings.revision;
    const g = ctx.settings.graphics;
    this.budget = Math.max(24, Math.round(g.faunaBudget));
    this.hiDist = ctx.settings.at('high') ? 46 : 30;
    this.cheapDist = Math.min(g.viewDistance * 0.45, ctx.settings.at('high') ? 150 : 95);
    for (const pool of this.pools) {
      pool.maxCount = Math.max(2, Math.round(this.budget * pool.def.budgetShare));
    }
  }

  /* ---------------------------------------------------------------- *
   * Streaming: deterministic spawn cells around the player
   * ---------------------------------------------------------------- */

  private stream(ctx: GameContext): void {
    const px = this.env.playerPos.x;
    const pz = this.env.playerPos.z;
    const cx = Math.floor(px / CELL);
    const cz = Math.floor(pz / CELL);

    // Rescan the cell ring when the player crosses a cell or twice a second.
    if (cx !== this.scanCx || cz !== this.scanCz || ctx.time - this.lastCellScan > 0.5) {
      this.scanCx = cx;
      this.scanCz = cz;
      this.lastCellScan = ctx.time;
      const rad = Math.ceil(this.streamRadius / CELL);
      const rad2 = (this.streamRadius / CELL) * (this.streamRadius / CELL);
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dz * dz > rad2) continue;
          const key = cellKey(cx + dx, cz + dz);
          if (this.activeCells.has(key) || this.cellQueueSet.has(key)) continue;
          this.cellQueue.push(key);
          this.cellQueueSet.add(key);
        }
      }
      // Nearest first, so the budget is spent on what the player can see.
      if (this.cellQueue.length > 1) {
        this.cellQueue.sort((a, b) => cellDist2(a, cx, cz) - cellDist2(b, cx, cz));
      }
      // Retire cells that fell outside the radius so they can repopulate later.
      const limit = (this.streamRadius + CELL * 2) * (this.streamRadius + CELL * 2);
      for (const key of this.activeCells.keys()) {
        if (cellDist2(key, cx, cz) * CELL * CELL > limit) this.activeCells.delete(key);
      }
    }

    // Despawn anything outside its own class's keep radius. This runs *before*
    // spawning so the freed slots are available immediately: a diver who has
    // just crossed 80 m of water should be swimming into fish, not waiting a
    // second for the budget to unlock.
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.active) continue;
      const keep = this.keepRadius(this.pools[a.species].def) * 1.25;
      if (a.pos.distanceToSquared(this.env.playerPos) > keep * keep) this.despawn(i);
    }

    // Bounded spawn work per frame. Spawning is a handful of heightAt calls per
    // animal, so when the population is far below budget — boot, a long swim, a
    // teleport — there is no reason to trickle three cells a frame and leave the
    // near field empty for half a second.
    let work = this.activeCount < this.budget * 0.7 ? 16 : 4;
    while (work-- > 0 && this.cellQueue.length > 0) {
      const key = this.cellQueue.shift() as number;
      this.cellQueueSet.delete(key);
      this.spawnCell(key, ctx);
    }
  }

  private keepRadius(def: SpeciesDef): number {
    return Math.min(this.streamRadius, KEEP_RADIUS[def.behaviour] ?? 100);
  }

  /**
   * Recycles the farthest agent so a nearer cell can be populated, returning
   * false if nothing is far enough to be worth taking.
   *
   * Without this the budget latches onto wherever the diver happened to be when
   * it first filled: `spawnCell` bails out the moment `activeCount` hits the
   * budget, and the cells it skipped are never claimed, so the queue spins
   * forever while the whole population sits behind you. That is why the round-1
   * frames had 100+ live agents and no fish anywhere near the camera.
   */
  private evictFarther(thanDist: number, pool: Pool | null): boolean {
    let worst = -1;
    let worstD = thanDist + EVICT_MARGIN;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.active) continue;
      if (pool && a.species !== pool.index) continue;
      // Never delete something the diver is currently looking at.
      if (a.onScreen && a.dist < 160) continue;
      const d = a.pos.distanceTo(this.env.playerPos);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst < 0) return false;
    this.despawn(worst);
    return true;
  }

  /**
   * Room test for one more animal, distinguishing the two ways it can fail:
   *   0 = go ahead
   *   1 = this species is saturated near here (move on to the next species)
   *   2 = the global budget is full (stop, and leave the cell unclaimed)
   */
  private roomFor(pool: Pool, dist: number): number {
    if (pool.live >= pool.maxCount && !this.evictFarther(dist, pool)) return 1;
    if (this.activeCount >= this.budget && !this.evictFarther(dist, null)) return 2;
    return this.freeList.length > 0 ? 0 : 2;
  }

  private spawnCell(key: number, ctx: GameContext): void {
    const cx = ((key / 65536) | 0) - 32768;
    const cz = (key % 65536) - 32768;
    this.activeCells.set(key, 0);

    const world = ctx.world;
    const rnd = mulberry32(Math.floor(hash2(cx, cz, this.seed) * 0xffffffff) >>> 0);
    const cx0 = cx * CELL;
    const cz0 = cz * CELL;
    // Sample the biome at the cell centre; cells are small relative to biomes.
    const centreX = cx0 + CELL * 0.5;
    const centreZ = cz0 + CELL * 0.5;
    const floorCentre = world.heightAt(centreX, centreZ);
    const sample = world.biomeAt(centreX, centreZ);
    const biome = BIOME_MAP.get(sample.id);
    if (!biome) return;

    const budgetScale = this.budget / 280;
    const area = CELL * CELL;
    const distToPlayer = Math.hypot(centreX - this.env.playerPos.x, centreZ - this.env.playerPos.z);
    // A cell the budget turned away must not stay claimed, or freeing capacity
    // later would never repopulate it.
    let blocked = false;

    for (const entry of biome.fauna) {
      const pool = this.poolOf(entry.id);
      if (!pool) continue;
      const def = pool.def;
      if (distToPlayer > this.keepRadius(def)) continue;

      const depth = -floorCentre;
      if (depth < def.depth[0] - 20 || depth > def.depth[1] + 60) continue;

      const expected =
        entry.density * area * DENSITY[def.behaviour] * budgetScale * sample.weight;
      let count = Math.floor(expected);
      if (rnd() < expected - count) count++;
      if (count <= 0) continue;

      /*
       * Schooling species arrive as one shoal, not as N loners scattered over a
       * 28 m cell. Members are seeded inside a cluster comfortably smaller than
       * the species' cohesion radius, so the boids are already flocking on the
       * first simulated frame and the group reads as a single animal mass. A
       * shoal is also what makes small fish visible at all — one 0.5 m peeper at
       * 30 m is a speck, fourteen of them turning together is a subject.
       */
      const shoal = def.behaviour === 'school';
      if (shoal) count = Math.max(count, 6);

      const sx = cx0 + rnd() * CELL;
      const sz = cz0 + rnd() * CELL;
      const spread = def.school.radius * 0.42;
      const shoalAlt = this.spawnAltitude(def, world.heightAt(sx, sz), rnd);

      for (let k = 0; k < count; k++) {
        const room = this.roomFor(pool, distToPlayer);
        // A saturated species just means this cell is outside the band where
        // that animal still fits — the next species in the biome may well fit.
        if (room === 1) break;
        if (room === 2) {
          blocked = true;
          break;
        }
        let x: number;
        let z: number;
        let alt: number;
        if (shoal) {
          x = sx + (rnd() - 0.5) * 2 * spread;
          z = sz + (rnd() - 0.5) * 2 * spread;
          alt = shoalAlt + (rnd() - 0.5) * spread * 0.7;
        } else {
          x = cx0 + rnd() * CELL;
          z = cz0 + rnd() * CELL;
          alt = this.spawnAltitude(def, world.heightAt(x, z), rnd);
        }
        const floor = world.heightAt(x, z);
        const y = Math.min(floor + Math.max(alt, def.altitude[0]), this.env.surfaceY - 1.5);
        if (y <= floor + 0.2) continue;
        this.spawn(pool, x, y, z, rnd);
      }
      if (blocked) break;
    }

    if (blocked) this.activeCells.delete(key);
  }

  /**
   * Picks a spawn height above the sea floor.
   *
   * Half the time it is drawn from the species' habitat band, and half the time
   * it is biased to the diver's own height above the floor (clamped back into a
   * slightly stretched band). Habitat alone is not enough: in the round-1
   * shallows vantage the camera hovered 18 m off the bottom while peepers cap out
   * at 14 m, so every fish in the world was below the frame. Spawning some of
   * them at eye level is the difference between "the ocean contains fish" and
   * "there are fish here".
   */
  private spawnAltitude(def: SpeciesDef, floorY: number, rnd: () => number): number {
    const lo = def.altitude[0];
    const hi = def.altitude[1];
    if (rnd() < 0.5) {
      const eyeAlt = this.env.playerPos.y - floorY;
      if (eyeAlt > lo * 0.5) {
        return THREE.MathUtils.clamp(eyeAlt + (rnd() - 0.5) * 9, lo, hi * 1.6);
      }
    }
    return THREE.MathUtils.lerp(lo, hi, rnd());
  }

  private poolOf(id: string): Pool | undefined {
    for (const p of this.pools) if (p.def.id === id) return p;
    return undefined;
  }

  private spawn(pool: Pool, x: number, y: number, z: number, rnd: () => number): void {
    const idx = this.freeList.pop();
    if (idx === undefined) return;
    const a = this.agents[idx];
    const def = pool.def;

    a.active = true;
    a.species = pool.index;
    a.variant = Math.min(this.variants - 1, Math.floor(rnd() * this.variants));
    a.pos.set(x, y, z);
    a.home.copy(a.pos);
    a.target.copy(a.pos);
    const ang = rnd() * Math.PI * 2;
    a.fwd.set(Math.cos(ang), 0, Math.sin(ang));
    a.vel.copy(a.fwd).multiplyScalar(def.cruise * (0.4 + rnd() * 0.5));
    a.phase = rnd() * Math.PI * 2;
    a.hash = rnd();
    a.roughJitter = (rnd() - 0.5) * 0.5;

    // Per-individual size: a uniform scale plus non-uniform silhouette jitter,
    // so two neighbours never read as the same mesh.
    const s = 1 + (rnd() - 0.5) * 2 * def.sizeVar;
    a.scale = s;
    a.stretch = 1 + (rnd() - 0.5) * 0.22;
    a.girth = 1 + (rnd() - 0.5) * 0.2;

    // Per-individual colour: a hue/saturation nudge of the species palette,
    // expressed as a multiplier centred on white so the palette stays readable.
    _colorScratch.copy(def.dorsal).getHSL(_hsl);
    _colorScratch.setHSL(
      (_hsl.h + (rnd() - 0.5) * 0.07 + 1) % 1,
      THREE.MathUtils.clamp(_hsl.s * (0.75 + rnd() * 0.55), 0, 1),
      THREE.MathUtils.clamp(0.5 * (0.8 + rnd() * 0.45), 0.05, 0.95),
    );
    const lift = 0.86 + rnd() * 0.26;
    a.tint.setRGB(
      lift * (0.78 + _colorScratch.r * 0.44),
      lift * (0.78 + _colorScratch.g * 0.44),
      lift * (0.78 + _colorScratch.b * 0.44),
    );

    a.glow = 0.65 + rnd() * 0.7;
    a.beat = def.beat;
    a.amp = def.amp;
    a.state = ST_PATROL;
    a.stateT = rnd() * 2;
    a.awareness = 0;
    a.aggro = 0;
    a.startle = 0;
    a.biteCd = 0;
    a.growlCd = 0;
    a.wanderT = rnd() * 4;
    a.bubbleT = rnd() * 3;
    a.carrying = -1;
    a.lod = LOD_FULL;
    a.floorY = this.env.world.heightAt(x, z);
    a.altitude = y - a.floorY;

    pool.live++;
    if (def.behaviour === 'predator') this.predatorList.push(a);
  }

  private despawn(index: number): void {
    const a = this.agents[index];
    if (!a.active) return;
    this.releaseSalvage(a);
    a.active = false;
    this.pools[a.species].live--;
    const pi = this.predatorList.indexOf(a);
    if (pi >= 0) this.predatorList.splice(pi, 1);
    this.freeList.push(index);
  }

  /* ---------------------------------------------------------------- *
   * Simulation
   * ---------------------------------------------------------------- */

  private simulate(ctx: GameContext): void {
    const env = this.env;
    const camPos = _camPos.copy(this.eye);

    // Rebuild the neighbour grid with only the agents that will use it.
    this.hash.clear();
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.active) continue;
      a.dist = a.pos.distanceTo(camPos);
      a.lod = a.dist < this.hiDist * 1.6 ? LOD_FULL : a.dist < this.cheapDist ? LOD_CHEAP : LOD_FROZEN;
      if (a.lod === LOD_FULL) this.hash.insert(i, a.pos.x, a.pos.y, a.pos.z);
    }

    const frame = ctx.frame;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.active) continue;
      const def = this.pools[a.species].def;

      // Distance LOD also thins the update cadence: near agents every frame,
      // mid every other, far every sixth, each with a correspondingly larger
      // timestep so they still travel at the right speed.
      const stride = a.lod === LOD_FULL ? 1 : a.lod === LOD_CHEAP ? 2 : 6;
      if ((frame + i) % stride !== 0) continue;
      env.dt = Math.min(0.3, stride * this.lastDt);

      if (a.lod === LOD_FROZEN) {
        steerFrozen(a, def, env.dt);
        continue;
      }

      switch (def.behaviour) {
        case 'predator':
          steerPredator(a, def, env, this.hooks);
          break;
        case 'drifter':
          if (a.lod === LOD_FULL) steerDrifter(a, def, env);
          else steerCheap(a, def, env);
          break;
        default:
          if (a.lod === LOD_FULL) {
            steerSchool(a, this.agents, this.hash, def, env, this.predatorList, this.neighbours);
          } else {
            steerCheap(a, def, env);
          }
          break;
      }
      if (a.startle > 0) a.startle = Math.max(0, a.startle - env.dt * 0.75);
    }
    env.dt = this.lastDt;
  }

  private lastDt = 0.016;

  /* ---------------------------------------------------------------- *
   * Instance fill: LOD selection, per-instance frustum cull, uploads
   * ---------------------------------------------------------------- */

  private fill(ctx: GameContext): void {
    const cam = ctx.camera;
    // The camera rig resolves at Phase.Camera, after us, so `matrixWorld` may be
    // a frame stale. Rebuild from `this.eye` (see its declaration) and the live
    // quaternion, and pad the test sphere, so nothing pops at the screen edge
    // while turning and a teleport does not cull the whole population.
    _camMat.compose(this.eye, cam.quaternion, _one).invert();
    _projView.multiplyMatrices(cam.projectionMatrix, _camMat);
    _frustum.setFromProjectionMatrix(_projView);
    _camPos.copy(this.eye);

    for (const pool of this.pools) {
      for (const b of pool.hi) b.n = 0;
      pool.lo.n = 0;
    }
    const shadows = this.shadows;
    shadows?.begin();

    const bubbles = this.bubbles;
    const dt = this.lastDt;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.active) continue;
      const pool = this.pools[a.species];
      const def = pool.def;
      const size = def.length * a.scale;

      _sphere.center.copy(a.pos);
      _sphere.radius = size * 0.8 + 2.5;
      a.onScreen = _frustum.intersectsSphere(_sphere);

      // Contact shadow: only for creatures actually near the floor.
      if (shadows && a.dist < 95 && a.floorY > -1e5) {
        const alt = a.pos.y - a.floorY;
        if (alt < size * 4 + 3) shadows.add(a.pos.x, a.floorY, a.pos.z, size * 0.36, alt);
      }

      // Gill bubbles.
      if (bubbles && def.bubbles > 0 && a.dist < 42 && a.onScreen) {
        a.bubbleT -= dt;
        if (a.bubbleT <= 0) {
          a.bubbleT = (1.1 + Math.random() * 2.6) / def.bubbles;
          _v.copy(pool.gill).multiplyScalar(a.scale).applyQuaternion(a.quat).add(a.pos);
          bubbles.emit(_v.x, _v.y, _v.z, 0.016 + Math.random() * 0.02 * a.scale, 0.32);
        }
      }

      // Carried salvage rides in the jaw.
      if (a.carrying >= 0) {
        const item = this.salvage[a.carrying];
        if (item) {
          _v.copy(pool.jaw).multiplyScalar(a.scale).applyQuaternion(a.quat).add(a.pos);
          item.obj.position.copy(_v);
          item.obj.quaternion.copy(a.quat);
        }
      }

      if (!a.onScreen) continue;

      const batch = a.dist < this.hiDist ? pool.hi[Math.min(a.variant, pool.hi.length - 1)] : pool.lo;
      const slot = batch.n;
      if (slot >= batch.anim.count) continue;
      batch.n++;

      _scl.set(a.scale * a.girth, a.scale * a.girth, a.scale * a.stretch);
      _m4.compose(a.pos, a.quat, _scl);
      batch.mesh.setMatrixAt(slot, _m4);

      // Animation drive: tail beat frequency and amplitude follow real speed,
      // so a coasting fish glides and a fleeing one thrashes.
      const rel = THREE.MathUtils.clamp(a.speed / Math.max(0.05, def.cruise), 0, 2.4);
      const freq = THREE.MathUtils.clamp(def.beat * (0.34 + rel * 0.72), 0.12, 4.2);
      const amp = def.amp * def.body.length * (0.5 + rel * 0.55 + a.startle * 0.5);
      const ai = slot * 4;
      const arr = batch.anim.array as Float32Array;
      arr[ai] = a.phase;
      arr[ai + 1] = freq;
      arr[ai + 2] = amp;
      arr[ai + 3] = a.lean;

      const ti = slot * 3;
      const tarr = batch.tint.array as Float32Array;
      tarr[ti] = a.tint.r;
      tarr[ti + 1] = a.tint.g;
      tarr[ti + 2] = a.tint.b;

      const ei = slot * 2;
      const earr = batch.extra.array as Float32Array;
      earr[ei] = a.glow * (1 + a.aggro * 0.8);
      earr[ei + 1] = a.hash;
    }

    for (const pool of this.pools) {
      for (const b of pool.hi) commit(b);
      commit(pool.lo);
    }
    shadows?.end();
  }

  /* ---------------------------------------------------------------- *
   * Predator hooks
   * ---------------------------------------------------------------- */

  private onBite(a: Agent, sp: SpeciesDef, dir: THREE.Vector3): void {
    const p = this.player;
    const dist = a.pos.distanceTo(this.env.playerPos);
    // player.damage() emits 'player:damage' itself; only fall back if absent.
    if (p?.damage) {
      p.damage(sp.damage * (0.8 + a.hash * 0.4), sp.id);
    } else {
      this.bus?.emit('player:damage', {
        amount: sp.damage,
        source: sp.id,
        direction: [dir.x, dir.y, dir.z],
      });
    }
    p?.addImpulse?.(_v2.copy(dir).multiplyScalar(sp.damage * 0.22 + 2.2).setY(0.9));
    this.bus?.emit('creature:aggro', { species: sp.id, distance: dist });
    this.bus?.emit('audio:cue', {
      id: `creature.bite.${sp.id}`,
      position: [a.pos.x, a.pos.y, a.pos.z],
      gain: 1,
    });
  }

  /* ---------------------------------------------------------------- *
   * Loose metal (stalkers)
   * ---------------------------------------------------------------- */

  private findSalvage(a: Agent, range: number): number {
    let best = -1;
    let bestD = range * range;
    for (let i = 0; i < this.salvage.length; i++) {
      const s = this.salvage[i];
      if (s.claimedBy >= 0) continue;
      const d = s.obj.position.distanceToSquared(a.pos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0 && this.salvage.length < 8 && this.salvageMat) {
      // Nothing to scavenge nearby: drop a piece of wreck debris on the floor so
      // the behaviour is actually observable. Props may register its own too.
      best = this.spawnScrapNear(a);
    }
    return best;
  }

  private salvagePos(index: number, out: THREE.Vector3): boolean {
    const s = this.salvage[index];
    if (!s) return false;
    out.copy(s.obj.position);
    return true;
  }

  private claimSalvage(a: Agent, index: number): boolean {
    const s = this.salvage[index];
    if (!s || (s.claimedBy >= 0 && s.claimedBy !== a.species)) return false;
    if (a.carrying >= 0 && a.carrying !== index) this.releaseSalvage(a);
    s.claimedBy = a.species;
    a.carrying = index;
    return true;
  }

  private releaseSalvage(a: Agent): void {
    if (a.carrying < 0) return;
    const s = this.salvage[a.carrying];
    if (s) {
      s.claimedBy = -1;
      // Settle it back onto the sea floor where it was dropped.
      if (this.env.world) {
        s.obj.position.y = this.env.world.heightAt(s.obj.position.x, s.obj.position.z) + 0.12;
      }
    }
    a.carrying = -1;
  }

  private spawnScrapNear(a: Agent): number {
    if (!this.salvageGeo || !this.salvageMat) return -1;
    const mesh = new THREE.Mesh(this.salvageGeo, this.salvageMat);
    const ang = a.hash * Math.PI * 2;
    const r = 9 + a.hash * 9;
    const x = a.home.x + Math.cos(ang) * r;
    const z = a.home.z + Math.sin(ang) * r;
    const floor = this.env.world.heightAt(x, z);
    mesh.position.set(x, floor + 0.12, z);
    mesh.rotation.set(a.hash * 0.7, a.hash * 6.28, (a.hash - 0.5) * 0.6);
    mesh.scale.setScalar(0.7 + a.hash * 0.8);
    mesh.name = 'fauna.salvage';
    mesh.castShadow = false;
    this.group.add(mesh);
    this.salvage.push({ obj: mesh, owned: true, claimedBy: -1 });
    return this.salvage.length - 1;
  }

  /** Lazily creates the shared scrap geometry/material on first use. */
  private ensureSalvageAssets(ctx: GameContext): void {
    if (this.salvageGeo) return;
    const textures = ctx.tryGet<TexturesLike>('assets.textures');
    const maps = safeMaps(textures, 'metal_scuffed', 256);
    const geo = new THREE.BoxGeometry(0.72, 0.11, 0.52, 4, 2, 3);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const h = hash2(i * 7 + 1, i * 13 + 3, 991);
      const h2 = hash2(i * 3 + 5, i * 17 + 11, 997);
      pos.setXYZ(
        i,
        pos.getX(i) * (1 + (h - 0.5) * 0.4),
        pos.getY(i) + (h2 - 0.5) * 0.06,
        pos.getZ(i) * (1 + (h2 - 0.5) * 0.45),
      );
    }
    geo.computeVertexNormals();
    this.salvageGeo = geo;

    const mat = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      roughnessMap: maps.roughnessMap,
      aoMap: maps.aoMap,
      color: 0x8d8f92,
      metalness: 0.82,
      roughness: 0.58,
      fog: false,
    });
    mat.name = 'fauna.salvage';
    // We apply applyUnderwater ourselves — opt out of the water auto-patcher.
    mat.userData.underwater = true;
    mat.userData.waterAware = true;
    const shared = this.sharedUniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.vertexShader =
        'varying vec3 vSW; varying float vSD; varying vec3 vSV;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            vec4 swp = modelMatrix * vec4(transformed, 1.0);
            vSW = swp.xyz;
            vSD = length(swp.xyz - cameraPosition);
            vSV = normalize(swp.xyz - cameraPosition + vec3(1e-6));
          }`,
        );
      shader.fragmentShader =
        UNDERWATER_GLSL +
        'varying vec3 vSW; varying float vSD; varying vec3 vSV;\n' +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          gl_FragColor.rgb = applyUnderwater(gl_FragColor.rgb, vSD, vSW.y, normalize(vSV));`,
        );
    };
    mat.customProgramCacheKey = () => 'fauna.salvage';
    this.salvageMat = mat;
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  dispose(): void {
    for (const pool of this.pools) {
      for (const b of pool.hi) b.mesh.geometry.dispose();
      pool.lo.mesh.geometry.dispose();
      pool.mats.dispose();
    }
    this.pools.length = 0;
    this.shadows?.dispose();
    this.bubbles?.dispose();
    this.salvageGeo?.dispose();
    this.salvageMat?.dispose();
    for (const s of this.salvage) {
      if (s.owned) s.obj.removeFromParent();
    }
    this.salvage.length = 0;
    this.group.removeFromParent();
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function commit(b: Batch): void {
  b.mesh.count = b.n;
  b.mesh.visible = b.n > 0;
  if (b.n === 0) return;
  b.mesh.instanceMatrix.needsUpdate = true;
  b.anim.needsUpdate = true;
  b.tint.needsUpdate = true;
  b.extra.needsUpdate = true;
}

function cellKey(cx: number, cz: number): number {
  return ((cx + 32768) & 0xffff) * 65536 + ((cz + 32768) & 0xffff);
}

function cellDist2(key: number, cx: number, cz: number): number {
  const kx = ((key / 65536) | 0) - 32768;
  const kz = (key % 65536) - 32768;
  const dx = kx - cx;
  const dz = kz - cz;
  return dx * dx + dz * dz;
}

/**
 * The texture library is another agent's system and may not be present (or may
 * be the baseline stub). Fall back to flat 1x1 maps: the creature shader
 * generates all of its detail procedurally anyway, so this degrades to
 * "slightly less grain", never to "untextured".
 */
function safeMaps(lib: TexturesLike | undefined, id: TextureId, size: number): PbrMaps {
  if (lib) {
    try {
      const m = lib.get(id, size);
      if (m && m.map) return m;
    } catch {
      /* fall through to the stub below */
    }
  }
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  white.needsUpdate = true;
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  flat.needsUpdate = true;
  return { map: white, normalMap: flat, roughnessMap: white, aoMap: white };
}

/** Perturbs a body spec so each variant has a genuinely different silhouette. */
function variantSpec(base: BodySpec, v: number): BodySpec {
  const r = mulberry32((base.seed * 977 + v * 31013) >>> 0);
  const jit = (arr: number[], amt: number) => arr.map((x) => x * (1 + (r() - 0.5) * amt));
  return {
    ...base,
    seed: (base.seed + v * 7919) >>> 0,
    girth: jit(base.girth, 0.26),
    widthMul: jit(base.widthMul, 0.22),
    heightMul: jit(base.heightMul, 0.28),
    sharp: jit(base.sharp, 0.14),
    arch: base.arch.map((x) => x + (r() - 0.5) * 0.05),
    dorsalRidge: base.dorsalRidge * (0.6 + r() * 0.9),
    bellyBulge: base.bellyBulge * (0.6 + r() * 0.9),
    noiseAmp: base.noiseAmp * (0.7 + r() * 0.85),
    noiseFreq: base.noiseFreq * (0.8 + r() * 0.55),
    toothLen: base.toothLen * (0.8 + r() * 0.45),
    eyes: base.eyes.map((e) => ({
      ...e,
      radius: e.radius * (0.86 + r() * 0.32),
      up: e.up * (0.9 + r() * 0.25),
      out: e.out * (0.94 + r() * 0.14),
    })),
    fins: base.fins.map((f) => ({
      ...f,
      span: f.span * (0.78 + r() * 0.5),
      chordRoot: f.chordRoot * (0.85 + r() * 0.36),
      chordTip: f.chordTip * (0.8 + r() * 0.5),
      sweep: f.sweep * (0.7 + r() * 0.75),
      curl: f.curl * (0.5 + r() * 1.3),
      notch: Math.min(0.5, f.notch * (0.6 + r() * 0.95)),
    })),
    limbs: base.limbs.map((l) => ({
      ...l,
      radius: l.radius * (0.85 + r() * 0.32),
      joints: l.joints.map((j) => ({
        len: j.len * (0.84 + r() * 0.38),
        pitch: j.pitch * (0.8 + r() * 0.5),
        yaw: j.yaw * (0.7 + r() * 0.7),
      })),
    })),
  };
}

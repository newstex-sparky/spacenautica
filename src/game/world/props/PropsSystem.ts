/**
 * `world.props` — rocks, resource nodes, wrecks, POIs and hydrothermal vents.
 *
 * This system owns everything the player interacts with in the open world and
 * most of the frame's mid-ground interest. Its public surface:
 *
 *  - `landmarks`     — deterministic named-POI registry (quests, compass, audio)
 *  - `focus`         — what the player is currently aiming at, if harvestable
 *  - `interactables` — every harvestable node + lootable container
 *  - `tryInteract()` — harvest/loot the focused target
 *  - `interiors`     — enclosed volumes, for HUD/audio/fog overrides
 *  - `emitters`      — light sources the pooled rig is driving right now
 *
 * Everything is generated from the terrain seed, so two runs of the same world
 * put the same boulder in the same place.
 */
import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { GameContext, GameSystem, QualityTier } from '../../core/Types';
import { hash2, mulberry32 } from '../../core/Noise';
import { LANDMARK_SEEDS, LandmarkRegistry } from './Landmarks';
import type { Landmark } from './Landmarks';
import { PropMaterialLibrary } from './PropMaterials';
import type { PropMatId } from './PropMaterials';
import {
  PropBatches, scatterCluster, scatterRegion,
} from './PropScatter';
import type { NodeDef, Placement, PlacedProp, ScatterKind } from './PropScatter';
import {
  makeCoralSample, makeCrystalCluster, makeEggCluster, makeRock, makeSalvage,
} from './RockGen';
import type { PropShape, RockKind, SalvageKind } from './RockGen';
import { makeContainer, makeEscapePod, makeHullSection, makePrecursorStructure } from './WreckGen';
import type { WreckBuild } from './WreckGen';
import { VentField } from './VentField';
import type { PropEmitter, VentSpec } from './VentField';
import { NearClutter } from './NearClutter';

/* ------------------------------------------------------------------ *
 * Scratch — nothing in update() allocates
 * ------------------------------------------------------------------ */
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _ray = new THREE.Ray();

/* ------------------------------------------------------------------ *
 * Resource-node catalogue
 * ------------------------------------------------------------------ */

const NODE_LIMESTONE: NodeDef = {
  id: 'limestone_outcrop', label: 'Limestone Outcrop', category: 'resource',
  yields: [{ item: 'titanium', count: 1 }, { item: 'copper_ore', count: 1 }],
  requiresTool: false, reach: 3.4, tint: 0xffe2a0,
};
const NODE_SANDSTONE: NodeDef = {
  id: 'sandstone_outcrop', label: 'Sandstone Outcrop', category: 'resource',
  yields: [{ item: 'silver_ore', count: 1 }, { item: 'lead', count: 1 }, { item: 'gold', count: 1 }],
  requiresTool: false, reach: 3.4, tint: 0xffd08a,
};
const NODE_METAL_ORE: NodeDef = {
  id: 'metal_deposit', label: 'Metal Deposit', category: 'resource',
  yields: [{ item: 'magnetite', count: 1 }, { item: 'titanium', count: 2 }],
  requiresTool: true, reach: 3.6, tint: 0xcfe0ff,
};
const NODE_QUARTZ: NodeDef = {
  id: 'quartz_cluster', label: 'Quartz Cluster', category: 'resource',
  yields: [{ item: 'quartz', count: 2 }, { item: 'diamond', count: 1 }],
  requiresTool: false, reach: 3.0, tint: 0xa8f0ff,
};
const NODE_SALVAGE: NodeDef = {
  id: 'metal_salvage', label: 'Metal Salvage', category: 'salvage',
  yields: [{ item: 'titanium', count: 2 }, { item: 'scrap_metal', count: 1 }],
  requiresTool: false, reach: 3.2, tint: 0xffc890,
};
const NODE_CORAL: NodeDef = {
  id: 'coral_sample', label: 'Coral Sample', category: 'organic',
  yields: [{ item: 'coral_sample', count: 1 }],
  requiresTool: false, reach: 2.8, tint: 0xff9a80,
};
const NODE_EGG: NodeDef = {
  id: 'creature_egg', label: 'Creature Eggs', category: 'organic',
  yields: [{ item: 'creature_egg', count: 1 }],
  requiresTool: false, reach: 2.6, tint: 0x9affd0,
};
const NODE_CONTAINER: NodeDef = {
  id: 'supply_locker', label: 'Supply Locker', category: 'salvage',
  yields: [
    { item: 'titanium', count: 2 }, { item: 'battery', count: 1 },
    { item: 'nutrient_block', count: 1 }, { item: 'fibre_mesh', count: 2 },
  ],
  requiresTool: false, reach: 2.6, tint: 0xffe0b0,
};

/* ------------------------------------------------------------------ *
 * Public interaction contract
 * ------------------------------------------------------------------ */

export interface PropInteractable {
  /** Stable per-instance id, safe to persist. */
  uid: string;
  def: NodeDef;
  /** World position of the interaction point. */
  position: THREE.Vector3;
  /** Bounding radius used for the aim test. */
  radius: number;
  /** Geometry + transform borrowed by the highlight shell. */
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  harvested: boolean;
  /** Set for scattered nodes; null for wreck containers. */
  placed: PlacedProp | null;
  /** Set for containers; null for scattered nodes. */
  mesh: THREE.Object3D | null;
}

export interface PropFocus {
  target: PropInteractable;
  label: string;
  distance: number;
  requiresTool: boolean;
}

/* ------------------------------------------------------------------ *
 * Pooled light rig
 * ------------------------------------------------------------------ */

/**
 * A *fixed* number of point lights, re-aimed at the nearest emitters every
 * frame. Fixed because changing the scene's light count recompiles every
 * shader in the frame — this way vents, wreck lamps and the precursor gate all
 * light the world without ever triggering that.
 */
class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private order: number[] = [];

  constructor(count: number, parent: THREE.Object3D) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      l.visible = false;
      l.name = `props.light.${i}`;
      parent.add(l);
      this.lights.push(l);
    }
  }

  update(emitters: PropEmitter[], camera: THREE.Vector3, time: number): void {
    const n = this.lights.length;
    if (n === 0) return;
    if (this.order.length !== emitters.length) {
      this.order = emitters.map((_, i) => i);
    }
    // Partial selection: we only need the n nearest, so a bounded scan is enough.
    const best: number[] = [];
    const bestD: number[] = [];
    for (let i = 0; i < emitters.length; i++) {
      const d = emitters[i].pos.distanceToSquared(camera);
      const range = (emitters[i].distance + 8) ** 2;
      if (d > range) continue;
      let slot = best.length;
      while (slot > 0 && bestD[slot - 1] > d) slot--;
      if (slot >= n) continue;
      best.splice(slot, 0, i);
      bestD.splice(slot, 0, d);
      if (best.length > n) {
        best.length = n;
        bestD.length = n;
      }
    }
    for (let i = 0; i < n; i++) {
      const l = this.lights[i];
      if (i >= best.length) {
        l.visible = false;
        l.intensity = 0;
        continue;
      }
      const e = emitters[best[i]];
      l.visible = true;
      l.position.copy(e.pos);
      l.color.copy(e.color);
      l.distance = e.distance;
      // Two detuned sines plus a hash-driven dropout: a failing lamp, not a sine.
      const f = e.flicker;
      const t = time * 6.3 + e.phase;
      const wob = 1 - f * (0.35 + 0.35 * Math.sin(t) * Math.sin(t * 0.37 + 1.7));
      const drop = f > 0.5 && hash2(Math.floor(time * 9), e.phase | 0, 7) < 0.05 * f ? 0.15 : 1;
      l.intensity = e.intensity * Math.max(0, wob) * drop;
    }
  }

  dispose(): void {
    for (const l of this.lights) {
      l.parent?.remove(l);
      l.dispose();
    }
    this.lights.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Tier budgets
 * ------------------------------------------------------------------ */

interface Budget {
  rockVariants: number;
  rocks: number;
  nodes: number;
  lights: number;
  vents: number;
  lodSlices: number;
  propViewDistance: number;
}

function budgetFor(tier: QualityTier, foliage: number, viewDistance: number): Budget {
  const base: Record<QualityTier, Budget> = {
    low: { rockVariants: 7, rocks: 420, nodes: 150, lights: 1, vents: 6, lodSlices: 10, propViewDistance: 150 },
    medium: { rockVariants: 11, rocks: 950, nodes: 280, lights: 2, vents: 10, lodSlices: 8, propViewDistance: 200 },
    high: { rockVariants: 15, rocks: 1750, nodes: 430, lights: 3, vents: 16, lodSlices: 6, propViewDistance: 260 },
    ultra: { rockVariants: 19, rocks: 2600, nodes: 560, lights: 4, vents: 20, lodSlices: 5, propViewDistance: 320 },
  };
  const b = { ...base[tier] };
  b.rocks = Math.round(b.rocks * THREE.MathUtils.clamp(foliage, 0.25, 1.6));
  b.nodes = Math.round(b.nodes * THREE.MathUtils.clamp(foliage, 0.35, 1.5));
  b.propViewDistance = Math.min(b.propViewDistance, Math.max(90, viewDistance * 0.42));
  return b;
}

/* ------------------------------------------------------------------ *
 * System
 * ------------------------------------------------------------------ */

export class PropsSystem implements GameSystem {
  readonly name = 'world.props';
  readonly phase = Phase.World;

  /** Named POIs. Read by quests, the HUD compass, audio and the databank. */
  readonly landmarks = new LandmarkRegistry();
  /** Everything harvestable or lootable in the world. */
  readonly interactables: PropInteractable[] = [];
  /** Enclosed interior volumes (inside the hull), world space. */
  readonly interiors: Array<{ pos: THREE.Vector3; radius: number }> = [];
  /** Light emitters currently registered with the pooled rig. */
  readonly emitters: PropEmitter[] = [];
  /** What the player is aiming at, or null. */
  focus: PropFocus | null = null;
  /** Ready-made HUD string, or null. */
  interactionPrompt: string | null = null;

  protected group = new THREE.Group();
  private mats: PropMaterialLibrary | null = null;
  private batches: PropBatches | null = null;
  private vents: VentField | null = null;
  private clutter: NearClutter | null = null;
  private lights: LightPool | null = null;
  private highlight: THREE.Mesh | null = null;
  private highlightMat: THREE.ShaderMaterial | null = null;
  private shapes: PropShape[] = [];
  private ownedGeo: THREE.BufferGeometry[] = [];
  private wreckMeshes: THREE.Mesh[] = [];
  private budget: Budget = budgetFor('high', 1, 760);
  private seed = 20260728;
  private discoveryTimer = 0;
  private nodeUid = 0;
  private lastTier: QualityTier = 'high';

  /* ---------------------------------------------------------------- *
   * Init
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.group.name = 'world.props';
    ctx.scene.add(this.group);

    const g = ctx.settings.graphics;
    this.lastTier = g.tier;
    this.budget = budgetFor(g.tier, g.foliageDensity, g.viewDistance);

    const terrain = ctx.tryGet<GameSystem & { seed?: number }>('world.terrain');
    this.seed = terrain?.seed ?? 20260728;

    const water = ctx.tryGet<GameSystem & { sharedUniforms?: Record<string, THREE.IUniform> }>('world.water');
    const shared = water?.sharedUniforms ?? {};
    this.mats = new PropMaterialLibrary(shared, g.tier);

    this.lights = new LightPool(this.budget.lights, this.group);

    this.resolveLandmarks(ctx);
    const kinds = this.buildKinds();
    this.placeScatter(ctx, kinds);
    this.buildWrecks(ctx);
    this.buildVents(ctx, shared);
    this.buildHighlight();

    // Foreground dressing. The world scatter cannot supply this: at one boulder
    // per ~900 m^2 the first three metres of any view are empty, which is why
    // every frame read as a wash with no sense of scale.
    this.clutter = new NearClutter(this.mats, g.tier, g.foliageDensity, this.seed);
    this.clutter.build();
    this.group.add(this.clutter.group);
    // Fill the ring completely before the first frame; after this it only ever
    // advances a slice at a time.
    this.clutter.prime(ctx.world, ctx.camera.position);
  }

  /** Snaps every authored POI onto the sea floor. */
  private resolveLandmarks(ctx: GameContext): void {
    for (const s of LANDMARK_SEEDS) {
      const h = ctx.world.heightAt(s.x, s.z);
      const l: Landmark = {
        id: s.id, name: s.name, kind: s.kind,
        position: new THREE.Vector3(s.x, h, s.z),
        radius: s.radius, depth: Math.max(0, -h), discovered: false,
        databank: s.databank, blurb: s.blurb,
      };
      this.landmarks.add(l);
    }
  }

  /* ---------------------------------------------------------------- *
   * Shape + scatter catalogue
   * ---------------------------------------------------------------- */

  private trackShape(s: PropShape): PropShape {
    this.shapes.push(s);
    for (const g of s.lods) this.ownedGeo.push(g);
    return s;
  }

  private buildKinds(): ScatterKind[] {
    const n = this.budget.rockVariants;
    const kinds: ScatterKind[] = [];
    const rockMats: PropMatId[] = ['rock_basalt', 'rock_limestone', 'rock_sandstone', 'rock_shale'];
    const rockKinds: RockKind[] = ['boulder', 'slab', 'spire', 'outcrop', 'chunk', 'pebble'];

    // --- plain boulders, many silhouettes, spread over four rock types ---
    for (let i = 0; i < n; i++) {
      const kind = rockKinds[i % rockKinds.length];
      const mat = rockMats[(i * 3 + (i >> 2)) % rockMats.length];
      const shape = this.trackShape(makeRock(this.seed + i * 977 + 13, kind, mat === 'rock_basalt' ? 1 : 0.75));
      const big = kind === 'outcrop' || kind === 'spire';
      kinds.push({
        id: shape.id,
        shape,
        mat,
        biomes: {
          '*': 1,
          shallows: kind === 'pebble' ? 1.6 : 1,
          kelp_forest: 1.1,
          grassy_plateau: 0.9,
          red_grass: 1.2,
          mushroom_forest: 0.9,
          blood_kelp: 1.1,
          lost_river: 1.3,
          lava_zone: 1.4,
        },
        depth: [1, 1400],
        minNormalY: kind === 'pebble' ? 0.45 : 0.34,
        scale: big ? [1.4, 5.2] : kind === 'pebble' ? [0.25, 0.7] : [0.6, 3.1],
        align: kind === 'spire' ? 0.25 : 0.65,
        weight: kind === 'pebble' ? 2.2 : big ? 0.7 : 1.4,
      });
    }
    return kinds;
  }

  private buildNodeKinds(): ScatterKind[] {
    const kinds: ScatterKind[] = [];
    const push = (
      shape: PropShape, mat: PropMatId, node: NodeDef, opts: Partial<ScatterKind>,
    ) => {
      kinds.push({
        id: shape.id, shape, mat, node,
        biomes: { '*': 1 },
        depth: [1, 1400], minNormalY: 0.42, scale: [0.8, 1.6], align: 0.7, weight: 1,
        ...opts,
      });
    };

    // limestone / sandstone outcrops with visible ore glints
    for (let i = 0; i < 3; i++) {
      push(
        this.trackShape(makeRock(this.seed + 5100 + i * 31, i === 0 ? 'outcrop' : 'boulder', 0.8)),
        'ore_limestone', NODE_LIMESTONE,
        {
          biomes: { '*': 1, shallows: 1.6, kelp_forest: 1.3, grassy_plateau: 1.1 },
          depth: [2, 320], scale: [0.55, 1.15], weight: 2.4,
        },
      );
      push(
        this.trackShape(makeRock(this.seed + 5300 + i * 37, i === 1 ? 'slab' : 'boulder', 0.7)),
        'rock_sandstone', NODE_SANDSTONE,
        {
          biomes: { '*': 0.7, grassy_plateau: 1.5, red_grass: 1.6, mushroom_forest: 1.4 },
          depth: [40, 620], scale: [0.6, 1.2], weight: 1.8,
        },
      );
    }
    // deep metal deposits — need a tool
    for (let i = 0; i < 2; i++) {
      push(
        this.trackShape(makeRock(this.seed + 5500 + i * 41, 'chunk', 0.5)),
        'ore_metal', NODE_METAL_ORE,
        {
          biomes: { '*': 0.3, blood_kelp: 1.4, lost_river: 1.8, lava_zone: 2.0 },
          depth: [120, 1400], scale: [0.7, 1.4], weight: 1.2,
        },
      );
    }
    // quartz clusters
    for (let i = 0; i < 3; i++) {
      push(
        this.trackShape(makeCrystalCluster(this.seed + 6100 + i * 53, 4 + i)),
        'quartz', NODE_QUARTZ,
        {
          biomes: { '*': 0.8, shallows: 1.2, red_grass: 1.4, lost_river: 1.6 },
          depth: [4, 900], scale: [0.7, 1.7], align: 0.5, weight: 1.5,
        },
      );
    }
    // loose salvage
    const salvageKinds: SalvageKind[] = ['panel', 'pipe', 'crate', 'girder', 'tank'];
    for (let i = 0; i < salvageKinds.length; i++) {
      push(
        this.trackShape(makeSalvage(this.seed + 6600 + i * 67, salvageKinds[i])),
        'salvage_metal', NODE_SALVAGE,
        {
          biomes: { '*': 0.55, shallows: 0.9, kelp_forest: 0.8 },
          depth: [2, 700], scale: [0.7, 1.5], align: 0.85, weight: 1.1,
        },
      );
    }
    // organics
    for (let i = 0; i < 2; i++) {
      push(
        this.trackShape(makeCoralSample(this.seed + 7100 + i * 71)),
        'coral_sample', NODE_CORAL,
        {
          biomes: { '*': 0.4, shallows: 1.5, red_grass: 1.7, kelp_forest: 1.0 },
          depth: [3, 260], scale: [0.6, 1.4], align: 0.6, weight: 1.6,
        },
      );
      push(
        this.trackShape(makeEggCluster(this.seed + 7300 + i * 73)),
        'egg_shell', NODE_EGG,
        {
          biomes: { '*': 0.25, shallows: 0.9, kelp_forest: 1.2, mushroom_forest: 1.3, blood_kelp: 1.1 },
          depth: [6, 480], scale: [0.7, 1.3], align: 0.75, weight: 0.7,
        },
      );
    }
    return kinds;
  }

  private placeScatter(ctx: GameContext, rockKinds: ScatterKind[]): void {
    const nodeKinds = this.buildNodeKinds();
    const all = [...rockKinds, ...nodeKinds];
    const nodeOffset = rockKinds.length;
    const b = this.budget;
    const placements: Placement[] = [];

    // World-wide boulders. `clump` gives boulder fields and clean sand.
    const rocks = scatterRegion(ctx.world, rockKinds, {
      region: 470, cell: 13, density: 0.5, perCell: 2, clump: 0.8,
      seed: this.seed + 101, max: b.rocks,
    });
    placements.push(...rocks);

    // Resource nodes — sparser, less clumped so the player always finds some.
    const nodes = scatterRegion(ctx.world, nodeKinds, {
      region: 470, cell: 26, density: 0.42, perCell: 1, clump: 0.35,
      seed: this.seed + 307, max: b.nodes,
    });
    for (const p of nodes) p.kind += nodeOffset;
    placements.push(...nodes);

    // Landmark-local density: debris fields, boulder gardens, guaranteed nodes
    // near the lifepod so the first five minutes are never a barren swim.
    const debrisKinds = nodeKinds.filter((k) => k.node === NODE_SALVAGE);
    const oreKinds = nodeKinds.filter((k) => k.node === NODE_LIMESTONE || k.node === NODE_SANDSTONE);
    const idxOf = (k: ScatterKind) => all.indexOf(k);
    const addCluster = (
      list: ScatterKind[], centre: THREE.Vector3, radius: number, count: number, seed: number,
    ) => {
      if (list.length === 0 || count <= 0) return;
      const cl = scatterCluster(ctx.world, list, centre, radius, count, seed);
      for (const p of cl) {
        p.kind = idxOf(list[p.kind]);
        if (p.kind >= 0) placements.push(p);
      }
    };

    const scale = THREE.MathUtils.clamp(ctx.settings.graphics.foliageDensity, 0.3, 1.5);
    for (const l of this.landmarks.all) {
      if (l.kind === 'debris' || l.kind === 'wreck') {
        addCluster(debrisKinds, l.position, l.radius, Math.round(46 * scale), this.seed + l.id.length * 31 + 7);
        addCluster(rockKinds, l.position, l.radius * 1.2, Math.round(26 * scale), this.seed + l.id.length * 17);
      } else if (l.kind === 'boulder_field') {
        addCluster(rockKinds, l.position, l.radius, Math.round(90 * scale), this.seed + l.id.length * 53);
        addCluster(oreKinds, l.position, l.radius, Math.round(16 * scale), this.seed + l.id.length * 59);
      } else if (l.kind === 'pod') {
        addCluster(oreKinds, l.position, 26, Math.round(12 * scale), this.seed + 991);
        addCluster(nodeKinds, l.position, 34, Math.round(18 * scale), this.seed + 997);
        addCluster(rockKinds, l.position, 30, Math.round(20 * scale), this.seed + 1009);
      } else if (l.kind === 'precursor') {
        addCluster(rockKinds, l.position, l.radius, Math.round(34 * scale), this.seed + 1013);
      }
    }

    this.batches = new PropBatches(this.lastTier);
    this.batches.commit(all, placements, this.mats!);
    this.group.add(this.batches.group);

    // Register the harvestable subset as interactables.
    for (const p of this.batches.placed) {
      if (!p.kind.node) continue;
      this.interactables.push({
        uid: `node.${this.nodeUid++}`,
        def: p.kind.node,
        position: p.centre,
        radius: p.radius,
        geometry: p.hiGeo,
        matrix: p.matrix,
        harvested: false,
        placed: p,
        mesh: null,
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Wrecks + POIs
   * ---------------------------------------------------------------- */

  private buildWrecks(ctx: GameContext): void {
    const mats = this.mats!;
    const containerGeo = makeContainer(this.seed + 4242);
    this.ownedGeo.push(containerGeo);
    let hasContainer = false;

    const place = (build: WreckBuild, l: Landmark, yaw: number, pitch: number, roll: number) => {
      const root = new THREE.Group();
      root.name = `props.${l.id}`;
      // Sample the floor across the footprint so a long hull does not float.
      let low = l.position.y;
      const r = build.radius * 0.8;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        low = Math.min(low, ctx.world.heightAt(l.position.x + Math.cos(a) * r, l.position.z + Math.sin(a) * r));
      }
      root.position.set(l.position.x, low + build.sink * 0.35 - build.sink, l.position.z);
      root.rotation.set(pitch, yaw, roll);
      root.updateMatrixWorld(true);

      for (const part of build.parts) {
        const mesh = new THREE.Mesh(part.geo, mats.get(part.mat));
        mesh.castShadow = part.castShadow && this.lastTier !== 'low';
        mesh.receiveShadow = true;
        root.add(mesh);
        this.wreckMeshes.push(mesh);
        this.ownedGeo.push(part.geo);
      }
      for (const c of build.containers) {
        const mesh = new THREE.Mesh(containerGeo, mats.get('salvage_metal'));
        mesh.position.copy(c.pos);
        mesh.rotation.y = c.yaw;
        mesh.castShadow = this.lastTier !== 'low';
        mesh.receiveShadow = true;
        root.add(mesh);
        hasContainer = true;
        mesh.updateMatrixWorld(true);
        this.interactables.push({
          uid: `container.${l.id}.${this.interactables.length}`,
          def: NODE_CONTAINER,
          position: mesh.getWorldPosition(new THREE.Vector3()),
          radius: 0.9,
          geometry: containerGeo,
          matrix: mesh.matrixWorld.clone(),
          harvested: false,
          placed: null,
          mesh,
        });
      }
      for (const li of build.lights) {
        this.emitters.push({
          pos: li.pos.clone().applyMatrix4(root.matrixWorld),
          color: new THREE.Color(li.color).convertSRGBToLinear(),
          intensity: li.intensity,
          distance: li.distance,
          flicker: li.flicker,
          phase: (l.id.length * 7 + this.emitters.length * 13) % 100,
        });
      }
      for (const iv of build.interior) {
        this.interiors.push({
          pos: iv.pos.clone().applyMatrix4(root.matrixWorld),
          radius: iv.radius,
        });
      }
      this.group.add(root);
      l.radius = Math.max(l.radius, build.radius * 1.2);
    };

    const bow = this.landmarks.get('aurora_bow');
    if (bow) place(makeHullSection(this.seed + 11), bow, 0.42, 0.14, -0.24);
    const pod = this.landmarks.get('pod_five');
    if (pod) place(makeEscapePod(this.seed + 23), pod, 0.7, 0.22, 0.3);
    const gate = this.landmarks.get('precursor_gate');
    if (gate) place(makePrecursorStructure(this.seed + 37), gate, 0.55, 0, 0);

    if (!hasContainer) this.ownedGeo.splice(this.ownedGeo.indexOf(containerGeo), 1);
  }

  /* ---------------------------------------------------------------- *
   * Vents + bubble columns
   * ---------------------------------------------------------------- */

  private buildVents(ctx: GameContext, shared: Record<string, THREE.IUniform>): void {
    const specs: VentSpec[] = [];
    const rng = mulberry32(this.seed + 8801);
    const perField = Math.max(3, Math.floor(this.budget.vents * 0.4));

    for (const l of this.landmarks.all) {
      if (l.kind !== 'vent_field') continue;
      for (let i = 0; i < perField; i++) {
        const a = rng() * Math.PI * 2;
        const r = l.radius * 0.85 * Math.pow(rng(), 0.6);
        const x = l.position.x + Math.cos(a) * r;
        const z = l.position.z + Math.sin(a) * r;
        specs.push({
          pos: new THREE.Vector3(x, ctx.world.heightAt(x, z) - 0.3, z),
          height: 1.8 + rng() * 4.4,
          heat: 0.45 + rng() * 0.55,
          seed: (this.seed + i * 313 + l.id.length * 17) | 0,
        });
      }
    }
    // A handful of lone smokers so the deep is never featureless.
    const lone = Math.max(0, this.budget.vents - specs.length);
    for (let i = 0; i < lone; i++) {
      const x = (hash2(i * 13, i * 29, this.seed + 5) * 2 - 1) * 430;
      const z = (hash2(i * 31, i * 17, this.seed + 9) * 2 - 1) * 430;
      const h = ctx.world.heightAt(x, z);
      if (-h < 60) continue;
      specs.push({
        pos: new THREE.Vector3(x, h - 0.3, z),
        height: 1.6 + hash2(i, i * 3, this.seed + 11) * 3.6,
        heat: 0.3 + hash2(i * 5, i, this.seed + 13) * 0.5,
        seed: (this.seed + 5000 + i * 97) | 0,
      });
    }

    // Cold gas seeps: bubble columns straight out of the sand.
    const seeps: Array<{ pos: THREE.Vector3; strength: number }> = [];
    const seepCount = this.lastTier === 'low' ? 6 : this.lastTier === 'medium' ? 12 : 20;
    for (let i = 0; i < seepCount; i++) {
      const x = (hash2(i * 7 + 1, i * 11 + 3, this.seed + 21) * 2 - 1) * 420;
      const z = (hash2(i * 19 + 5, i * 23 + 7, this.seed + 23) * 2 - 1) * 420;
      const h = ctx.world.heightAt(x, z);
      seeps.push({
        pos: new THREE.Vector3(x, h + 0.15, z),
        strength: 0.4 + hash2(i, i * 2, this.seed + 25) * 0.9,
      });
    }

    this.vents = new VentField(this.mats!, shared, this.lastTier);
    this.vents.build(specs, seeps, ctx.settings.graphics.particulate);
    this.group.add(this.vents.group);
    for (const e of this.vents.emitters) this.emitters.push(e);
  }

  /* ---------------------------------------------------------------- *
   * Highlight affordance
   * ---------------------------------------------------------------- */

  private buildHighlight(): void {
    this.highlightMat = this.mats!.makeHighlightMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.highlightMat);
    mesh.name = 'props.highlight';
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 9;
    this.highlight = mesh;
    this.group.add(mesh);
  }

  /* ---------------------------------------------------------------- *
   * Interaction API
   * ---------------------------------------------------------------- */

  /**
   * Aim test. Returns the closest harvestable the reticle is on, or null.
   * Other systems (view model, HUD) may call this directly.
   */
  raycastInteractable(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 4): PropInteractable | null {
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    let best: PropInteractable | null = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      if (it.harvested) continue;
      const reach = Math.min(maxDist, it.def.reach) + it.radius;
      const d2 = it.position.distanceToSquared(origin);
      if (d2 > reach * reach) continue;
      _sphere.center.copy(it.position);
      _sphere.radius = Math.max(0.35, it.radius * 1.1);
      if (!_ray.intersectsSphere(_sphere)) continue;
      if (d2 < bestD) {
        bestD = d2;
        best = it;
      }
    }
    return best;
  }

  /**
   * Harvests the focused target. Grants items through `game.state`'s inventory
   * when that system exposes one, and always announces the change on the bus so
   * the HUD, audio and quest systems can react without coupling.
   */
  tryInteract(ctx: GameContext): boolean {
    const f = this.focus;
    if (!f) return false;
    return this.harvest(ctx, f.target);
  }

  harvest(ctx: GameContext, target: PropInteractable): boolean {
    if (target.harvested) return false;
    target.harvested = true;
    if (target.placed) this.batches?.harvest(target.placed);
    else if (target.mesh) target.mesh.visible = false;

    // Deterministic per-instance loot roll.
    const rng = mulberry32(
      (Math.round(target.position.x * 17) ^ Math.round(target.position.z * 131) ^ this.seed) >>> 0,
    );
    const table = target.def.yields;
    const draws = table.length === 1 ? 1 : 1 + (rng() < 0.45 ? 1 : 0);
    const taken = new Set<number>();
    const state = ctx.tryGet<GameSystem & {
      inventory?: { add(id: string, count?: number): number; countOf(id: string): number };
      scanner?: { progress: Map<string, number> };
    }>('game.state');

    for (let d = 0; d < draws; d++) {
      let i = Math.floor(rng() * table.length) % table.length;
      let guard = 0;
      while (taken.has(i) && guard++ < table.length) i = (i + 1) % table.length;
      taken.add(i);
      const y = table[i];
      let total = y.count;
      if (state?.inventory) {
        // Use the RPG system's inventory when it is present.
        state.inventory.add(y.item, y.count);
        total = state.inventory.countOf(y.item);
      }
      ctx.bus.emit('inventory:changed', { id: y.item, delta: y.count, total });
    }

    ctx.bus.emit('audio:cue', {
      id: target.def.category === 'organic' ? 'prop.pick_organic' : 'prop.harvest',
      position: [target.position.x, target.position.y, target.position.z],
      gain: 0.85,
    });
    ctx.bus.emit('ui:notify', { text: `${target.def.label} collected`, kind: 'success', ttl: 2.5 });
    this.focus = null;
    this.interactionPrompt = null;
    if (this.highlight) this.highlight.visible = false;
    return true;
  }

  /** Puts a harvested node back (used by save-load and by respawn rules). */
  restore(target: PropInteractable): void {
    if (!target.harvested) return;
    target.harvested = false;
    if (target.placed) this.batches?.restore(target.placed);
    else if (target.mesh) target.mesh.visible = true;
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    const g = ctx.settings.graphics;
    if (g.tier !== this.lastTier) {
      // Cheap partial reconfigure: budgets and shadow flags only. Geometry is
      // never regenerated at runtime.
      this.lastTier = g.tier;
      this.budget = budgetFor(g.tier, g.foliageDensity, g.viewDistance);
      const shadows = g.tier !== 'low';
      for (const m of this.wreckMeshes) m.castShadow = shadows;
    }

    const cam = ctx.camera.position;
    this.batches?.updateLod(cam, this.budget.propViewDistance, this.budget.lodSlices);
    this.clutter?.update(ctx.world, cam);
    this.vents?.update(dt, ctx);
    if (ctx.frame % 12 === 0) this.vents?.applyLod(cam);
    this.lights?.update(this.emitters, cam, ctx.time);

    /* --- aim + highlight ----------------------------------------- */
    ctx.camera.getWorldDirection(_dir);
    const target = this.raycastInteractable(cam, _dir, 4.2);
    if (target) {
      const dist = Math.sqrt(target.position.distanceToSquared(cam));
      this.focus = { target, label: target.def.label, distance: dist, requiresTool: target.def.requiresTool };
      this.interactionPrompt = target.def.requiresTool
        ? `${target.def.label} — needs a cutting tool`
        : `[E] ${target.def.label}`;
      const hl = this.highlight;
      if (hl && this.highlightMat) {
        if (hl.geometry !== target.geometry) hl.geometry = target.geometry;
        hl.matrix.copy(target.matrix);
        hl.matrixWorldNeedsUpdate = true;
        hl.visible = true;
        this.highlightMat.uniforms.uTime.value = ctx.time;
        this.highlightMat.uniforms.uStrength.value = target.def.requiresTool ? 0.45 : 1;
        (this.highlightMat.uniforms.uColor.value as THREE.Color)
          .setHex(target.def.tint).convertSRGBToLinear();
        this.highlightMat.uniforms.uGrow.value = 0.02 + Math.min(0.09, target.radius * 0.03);
      }
    } else {
      this.focus = null;
      this.interactionPrompt = null;
      if (this.highlight) this.highlight.visible = false;
    }

    if (ctx.input.pressed('interact') && this.focus && !this.focus.requiresTool) {
      this.tryInteract(ctx);
    }

    /* --- landmark discovery -------------------------------------- */
    this.discoveryTimer += dt;
    if (this.discoveryTimer > 0.5) {
      this.discoveryTimer = 0;
      for (const l of this.landmarks.all) {
        if (l.discovered) continue;
        _tmp.copy(l.position);
        _tmp2.copy(cam);
        if (_tmp.distanceToSquared(_tmp2) > l.radius * l.radius) continue;
        l.discovered = true;
        ctx.bus.emit('ui:notify', { text: `${l.name} discovered`, kind: 'info', ttl: 4 });
        ctx.bus.emit('audio:cue', { id: 'poi.discovered', gain: 0.7 });
        if (l.databank) ctx.bus.emit('databank:unlocked', { id: l.databank });
      }
    }
  }

  /** True when the camera is inside a wreck interior. */
  insideInterior(pos: THREE.Vector3): boolean {
    for (const iv of this.interiors) {
      if (iv.pos.distanceToSquared(pos) < iv.radius * iv.radius) return true;
    }
    return false;
  }

  dispose(): void {
    this.batches?.dispose();
    this.clutter?.dispose();
    this.vents?.dispose();
    this.lights?.dispose();
    this.mats?.dispose();
    for (const g of this.ownedGeo) g.dispose();
    this.ownedGeo.length = 0;
    this.highlight?.geometry?.dispose?.();
    this.group.parent?.remove(this.group);
    this.group.clear();
    this.interactables.length = 0;
    this.interiors.length = 0;
    this.emitters.length = 0;
    this.shapes.length = 0;
    this.wreckMeshes.length = 0;
  }
}

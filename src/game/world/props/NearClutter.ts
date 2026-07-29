/**
 * Near-field ground clutter — the answer to "nothing in the frame establishes
 * scale".
 *
 * The world-wide boulder scatter is budgeted for a 940 m square, which works out
 * to roughly one rock per 900 m^2. That is a sensible mid-ground density and it
 * guarantees the *foreground* is empty: the odds of a boulder landing inside the
 * first three metres of any given view are about one in thirty. Every frame then
 * reads as a flat wash with a distant silhouette and nothing for the eye to
 * measure against.
 *
 * So the near field is dressed separately, by a ring of gravel, cobbles and
 * shell rubble that follows the camera. It is *not* random per frame: each grid
 * cell hashes to a fixed set of items, so a pebble stays exactly where it is as
 * you swim past and back. Rebuilds happen only when the camera crosses a cell
 * boundary, and the terrain sampling for a rebuild is time-sliced across frames
 * so it never shows up as a hitch.
 *
 * Items scale-fade in at the ring edge rather than popping, and the whole system
 * shares the prop rock materials, so it inherits `applyUnderwater()`, the
 * band-limited surface shading and the per-instance colour hash for free.
 */
import * as THREE from 'three';
import { hash2 } from '../../core/Noise';
import type { QualityTier, WorldQuery } from '../../core/Types';
import type { PropMatId, PropMaterialLibrary } from './PropMaterials';
import { makeRock } from './RockGen';
import type { PropShape } from './RockGen';

/* Scratch — nothing in update() allocates. */
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qAlign = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

interface ClutterBudget {
  /** Instances per material batch. */
  perBatch: number;
  /** Grid cell size, metres. */
  cell: number;
  /** Ring radius, metres. */
  radius: number;
  /** Terrain-sampled cells allowed per frame during a rebuild. */
  cellsPerFrame: number;
  /** Distinct pebble silhouettes per batch. */
  variants: number;
  shadows: boolean;
}

function budgetFor(tier: QualityTier, foliage: number): ClutterBudget {
  const base: Record<QualityTier, ClutterBudget> = {
    low: { perBatch: 90, cell: 3.0, radius: 13, cellsPerFrame: 24, variants: 3, shadows: false },
    medium: { perBatch: 170, cell: 2.6, radius: 18, cellsPerFrame: 40, variants: 4, shadows: false },
    high: { perBatch: 280, cell: 2.2, radius: 24, cellsPerFrame: 60, variants: 6, shadows: true },
    ultra: { perBatch: 400, cell: 2.0, radius: 29, cellsPerFrame: 90, variants: 8, shadows: true },
  };
  const b = { ...base[tier] };
  const f = THREE.MathUtils.clamp(foliage, 0.3, 1.5);
  b.perBatch = Math.max(40, Math.round(b.perBatch * f));
  return b;
}

/** The two rock families the ring mixes, so the foreground is never monochrome. */
const CLUTTER_MATS: PropMatId[] = ['rock_basalt', 'rock_sandstone'];

interface Batch {
  mesh: THREE.BatchedMesh;
  /** Geometry ids, one per (variant, lod). */
  geo: number[][];
  /** Instance ids, allocated once and reused forever. */
  slots: number[];
  used: number;
}

export class NearClutter {
  readonly group = new THREE.Group();

  private budget: ClutterBudget;
  private shapes: PropShape[] = [];
  private batches: Batch[] = [];
  /** Cell offsets sorted near-to-far, so a partial rebuild fills inwards first. */
  private ring: Int16Array = new Int16Array(0);
  private anchorX = Number.NaN;
  private anchorZ = Number.NaN;
  private cursor = 0;
  private rebuilding = false;
  private pendingCx = 0;
  private pendingCz = 0;
  private built = false;

  constructor(
    private readonly mats: PropMaterialLibrary,
    tier: QualityTier,
    foliage: number,
    private readonly seed: number,
  ) {
    this.group.name = 'world.props.clutter';
    this.budget = budgetFor(tier, foliage);
  }

  /** Builds geometry and the batches. Call once, from `PropsSystem.init`. */
  build(): void {
    if (this.built) return;
    this.built = true;
    const b = this.budget;

    // Cell offsets inside the ring, ordered by distance from the centre.
    const half = Math.ceil(b.radius / b.cell);
    const offs: Array<[number, number, number]> = [];
    for (let dz = -half; dz <= half; dz++) {
      for (let dx = -half; dx <= half; dx++) {
        const d = Math.hypot(dx, dz) * b.cell;
        if (d <= b.radius) offs.push([d, dx, dz]);
      }
    }
    offs.sort((p, q) => p[0] - q[0]);
    this.ring = new Int16Array(offs.length * 2);
    for (let i = 0; i < offs.length; i++) {
      this.ring[i * 2] = offs[i][1];
      this.ring[i * 2 + 1] = offs[i][2];
    }

    for (let m = 0; m < CLUTTER_MATS.length; m++) {
      // Gravel, cobbles and flat shell/plate chips — three readable sizes, so the
      // foreground has its own internal scale ladder.
      const shapes: PropShape[] = [];
      for (let v = 0; v < b.variants; v++) {
        const kind = v % 3 === 2 ? 'slab' : 'pebble';
        const s = makeRock(this.seed + m * 7717 + v * 331 + 5, kind, 0.35);
        shapes.push(s);
        this.shapes.push(s);
      }

      // Clutter is centimetre-to-decimetre scale, but `makeRock`'s lod0 is built
      // for a three-metre boulder — 960 verts for a pebble and 3840 for a chip.
      // Starting the chain one step down cuts the drawn geometry by ~60% with no
      // visible difference on something 20 cm across.
      const chains = shapes.map((s) => (s.lods.length > 1 ? s.lods.slice(1) : s.lods));

      let verts = 0;
      for (const c of chains) for (const g of c) verts += g.getAttribute('position').count;
      const mesh = new THREE.BatchedMesh(b.perBatch, verts, 0, this.mats.get(CLUTTER_MATS[m]));
      mesh.name = `props.clutter.${CLUTTER_MATS[m]}`;
      // Deliberately NOT a shadow caster. The median item is ~15 cm, which is
      // smaller than one texel of the sun cascade, so casting would buy a field
      // of flickering sub-texel dots — precisely the aliasing this project
      // rejects frames for. Grounding comes from the baked cavity AO and the
      // burial instead, and skipping it saves a second pass over the batch.
      mesh.castShadow = false;
      mesh.receiveShadow = b.shadows;
      mesh.sortObjects = false;
      // The ring is rebuilt around the camera every couple of metres, so three's
      // own bounding sphere would be stale constantly. Culling it is pointless
      // anyway: it is always exactly where the camera is.
      mesh.frustumCulled = false;

      const geo = chains.map((c) => c.map((g) => mesh.addGeometry(g)));
      const slots: number[] = [];
      for (let i = 0; i < b.perBatch; i++) {
        const id = mesh.addInstance(geo[i % geo.length][0]);
        mesh.setMatrixAt(id, _hidden);
        mesh.setVisibleAt(id, false);
        slots.push(id);
      }
      this.batches.push({ mesh, geo, slots, used: 0 });
      this.group.add(mesh);
    }
  }

  /**
   * Re-anchors the ring when the camera crosses a cell, then advances an
   * in-progress rebuild by at most `cellsPerFrame` terrain-sampled cells.
   */
  update(world: WorldQuery, camera: THREE.Vector3): void {
    if (!this.built) return;
    const b = this.budget;
    const cx = Math.floor(camera.x / b.cell);
    const cz = Math.floor(camera.z / b.cell);

    if (!this.rebuilding && (cx !== this.anchorX || cz !== this.anchorZ)) {
      this.rebuilding = true;
      this.cursor = 0;
      this.pendingCx = cx;
      this.pendingCz = cz;
      for (const ba of this.batches) ba.used = 0;
    }
    if (!this.rebuilding) return;

    const cells = this.ring.length / 2;
    const stop = Math.min(cells, this.cursor + b.cellsPerFrame);
    for (; this.cursor < stop; this.cursor++) {
      this.emitCell(world, camera, this.pendingCx + this.ring[this.cursor * 2],
        this.pendingCz + this.ring[this.cursor * 2 + 1]);
    }
    if (this.cursor >= cells) {
      // Sweep finished: retire the slots the new ring did not need.
      for (const ba of this.batches) {
        for (let i = ba.used; i < ba.slots.length; i++) ba.mesh.setVisibleAt(ba.slots[i], false);
      }
      this.rebuilding = false;
      this.anchorX = this.pendingCx;
      this.anchorZ = this.pendingCz;
    }
  }

  /**
   * Runs a whole rebuild to completion in one go. Used at init (and after a
   * teleport) so the very first frame is already dressed — the time-slicing in
   * `update` exists to hide the cost of *incremental* re-anchoring, not the
   * initial fill.
   */
  prime(world: WorldQuery, camera: THREE.Vector3): void {
    if (!this.built) return;
    this.rebuilding = false;
    this.anchorX = Number.NaN;
    const guard = Math.ceil(this.ring.length / 2 / Math.max(1, this.budget.cellsPerFrame)) + 2;
    for (let i = 0; i < guard && (i === 0 || this.rebuilding); i++) {
      this.update(world, camera);
    }
  }

  /** Places this cell's deterministic item set. */
  private emitCell(world: WorldQuery, camera: THREE.Vector3, gx: number, gz: number): void {
    const b = this.budget;
    // Item count per cell is hashed, so clutter clumps into gravel patches with
    // clean sand between them instead of reading as an even carpet.
    const dens = hash2(gx * 71 + 5, gz * 89 + 11, this.seed + 401);
    const count = dens > 0.72 ? 3 : dens > 0.4 ? 2 : dens > 0.14 ? 1 : 0;

    for (let k = 0; k < count; k++) {
      const hx = hash2(gx * 13 + k * 3, gz * 17 + k * 7, this.seed + 431);
      const hz = hash2(gx * 19 + k * 5, gz * 23 + k * 9, this.seed + 457);
      const x = (gx + hx) * b.cell;
      const z = (gz + hz) * b.cell;

      const dx = x - camera.x;
      const dz = z - camera.z;
      const dist = Math.hypot(dx, dz);
      if (dist > b.radius) continue;

      const h = world.heightAt(x, z);
      if (h > -0.5) continue;                       // never above the waterline
      world.normalAt(x, z, _n);
      if (_n.y < 0.55) continue;                    // gravel does not cling to walls

      const mi = hash2(gx * 29 + k, gz * 31 + k, this.seed + 479) < 0.62 ? 0 : 1;
      const ba = this.batches[mi];
      if (ba.used >= ba.slots.length) continue;

      const vi = Math.floor(hash2(gx * 37 + k, gz * 41 + k, this.seed + 503) * ba.geo.length)
        % ba.geo.length;
      const shape = this.shapes[mi * b.variants + vi];

      // Gravel, cobble or the occasional flat chip, biased small — the point is a
      // dense believable litter, not more boulders.
      const sJ = hash2(gx * 43 + k, gz * 47 + k, this.seed + 521);
      let scale = 0.07 + 0.62 * sJ * sJ * sJ;
      // Scale-fade over the outermost 18% of the ring so nothing ever pops in.
      const fade = 1 - THREE.MathUtils.smoothstep(dist, b.radius * 0.82, b.radius);
      scale *= fade;
      if (scale < 0.02) continue;

      const rot = hash2(gx * 53 + k, gz * 59 + k, this.seed + 547) * Math.PI * 2;
      _qy.setFromAxisAngle(_up, rot);
      // Settle onto the slope, but only most of the way: a pebble sitting dead
      // flat on a gradient looks placed.
      _q.setFromUnitVectors(_up, _n);
      _qAlign.identity();
      _qy.premultiply(_q.slerp(_qAlign, 0.25));
      _scl.setScalar(scale);
      _pos.set(x, h - shape.burial * scale * 0.9, z);
      _m4.compose(_pos, _qy, _scl);

      // Distance LOD: the far half of the ring does not need the detailed mesh.
      const lodIds = ba.geo[vi];
      const lod = dist > b.radius * 0.55 ? Math.min(1, lodIds.length - 1) : 0;
      const id = ba.slots[ba.used++];
      ba.mesh.setGeometryIdAt(id, lodIds[lod]);
      ba.mesh.setMatrixAt(id, _m4);
      ba.mesh.setVisibleAt(id, true);
    }
  }

  dispose(): void {
    for (const ba of this.batches) {
      ba.mesh.dispose();
      this.group.remove(ba.mesh);
    }
    this.batches.length = 0;
    for (const s of this.shapes) for (const g of s.lods) g.dispose();
    this.shapes.length = 0;
    this.group.parent?.remove(this.group);
    this.built = false;
  }
}

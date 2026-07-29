/**
 * Deterministic scatter + batching for every static prop in the world.
 *
 * Placement is a two-pass affair: first a jittered-grid pass decides *what*
 * goes *where* (gated by biome, depth, slope and a low-frequency clumping field
 * so you get boulder fields and clean sand patches rather than uniform
 * confetti), then a commit pass builds one `THREE.BatchedMesh` per material.
 *
 * `BatchedMesh` is the right tool here: many different geometries in a single
 * draw call, per-instance frustum culling done by three, and per-instance
 * geometry swapping, which is how the LOD chain is applied. Per-instance
 * colour/roughness/pattern variation needs no attributes at all — the shader
 * hashes the instance's own translation (see `PropShaders.ts`).
 *
 * Rocks are sunk to the *minimum* terrain height across their footprint, so
 * nothing floats on a slope and no base is ever coplanar with the sea floor
 * (which is what would cause Z-fighting).
 */
import * as THREE from 'three';
import { Noise, hash2, mulberry32 } from '../../core/Noise';
import type { QualityTier, WorldQuery } from '../../core/Types';
import type { PropMatId, PropMaterialLibrary } from './PropMaterials';
import type { PropShape } from './RockGen';

const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _qIdentity = new THREE.Quaternion();
const _ray = new THREE.Ray();
const _sphere = new THREE.Sphere();

/** A harvestable resource node attached to a scatter kind. */
export interface NodeDef {
  /** Interaction id; also the scan target id. */
  id: string;
  /** Text the HUD shows on the prompt. */
  label: string;
  /** Scanner/databank category. */
  category: string;
  /** What the player receives. */
  yields: Array<{ item: string; count: number }>;
  /** True when a cutting/drilling tool is required rather than bare hands. */
  requiresTool: boolean;
  /** Interaction range in metres. */
  reach: number;
  /** Highlight tint. */
  tint: number;
}

export interface ScatterKind {
  id: string;
  shape: PropShape;
  mat: PropMatId;
  /** Biome weights keyed by biome id; `'*'` is the fallback. */
  biomes: Record<string, number>;
  /** Allowed floor depth range, metres below sea level. */
  depth: [number, number];
  /** Reject placements on slopes steeper than this (terrain normal Y). */
  minNormalY: number;
  /** Uniform scale range. */
  scale: [number, number];
  /** 0 = stand straight up, 1 = fully align to the terrain normal. */
  align: number;
  /** Relative abundance inside its scatter group. */
  weight: number;
  /** Extra sink beyond the shape's own burial, in metres. */
  extraSink?: number;
  node?: NodeDef;
}

export interface Placement {
  kind: number;
  matrix: THREE.Matrix4;
  centre: THREE.Vector3;
  radius: number;
}

export interface PlacedProp {
  kind: ScatterKind;
  batch: THREE.BatchedMesh;
  instanceId: number;
  lodIds: number[];
  centre: THREE.Vector3;
  radius: number;
  matrix: THREE.Matrix4;
  /** lod0 geometry, borrowed by the highlight shell. */
  hiGeo: THREE.BufferGeometry;
  lod: number;
  shown: boolean;
  harvested: boolean;
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

function orient(
  world: WorldQuery, kind: ScatterKind, x: number, z: number, rot: number, scale: number,
  out: Placement,
): boolean {
  const h = world.heightAt(x, z);
  const depth = -h;
  if (depth < kind.depth[0] || depth > kind.depth[1]) return false;
  world.normalAt(x, z, _n);
  if (_n.y < kind.minNormalY) return false;

  const shape = kind.shape;
  const foot = Math.max(0.3, shape.radius * scale);
  // Sink to the lowest floor height under the footprint: never floating, and
  // never coplanar with the terrain either.
  let low = h;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    low = Math.min(low, world.heightAt(x + Math.cos(a) * foot, z + Math.sin(a) * foot));
  }
  const sink = shape.burial * scale + (kind.extraSink ?? 0);
  const y = low - sink;

  _qy.setFromAxisAngle(_up, rot);
  if (kind.align > 0.001) {
    _q.setFromUnitVectors(_up, _n);
    _qy.premultiply(_q.slerp(_qIdentity, 1 - kind.align));
  }
  _scale.setScalar(scale);
  out.matrix.compose(_pos.set(x, y, z), _qy, _scale);
  out.centre.set(x, y + shape.height * scale * 0.5, z);
  out.radius = Math.max(foot, shape.height * scale * 0.6);
  return true;
}

export interface ScatterOptions {
  /** Half-extent of the scattered region, metres. */
  region: number;
  /** Jittered-grid cell size, metres. */
  cell: number;
  /** Probability an individual cell candidate survives, 0..1. */
  density: number;
  /** Candidates attempted per cell. */
  perCell: number;
  /** Low-frequency clumping strength, 0 = uniform. */
  clump: number;
  seed: number;
  /** Hard cap. */
  max: number;
}

/**
 * Deterministic world-wide scatter. Identical for a given seed, every run.
 *
 * The budget is applied by *thinning the whole field uniformly*, not by stopping
 * the scan once it is full. That distinction matters enormously: the raster scan
 * runs -region..+region in Z, so an early-out cap spent the entire budget on the
 * first few rows and left ~90% of the world with no props at all. Thinning uses
 * an independent spatial hash, so lowering the budget lowers density everywhere
 * instead of shrinking the populated area.
 *
 * It is also much cheaper: the terrain is only sampled for candidates that
 * survive thinning, and `orient` costs five `heightAt` calls each.
 */
export function scatterRegion(
  world: WorldQuery, kinds: ScatterKind[], opts: ScatterOptions,
): Placement[] {
  const out: Placement[] = [];
  if (kinds.length === 0 || opts.max <= 0) return out;
  const noise = new Noise(opts.seed ^ 0x51de);
  const n = Math.ceil(opts.region / opts.cell);
  const weights = new Float64Array(kinds.length);

  // --- pass 1: enumerate survivors of the density/clump gate (no terrain) ---
  const cand: number[] = [];
  for (let gz = -n; gz <= n; gz++) {
    for (let gx = -n; gx <= n; gx++) {
      for (let k = 0; k < opts.perCell; k++) {
        const h3 = hash2(gx * 13 + k * 3, gz * 17 + k * 7, opts.seed + 53);
        const x = (gx + hash2(gx * 3 + k, gz * 5 + k, opts.seed + 11)) * opts.cell;
        const z = (gz + hash2(gx * 7 + k, gz * 11 + k, opts.seed + 29)) * opts.cell;
        if (Math.abs(x) > opts.region || Math.abs(z) > opts.region) continue;
        let p = opts.density;
        if (opts.clump > 0) {
          const c = noise.fbm2(x * 0.0055, z * 0.0055, 3) * 0.5 + 0.5;
          p *= 1 - opts.clump + opts.clump * 2.4 * c * c;
        }
        if (h3 > p) continue;
        cand.push(gx, gz, k);
      }
    }
  }

  const count = cand.length / 3;
  if (count === 0) return out;
  // Aim a little over budget: `orient` still rejects on depth and slope, and
  // under-filling the world is worse than trimming a few at the end.
  const keep = count <= opts.max ? 1 : Math.min(1, (opts.max * 1.35) / count);

  // --- pass 2: place the survivors ---
  const ceiling = opts.max * 2;
  for (let c = 0; c < cand.length && out.length < ceiling; c += 3) {
    const gx = cand[c];
    const gz = cand[c + 1];
    const k = cand[c + 2];
    if (keep < 1 && hash2(gx * 61 + k * 5, gz * 67 + k * 9, opts.seed + 199) > keep) continue;

    const x = (gx + hash2(gx * 3 + k, gz * 5 + k, opts.seed + 11)) * opts.cell;
    const z = (gz + hash2(gx * 7 + k, gz * 11 + k, opts.seed + 29)) * opts.cell;

    const b = world.biomeAt(x, z);
    let total = 0;
    for (let i = 0; i < kinds.length; i++) {
      const kd = kinds[i];
      const w = (kd.biomes[b.id] ?? kd.biomes['*'] ?? 0) * kd.weight;
      weights[i] = w;
      total += w;
    }
    if (total <= 0) continue;
    let pick = hash2(gx * 19 + k, gz * 23 + k, opts.seed + 71) * total;
    let ki = 0;
    for (; ki < kinds.length - 1; ki++) {
      pick -= weights[ki];
      if (pick <= 0) break;
    }
    if (weights[ki] <= 0) continue;

    const kind = kinds[ki];
    const rot = hash2(gx * 29 + k, gz * 31 + k, opts.seed + 97) * Math.PI * 2;
    const sJ = hash2(gx * 37 + k, gz * 41 + k, opts.seed + 131);
    const scale = kind.scale[0] + (kind.scale[1] - kind.scale[0]) * sJ * sJ;
    const pl: Placement = { kind: ki, matrix: new THREE.Matrix4(), centre: new THREE.Vector3(), radius: 1 };
    if (orient(world, kind, x, z, rot, scale, pl)) out.push(pl);
  }

  // The 1.35 headroom above covers `orient` rejections; when it overshoots,
  // trim by stride rather than by truncation. `out` is in raster order, so every
  // Nth entry is still spread over the whole region — lopping off the tail would
  // just reintroduce the empty-far-edge bug in a milder form.
  if (out.length > opts.max) {
    const stride = out.length / opts.max;
    const trimmed: Placement[] = [];
    for (let i = 0; i < opts.max; i++) trimmed.push(out[Math.floor(i * stride)]);
    return trimmed;
  }
  return out;
}

/** Dense local scatter used for debris fields and boulder gardens. */
export function scatterCluster(
  world: WorldQuery, kinds: ScatterKind[], centre: THREE.Vector3,
  radius: number, count: number, seed: number,
): Placement[] {
  const out: Placement[] = [];
  if (kinds.length === 0) return out;
  const rng = mulberry32(seed);
  const weights = new Float64Array(kinds.length);
  for (let i = 0; i < count; i++) {
    // sqrt for area-uniform, biased slightly inward so the centre reads dense
    const r = radius * Math.pow(rng(), 0.62);
    const a = rng() * Math.PI * 2;
    const x = centre.x + Math.cos(a) * r;
    const z = centre.z + Math.sin(a) * r;
    let total = 0;
    for (let k = 0; k < kinds.length; k++) {
      weights[k] = kinds[k].weight;
      total += weights[k];
    }
    let pick = rng() * total;
    let ki = 0;
    for (; ki < kinds.length - 1; ki++) {
      pick -= weights[ki];
      if (pick <= 0) break;
    }
    const kind = kinds[ki];
    const sJ = rng();
    const scale = kind.scale[0] + (kind.scale[1] - kind.scale[0]) * sJ * sJ;
    const pl: Placement = { kind: ki, matrix: new THREE.Matrix4(), centre: new THREE.Vector3(), radius: 1 };
    if (orient(world, kind, x, z, rng() * Math.PI * 2, scale, pl)) out.push(pl);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Batching + LOD
 * ------------------------------------------------------------------ */

export class PropBatches {
  readonly group = new THREE.Group();
  readonly placed: PlacedProp[] = [];
  private batches: THREE.BatchedMesh[] = [];
  private cursor = 0;

  constructor(private readonly tier: QualityTier) {
    this.group.name = 'world.props.batches';
  }

  /**
   * Commits placements into one `BatchedMesh` per material. Geometry is uploaded
   * once per (kind, lod); instances only cost a matrix.
   */
  commit(kinds: ScatterKind[], placements: Placement[], mats: PropMaterialLibrary): void {
    if (placements.length === 0) return;
    const byMat = new Map<PropMatId, { kinds: Set<number>; items: Placement[] }>();
    for (const p of placements) {
      const mat = kinds[p.kind].mat;
      let e = byMat.get(mat);
      if (!e) {
        e = { kinds: new Set(), items: [] };
        byMat.set(mat, e);
      }
      e.kinds.add(p.kind);
      e.items.push(p);
    }

    const shadows = this.tier !== 'low';
    for (const [mat, entry] of byMat) {
      let verts = 0;
      for (const ki of entry.kinds) {
        for (const g of kinds[ki].shape.lods) verts += g.getAttribute('position').count;
      }
      const batch = new THREE.BatchedMesh(entry.items.length, verts, 0, mats.get(mat));
      batch.name = `props.batch.${mat}`;
      batch.castShadow = shadows;
      batch.receiveShadow = true;
      batch.sortObjects = false;
      const lodIds = new Map<number, number[]>();
      for (const ki of entry.kinds) {
        lodIds.set(ki, kinds[ki].shape.lods.map((g) => batch.addGeometry(g)));
      }
      for (const p of entry.items) {
        const ids = lodIds.get(p.kind);
        if (!ids) continue;
        const id = batch.addInstance(ids[0]);
        batch.setMatrixAt(id, p.matrix);
        this.placed.push({
          kind: kinds[p.kind],
          batch,
          instanceId: id,
          lodIds: ids,
          centre: p.centre,
          radius: p.radius,
          matrix: p.matrix,
          hiGeo: kinds[p.kind].shape.lods[0],
          lod: 0,
          shown: true,
          harvested: false,
        });
      }
      batch.computeBoundingSphere();
      batch.computeBoundingBox();
      this.batches.push(batch);
      this.group.add(batch);
    }
  }

  /**
   * Time-sliced LOD + distance culling. Touches a fraction of the instance list
   * each frame so a few thousand props never show up in a frame-time spike.
   */
  updateLod(cameraPos: THREE.Vector3, viewDistance: number, slices = 6): void {
    const list = this.placed;
    if (list.length === 0) return;
    const chunk = Math.ceil(list.length / slices);
    for (let n = 0; n < chunk; n++) {
      const p = list[this.cursor];
      this.cursor = (this.cursor + 1) % list.length;
      if (p.harvested) continue;
      const d = Math.sqrt(
        (p.centre.x - cameraPos.x) ** 2 + (p.centre.y - cameraPos.y) ** 2 + (p.centre.z - cameraPos.z) ** 2,
      );
      // Big props hold their detail further out; a pebble drops immediately.
      const t0 = 16 + p.radius * 11;
      const t1 = 52 + p.radius * 26;
      const want = d > t1 ? 2 : d > t0 ? 1 : 0;
      const target = p.lodIds[Math.min(want, p.lodIds.length - 1)];
      if (p.lod !== want) {
        p.lod = want;
        p.batch.setGeometryIdAt(p.instanceId, target);
      }
      const show = d < viewDistance + p.radius * 4;
      if (show !== p.shown) {
        p.shown = show;
        p.batch.setVisibleAt(p.instanceId, show);
      }
    }
  }

  /**
   * Ray test against harvestable nodes. Cheap: bounding-sphere only, over the
   * candidates already inside `reach` — there are never many.
   */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): PlacedProp | null {
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    let best: PlacedProp | null = null;
    let bestT = maxDist;
    for (const p of this.placed) {
      if (p.harvested || !p.kind.node) continue;
      const reach = Math.min(maxDist, p.kind.node.reach + p.radius);
      const d2 = p.centre.distanceToSquared(origin);
      if (d2 > reach * reach) continue;
      _sphere.center.copy(p.centre);
      _sphere.radius = p.radius * 1.15;
      if (!_ray.intersectsSphere(_sphere)) continue;
      const t = Math.sqrt(d2);
      if (t < bestT) {
        bestT = t;
        best = p;
      }
    }
    return best;
  }

  /** Hides a harvested instance. Reversible via `restore`. */
  harvest(p: PlacedProp): void {
    if (p.harvested) return;
    p.harvested = true;
    p.batch.setVisibleAt(p.instanceId, false);
  }

  restore(p: PlacedProp): void {
    if (!p.harvested) return;
    p.harvested = false;
    p.shown = true;
    p.batch.setVisibleAt(p.instanceId, true);
  }

  dispose(): void {
    for (const b of this.batches) {
      b.dispose();
      this.group.remove(b);
    }
    this.batches.length = 0;
    this.placed.length = 0;
  }
}

/** Sum of vertices across a shape's LOD chain — used for batch sizing. */
export function shapeVertexCount(shape: PropShape): number {
  let v = 0;
  for (const g of shape.lods) v += g.getAttribute('position').count;
  return v;
}

/**
 * Procedural rock, crystal and organic prop geometry.
 *
 * The boulder pipeline is: geodesic sphere → anisotropic squash → multi-octave
 * radial displacement → stepped bedding terraces → **plate fracturing** (each
 * fracture plane flattens everything beyond it, which is what produces the flat
 * bedding faces and conchoidal chips real rock has) → weighted erosion (strong
 * on the buried underside, weak on exposed crests, so ridges stay crisp) →
 * cavity-AO bake → partial facet normals.
 *
 * Every stage is a pure function of the original unit direction, so the same
 * parameters re-run at a lower subdivision give a *matching silhouette* — that
 * is how the LOD chain is built without any decimation code.
 */
import * as THREE from 'three';
import { Noise, mulberry32 } from '../../core/Noise';
import {
  adjacency, appendSoft, bakeCavityAO, boundsOf, emptySoft, gridSurface, icosphere,
  laplacian, markBoundaryWear, superBox, toGeometry, transformSoft, vertexNormals,
} from './GeoUtil';
import type { Rng, SoftMesh } from './GeoUtil';

const _v = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();

/** A prop shape plus its LOD chain, ready to be handed to a `BatchedMesh`. */
export interface PropShape {
  id: string;
  /** Index 0 is the highest detail. */
  lods: THREE.BufferGeometry[];
  /** Local-space bounding radius, used for placement and burial depth. */
  radius: number;
  /** Local-space height above the origin (origin sits at the base). */
  height: number;
  /** How far the base should be sunk into the sea floor, in local units. */
  burial: number;
}

export interface RockParams {
  detail: number;
  squash: THREE.Vector3;
  /** Low-frequency lumpiness, fraction of radius. */
  warp: number;
  /** Ridged high-frequency crests. */
  ridge: number;
  /** Stepped sedimentary terraces: strength and vertical frequency. */
  bedding: number;
  beddingFreq: number;
  /** Number of fracture planes and how hard they flatten. */
  plates: number;
  plateBite: number;
  /** Bias of fracture planes toward horizontal (1) vs random (0). */
  plateFlat: number;
  /** Erosion smoothing passes. */
  erode: number;
  facet: number;
}

const DEFAULT_ROCK: RockParams = {
  detail: 3,
  squash: new THREE.Vector3(1, 1, 1),
  warp: 0.3,
  ridge: 0.14,
  bedding: 0.05,
  beddingFreq: 2.4,
  plates: 4,
  plateBite: 0.75,
  plateFlat: 0.55,
  erode: 2,
  facet: 0.45,
};

/* ------------------------------------------------------------------ *
 * Boulders
 * ------------------------------------------------------------------ */

function buildRock(noise: Noise, rng: Rng, p: RockParams, detail: number): SoftMesh {
  const m = icosphere(detail);
  for (const v of m.verts) v.multiply(p.squash);

  // Fracture planes are drawn from the *same* rng sequence for every LOD, so
  // the low-detail copy keeps the high-detail silhouette.
  const planes: Array<{ n: THREE.Vector3; d: number }> = [];
  for (let i = 0; i < p.plates; i++) {
    const flat = rng() < p.plateFlat;
    const n = flat
      ? new THREE.Vector3(rng() - 0.5, (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.6), rng() - 0.5)
      : new THREE.Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.5, rng() * 2 - 1);
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
    n.normalize();
    planes.push({ n, d: 0.42 + rng() * 0.44 });
  }
  const ox = rng() * 130;
  const oy = rng() * 130;
  const oz = rng() * 130;

  for (const v of m.verts) {
    const qx = v.x * 1.35 + ox;
    const qy = v.y * 1.35 + oy;
    const qz = v.z * 1.35 + oz;

    let r = 1;
    r += p.warp * noise.fbm3(qx * 0.62, qy * 0.62, qz * 0.62, 4);
    r += p.ridge * (noise.ridged2(qx * 1.5 + qz * 0.4, qy * 1.5) - 0.42);

    // Stepped bedding: quantising the radius against a warped height band
    // makes real terraces with an overhanging lip, not a sine wave.
    if (p.bedding > 0) {
      const phase = v.y * p.beddingFreq + noise.fbm3(qx * 0.3, qy * 0.12, qz * 0.3, 2) * 1.1;
      const frac = phase - Math.floor(phase);
      r += p.bedding * (frac < 0.22 ? -1.1 : frac > 0.86 ? 0.45 : 0.05);
    }
    v.multiplyScalar(Math.max(0.32, r));

    // Plate fracturing.
    for (const pl of planes) {
      const dist = v.dot(pl.n) - pl.d;
      if (dist > 0) v.addScaledVector(pl.n, -dist * p.plateBite);
    }
  }

  const adj = adjacency(m);
  if (p.erode > 0) {
    const maxY = m.verts.reduce((a, v) => Math.max(a, v.y), 0.001);
    // Erode the buried underside hard, leave exposed crests alone.
    laplacian(m, adj, p.erode, 0.5, (i) => {
      const h = m.verts[i].y / maxY;
      return 0.35 + 0.65 * Math.max(0, -h);
    });
  }
  return m;
}

/**
 * Bakes the shared per-vertex payload: cavity AO, chipped-edge wear from local
 * convexity, and clumped encrustation seeds.
 */
function bakeRockSurface(m: SoftMesh, noise: Noise, crust: number): void {
  const adj = adjacency(m);
  bakeCavityAO(m, adj, 1.1, 0.2);
  const nrm = vertexNormals(m);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of m.verts) {
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const span = Math.max(0.001, maxY - minY);
  for (let i = 0; i < m.verts.length; i++) {
    const v = m.verts[i];
    // convexity: neighbours fall away from the vertex plane → an exposed edge
    let conv = 0;
    for (const j of adj[i]) conv += _v.subVectors(m.verts[j], v).dot(nrm[i]);
    conv = -conv / Math.max(1, adj[i].length);
    m.surf[i].y = Math.min(1, Math.max(0, conv * 7));
    m.surf[i].z = Math.min(1, Math.max(0,
      crust * (0.35 + 0.9 * (noise.fbm3(v.x * 0.9 + 5, v.y * 0.9, v.z * 0.9 - 3, 3) * 0.5 + 0.5))
      * (0.4 + 0.6 * (v.y - minY) / span)));
    // Darken the part that will be buried in the sand.
    const buried = Math.max(0, 1 - (v.y - minY) / (span * 0.45));
    m.surf[i].x *= 1 - buried * 0.55;
  }
}

/** Recentres so the origin sits at the base centre, and returns the metrics. */
function groundAndMeasure(m: SoftMesh): { radius: number; height: number } {
  boundsOf(m, _box);
  const cx = (_box.min.x + _box.max.x) * 0.5;
  const cz = (_box.min.z + _box.max.z) * 0.5;
  for (const v of m.verts) {
    v.x -= cx;
    v.y -= _box.min.y;
    v.z -= cz;
  }
  let radius = 0;
  let height = 0;
  for (const v of m.verts) {
    radius = Math.max(radius, Math.hypot(v.x, v.z));
    height = Math.max(height, v.y);
  }
  return { radius, height };
}

export type RockKind = 'boulder' | 'slab' | 'spire' | 'outcrop' | 'chunk' | 'pebble';

const ROCK_KINDS: Record<RockKind, Partial<RockParams>> = {
  boulder: { warp: 0.32, ridge: 0.13, bedding: 0.045, plates: 4, plateBite: 0.7, erode: 2, facet: 0.4 },
  slab: {
    squash: new THREE.Vector3(1.5, 0.42, 1.15), warp: 0.2, ridge: 0.08, bedding: 0.1,
    beddingFreq: 6, plates: 6, plateBite: 0.95, plateFlat: 0.85, erode: 1, facet: 0.8,
  },
  spire: {
    squash: new THREE.Vector3(0.62, 1.9, 0.7), warp: 0.26, ridge: 0.3, bedding: 0.07,
    beddingFreq: 1.6, plates: 5, plateBite: 0.8, plateFlat: 0.35, erode: 1, facet: 0.6,
  },
  outcrop: {
    squash: new THREE.Vector3(1.7, 0.62, 1.5), warp: 0.36, ridge: 0.22, bedding: 0.09,
    beddingFreq: 3.4, plates: 7, plateBite: 0.85, plateFlat: 0.7, erode: 2, facet: 0.55,
  },
  chunk: {
    squash: new THREE.Vector3(1.1, 0.85, 0.95), warp: 0.16, ridge: 0.06, bedding: 0.02,
    plates: 9, plateBite: 1, plateFlat: 0.25, erode: 0, facet: 0.95,
  },
  pebble: {
    squash: new THREE.Vector3(1.2, 0.6, 1), warp: 0.22, ridge: 0.05, bedding: 0,
    plates: 3, plateBite: 0.6, erode: 3, facet: 0.25, detail: 2,
  },
};

/**
 * One rock variant with a 3-step LOD chain. `seed` selects the variant, so a
 * handful of calls produces an unlimited family of distinct silhouettes.
 */
export function makeRock(seed: number, kind: RockKind, crust = 1, lodCount = 3): PropShape {
  const noise = new Noise(seed ^ 0x9e3779b9);
  const base: RockParams = { ...DEFAULT_ROCK, ...ROCK_KINDS[kind] };
  // Jitter the recipe per variant so no two share proportions.
  const jr = mulberry32(seed);
  const p: RockParams = {
    ...base,
    squash: base.squash.clone().multiply(
      new THREE.Vector3(0.8 + jr() * 0.5, 0.78 + jr() * 0.55, 0.8 + jr() * 0.5),
    ),
    warp: base.warp * (0.75 + jr() * 0.6),
    ridge: base.ridge * (0.6 + jr() * 0.9),
    bedding: base.bedding * (0.5 + jr() * 1.1),
    beddingFreq: base.beddingFreq * (0.7 + jr() * 0.7),
    plates: Math.max(2, Math.round(base.plates * (0.7 + jr() * 0.8))),
  };

  const lods: THREE.BufferGeometry[] = [];
  let radius = 1;
  let height = 1;
  const top = p.detail;
  for (let l = 0; l < lodCount; l++) {
    const rng = mulberry32(seed + 7771);   // identical plane sequence per LOD
    const detail = Math.max(1, top - l);
    const m = buildRock(noise, rng, p, detail);
    bakeRockSurface(m, noise, crust);
    const met = groundAndMeasure(m);
    if (l === 0) {
      radius = met.radius;
      height = met.height;
    }
    lods.push(toGeometry(m, { facet: l === 0 ? p.facet : Math.min(1, p.facet + 0.2) }));
  }
  return {
    id: `rock_${kind}_${seed}`,
    lods,
    radius,
    height,
    burial: height * (kind === 'spire' ? 0.16 : kind === 'slab' ? 0.3 : 0.26),
  };
}

/* ------------------------------------------------------------------ *
 * Resource-node shapes
 * ------------------------------------------------------------------ */

/**
 * Quartz / crystal cluster: hexagonal prisms with pyramidal terminations,
 * splayed from a common root and mutually interpenetrating.
 */
export function makeCrystalCluster(seed: number, count = 5): PropShape {
  const rng = mulberry32(seed);
  const noise = new Noise(seed ^ 0x51ed27);
  const cluster = emptySoft();
  for (let i = 0; i < count; i++) {
    const len = 0.5 + rng() * 1.1;
    const rad = 0.09 + rng() * 0.14;
    const sides = rng() < 0.35 ? 5 : 6;
    const prism = gridSurface(sides, 5, (u, v, out) => {
      const a = u * Math.PI * 2 + 0.3;
      // taper to a point over the last fifth: a real crystal termination
      const t = v < 0.8 ? 1 - v * 0.18 : (1 - v) / 0.2 * 0.82;
      const wob = 1 + 0.09 * noise.fbm2(Math.cos(a) * 3 + i * 9, v * 2.5);
      out.set(Math.cos(a) * rad * t * wob, v * len, Math.sin(a) * rad * t * wob);
    }, true);
    const adj = adjacency(prism);
    bakeCavityAO(prism, adj, 0.7, 0.4);
    for (let k = 0; k < prism.verts.length; k++) {
      prism.surf[k].y = 0;
      prism.surf[k].z = 0;
      prism.surf[k].x *= 0.5 + 0.5 * (prism.verts[k].y / len);
    }
    const tilt = (0.12 + rng() * 0.62) * (i === 0 ? 0.25 : 1);
    const az = rng() * Math.PI * 2;
    _q.setFromEuler(new THREE.Euler(Math.sin(az) * tilt, az, Math.cos(az) * tilt, 'YXZ'));
    _m4.compose(
      new THREE.Vector3((rng() - 0.5) * 0.34, -0.06 - rng() * 0.1, (rng() - 0.5) * 0.34),
      _q, new THREE.Vector3(1, 1, 1),
    );
    appendSoft(cluster, prism, _m4);
  }
  // a small rock base so the cluster is not floating on nothing
  const baseRock = buildRock(noise, mulberry32(seed + 3), {
    ...DEFAULT_ROCK, detail: 2, squash: new THREE.Vector3(1.3, 0.45, 1.2),
    warp: 0.3, ridge: 0.1, plates: 4, plateBite: 0.8, erode: 2,
  }, 2);
  bakeRockSurface(baseRock, noise, 0.4);
  transformSoft(baseRock, _m4.makeScale(0.55, 0.4, 0.55));
  appendSoft(cluster, baseRock);

  const met = groundAndMeasure(cluster);
  const hi = toGeometry(cluster, { facet: 0.92 });
  const lo = toGeometry(cluster, { facet: 1 });
  return { id: `crystal_${seed}`, lods: [hi, lo], radius: met.radius, height: met.height, burial: met.height * 0.18 };
}

/** Creature egg cluster: 2–4 leathery ovoids nested in a shallow depression. */
export function makeEggCluster(seed: number): PropShape {
  const rng = mulberry32(seed);
  const noise = new Noise(seed ^ 0x2f8a);
  const out = emptySoft();
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const egg = icosphere(3);
    const rx = 0.26 + rng() * 0.14;
    const ry = rx * (1.25 + rng() * 0.4);
    for (const v of egg.verts) {
      const d = 1
        + 0.1 * noise.fbm3(v.x * 2.6 + i * 11, v.y * 2.6, v.z * 2.6, 3)
        + 0.05 * Math.max(0, v.y);             // slightly pointed at the top
      v.set(v.x * rx * d, v.y * ry * d, v.z * rx * d);
    }
    const adj = adjacency(egg);
    bakeCavityAO(egg, adj, 0.8, 0.35);
    for (const s of egg.surf) { s.y = 0; s.z = 0; }
    _q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 6.28, (rng() - 0.5) * 0.5, 'YXZ'));
    _m4.compose(
      new THREE.Vector3((rng() - 0.5) * 0.42, ry * 0.82, (rng() - 0.5) * 0.42),
      _q, new THREE.Vector3(1, 1, 1),
    );
    appendSoft(out, egg, _m4);
  }
  const met = groundAndMeasure(out);
  return {
    id: `egg_${seed}`,
    lods: [toGeometry(out, { facet: 0.1 }), toGeometry(out, { facet: 0.25 })],
    radius: met.radius, height: met.height, burial: met.height * 0.1,
  };
}

/** Harvestable coral sample: a lobed brain/fan blob with deep sulci. */
export function makeCoralSample(seed: number): PropShape {
  const rng = mulberry32(seed);
  const noise = new Noise(seed ^ 0x77c1);
  const m = icosphere(3);
  const fan = rng() < 0.45;
  const cell = { x: 0, y: 0 };
  for (const v of m.verts) {
    const s = fan ? new THREE.Vector3(1.35, 0.95, 0.42) : new THREE.Vector3(1, 0.78, 1);
    v.multiply(s);
    const w = noise.worley2(v.x * 3.2 + 4, v.z * 3.2 - 2, cell);
    const lobes = 1 + 0.3 * noise.billow2(v.x * 2.1, v.z * 2.1 + v.y * 1.4, 3);
    const sulci = 0.16 * Math.min(1, w * 2.4);
    v.multiplyScalar(Math.max(0.4, (0.62 + rng() * 0.12) * (lobes - 0.14 + sulci)));
  }
  const adj = adjacency(m);
  laplacian(m, adj, 1, 0.3);
  bakeCavityAO(m, adj, 1.4, 0.16);
  for (const s of m.surf) { s.y = 0; s.z = 0; }
  const met = groundAndMeasure(m);
  return {
    id: `coral_${seed}`,
    lods: [toGeometry(m, { facet: 0.15 }), toGeometry(m, { facet: 0.35 })],
    radius: met.radius, height: met.height, burial: met.height * 0.12,
  };
}

/**
 * Hydrothermal chimney. One continuous surface that climbs the outside, curls
 * over the rim and drops back down into the throat, so it reads as a hollow
 * vent from any angle without needing a two-sided material.
 */
export function makeVentChimney(seed: number, height = 3.4): PropShape {
  const noise = new Noise(seed ^ 0x1d0f);
  const rng = mulberry32(seed);
  const rBase = height * (0.28 + rng() * 0.14);
  const leanX = (rng() - 0.5) * height * 0.22;
  const leanZ = (rng() - 0.5) * height * 0.22;

  const m = gridSurface(14, 16, (u, v, out) => {
    const a = u * Math.PI * 2;
    let y: number;
    let r: number;
    if (v < 0.76) {
      const t = v / 0.76;
      y = t * height;
      r = rBase * (1 - 0.58 * t) * (1 + 0.1 * Math.sin(t * 7 + a * 2));
    } else {
      const s = (v - 0.76) / 0.24;
      y = height - s * height * 0.26;
      r = rBase * 0.42 * (1 - 0.88 * s);
    }
    const wob = 1 + 0.28 * noise.fbm2(Math.cos(a) * 2.2 + 11, Math.sin(a) * 2.2 + v * 5.5);
    const t01 = Math.min(1, v / 0.76);
    out.set(
      Math.cos(a) * r * wob + leanX * t01 * t01,
      y,
      Math.sin(a) * r * wob * (1 + 0.12 * Math.sin(a * 3)) + leanZ * t01 * t01,
    );
  }, true);

  const adj = adjacency(m);
  laplacian(m, adj, 1, 0.25);
  bakeCavityAO(m, adj, 1.2, 0.12);
  markBoundaryWear(m, 0.8, 2);
  for (let i = 0; i < m.verts.length; i++) {
    m.surf[i].z = 0.15;
    // AO ramps down hard inside the throat
    m.surf[i].x *= m.verts[i].y > height * 0.9 ? 0.35 : 1;
  }
  const met = groundAndMeasure(m);
  return {
    id: `vent_${seed}`,
    lods: [toGeometry(m, { facet: 0.5 }), toGeometry(m, { facet: 0.7 })],
    radius: met.radius, height: met.height, burial: met.height * 0.12,
  };
}

/* ------------------------------------------------------------------ *
 * Debris / salvage
 * ------------------------------------------------------------------ */

export type SalvageKind = 'panel' | 'pipe' | 'crate' | 'girder' | 'tank';

/** Small man-made debris. Torn, bent and dented — never a clean primitive. */
export function makeSalvage(seed: number, kind: SalvageKind): PropShape {
  const rng = mulberry32(seed);
  const noise = new Noise(seed ^ 0x4b19);
  let m: SoftMesh;

  if (kind === 'panel') {
    const w = 0.9 + rng() * 1.6;
    const h = 0.7 + rng() * 1.3;
    const bend = (rng() - 0.5) * 1.5;
    m = gridSurface(9, 7, (u, v, out) => {
      const x = (u - 0.5) * w;
      const z = (v - 0.5) * h;
      const y = bend * x * x * 0.5 + 0.08 * noise.fbm2(u * 5 + 3, v * 5);
      out.set(x, y, z);
    });
    // tear the edges along a noise field
    m = dropByNoise(m, noise, 0.84, 2.6);
    markBoundaryWear(m, 1, 2);
  } else if (kind === 'pipe') {
    const len = 1.4 + rng() * 2.6;
    const r = 0.09 + rng() * 0.13;
    m = gridSurface(10, 9, (u, v, out) => {
      const a = u * Math.PI * 2;
      const sag = Math.sin(v * Math.PI) * (rng() < 0.5 ? 0.1 : -0.1);
      const rr = r * (1 + 0.16 * noise.fbm2(v * 6, a));
      out.set(Math.cos(a) * rr, (v - 0.5) * len + sag, Math.sin(a) * rr);
    }, true);
    markBoundaryWear(m, 0.9, 1);
    transformSoft(m, _m4.makeRotationZ(Math.PI * 0.5 + (rng() - 0.5) * 0.4));
  } else if (kind === 'crate') {
    m = superBox(0.42 + rng() * 0.2, 0.34 + rng() * 0.16, 0.42 + rng() * 0.2, 9, 3);
    for (const v of m.verts) {
      v.multiplyScalar(1 + 0.06 * noise.fbm3(v.x * 4, v.y * 4, v.z * 4, 2));
    }
  } else if (kind === 'girder') {
    const len = 2.2 + rng() * 3.4;
    m = superBox(0.13, len * 0.5, 0.09, 12, 3);
    for (const v of m.verts) {
      const t = v.y / (len * 0.5);
      v.x += t * t * (rng() - 0.5) * 0.1;
      v.multiplyScalar(1 + 0.05 * noise.fbm3(v.x * 6, v.y * 2, v.z * 6, 2));
    }
    m = dropByNoise(m, noise, 0.9, 1.1);
    markBoundaryWear(m, 1, 2);
    transformSoft(m, _m4.makeRotationZ(1.4 + (rng() - 0.5) * 0.6));
  } else {
    const r = 0.28 + rng() * 0.16;
    const len = 1.1 + rng() * 0.8;
    m = gridSurface(12, 10, (u, v, out) => {
      const a = u * Math.PI * 2;
      const cap = Math.sin(Math.min(1, Math.max(0, v)) * Math.PI);
      const rr = r * (0.25 + 0.75 * Math.pow(cap, 0.45)) * (1 + 0.07 * noise.fbm2(a * 2, v * 4));
      out.set(Math.cos(a) * rr, (v - 0.5) * len, Math.sin(a) * rr);
    }, true);
    transformSoft(m, _m4.makeRotationX(1.2 + rng()));
  }

  const adj = adjacency(m);
  bakeCavityAO(m, adj, 1, 0.2);
  for (let i = 0; i < m.verts.length; i++) {
    m.surf[i].z = 0.55 + 0.45 * (noise.fbm3(m.verts[i].x * 2, m.verts[i].y * 2, m.verts[i].z * 2, 2) * 0.5 + 0.5);
  }
  const met = groundAndMeasure(m);
  return {
    id: `salvage_${kind}_${seed}`,
    lods: [toGeometry(m, { facet: kind === 'crate' ? 0.85 : 0.35 })],
    radius: met.radius, height: met.height,
    burial: met.height * (kind === 'panel' ? 0.35 : 0.22),
  };
}

/** Removes triangles whose centroid falls below a noise threshold — a tear. */
function dropByNoise(m: SoftMesh, noise: Noise, keepBias: number, freq: number): SoftMesh {
  const kept: number[] = [];
  const c = new THREE.Vector3();
  for (let i = 0; i < m.faces.length; i += 3) {
    c.copy(m.verts[m.faces[i]]).add(m.verts[m.faces[i + 1]]).add(m.verts[m.faces[i + 2]]).multiplyScalar(1 / 3);
    const n = noise.fbm3(c.x * freq, c.y * freq, c.z * freq, 3) * 0.5 + 0.5;
    if (n > 1 - keepBias) kept.push(m.faces[i], m.faces[i + 1], m.faces[i + 2]);
  }
  if (kept.length < 12) return m;      // never dissolve the whole piece
  const remap = new Int32Array(m.verts.length).fill(-1);
  const verts: THREE.Vector3[] = [];
  const surf: THREE.Vector4[] = [];
  const faces: number[] = [];
  for (const idx of kept) {
    if (remap[idx] < 0) {
      remap[idx] = verts.length;
      verts.push(m.verts[idx]);
      surf.push(m.surf[idx]);
    }
    faces.push(remap[idx]);
  }
  m.verts = verts;
  m.surf = surf;
  m.faces = faces;
  return m;
}

export { dropByNoise };

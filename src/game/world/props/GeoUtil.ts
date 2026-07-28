/**
 * Geometry construction helpers for procedural props.
 *
 * Everything here works on a lightweight editable `SoftMesh` (vertex list +
 * flat index triples + a per-vertex surface payload) rather than on
 * `BufferGeometry`, because the generators need cheap adjacency for smoothing,
 * erosion and ambient-occlusion baking. `toGeometry()` is the single place that
 * bakes a `SoftMesh` down to a GPU-ready, *non-indexed* `BufferGeometry`.
 *
 * Non-indexed is deliberate: it lets us blend each vertex normal toward its
 * face normal per-triangle (partial faceting for chipped rock plates and
 * stamped hull panels) and it keeps every prop geometry structurally identical
 * so they can all live inside one `THREE.BatchedMesh`.
 *
 * All generation happens once, during `init` — never per frame.
 */
import * as THREE from 'three';

export type Rng = () => number;

/**
 * Per-vertex prop surface payload, uploaded as `aPropSurf` (vec4):
 *   x = baked ambient occlusion (1 = open, 0 = fully occluded)
 *   y = wear / damage (drives paint chipping, rust seeding, edge erosion)
 *   z = encrustation (barnacles, coral, silt build-up)
 *   w = material class (integer-ish selector inside the shader colour ramps)
 */
export const SURF_ATTR = 'aPropSurf';

export interface SoftMesh {
  verts: THREE.Vector3[];
  /** Flat triangle index triples. */
  faces: number[];
  /** Parallel to `verts`. See {@link SURF_ATTR}. */
  surf: THREE.Vector4[];
}

const _e0 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _fn = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _nrm3 = new THREE.Matrix3();

export function emptySoft(): SoftMesh {
  return { verts: [], faces: [], surf: [] };
}

/** Append `src` into `dst`, optionally transformed. Vertex payloads are kept. */
export function appendSoft(dst: SoftMesh, src: SoftMesh, matrix?: THREE.Matrix4): SoftMesh {
  const base = dst.verts.length;
  for (let i = 0; i < src.verts.length; i++) {
    const v = src.verts[i].clone();
    if (matrix) v.applyMatrix4(matrix);
    dst.verts.push(v);
    dst.surf.push(src.surf[i].clone());
  }
  for (let i = 0; i < src.faces.length; i++) dst.faces.push(src.faces[i] + base);
  return dst;
}

export function transformSoft(m: SoftMesh, matrix: THREE.Matrix4): SoftMesh {
  for (const v of m.verts) v.applyMatrix4(matrix);
  return m;
}

/** Set the material-class channel (`aPropSurf.w`) on every vertex. */
export function setClass(m: SoftMesh, cls: number): SoftMesh {
  for (const s of m.surf) s.w = cls;
  return m;
}

/* ------------------------------------------------------------------ *
 * Primitive builders
 * ------------------------------------------------------------------ */

/**
 * Geodesic sphere. Unlike `THREE.IcosahedronGeometry` this returns indexed
 * topology (so we can smooth / erode it) and has no UV seam.
 * detail 0 → 20 tris, 1 → 80, 2 → 320, 3 → 1280, 4 → 5120.
 */
export function icosphere(detail: number): SoftMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const verts = raw.map((v) => new THREE.Vector3(v[0], v[1], v[2]).normalize());
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];

  for (let d = 0; d < detail; d++) {
    const mid = new Map<number, number>();
    const next: number[] = [];
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 1048576 + b : b * 1048576 + a;
      let m = mid.get(key);
      if (m === undefined) {
        m = verts.length;
        verts.push(verts[a].clone().add(verts[b]).normalize());
        mid.set(key, m);
      }
      return m;
    };
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i];
      const b = faces[i + 1];
      const c = faces[i + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  return { verts, faces, surf: verts.map(() => new THREE.Vector4(1, 0, 0, 0)) };
}

/**
 * Superquadric box built on an icosphere: `exponent` 2 is a sphere, 6–14 give
 * progressively harder bevels. Keeps clean topology (unlike a chamfered box)
 * so it still smooths and bakes AO. Used for crates, girders, hull plating and
 * the precursor slabs.
 */
export function superBox(
  hx: number, hy: number, hz: number, exponent = 8, detail = 3,
): SoftMesh {
  const m = icosphere(detail);
  const n = Math.max(2, exponent);
  for (const v of m.verts) {
    const ax = Math.abs(v.x);
    const ay = Math.abs(v.y);
    const az = Math.abs(v.z);
    const norm = Math.pow(Math.pow(ax, n) + Math.pow(ay, n) + Math.pow(az, n), 1 / n);
    const s = norm > 1e-6 ? 1 / norm : 1;
    v.set(v.x * s * hx, v.y * s * hy, v.z * s * hz);
  }
  return m;
}

/**
 * Parametric grid surface. `closeU` stitches the last column back to the first
 * (tubes, rings). Returns quads split into triangles.
 */
export function gridSurface(
  uSeg: number, vSeg: number,
  fn: (u: number, v: number, out: THREE.Vector3) => void,
  closeU = false,
): SoftMesh {
  const uCount = closeU ? uSeg : uSeg + 1;
  const verts: THREE.Vector3[] = [];
  for (let j = 0; j <= vSeg; j++) {
    for (let i = 0; i < uCount; i++) {
      const v = new THREE.Vector3();
      fn(i / uSeg, j / vSeg, v);
      verts.push(v);
    }
  }
  const faces: number[] = [];
  for (let j = 0; j < vSeg; j++) {
    for (let i = 0; i < uSeg; i++) {
      if (!closeU && i >= uSeg) continue;
      const i1 = closeU ? (i + 1) % uCount : i + 1;
      const a = j * uCount + i;
      const b = j * uCount + i1;
      const c = (j + 1) * uCount + i1;
      const d = (j + 1) * uCount + i;
      faces.push(a, c, b, a, d, c);
    }
  }
  return { verts, faces, surf: verts.map(() => new THREE.Vector4(1, 0, 0, 0)) };
}

/** A tube swept along +Y with a per-slice radius/centre offset callback. */
export function tube(
  radial: number, slices: number, length: number,
  shape: (t: number, out: { r: number; ox: number; oz: number; ell: number }) => void,
): SoftMesh {
  const s = { r: 1, ox: 0, oz: 0, ell: 1 };
  return gridSurface(radial, slices, (u, v, out) => {
    shape(v, s);
    const a = u * Math.PI * 2;
    out.set(Math.cos(a) * s.r + s.ox, (v - 0.5) * length, Math.sin(a) * s.r * s.ell + s.oz);
  }, true);
}

/* ------------------------------------------------------------------ *
 * Topology operations
 * ------------------------------------------------------------------ */

/** Vertex → neighbouring vertex indices. */
export function adjacency(m: SoftMesh): number[][] {
  const adj: number[][] = m.verts.map(() => []);
  const push = (a: number, b: number) => {
    if (adj[a].indexOf(b) < 0) adj[a].push(b);
  };
  for (let i = 0; i < m.faces.length; i += 3) {
    const a = m.faces[i];
    const b = m.faces[i + 1];
    const c = m.faces[i + 2];
    push(a, b); push(a, c);
    push(b, a); push(b, c);
    push(c, a); push(c, b);
  }
  return adj;
}

/** Area-weighted smooth vertex normals. */
export function vertexNormals(m: SoftMesh): THREE.Vector3[] {
  const out = m.verts.map(() => new THREE.Vector3());
  for (let i = 0; i < m.faces.length; i += 3) {
    const a = m.faces[i];
    const b = m.faces[i + 1];
    const c = m.faces[i + 2];
    _e0.subVectors(m.verts[b], m.verts[a]);
    _e1.subVectors(m.verts[c], m.verts[a]);
    _fn.crossVectors(_e0, _e1); // length ∝ 2×area, so this is area-weighted
    out[a].add(_fn);
    out[b].add(_fn);
    out[c].add(_fn);
  }
  for (const n of out) {
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
    else n.normalize();
  }
  return out;
}

/**
 * Laplacian relaxation. `weight(i)` scales the effect per vertex, which is how
 * erosion is applied: strong on downward/buried faces, weak on exposed crests
 * so ridges stay crisp.
 */
export function laplacian(
  m: SoftMesh, adj: number[][], iterations: number, factor: number,
  weight?: (i: number) => number,
): SoftMesh {
  const next = m.verts.map((v) => v.clone());
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < m.verts.length; i++) {
      const nb = adj[i];
      if (nb.length === 0) continue;
      _tmp.set(0, 0, 0);
      for (const j of nb) _tmp.add(m.verts[j]);
      _tmp.multiplyScalar(1 / nb.length);
      const w = factor * (weight ? weight(i) : 1);
      next[i].copy(m.verts[i]).lerp(_tmp, Math.min(1, Math.max(0, w)));
    }
    for (let i = 0; i < m.verts.length; i++) m.verts[i].copy(next[i]);
  }
  return m;
}

/**
 * Bakes a curvature/cavity ambient-occlusion term into `surf.x`. Uses the
 * signed offset of each vertex from its 1-ring and 2-ring centroid along the
 * vertex normal, so creases, crack floors and the insides of concavities go
 * dark at two different scales. `floor` clamps how black it may get.
 */
export function bakeCavityAO(m: SoftMesh, adj: number[][], strength = 1, floor = 0.22): SoftMesh {
  const nrm = vertexNormals(m);
  const ring1 = new Float32Array(m.verts.length);
  const ring2 = new Float32Array(m.verts.length);
  const scale = boundingRadius(m) || 1;

  for (let i = 0; i < m.verts.length; i++) {
    const nb = adj[i];
    if (nb.length === 0) continue;
    _tmp.set(0, 0, 0);
    for (const j of nb) _tmp.add(m.verts[j]);
    _tmp.multiplyScalar(1 / nb.length).sub(m.verts[i]);
    ring1[i] = _tmp.dot(nrm[i]) / scale;
  }
  for (let i = 0; i < m.verts.length; i++) {
    const nb = adj[i];
    if (nb.length === 0) continue;
    let acc = ring1[i];
    let n = 1;
    for (const j of nb) {
      acc += ring1[j];
      n++;
      for (const k of adj[j]) {
        acc += ring1[k] * 0.4;
        n += 0.4;
      }
    }
    ring2[i] = acc / n;
  }
  for (let i = 0; i < m.verts.length; i++) {
    // Positive offset toward the normal = concave = occluded.
    const cav = ring1[i] * 6 + ring2[i] * 18;
    const ao = 1 - Math.max(0, cav) * 4 * strength;
    m.surf[i].x = Math.min(1, Math.max(floor, ao));
  }
  return m;
}

/**
 * Removes triangles for which `keep()` is false, then drops orphan vertices.
 * This is what produces torn hull plating and eroded, chipped rock edges: the
 * resulting boundary follows a noise field rather than a clean cut.
 */
export function dropFaces(
  m: SoftMesh, keep: (centroid: THREE.Vector3, faceIndex: number) => boolean,
): SoftMesh {
  const kept: number[] = [];
  const c = new THREE.Vector3();
  for (let i = 0, f = 0; i < m.faces.length; i += 3, f++) {
    c.copy(m.verts[m.faces[i]]).add(m.verts[m.faces[i + 1]]).add(m.verts[m.faces[i + 2]]).multiplyScalar(1 / 3);
    if (keep(c, f)) kept.push(m.faces[i], m.faces[i + 1], m.faces[i + 2]);
  }
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

/**
 * Marks vertices that sit on an open boundary edge (an edge used by exactly one
 * triangle) by writing into `surf.y` — the wear channel. Torn metal rims and
 * freshly chipped rock get their damage shading from this.
 */
export function markBoundaryWear(m: SoftMesh, amount = 1, spread = 1): SoftMesh {
  const count = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * 1048576 + b : b * 1048576 + a);
  for (let i = 0; i < m.faces.length; i += 3) {
    const t = [m.faces[i], m.faces[i + 1], m.faces[i + 2]];
    for (let e = 0; e < 3; e++) {
      const k = key(t[e], t[(e + 1) % 3]);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const wear = new Float32Array(m.verts.length);
  for (const [k, n] of count) {
    if (n !== 1) continue;
    const a = Math.floor(k / 1048576);
    const b = k % 1048576;
    wear[a] = amount;
    wear[b] = amount;
  }
  const adj = adjacency(m);
  for (let s = 0; s < spread; s++) {
    const next = wear.slice();
    for (let i = 0; i < wear.length; i++) {
      for (const j of adj[i]) next[i] = Math.max(next[i], wear[j] * 0.6);
    }
    wear.set(next);
  }
  for (let i = 0; i < m.verts.length; i++) m.surf[i].y = Math.max(m.surf[i].y, wear[i]);
  return m;
}

export function boundingRadius(m: SoftMesh): number {
  let r = 0;
  for (const v of m.verts) r = Math.max(r, v.length());
  return r;
}

export function boundsOf(m: SoftMesh, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  for (const v of m.verts) out.expandByPoint(v);
  return out;
}

/* ------------------------------------------------------------------ *
 * Baking
 * ------------------------------------------------------------------ */

export interface BakeOptions {
  /**
   * 0 = fully smooth vertex normals, 1 = flat-shaded facets. Rocks use a
   * per-face callback so large fracture plates read flat while the eroded
   * micro-relief stays smooth.
   */
  facet?: number | ((faceIndex: number, faceNormal: THREE.Vector3) => number);
  /** Flip winding + normals (used for interior shells). */
  flip?: boolean;
}

/**
 * Bakes to a non-indexed `BufferGeometry` carrying `position`, `normal` and
 * `aPropSurf`. No UVs: every prop material is triplanar/procedural, which is
 * also what lets one geometry be reused at any scale without stretching.
 */
export function toGeometry(m: SoftMesh, opts: BakeOptions = {}): THREE.BufferGeometry {
  const smooth = vertexNormals(m);
  const triCount = m.faces.length / 3;
  const pos = new Float32Array(triCount * 9);
  const nrm = new Float32Array(triCount * 9);
  const srf = new Float32Array(triCount * 12);
  const facetOpt = opts.facet ?? 0;
  const flip = opts.flip === true;
  const fnorm = new THREE.Vector3();
  const out = new THREE.Vector3();

  for (let f = 0; f < triCount; f++) {
    const i0 = m.faces[f * 3];
    const i1 = m.faces[f * 3 + (flip ? 2 : 1)];
    const i2 = m.faces[f * 3 + (flip ? 1 : 2)];
    const a = m.verts[i0];
    const b = m.verts[i1];
    const c = m.verts[i2];
    _e0.subVectors(b, a);
    _e1.subVectors(c, a);
    fnorm.crossVectors(_e0, _e1);
    if (fnorm.lengthSq() < 1e-14) fnorm.set(0, 1, 0);
    else fnorm.normalize();
    const facet = typeof facetOpt === 'number' ? facetOpt : facetOpt(f, fnorm);
    const tri = [i0, i1, i2];
    for (let k = 0; k < 3; k++) {
      const vi = tri[k];
      const v = m.verts[vi];
      const o = f * 9 + k * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      out.copy(smooth[vi]);
      if (flip) out.negate();
      out.lerp(fnorm, facet);
      if (out.lengthSq() < 1e-12) out.copy(fnorm);
      else out.normalize();
      nrm[o] = out.x; nrm[o + 1] = out.y; nrm[o + 2] = out.z;
      const s = m.surf[vi];
      const so = f * 12 + k * 4;
      srf[so] = s.x; srf[so + 1] = s.y; srf[so + 2] = s.z; srf[so + 3] = s.w;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute(SURF_ATTR, new THREE.BufferAttribute(srf, 4));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** Concatenates baked geometries that share the props attribute layout. */
export function mergeBaked(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0;
  for (const g of list) verts += g.getAttribute('position').count;
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const srf = new Float32Array(verts * 4);
  let o = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const s = g.getAttribute(SURF_ATTR);
    pos.set(p.array as Float32Array, o * 3);
    nrm.set(n.array as Float32Array, o * 3);
    srf.set(s.array as Float32Array, o * 4);
    o += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute(SURF_ATTR, new THREE.BufferAttribute(srf, 4));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** Applies a matrix to a baked geometry in place (position + normal). */
export function transformBaked(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  geo.applyMatrix4(matrix);
  _nrm3.getNormalMatrix(matrix);
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i).applyMatrix3(_nrm3).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
  return geo;
}

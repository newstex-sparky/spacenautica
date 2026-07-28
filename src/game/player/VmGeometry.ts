/**
 * Procedural geometry toolkit for the view model.
 *
 * Nothing here loads a mesh — everything is primitives that are then tapered,
 * bent, eroded and greebled so no silhouette is a clean lathe of revolution.
 * Every part carries a baked `vmMask` attribute:
 *
 *   x = ambient occlusion amount (0 = open, 1 = fully buried)
 *   y = edge/convexity exposure  (drives paint chipping and scuffs)
 *   z = per-part random          (breaks up albedo between neighbouring parts)
 *
 * `PartBuilder` accumulates transformed parts and merges them into a single
 * draw call, which keeps the whole first-person rig at a handful of draws.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Noise, mulberry32 } from '../core/Noise';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Shared noise for surface erosion; deterministic so the rig is reproducible. */
export const vmNoise = new Noise(90210);

export interface PartOptions {
  /** Base occlusion for the whole part, 0..1. Crevices should raise this. */
  occ?: number;
  /** Multiplier on the automatic convexity/edge term. */
  edge?: number;
  /** 0..1 per-part albedo jitter. Defaults to a hash of the part index. */
  id?: number;
  /** Extra occlusion applied to downward-facing surfaces. */
  downOcc?: number;
}

export interface TransformSpec {
  pos?: [number, number, number];
  /** Euler XYZ in radians. */
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
}

/** Applies a transform in place. */
export function transform(geo: THREE.BufferGeometry, t: TransformSpec): THREE.BufferGeometry {
  const s = t.scale;
  _m.identity();
  _q.setFromEuler(_e.set(t.rot?.[0] ?? 0, t.rot?.[1] ?? 0, t.rot?.[2] ?? 0));
  _m.compose(
    _v.set(t.pos?.[0] ?? 0, t.pos?.[1] ?? 0, t.pos?.[2] ?? 0),
    _q,
    _n.set(
      typeof s === 'number' ? s : (s?.[0] ?? 1),
      typeof s === 'number' ? s : (s?.[1] ?? 1),
      typeof s === 'number' ? s : (s?.[2] ?? 1),
    ),
  );
  geo.applyMatrix4(_m);
  return geo;
}

/**
 * Scales X/Z as a function of Y, normalised over the geometry's own bounds.
 * This is what turns a cylinder into a forearm or a blade.
 */
export function taper(
  geo: THREE.BufferGeometry,
  fn: (t: number) => number | [number, number],
): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const y0 = bb.min.y;
  const span = Math.max(1e-6, bb.max.y - y0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / span;
    const r = fn(t);
    const rx = Array.isArray(r) ? r[0] : r;
    const rz = Array.isArray(r) ? r[1] : r;
    pos.setX(i, pos.getX(i) * rx);
    pos.setZ(i, pos.getZ(i) * rz);
  }
  pos.needsUpdate = true;
  return geo;
}

/**
 * Sags the geometry in Y by a quadratic in Z — the cheap way to curve a finger
 * segment, a knife spine or a cable so it is not dead straight.
 */
export function sagZ(geo: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setY(i, pos.getY(i) + k * z * z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Displaces vertices along their normals with fbm noise, then recomputes
 * normals. Small amounts (0.2–0.6 mm) are enough to kill the "perfect
 * primitive" read while keeping the silhouette legible.
 */
export function erode(
  geo: THREE.BufferGeometry,
  amount: number,
  freq: number,
  seed = 0,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  if (!nrm) geo.computeVertexNormals();
  const n2 = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d =
      vmNoise.fbm3((x + seed) * freq, (y - seed * 0.7) * freq, (z + seed * 1.3) * freq, 3) * amount;
    pos.setXYZ(i, x + n2.getX(i) * d, y + n2.getY(i) * d, z + n2.getZ(i) * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Rounds a box by pushing its vertices onto a superellipsoid. */
export function roundBox(
  geo: THREE.BufferGeometry,
  half: [number, number, number],
  power = 4,
  strength = 1,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i) / half[0];
    const ny = pos.getY(i) / half[1];
    const nz = pos.getZ(i) / half[2];
    const d = Math.pow(
      Math.pow(Math.abs(nx), power) + Math.pow(Math.abs(ny), power) + Math.pow(Math.abs(nz), power),
      1 / power,
    );
    const k = d > 1e-5 ? 1 / d : 1;
    const f = 1 + (k - 1) * strength;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Mirrors a non-indexed geometry across X, flipping normals and triangle
 * winding so the left hand is a true mirror of the right rather than an
 * inside-out copy.
 */
export function mirrorX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    if (nrm) nrm.setX(i, -nrm.getX(i));
  }
  // Swap the 2nd and 3rd vertex of every triangle to restore the winding.
  const swap = (attr: THREE.BufferAttribute, comps: number) => {
    const a = attr.array as Float32Array;
    for (let t = 0; t < attr.count; t += 3) {
      for (let c = 0; c < comps; c++) {
        const i1 = (t + 1) * comps + c;
        const i2 = (t + 2) * comps + c;
        const tmp = a[i1];
        a[i1] = a[i2];
        a[i2] = tmp;
      }
    }
    attr.needsUpdate = true;
  };
  swap(pos, 3);
  if (nrm) swap(nrm, 3);
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) swap(uv, 2);
  return geo;
}

/** Convenience primitives, all non-indexed so they merge cleanly. */
export const prim = {
  capsule(r: number, h: number, cap = 5, radial = 12): THREE.BufferGeometry {
    return new THREE.CapsuleGeometry(r, h, cap, radial).toNonIndexed();
  },
  box(w: number, h: number, d: number, seg = 2): THREE.BufferGeometry {
    return new THREE.BoxGeometry(w, h, d, seg, seg, seg).toNonIndexed();
  },
  cyl(rt: number, rb: number, h: number, radial = 14, heightSeg = 2, open = false): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(rt, rb, h, radial, heightSeg, open).toNonIndexed();
  },
  sphere(r: number, w = 14, h = 10): THREE.BufferGeometry {
    return new THREE.SphereGeometry(r, w, h).toNonIndexed();
  },
  torus(r: number, tube: number, radial = 10, tubular = 20, arc = Math.PI * 2): THREE.BufferGeometry {
    return new THREE.TorusGeometry(r, tube, radial, tubular, arc).toNonIndexed();
  },
  cone(r: number, h: number, radial = 14): THREE.BufferGeometry {
    return new THREE.ConeGeometry(r, h, radial, 2).toNonIndexed();
  },
  /** A swept tube through points — cables, hoses, hydraulic lines. */
  tube(points: Array<[number, number, number]>, radius: number, seg = 24, radial = 7): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    return new THREE.TubeGeometry(curve, seg, radius, radial, false).toNonIndexed();
  },
  /** A lathed profile — bottles, reflectors, machined bosses. */
  lathe(profile: Array<[number, number]>, seg = 18): THREE.BufferGeometry {
    return new THREE.LatheGeometry(
      profile.map((p) => new THREE.Vector2(p[0], p[1])),
      seg,
    ).toNonIndexed();
  },
};

/**
 * Accumulates parts, bakes `vmMask`, merges into one geometry.
 */
export class PartBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private index = 0;

  constructor(private rand: () => number = mulberry32(1234)) {}

  /** Adds an already-positioned geometry. Takes ownership. */
  add(geo: THREE.BufferGeometry, opts: PartOptions = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      // Cheap planar UVs so any material that wants them has something sane.
      const pos = g.attributes.position as THREE.BufferAttribute;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = pos.getX(i) * 6 + 0.5;
        uv[i * 2 + 1] = pos.getY(i) * 6 + 0.5;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    this.bakeMask(g, opts);
    this.parts.push(g);
    this.index++;
    return this;
  }

  private bakeMask(g: THREE.BufferGeometry, opts: PartOptions): void {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    g.computeBoundingSphere();
    _c.copy(g.boundingSphere!.center);
    const base = opts.occ ?? 0.12;
    const edgeK = opts.edge ?? 1;
    const downOcc = opts.downOcc ?? 0.32;
    const id = opts.id ?? this.rand();
    const mask = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(_c);
      _n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      const outward = _v.lengthSq() > 1e-8 ? _n.dot(_v.normalize()) : 1;
      // Convex, outward-facing vertices catch the light and the wear.
      const edge = THREE.MathUtils.clamp(Math.pow(Math.max(0, outward), 1.5) * 0.92 + 0.08, 0, 1) * edgeK;
      // Downward and inward facing surfaces sit in shadow.
      const occ = THREE.MathUtils.clamp(base + downOcc * (0.5 - 0.5 * _n.y) - edge * 0.22, 0, 1);
      mask[i * 3] = occ;
      mask[i * 3 + 1] = edge;
      mask[i * 3 + 2] = id;
    }
    g.setAttribute('vmMask', new THREE.BufferAttribute(mask, 3));
  }

  /** Merges everything added so far. The builder is left empty. */
  build(name = 'vm.part'): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry();
    const merged = this.parts.length === 1 ? this.parts[0] : mergeGeometries(this.parts, false);
    if (this.parts.length > 1) for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    const out = merged ?? new THREE.BufferGeometry();
    out.name = name;
    out.computeBoundingSphere();
    return out;
  }

  get count(): number {
    return this.index;
  }
}

/**
 * Scatters small boxes/cylinders over a surface region — screws, vents, rivets,
 * cable clamps. Mid-scale detail is what separates a modelled tool from a
 * primitive, and doing it procedurally means no two builds are identical.
 */
export function greeble(
  b: PartBuilder,
  seed: number,
  count: number,
  region: { x: [number, number]; y: [number, number]; z: [number, number] },
  size: [number, number],
  kind: 'screw' | 'vent' | 'rivet' | 'clamp' = 'screw',
): void {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = THREE.MathUtils.lerp(region.x[0], region.x[1], rnd());
    const y = THREE.MathUtils.lerp(region.y[0], region.y[1], rnd());
    const z = THREE.MathUtils.lerp(region.z[0], region.z[1], rnd());
    const s = THREE.MathUtils.lerp(size[0], size[1], rnd());
    let g: THREE.BufferGeometry;
    if (kind === 'screw') {
      g = prim.cyl(s, s * 0.92, s * 0.5, 8, 1);
      transform(g, { pos: [x, y, z], rot: [Math.PI / 2, rnd() * 3, 0] });
    } else if (kind === 'vent') {
      g = prim.box(s * 4.5, s * 0.7, s * 0.9, 1);
      transform(g, { pos: [x, y, z], rot: [0, 0, (rnd() - 0.5) * 0.05] });
    } else if (kind === 'rivet') {
      g = prim.sphere(s, 7, 5);
      transform(g, { pos: [x, y, z], scale: [1, 0.55, 1] });
    } else {
      g = prim.torus(s * 1.6, s * 0.45, 6, 10);
      transform(g, { pos: [x, y, z], rot: [0, Math.PI / 2, 0] });
    }
    b.add(g, { occ: kind === 'vent' ? 0.55 : 0.18, edge: kind === 'vent' ? 0.5 : 1.25, id: rnd() });
  }
}

/**
 * Geometry construction kit for procedural marine flora.
 *
 * Every species is assembled from these primitives at boot; nothing is loaded.
 * Alongside position/normal/uv, each vertex carries two custom attributes that
 * the flora shader needs:
 *
 *   `aBend`  = (t, blade, phase, ao)
 *      t     — normalised distance from the holdfast to this vertex, 0..1. Drives
 *              compliance: the base barely moves, the tip moves a lot.
 *      blade — 0 on woody/rigid tissue, 1 on a thin lamina. Gates the secondary
 *              flutter and the alpha erosion.
 *      phase — extra phase along the plant so the sway travels rather than
 *              pivoting; also decorrelates individual blades.
 *      ao    — baked ambient occlusion, dark toward the holdfast and inside caps.
 *
 *   `aFlora` = (emit, thickness, twist)
 *      emit      — bioluminescent mask, 0..1.
 *      thickness — inverse optical thickness, 1 = paper-thin (max back-scatter).
 *      twist     — how strongly this vertex responds to per-instance twist.
 */
import * as THREE from 'three';

export interface VAttr {
  t?: number;
  blade?: number;
  phase?: number;
  ao?: number;
  emit?: number;
  thick?: number;
  twist?: number;
}

const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
const V_C = new THREE.Vector3();
const V_D = new THREE.Vector3();
const V_E = new THREE.Vector3();

export class FloraMeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uvs: number[] = [];
  readonly bend: number[] = [];
  readonly extra: number[] = [];
  readonly idx: number[] = [];
  count = 0;

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, a: VAttr): number {
    this.pos.push(p.x, p.y, p.z);
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    this.nrm.push(n.x / l, n.y / l, n.z / l);
    this.uvs.push(u, v);
    this.bend.push(a.t ?? 0, a.blade ?? 0, a.phase ?? 0, a.ao ?? 1);
    this.extra.push(a.emit ?? 0, a.thick ?? 0.35, a.twist ?? 1);
    return this.count++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Quad wound a-b-c-d. */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aBend', new THREE.Float32BufferAttribute(this.bend, 4));
    g.setAttribute('aFlora', new THREE.Float32BufferAttribute(this.extra, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/* ------------------------------------------------------------------ *
 * Paths and parallel-transport frames
 * ------------------------------------------------------------------ */

export interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  b: THREE.Vector3;
}

function anyPerp(t: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  if (Math.abs(t.y) < 0.9) out.set(0, 1, 0);
  else out.set(1, 0, 0);
  out.sub(V_E.copy(t).multiplyScalar(out.dot(t)));
  return out.normalize();
}

/**
 * Walks a curve, carrying a rotation-minimising frame so a ribbon or tube built
 * on it does not corkscrew. `bend` nudges the tangent each step (that is where
 * curl, gravity droop and noise go); `segLen` gives the step length.
 */
export function buildPath(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  segs: number,
  segLen: (i: number, u: number) => number,
  bend: (i: number, u: number, out: THREE.Vector3) => void,
): Frame[] {
  const frames: Frame[] = [];
  const p = origin.clone();
  const t = dir.clone().normalize();
  const n = anyPerp(t, new THREE.Vector3());
  const axis = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const next = new THREE.Vector3();

  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    frames.push({
      p: p.clone(),
      t: t.clone(),
      n: n.clone(),
      b: new THREE.Vector3().crossVectors(t, n).normalize(),
    });
    if (i === segs) break;
    delta.set(0, 0, 0);
    bend(i, u, delta);
    next.copy(t).add(delta).normalize();
    axis.crossVectors(t, next);
    const s = axis.length();
    if (s > 1e-7) {
      axis.divideScalar(s);
      n.applyAxisAngle(axis, Math.asin(Math.min(1, s))).normalize();
    }
    p.addScaledVector(next, segLen(i, u));
    t.copy(next);
  }
  return frames;
}

/** Total arc length of a frame chain. */
export function pathLength(frames: Frame[]): number {
  let l = 0;
  for (let i = 1; i < frames.length; i++) l += frames[i].p.distanceTo(frames[i - 1].p);
  return l;
}

/* ------------------------------------------------------------------ *
 * Ribbons — kelp laminae, seagrass, algal fronds
 * ------------------------------------------------------------------ */

export interface RibbonOpts {
  /** Half-width in metres at parameter u along the ribbon. */
  width: (u: number) => number;
  /** Rotation of the width axis about the tangent, radians. */
  twist?: (u: number) => number;
  /** Cross-sectional cupping, metres at the centre line. */
  cup?: (u: number) => number;
  /** Lateral subdivisions; 2 gives a cupped 3-column blade. */
  cross?: number;
  ao?: (u: number) => number;
  emit?: (u: number) => number;
  /** Maps u -> the plant-space compliance parameter t. */
  tOf: (u: number) => number;
  phase?: number;
  /** Extra phase carried along the ribbon so the wave travels. */
  phaseSpan?: number;
  blade?: number;
  thick?: number;
  twistWeight?: number;
  vRepeat?: number;
  uSpan?: [number, number];
}

export function ribbon(mb: FloraMeshBuilder, frames: Frame[], o: RibbonOpts): void {
  const cross = Math.max(1, o.cross ?? 2);
  const rows = frames.length;
  const start = mb.count;
  const wide = V_A;
  const face = V_B;
  const p = V_C;
  const nn = V_D;
  const [u0, u1] = o.uSpan ?? [0, 1];
  const vRep = o.vRepeat ?? 1;

  for (let i = 0; i < rows; i++) {
    const u = i / (rows - 1);
    const f = frames[i];
    const ang = o.twist ? o.twist(u) : 0;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    wide.copy(f.b).multiplyScalar(ca).addScaledVector(f.n, sa);
    face.copy(f.n).multiplyScalar(ca).addScaledVector(f.b, -sa);
    const hw = o.width(u);
    const cupA = o.cup ? o.cup(u) : 0;
    const ao = o.ao ? o.ao(u) : 1;
    const emit = o.emit ? o.emit(u) : 0;
    const t = o.tOf(u);

    for (let j = 0; j <= cross; j++) {
      const w = (j / cross) * 2 - 1;
      const lat = w * hw;
      const cup = cupA * (1 - w * w);
      p.copy(f.p).addScaledVector(wide, lat).addScaledVector(face, cup);
      // Analytic normal: the face normal tilted by the cup slope.
      nn.copy(face).addScaledVector(wide, cupA * 2 * w * 0.9);
      mb.vert(p, nn, u0 + (u1 - u0) * (j / cross), u * vRep, {
        t,
        blade: o.blade ?? 1,
        phase: (o.phase ?? 0) + (o.phaseSpan ?? 0) * u,
        ao,
        emit,
        thick: o.thick ?? 0.95,
        twist: o.twistWeight ?? 1,
      });
    }
  }

  const stride = cross + 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cross; j++) {
      const a = start + i * stride + j;
      mb.quad(a, a + 1, a + stride + 1, a + stride);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Tubes — stipes, branches, stalks
 * ------------------------------------------------------------------ */

export interface TubeOpts {
  radius: (u: number) => number;
  radial: number;
  /** Radial wobble, fraction of radius. */
  wobble?: (u: number, ang: number) => number;
  ao?: (u: number) => number;
  emit?: (u: number, ang: number) => number;
  tOf: (u: number) => number;
  phase?: number;
  phaseSpan?: number;
  blade?: number;
  thick?: number;
  twistWeight?: number;
  vRepeat?: number;
  uRepeat?: number;
  capTop?: boolean;
}

export function tube(mb: FloraMeshBuilder, frames: Frame[], o: TubeOpts): void {
  const rad = Math.max(3, o.radial);
  const rows = frames.length;
  const start = mb.count;
  const dir = V_A;
  const p = V_B;
  const vRep = o.vRepeat ?? 1;
  const uRep = o.uRepeat ?? 1;

  for (let i = 0; i < rows; i++) {
    const u = i / (rows - 1);
    const f = frames[i];
    const r = o.radius(u);
    const ao = o.ao ? o.ao(u) : 1;
    const t = o.tOf(u);
    // Duplicate the seam column so u wraps 0..1 without a mirrored texture.
    for (let j = 0; j <= rad; j++) {
      const ang = (j / rad) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      dir.copy(f.n).multiplyScalar(c).addScaledVector(f.b, s);
      const wob = o.wobble ? o.wobble(u, ang) : 0;
      p.copy(f.p).addScaledVector(dir, r * (1 + wob));
      mb.vert(p, dir, (j / rad) * uRep, u * vRep, {
        t,
        blade: o.blade ?? 0,
        phase: (o.phase ?? 0) + (o.phaseSpan ?? 0) * u,
        ao,
        emit: o.emit ? o.emit(u, ang) : 0,
        thick: o.thick ?? 0.15,
        twist: o.twistWeight ?? 1,
      });
    }
  }

  const stride = rad + 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < rad; j++) {
      const a = start + i * stride + j;
      mb.quad(a, a + stride, a + stride + 1, a + 1);
    }
  }

  if (o.capTop) {
    const f = frames[rows - 1];
    const tip = mb.vert(f.p, f.t, 0.5, vRep, {
      t: o.tOf(1),
      blade: o.blade ?? 0,
      phase: (o.phase ?? 0) + (o.phaseSpan ?? 0),
      ao: o.ao ? o.ao(1) : 1,
      emit: o.emit ? o.emit(1, 0) : 0,
      thick: o.thick ?? 0.15,
      twist: o.twistWeight ?? 1,
    });
    const ring = start + (rows - 1) * stride;
    for (let j = 0; j < rad; j++) mb.tri(ring + j, tip, ring + j + 1);
  }
}

/* ------------------------------------------------------------------ *
 * Surfaces of revolution — barrel sponges, mushroom caps, tube-coral rims
 * ------------------------------------------------------------------ */

export interface LatheOpts {
  /** Profile from base to top: r(v), y(v). */
  profile: (v: number) => { r: number; y: number };
  rows: number;
  radial: number;
  /** Non-circular deformation of the radius, fraction. */
  wobble?: (v: number, ang: number) => number;
  /** Vertical deformation, metres — makes mushroom caps wavy. */
  rise?: (v: number, ang: number) => number;
  ao?: (v: number) => number;
  emit?: (v: number, ang: number) => number;
  tOf: (v: number) => number;
  inward?: boolean;
  blade?: number;
  thick?: number;
  phase?: number;
  vRepeat?: number;
  uRepeat?: number;
  twistWeight?: number;
}

export function lathe(mb: FloraMeshBuilder, o: LatheOpts): void {
  const rows = Math.max(2, o.rows);
  const rad = Math.max(3, o.radial);
  const start = mb.count;
  const p = V_A;
  const nn = V_B;
  const dir = V_C;
  const uRep = o.uRepeat ?? 1;
  const vRep = o.vRepeat ?? 1;

  for (let i = 0; i < rows; i++) {
    const v = i / (rows - 1);
    const pr = o.profile(v);
    const prPrev = o.profile(Math.max(0, v - 0.02));
    const prNext = o.profile(Math.min(1, v + 0.02));
    const dr = prNext.r - prPrev.r;
    const dy = prNext.y - prPrev.y;
    const ao = o.ao ? o.ao(v) : 1;
    const t = o.tOf(v);
    for (let j = 0; j <= rad; j++) {
      const ang = (j / rad) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const wob = o.wobble ? o.wobble(v, ang) : 0;
      const r = pr.r * (1 + wob);
      const y = pr.y + (o.rise ? o.rise(v, ang) : 0);
      dir.set(c, 0, s);
      p.copy(dir).multiplyScalar(r);
      p.y = y;
      // Normal from the profile slope: perpendicular to (dr, dy) in the r-y plane.
      nn.set(c * dy, -dr, s * dy);
      if (o.inward) nn.negate();
      if (nn.lengthSq() < 1e-10) nn.set(c, 0, s);
      mb.vert(p, nn, (j / rad) * uRep, v * vRep, {
        t,
        blade: o.blade ?? 0,
        phase: o.phase ?? 0,
        ao,
        emit: o.emit ? o.emit(v, ang) : 0,
        thick: o.thick ?? 0.2,
        twist: o.twistWeight ?? 1,
      });
    }
  }

  const stride = rad + 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < rad; j++) {
      const a = start + i * stride + j;
      if (o.inward) mb.quad(a, a + 1, a + stride + 1, a + stride);
      else mb.quad(a, a + stride, a + stride + 1, a + 1);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Deformed icosphere — brain coral heads, gas bladders, glowing bulbs
 * ------------------------------------------------------------------ */

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: number[][] = [
  [-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0],
  [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T],
  [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1],
];
const ICO_FACES: number[][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** Unit-sphere triangle soup at the requested subdivision level. */
export function icoTriangles(subdiv: number): THREE.Vector3[][] {
  let tris: THREE.Vector3[][] = ICO_FACES.map((f) =>
    f.map((i) => new THREE.Vector3(ICO_VERTS[i][0], ICO_VERTS[i][1], ICO_VERTS[i][2]).normalize()),
  );
  for (let s = 0; s < subdiv; s++) {
    const next: THREE.Vector3[][] = [];
    for (const [a, b, c] of tris) {
      const ab = a.clone().add(b).normalize();
      const bc = b.clone().add(c).normalize();
      const ca = c.clone().add(a).normalize();
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }
  return tris;
}

export interface BlobOpts {
  /** Radius along a unit direction — this is where erosion and grooves live. */
  radius: (dir: THREE.Vector3) => number;
  center: THREE.Vector3;
  /** Non-uniform axis scaling applied after `radius`. */
  scale?: THREE.Vector3;
  subdiv: number;
  uvScale: number;
  ao?: (dir: THREE.Vector3, p: THREE.Vector3) => number;
  emit?: (dir: THREE.Vector3, p: THREE.Vector3) => number;
  tOf: (p: THREE.Vector3) => number;
  blade?: number;
  thick?: number;
  phase?: number;
  twistWeight?: number;
}

/**
 * Emits a deformed sphere as *non-indexed* triangles with a per-face planar UV
 * projection. Choosing the projection plane per triangle keeps the UV field
 * continuous inside each triangle, so three's derivative-based tangent frame
 * stays valid — a per-vertex choice would produce garbage tangents on the
 * triangles that straddle a plane boundary.
 */
export function blob(mb: FloraMeshBuilder, o: BlobOpts): void {
  const tris = icoTriangles(o.subdiv);
  const scale = o.scale ?? V_E.set(1, 1, 1);
  const pts: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nrm: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const fn = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

  for (const tri of tris) {
    for (let k = 0; k < 3; k++) {
      const d = tri[k];
      const r = o.radius(d);
      pts[k].set(d.x * r * scale.x, d.y * r * scale.y, d.z * r * scale.z).add(o.center);
      // Analytic normal is unavailable after arbitrary radial deformation; the
      // face normal plus a nudge toward the radial direction reads correctly.
      nrm[k].set(d.x / scale.x, d.y / scale.y, d.z / scale.z).normalize();
    }
    e1.subVectors(pts[1], pts[0]);
    e2.subVectors(pts[2], pts[0]);
    fn.crossVectors(e1, e2).normalize();
    if (fn.dot(nrm[0]) < 0) fn.negate();

    const ax = Math.abs(fn.x);
    const ay = Math.abs(fn.y);
    const az = Math.abs(fn.z);
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const p = pts[k];
      let u: number;
      let v: number;
      if (ax >= ay && ax >= az) {
        u = p.z;
        v = p.y;
      } else if (ay >= az) {
        u = p.x;
        v = p.z;
      } else {
        u = p.x;
        v = p.y;
      }
      const d = tri[k];
      ids.push(
        mb.vert(p, nrm[k].clone().lerp(fn, 0.45), u * o.uvScale, v * o.uvScale, {
          t: o.tOf(p),
          blade: o.blade ?? 0,
          phase: o.phase ?? 0,
          ao: o.ao ? o.ao(d, p) : 1,
          emit: o.emit ? o.emit(d, p) : 0,
          thick: o.thick ?? 0.08,
          twist: o.twistWeight ?? 1,
        }),
      );
    }
    mb.tri(ids[0], ids[1], ids[2]);
  }
}

/* ------------------------------------------------------------------ *
 * Branching L-system
 * ------------------------------------------------------------------ */

export interface Branch {
  pts: THREE.Vector3[];
  radii: number[];
  ts: number[];
  depth: number;
  terminal: boolean;
}

export interface LSystemOpts {
  rnd: () => number;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  radius: number;
  levels: number;
  /** Inclusive child-count range at each node. */
  children: [number, number];
  /** Branching half-angle, radians. */
  spread: number;
  lengthDecay: number;
  /** 0 = free 3D, 1 = collapsed into the local XY plane (gorgonian fans). */
  planar: number;
  /** Per-step tangent perturbation. */
  curve: number;
  /** Pull toward +Y per step; negative droops. */
  upBias: number;
  subSegs: number;
  /** Murray's-law exponent for radius partitioning at a node. */
  murray?: number;
}

/**
 * Recursive branching structure. Radii are partitioned between children by
 * Murray's law (`sum(r_child^k) == r_parent^k`), which is what makes a real
 * gorgonian taper convincingly instead of stepping down uniformly.
 */
export function lsystem(o: LSystemOpts): Branch[] {
  const out: Branch[] = [];
  const murray = o.murray ?? 2.4;
  const tSpan = 1 / (o.levels + 1);
  const roll = new THREE.Vector3();
  const axis = new THREE.Vector3();

  const grow = (
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    len: number,
    rad: number,
    depth: number,
    tStart: number,
  ): void => {
    const n = Math.max(2, o.subSegs - depth);
    const pts: THREE.Vector3[] = [origin.clone()];
    const radii: number[] = [rad];
    const ts: number[] = [tStart];
    const d = dir.clone().normalize();
    const p = origin.clone();
    for (let i = 1; i <= n; i++) {
      d.x += (o.rnd() - 0.5) * o.curve;
      d.y += (o.upBias - d.y * 0.35) * o.curve;
      d.z += (o.rnd() - 0.5) * o.curve * (1 - o.planar * 0.85);
      d.normalize();
      p.addScaledVector(d, len / n);
      pts.push(p.clone());
      const f = i / n;
      radii.push(rad * (1 - 0.55 * f));
      ts.push(tStart + tSpan * f);
    }

    const terminal = depth >= o.levels;
    out.push({ pts, radii, ts, depth, terminal });
    if (terminal) return;

    const nc = o.children[0] + Math.floor(o.rnd() * (o.children[1] - o.children[0] + 1));
    const tipR = radii[radii.length - 1];
    // Murray partition, jittered so siblings are not clones.
    const shares: number[] = [];
    let total = 0;
    for (let c = 0; c < nc; c++) {
      const s = 0.6 + o.rnd() * 0.8;
      shares.push(s);
      total += s;
    }
    const rollBase = o.rnd() * Math.PI * 2;
    for (let c = 0; c < nc; c++) {
      const frac = shares[c] / total;
      const childRad = tipR * Math.pow(frac, 1 / murray);
      const childLen = len * o.lengthDecay * (0.7 + 0.6 * o.rnd());
      // Phyllotaxis-ish roll keeps siblings from stacking.
      const ang = rollBase + (c / nc) * Math.PI * 2 + (o.rnd() - 0.5) * 0.9;
      roll.set(Math.cos(ang), 0, Math.sin(ang) * (1 - o.planar));
      if (roll.lengthSq() < 1e-8) roll.set(1, 0, 0);
      roll.normalize();
      axis.crossVectors(d, roll);
      if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1);
      axis.normalize();
      const childDir = d.clone().applyAxisAngle(axis, o.spread * (0.55 + 0.9 * o.rnd()));
      childDir.z *= 1 - o.planar * 0.9;
      childDir.normalize();
      grow(p, childDir, childLen, childRad, depth + 1, tStart + tSpan);
    }
  };

  grow(o.origin, o.dir, o.length, o.radius, 0, 0);
  return out;
}

export interface BranchTubeOpts {
  radial: number;
  ao?: (t: number, depth: number) => number;
  emit?: (p: THREE.Vector3, t: number, depth: number) => number;
  wobble?: (u: number, ang: number, depth: number) => number;
  blade?: number;
  thick?: number;
  polypRadius?: number;
  rnd?: () => number;
  vScale?: number;
}

/** Skins an L-system into tapered tubes with optional terminal polyps. */
export function skinBranches(mb: FloraMeshBuilder, branches: Branch[], o: BranchTubeOpts): void {
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const vScale = o.vScale ?? 1;

  for (const br of branches) {
    const rows = br.pts.length;
    const rad = Math.max(3, o.radial - br.depth);
    const start = mb.count;
    // Rotation-minimising frame walked along the polyline.
    const nrm = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const bin = new THREE.Vector3();
    tan.subVectors(br.pts[1], br.pts[0]).normalize();
    anyPerp(tan, nrm);
    let vAcc = 0;

    for (let i = 0; i < rows; i++) {
      if (i > 0) {
        const prevTan = tan.clone();
        if (i < rows - 1) tan.subVectors(br.pts[i + 1], br.pts[i]).normalize();
        const ax = new THREE.Vector3().crossVectors(prevTan, tan);
        const s = ax.length();
        if (s > 1e-7) nrm.applyAxisAngle(ax.divideScalar(s), Math.asin(Math.min(1, s))).normalize();
        vAcc += br.pts[i].distanceTo(br.pts[i - 1]);
      }
      bin.crossVectors(tan, nrm).normalize();
      const u = i / (rows - 1);
      const r = br.radii[i];
      const t = br.ts[i];
      const ao = o.ao ? o.ao(t, br.depth) : 1;
      for (let j = 0; j <= rad; j++) {
        const ang = (j / rad) * Math.PI * 2;
        dir.copy(nrm).multiplyScalar(Math.cos(ang)).addScaledVector(bin, Math.sin(ang));
        const wob = o.wobble ? o.wobble(u, ang, br.depth) : 0;
        p.copy(br.pts[i]).addScaledVector(dir, r * (1 + wob));
        mb.vert(p, dir, j / rad, vAcc * vScale, {
          t,
          blade: o.blade ?? 0,
          phase: t * 0.5,
          ao,
          emit: o.emit ? o.emit(p, t, br.depth) : 0,
          thick: o.thick ?? 0.1,
          twist: 1,
        });
      }
    }
    const stride = rad + 1;
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < rad; j++) {
        const a = start + i * stride + j;
        mb.quad(a, a + stride, a + stride + 1, a + 1);
      }
    }

    if (br.terminal && o.polypRadius) {
      const tip = br.pts[rows - 1];
      const pr = o.polypRadius * (0.7 + 0.6 * (o.rnd ? o.rnd() : 0.5));
      blob(mb, {
        center: tip,
        radius: () => pr,
        subdiv: 0,
        uvScale: 6,
        tOf: () => br.ts[rows - 1],
        ao: () => (o.ao ? o.ao(br.ts[rows - 1], br.depth) : 1),
        emit: (_d, pp) => (o.emit ? o.emit(pp, br.ts[rows - 1], br.depth) : 0),
        thick: 0.4,
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Cross-billboard card (furthest LOD)
 * ------------------------------------------------------------------ */

/**
 * `n` intersecting vertical quads plus, optionally, a horizontal one for
 * ground-hugging species. UVs cover the whole impostor; the vertex ao ramp and
 * `blade` weight keep the card swaying and shading like the mesh it replaces.
 */
export function crossCard(width: number, height: number, quads: number, emit: number, horizontal: boolean): THREE.BufferGeometry {
  const mb = new FloraMeshBuilder();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const rows = 3;

  for (let q = 0; q < quads; q++) {
    const ang = (q / quads) * Math.PI;
    const cx = Math.cos(ang);
    const cz = Math.sin(ang);
    n.set(-cz, 0.25, cx).normalize();
    const start = mb.count;
    for (let i = 0; i < rows; i++) {
      const v = i / (rows - 1);
      for (let j = 0; j < 2; j++) {
        const w = j === 0 ? -0.5 : 0.5;
        p.set(cx * w * width, v * height, cz * w * width);
        mb.vert(p, n, j, v, {
          t: v,
          blade: 0.75,
          phase: v * 0.4 + q * 0.17,
          ao: 0.4 + 0.6 * v,
          emit: emit * (0.35 + 0.65 * v),
          thick: 0.85,
          twist: 0.5,
        });
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      const a = start + i * 2;
      mb.quad(a, a + 1, a + 3, a + 2);
    }
  }

  if (horizontal) {
    const start = mb.count;
    n.set(0, 1, 0);
    const y = height * 0.14;
    const h = width * 0.55;
    p.set(-h, y, -h);
    mb.vert(p, n, 0, 0, { t: 0.25, blade: 0.5, ao: 0.55, emit: emit * 0.4, thick: 0.8, twist: 0.3 });
    p.set(h, y, -h);
    mb.vert(p, n, 1, 0, { t: 0.25, blade: 0.5, ao: 0.55, emit: emit * 0.4, thick: 0.8, twist: 0.3 });
    p.set(h, y, h);
    mb.vert(p, n, 1, 1, { t: 0.3, blade: 0.5, ao: 0.6, emit: emit * 0.4, thick: 0.8, twist: 0.3 });
    p.set(-h, y, h);
    mb.vert(p, n, 0, 1, { t: 0.3, blade: 0.5, ao: 0.6, emit: emit * 0.4, thick: 0.8, twist: 0.3 });
    mb.quad(start, start + 1, start + 2, start + 3);
  }

  return mb.geometry();
}

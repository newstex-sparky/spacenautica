/**
 * Parametric creature-mesh builder.
 *
 * One builder produces every species in the game: a body is a swept
 * superellipse cross-section along a spine curve, plus membranes (fins, ray
 * wings), swept-tube limbs, spheroid eyes and pyramid teeth. Nothing is loaded
 * from disk — every vertex here is computed at runtime.
 *
 * Vertex layout beyond position/normal/uv:
 *   aBody = vec4( bodyT, part, wing, vent )
 *     bodyT : (localZ + length/2) / length. 0 at the snout, 1 at the tail root,
 *             >1 on the caudal fin (so the tail whips harder than the body).
 *     part  : PART_* enum, branches the shader (body / fin / eye / limb / tooth).
 *     wing  : |localX| / maxHalfWidth, drives ray-wing undulation.
 *     vent  : 0 dorsal .. 1 ventral, drives countershading.
 *   aLimb = vec2( limbT, limbPhase )
 *     limbT : 0 at the root of a fin/limb, 1 at its tip.
 *     limbPhase : per-appendage phase offset so limbs do not move in lockstep.
 *
 * The head points down -Z so a Matrix4.lookAt() basis orients the creature.
 */
import * as THREE from 'three';
import { Noise } from '../core/Noise';

export const PART_BODY = 0;
export const PART_FIN = 1;
export const PART_EYE = 2;
export const PART_LIMB = 4;
export const PART_TOOTH = 5;

/* ------------------------------------------------------------------ *
 * Specs
 * ------------------------------------------------------------------ */

export interface FinSpec {
  /** Station along the body, 0 snout .. 1 tail root. */
  t: number;
  /** Angle around the cross-section: 0 = dorsal (+Y), PI/2 = right (+X), PI = ventral. */
  angle: number;
  /** Also emit an X-mirrored copy (pectorals, pelvics). */
  mirror: boolean;
  /** Span in metres from root to tip. */
  span: number;
  chordRoot: number;
  chordTip: number;
  /** Tip pushed backwards along +Z. */
  sweep: number;
  /** Tip pushed sideways out of the fin plane — kills the "flat card" read. */
  curl: number;
  /** Number of visible ray struts; drives the shader's rib normal detail. */
  ribs: number;
  /** Extra flap amplitude multiplier, 0 = rigid. */
  flap: number;
  /** Phase offset in turns, 0..1. */
  phase: number;
  segU: number;
  segV: number;
  /** Trailing-edge notch depth, 0..0.5. Gives forked/lunate silhouettes. */
  notch: number;
}

export interface LimbSpec {
  t: number;
  angle: number;
  mirror: boolean;
  /** Per-joint length / pitch / yaw, applied cumulatively down the limb. */
  joints: Array<{ len: number; pitch: number; yaw: number }>;
  radius: number;
  taper: number;
  phase: number;
  radial: number;
}

export interface EyeSpec {
  t: number;
  /** Vertical placement as a fraction of the section half-height. */
  up: number;
  /** Lateral placement as a fraction of the section half-width. */
  out: number;
  radius: number;
  /** How far the eyeball protrudes out of the skin, in radii. */
  bulge: number;
}

export interface BodySpec {
  length: number;
  /** Radius multiplier along t; sampled with a smoothstep interpolant. */
  girth: number[];
  widthMul: number[];
  heightMul: number[];
  /** Superellipse exponent along t. 2 = round, >2 boxy, <2 pinched/diamond. */
  sharp: number[];
  /** Spine vertical offset along t, in maxGirth units. */
  arch: number[];
  maxGirth: number;
  dorsalRidge: number;
  bellyBulge: number;
  /** Surface erosion / asymmetry amplitude, fraction of local radius. */
  noiseAmp: number;
  noiseFreq: number;
  segments: number;
  radial: number;
  eyes: EyeSpec[];
  fins: FinSpec[];
  limbs: LimbSpec[];
  /** Teeth rows along the gape; 0 disables. */
  teeth: number;
  toothLen: number;
  seed: number;
}

/* ------------------------------------------------------------------ *
 * Curve sampling
 * ------------------------------------------------------------------ */

/** Smoothstep-interpolated control-point curve; t is clamped to 0..1. */
export function sampleCurve(a: readonly number[], t: number): number {
  const n = a.length - 1;
  if (n <= 0) return a[0] ?? 0;
  const x = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return a[i] * (1 - s) + a[i + 1] * s;
}

function sgnPow(v: number, e: number): number {
  return v < 0 ? -Math.pow(-v, e) : Math.pow(v, e);
}

function spineY(spec: BodySpec, t: number): number {
  return sampleCurve(spec.arch, t) * spec.maxGirth;
}

function zAt(spec: BodySpec, t: number): number {
  return -spec.length * 0.5 + t * spec.length;
}

/* ------------------------------------------------------------------ *
 * Surface evaluation
 * ------------------------------------------------------------------ */

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _tu = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ctr = new THREE.Vector3();
const _out = new THREE.Vector3();
const _chord = new THREE.Vector3();
const _thin = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _fn = new THREE.Vector3();

/** Point on the body surface at station t and section angle theta. */
export function evalBody(
  spec: BodySpec,
  noise: Noise,
  t: number,
  theta: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const g = sampleCurve(spec.girth, t) * spec.maxGirth;
  const rx = Math.max(1e-4, g * sampleCurve(spec.widthMul, t));
  const ry = Math.max(1e-4, g * sampleCurve(spec.heightMul, t));
  const e = 2 / Math.max(0.5, sampleCurve(spec.sharp, t));
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  let x = rx * sgnPow(st, e);
  let y = ry * sgnPow(ct, e);

  const up = Math.max(0, ct);
  const dn = Math.max(0, -ct);
  y += ry * spec.dorsalRidge * up * up * up * (0.35 + 0.65 * sampleCurve(spec.girth, t));
  y -= ry * spec.bellyBulge * dn * dn;

  if (spec.noiseAmp > 0) {
    const nf = spec.noiseFreq;
    // Sampled on the cylinder so it is seamless around theta by construction.
    const n1 = noise.fbm3(ct * nf, st * nf, t * nf * 2.6, 3);
    const s = 1 + spec.noiseAmp * n1;
    x *= s;
    y *= s;
  }
  return out.set(x, y + spineY(spec, t), zAt(spec, t));
}

/* ------------------------------------------------------------------ *
 * Accumulator
 * ------------------------------------------------------------------ */

class MeshAccum {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  body: number[] = [];
  limb: number[] = [];
  idx: number[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  vert(
    p: THREE.Vector3,
    n: THREE.Vector3,
    u: number,
    v: number,
    t: number,
    part: number,
    wing: number,
    vent: number,
    limbT = 0,
    limbPhase = 0,
  ): number {
    const i = this.count;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.body.push(t, part, wing, vent);
    this.limb.push(limbT, limbPhase);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Winding a->b->c->d; emitted as (a,b,d) + (b,c,d). */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, d, b, c, d);
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBody', new THREE.Float32BufferAttribute(this.body, 4));
    g.setAttribute('aLimb', new THREE.Float32BufferAttribute(this.limb, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

function maxHalfWidth(spec: BodySpec): number {
  let m = 1e-3;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    m = Math.max(m, sampleCurve(spec.girth, t) * spec.maxGirth * sampleCurve(spec.widthMul, t));
  }
  for (const f of spec.fins) {
    if (Math.abs(Math.sin(f.angle)) > 0.5) m = Math.max(m, f.span * 0.9);
  }
  return m;
}

function ventOf(ny: number, yLocal: number, ry: number): number {
  const a = 0.5 - 0.5 * ny;
  const b = 0.5 - 0.5 * Math.max(-1, Math.min(1, yLocal / Math.max(1e-4, ry)));
  return Math.min(1, Math.max(0, 0.62 * a + 0.38 * b));
}

export interface BuiltBody {
  geometry: THREE.BufferGeometry;
  /** Widest half-width, used by the shader for the wing coordinate. */
  halfWidth: number;
  /** Local-space offset of the gill vent, for bubble emission. */
  gill: THREE.Vector3;
  /** Local-space jaw tip, for the stalker's carried salvage. */
  jaw: THREE.Vector3;
}

/**
 * Builds one creature geometry. `detail` scales the tessellation: 1 for the
 * near LOD, ~0.45 for the far LOD.
 */
export function buildCreature(spec: BodySpec, detail = 1): BuiltBody {
  const noise = new Noise(spec.seed);
  const m = new MeshAccum();
  const hw = maxHalfWidth(spec);
  const len = spec.length;
  const half = len * 0.5;
  const tOf = (z: number) => (z + half) / len;
  const wingOf = (x: number) => Math.min(1, Math.abs(x) / hw);

  const segs = Math.max(6, Math.round(spec.segments * detail));
  const radial = Math.max(6, Math.round(spec.radial * detail) & ~1);

  /* --- body sweep -------------------------------------------------
   * Two passes: sample the surface once per vertex, then derive normals from
   * neighbouring samples. Evaluating the noise field five times per vertex for
   * finite differences would cost five times as much for no visible gain.
   */
  const grid = new Float32Array((segs + 1) * radial * 3);
  const at = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const k = (i * radial + ((j % radial) + radial) % radial) * 3;
    return out.set(grid[k], grid[k + 1], grid[k + 2]);
  };
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    for (let j = 0; j < radial; j++) {
      evalBody(spec, noise, t, (j / radial) * Math.PI * 2, _p);
      const k = (i * radial + j) * 3;
      grid[k] = _p.x;
      grid[k + 1] = _p.y;
      grid[k + 2] = _p.z;
    }
  }
  const rings: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const row: number[] = [];
    const ryHere = Math.max(
      1e-4,
      sampleCurve(spec.girth, t) * spec.maxGirth * sampleCurve(spec.heightMul, t),
    );
    const sy = spineY(spec, t);
    for (let j = 0; j < radial; j++) {
      at(i, j, _p);
      at(Math.min(segs, i + 1), j, _a);
      at(Math.max(0, i - 1), j, _b);
      _tu.subVectors(_a, _b);
      at(i, j + 1, _a);
      at(i, j - 1, _b);
      _tv.subVectors(_a, _b);
      _n.crossVectors(_tu, _tv);
      const th = (j / radial) * Math.PI * 2;
      if (_n.lengthSq() < 1e-12) _n.set(Math.sin(th), Math.cos(th), 0);
      _n.normalize();
      _ctr.set(0, sy, _p.z);
      if (_n.dot(_v0.subVectors(_p, _ctr)) < 0) _n.negate();
      row.push(
        m.vert(
          _p,
          _n,
          j / radial,
          t,
          t,
          PART_BODY,
          wingOf(_p.x),
          ventOf(_n.y, _p.y - sy, ryHere),
        ),
      );
    }
    rings.push(row);
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      m.quad(rings[i][j], rings[i + 1][j], rings[i + 1][j2], rings[i][j2]);
    }
  }

  /* --- snout + tail-root caps ------------------------------------- */
  const capNose = (() => {
    _p.set(0, spineY(spec, 0), zAt(spec, -0.035));
    _n.set(0, 0, -1);
    return m.vert(_p, _n, 0.5, 0, tOf(_p.z), PART_BODY, 0, 0.5);
  })();
  for (let j = 0; j < radial; j++) {
    const j2 = (j + 1) % radial;
    m.tri(capNose, rings[0][j2], rings[0][j]);
  }
  const capTail = (() => {
    _p.set(0, spineY(spec, 1), zAt(spec, 1.02));
    _n.set(0, 0, 1);
    return m.vert(_p, _n, 0.5, 1, tOf(_p.z), PART_BODY, 0, 0.5);
  })();
  for (let j = 0; j < radial; j++) {
    const j2 = (j + 1) % radial;
    m.tri(capTail, rings[segs][j], rings[segs][j2]);
  }

  /* --- fins / membranes ------------------------------------------- */
  for (const fin of spec.fins) {
    addMembrane(m, spec, noise, fin, 1, hw, detail);
    if (fin.mirror) addMembrane(m, spec, noise, fin, -1, hw, detail);
  }

  /* --- limbs ------------------------------------------------------ */
  for (const limb of spec.limbs) {
    addLimb(m, spec, noise, limb, 1, hw, detail);
    if (limb.mirror) addLimb(m, spec, noise, limb, -1, hw, detail);
  }

  /* --- eyes ------------------------------------------------------- */
  for (const eye of spec.eyes) {
    addEye(m, spec, noise, eye, 1, hw, detail);
    addEye(m, spec, noise, eye, -1, hw, detail);
  }

  /* --- teeth ------------------------------------------------------ */
  if (spec.teeth > 0) addTeeth(m, spec, noise, hw);

  /* --- anchors ---------------------------------------------------- */
  evalBody(spec, noise, 0.2, Math.PI * 0.5, _p);
  const gill = _p.clone();
  evalBody(spec, noise, 0.0, Math.PI, _p);
  const jaw = _p.clone();

  return { geometry: m.toGeometry(), halfWidth: hw, gill, jaw };
}

/* ------------------------------------------------------------------ *
 * Membrane (fins, ray wings, caudal lobes)
 * ------------------------------------------------------------------ */

function addMembrane(
  m: MeshAccum,
  spec: BodySpec,
  noise: Noise,
  fin: FinSpec,
  sx: number,
  hw: number,
  detail: number,
): void {
  const len = spec.length;
  const half = len * 0.5;
  const su = Math.max(3, Math.round(fin.segU * detail));
  const sv = Math.max(2, Math.round(fin.segV * detail));

  evalBody(spec, noise, fin.t, fin.angle, _v0);
  _v0.x *= sx;
  // Sink the root slightly into the body so there is no visible seam.
  _out.set(Math.sin(fin.angle) * sx, Math.cos(fin.angle), 0).normalize();
  _v0.addScaledVector(_out, -0.12 * fin.span * 0.35);
  _chord.set(0, 0, 1);
  _thin.crossVectors(_out, _chord).normalize();

  const grid: number[][] = [];
  for (let i = 0; i <= su; i++) {
    const u = i / su;
    const row: number[] = [];
    const chordLen = THREE.MathUtils.lerp(fin.chordRoot, fin.chordTip, u * u * (3 - 2 * u));
    // Organic outline wobble so no fin edge is a straight line.
    const wob = 1 + 0.14 * noise.noise2(u * 5.1 + fin.t * 11.0, fin.angle * 2.3);
    for (let j = 0; j <= sv; j++) {
      const v = j / sv;
      // Trailing-edge notch → forked / lunate caudal silhouettes.
      const notch = fin.notch * (1 - Math.abs(2 * v - 1)) * u * u;
      const cz = chordLen * wob * (v - 0.28) - notch * chordLen;
      _p.copy(_v0)
        .addScaledVector(_out, fin.span * u)
        .addScaledVector(_chord, cz + fin.sweep * u * u)
        .addScaledVector(_thin, fin.curl * u * u * Math.sin(Math.PI * Math.min(1, Math.max(0, v))) * sx);
      // Slight ripple across the membrane so it never reads perfectly flat.
      _p.addScaledVector(
        _thin,
        0.035 * fin.span * Math.sin(v * Math.PI * fin.ribs * 0.5) * u * sx,
      );
      _fn.copy(_thin).multiplyScalar(sx);
      _fn.addScaledVector(_out, -fin.curl * 0.9 * u);
      _fn.normalize();
      const ryHere = Math.max(
        1e-4,
        sampleCurve(spec.girth, fin.t) * spec.maxGirth * sampleCurve(spec.heightMul, fin.t),
      );
      row.push(
        m.vert(
          _p,
          _fn,
          v,
          u,
          (_p.z + half) / len,
          PART_FIN,
          Math.min(1, Math.abs(_p.x) / hw),
          ventOf(_fn.y, _p.y - spineY(spec, fin.t), ryHere),
          u,
          fin.phase,
        ),
      );
    }
    grid.push(row);
  }
  for (let i = 0; i < su; i++) {
    for (let j = 0; j < sv; j++) {
      if (sx > 0) m.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      else m.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Limb (swept tube with jointed pitch/yaw)
 * ------------------------------------------------------------------ */

function addLimb(
  m: MeshAccum,
  spec: BodySpec,
  noise: Noise,
  limb: LimbSpec,
  sx: number,
  hw: number,
  detail: number,
): void {
  const len = spec.length;
  const half = len * 0.5;
  const radial = Math.max(4, Math.round(limb.radial * detail));

  evalBody(spec, noise, limb.t, limb.angle, _v0);
  _v0.x *= sx;
  _out.set(Math.sin(limb.angle) * sx, Math.cos(limb.angle), 0).normalize();

  // Walk the joints. `pitch` bends the limb in the body's cross-section plane
  // (rotation about world Z, i.e. knee flex up/down); `yaw` sweeps it fore/aft
  // (rotation about world Y). Both are unambiguous for a limb that starts out
  // sideways, so there are no gimbal degeneracies to guard against.
  const pts: THREE.Vector3[] = [_v0.clone()];
  const dirs: THREE.Vector3[] = [];
  const dir = new THREE.Vector3().copy(_out);
  const axisZ = new THREE.Vector3(0, 0, 1);
  const axisY = new THREE.Vector3(0, 1, 0);
  for (const j of limb.joints) {
    dir.applyAxisAngle(axisZ, j.pitch * sx).applyAxisAngle(axisY, j.yaw * sx).normalize();
    dirs.push(dir.clone());
    pts.push(pts[pts.length - 1].clone().addScaledVector(dir, j.len));
  }

  const rings: number[][] = [];
  for (let k = 0; k < pts.length; k++) {
    const u = k / (pts.length - 1);
    const d = dirs[Math.min(k, dirs.length - 1)];
    const right = _v2.set(0, 1, 0).cross(d);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up2 = _v3.copy(d).cross(right).normalize();
    const r = limb.radius * (1 - limb.taper * u) * (0.7 + 0.3 * Math.cos(u * Math.PI * 2.4));
    const row: number[] = [];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const bump = 1 + 0.16 * noise.noise2(u * 9 + limb.t * 4, a * 1.7);
      _p.copy(pts[k]).addScaledVector(right, ca * r * bump).addScaledVector(up2, sa * r * bump);
      _fn.copy(right).multiplyScalar(ca).addScaledVector(up2, sa).normalize();
      row.push(
        m.vert(
          _p,
          _fn,
          j / radial,
          u,
          (_p.z + half) / len,
          PART_LIMB,
          Math.min(1, Math.abs(_p.x) / hw),
          ventOf(_fn.y, -0.2, 1),
          u,
          limb.phase + (sx < 0 ? 0.5 : 0),
        ),
      );
    }
    rings.push(row);
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      m.quad(rings[k][j], rings[k + 1][j], rings[k + 1][j2], rings[k][j2]);
    }
  }
  // Close the tip with a small cone.
  const tipDir = dirs[dirs.length - 1] ?? _out;
  _p.copy(pts[pts.length - 1]).addScaledVector(tipDir, limb.radius * 0.9);
  const tip = m.vert(
    _p,
    _fn.copy(tipDir),
    0.5,
    1,
    (_p.z + half) / len,
    PART_LIMB,
    Math.min(1, Math.abs(_p.x) / hw),
    0.5,
    1,
    limb.phase + (sx < 0 ? 0.5 : 0),
  );
  const last = rings[rings.length - 1];
  for (let j = 0; j < radial; j++) m.tri(tip, last[j], last[(j + 1) % radial]);
}

/* ------------------------------------------------------------------ *
 * Eye
 * ------------------------------------------------------------------ */

function addEye(
  m: MeshAccum,
  spec: BodySpec,
  noise: Noise,
  eye: EyeSpec,
  sx: number,
  hw: number,
  detail: number,
): void {
  const len = spec.length;
  const half = len * 0.5;
  const rings = Math.max(4, Math.round(7 * detail));
  const segs = Math.max(6, Math.round(10 * detail));

  const g = sampleCurve(spec.girth, eye.t) * spec.maxGirth;
  const rx = g * sampleCurve(spec.widthMul, eye.t);
  const ry = g * sampleCurve(spec.heightMul, eye.t);
  const cx = rx * eye.out * sx;
  const cy = spineY(spec, eye.t) + ry * eye.up;
  const cz = zAt(spec, eye.t);
  // The eyeball's outward axis: mostly sideways, tilted forward and up a touch.
  const axis = _v1.set(sx * 0.94, 0.28, -0.2).normalize();
  const tangentA = _v2.set(0, 1, 0).cross(axis).normalize();
  const tangentB = _v3.copy(axis).cross(tangentA).normalize();
  const centre = _v0.set(cx, cy, cz).addScaledVector(axis, -eye.radius * (1 - eye.bulge));

  const grid: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    // v = 1 at the outward pole → the shader draws the pupil there.
    const v = i / rings;
    const polar = (1 - v) * Math.PI * 0.62;
    const row: number[] = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      _fn.copy(axis)
        .multiplyScalar(Math.cos(polar))
        .addScaledVector(tangentA, Math.sin(polar) * Math.cos(a))
        .addScaledVector(tangentB, Math.sin(polar) * Math.sin(a))
        .normalize();
      _p.copy(centre).addScaledVector(_fn, eye.radius);
      row.push(
        m.vert(
          _p,
          _fn,
          j / segs,
          v,
          (_p.z + half) / len,
          PART_EYE,
          Math.min(1, Math.abs(_p.x) / hw),
          0.15,
          v,
          0,
        ),
      );
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      if (sx > 0) m.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j2], grid[i][j2]);
      else m.quad(grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]);
    }
  }
  void noise;
}

/* ------------------------------------------------------------------ *
 * Teeth
 * ------------------------------------------------------------------ */

function addTeeth(m: MeshAccum, spec: BodySpec, noise: Noise, hw: number): void {
  const len = spec.length;
  const half = len * 0.5;
  const rows = [
    { th: Math.PI * 0.5 - 0.16, tilt: -0.35 },
    { th: Math.PI * 0.5 + 0.16, tilt: 0.35 },
    { th: -Math.PI * 0.5 + 0.16, tilt: -0.35 },
    { th: -Math.PI * 0.5 - 0.16, tilt: 0.35 },
  ];
  const n = spec.teeth;
  for (const row of rows) {
    for (let i = 0; i < n; i++) {
      const t = 0.02 + 0.115 * (i / Math.max(1, n - 1));
      evalBody(spec, noise, t, row.th, _v0);
      const jitter = 0.65 + 0.5 * noise.noise2(i * 3.7, row.th * 5.1);
      const L = spec.toothLen * jitter;
      const dir = _v1.set(Math.sin(row.th) * 0.35, Math.sin(row.tilt), -0.92).normalize();
      const right = _v2.set(0, 1, 0).cross(dir).normalize();
      const up2 = _v3.copy(dir).cross(right).normalize();
      const r = L * 0.22;
      _p.copy(_v0).addScaledVector(dir, L);
      const apex = m.vert(
        _p,
        _fn.copy(dir),
        0.5,
        1,
        (_p.z + half) / len,
        PART_TOOTH,
        Math.min(1, Math.abs(_p.x) / hw),
        0.4,
      );
      const base: number[] = [];
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        _p.copy(_v0).addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r);
        _fn.copy(right).multiplyScalar(Math.cos(a)).addScaledVector(up2, Math.sin(a)).normalize();
        base.push(
          m.vert(
            _p,
            _fn,
            k / 4,
            0,
            (_p.z + half) / len,
            PART_TOOTH,
            Math.min(1, Math.abs(_p.x) / hw),
            0.4,
          ),
        );
      }
      for (let k = 0; k < 4; k++) m.tri(apex, base[k], base[(k + 1) % 4]);
    }
  }
}

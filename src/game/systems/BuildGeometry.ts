/**
 * BUILD GEOMETRY — procedural meshes for every habitat piece.
 *
 * No glTF, no imported meshes: each piece is assembled from parametric primitives
 * that are then ribbed, bolted, greebled, dented and vertex-coloured with a
 * per-placement seed, so two corridors in the same frame are never the same mesh.
 *
 * Output is bucketed by material (hull / trim / interior / rubber / glass / glow)
 * and merged, so one piece costs six draw calls at most and usually four.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Noise, mulberry32 } from '../core/Noise';
import type { QualityTier } from '../core/Types';
import type { BuildPieceDef } from './BuildPieces';
import { CORRIDOR_LENGTH, CORRIDOR_RADIUS, ROOM_HEIGHT, ROOM_RADIUS } from './BuildPieces';

export type MaterialBucket = 'hull' | 'trim' | 'interior' | 'rubber' | 'glass' | 'glow';

export interface PieceGeometry {
  hull: THREE.BufferGeometry | null;
  trim: THREE.BufferGeometry | null;
  interior: THREE.BufferGeometry | null;
  rubber: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  /** Local-space bounds, used for the ghost box and collision tests. */
  bounds: THREE.Box3;
}

const SHARED_NOISE = new Noise(0xb1a5e5);

/* ------------------------------------------------------------------ *
 * Assembly helpers
 * ------------------------------------------------------------------ */

function xform(
  px = 0, py = 0, pz = 0,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1,
): THREE.Matrix4 {
  const e = new THREE.Euler(rx, ry, rz);
  const q = new THREE.Quaternion().setFromEuler(e);
  return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));
}

class Parts {
  private buckets = new Map<MaterialBucket, THREE.BufferGeometry[]>();

  add(bucket: MaterialBucket, geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    if (m) geo.applyMatrix4(m);
    let list = this.buckets.get(bucket);
    if (!list) {
      list = [];
      this.buckets.set(bucket, list);
    }
    list.push(geo);
  }

  /** Flips winding + normals so an inner shell is lit from inside. */
  addInverted(bucket: MaterialBucket, geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const index = geo.getIndex();
    if (index) {
      const a = index.array as Uint16Array | Uint32Array;
      for (let i = 0; i < a.length; i += 3) {
        const t = a[i];
        a[i] = a[i + 2];
        a[i + 2] = t;
      }
      index.needsUpdate = true;
    }
    const n = geo.getAttribute('normal');
    if (n) {
      const arr = n.array as Float32Array;
      for (let i = 0; i < arr.length; i++) arr[i] = -arr[i];
      n.needsUpdate = true;
    }
    this.add(bucket, geo, m);
  }

  take(bucket: MaterialBucket): THREE.BufferGeometry[] | undefined {
    return this.buckets.get(bucket);
  }

  buckets_(): MaterialBucket[] {
    return [...this.buckets.keys()];
  }
}

/** Displaces vertices along their normals with fbm — kills "perfect primitive". */
function roughen(geo: THREE.BufferGeometry, amp: number, freq: number, seedOffset: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nrm) return;
  const p = pos.array as Float32Array;
  const n = nrm.array as Float32Array;
  for (let i = 0; i < p.length; i += 3) {
    const d =
      SHARED_NOISE.fbm3(
        p[i] * freq + seedOffset,
        p[i + 1] * freq - seedOffset * 0.7,
        p[i + 2] * freq + seedOffset * 1.3,
        3,
      ) * amp;
    p[i] += n[i] * d;
    p[i + 1] += n[i + 1] * d;
    p[i + 2] += n[i + 2] * d;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * Bakes per-vertex wear into the colour attribute: a cavity/height term, patchy
 * biofilm in the greens, and a small per-piece hue offset so no two pieces in a
 * frame share a tint.
 */
function paint(geo: THREE.BufferGeometry, seed: number, tint: THREE.Color, bounds: THREE.Box3): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const p = pos.array as Float32Array;
  const rng = mulberry32(seed);
  const hueJitter = (rng() - 0.5) * 0.06;
  const valJitter = 1 + (rng() - 0.5) * 0.12;
  const hsl = { h: 0, s: 0, l: 0 };
  tint.getHSL(hsl);
  const base = new THREE.Color().setHSL(
    (hsl.h + hueJitter + 1) % 1,
    THREE.MathUtils.clamp(hsl.s * (0.9 + rng() * 0.25), 0, 1),
    THREE.MathUtils.clamp(hsl.l * valJitter, 0.02, 0.98),
  );
  const spanY = Math.max(0.001, bounds.max.y - bounds.min.y);

  for (let i = 0; i < count; i++) {
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];

    // Downward-facing surfaces and low areas collect silt and shadow.
    const low = 1 - THREE.MathUtils.clamp((y - bounds.min.y) / spanY, 0, 1);
    // Patchy biofilm at two scales.
    const film = THREE.MathUtils.clamp(
      SHARED_NOISE.fbm3(x * 0.85 + seed * 0.013, y * 0.85, z * 0.85, 3) * 0.5 + 0.5,
      0,
      1,
    );
    const filmFine = THREE.MathUtils.clamp(
      SHARED_NOISE.fbm3(x * 3.4, y * 3.4, z * 3.4 + seed * 0.05, 2) * 0.5 + 0.5,
      0,
      1,
    );
    const grime = THREE.MathUtils.clamp(low * 0.55 + film * 0.5 + filmFine * 0.2 - 0.25, 0, 1);

    colors[i * 3] = base.r * (1 - grime * 0.42);
    colors[i * 3 + 1] = base.g * (1 - grime * 0.24) + grime * 0.05;
    colors[i * 3 + 2] = base.b * (1 - grime * 0.34) + grime * 0.02;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function mergeBucket(list: THREE.BufferGeometry[] | undefined): THREE.BufferGeometry | null {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];
  const merged = mergeGeometries(list, false);
  if (!merged) return list[0];
  for (const g of list) g.dispose();
  return merged;
}

interface Detail {
  radial: number;
  tubular: number;
  cap: number;
  greebles: number;
}

function detailFor(tier: QualityTier): Detail {
  switch (tier) {
    case 'low': return { radial: 10, tubular: 12, cap: 8, greebles: 3 };
    case 'medium': return { radial: 14, tubular: 18, cap: 12, greebles: 5 };
    case 'high': return { radial: 20, tubular: 26, cap: 18, greebles: 8 };
    default: return { radial: 26, tubular: 34, cap: 24, greebles: 12 };
  }
}

/* ------------------------------------------------------------------ *
 * Reusable sub-assemblies
 * ------------------------------------------------------------------ */

/**
 * A ribbed pressure tube along +Z. The radius profile carries three scales:
 * end flanges (macro), evenly spaced ribs (mid), and a low-amplitude wobble
 * driven by noise (micro), so the silhouette is never a clean cylinder.
 */
function ribbedTubeProfile(
  radius: number,
  length: number,
  ribs: number,
  seed: number,
  steps = 48,
): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const rng = mulberry32(seed);
  const phase = rng() * 6.283;
  const ribAmp = 0.055 + rng() * 0.04;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -length / 2 + t * length;
    // Ribs.
    const rib = Math.pow(Math.abs(Math.sin(t * Math.PI * ribs + phase)), 8) * ribAmp;
    // Slight barrel so the middle is fatter than the ends.
    const barrel = Math.sin(t * Math.PI) * 0.022 * radius;
    // Noise wobble.
    const wob = SHARED_NOISE.noise2(t * 7 + seed * 0.02, seed * 0.05) * 0.012 * radius;
    // Flange collar at both ends.
    const flange = (t < 0.035 || t > 0.965) ? 0.075 : 0;
    pts.push(new THREE.Vector2(radius + rib + barrel + wob + flange, y));
  }
  return pts;
}

function tubeAlongZ(
  radius: number, length: number, ribs: number, seed: number, d: Detail,
): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(
    ribbedTubeProfile(radius, length, ribs, seed, Math.max(24, d.tubular * 2)),
    d.radial,
  );
  geo.rotateX(Math.PI / 2);
  return geo;
}

function boltRing(
  parts: Parts, bucket: MaterialBucket,
  cx: number, cy: number, cz: number,
  axis: 'x' | 'y' | 'z',
  radius: number, count: number, boltR: number, boltH: number, seed: number,
): void {
  const rng = mulberry32(seed);
  const start = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * Math.PI * 2;
    // Skip the occasional bolt: a base that has been repaired looks repaired.
    if (rng() < 0.08) continue;
    const s = 0.85 + rng() * 0.3;
    const bolt = new THREE.CylinderGeometry(boltR * s, boltR * s * 1.12, boltH, 6, 1);
    let m: THREE.Matrix4;
    if (axis === 'z') {
      m = xform(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz, Math.PI / 2, 0, 0);
    } else if (axis === 'x') {
      m = xform(cx, cy + Math.sin(a) * radius, cz + Math.cos(a) * radius, 0, 0, Math.PI / 2);
    } else {
      m = xform(cx + Math.cos(a) * radius, cy, cz + Math.sin(a) * radius);
    }
    parts.add(bucket, bolt, m);
  }
}

/** Random surface greebles: junction boxes, conduit stubs, weld patches. */
function greebleTube(
  parts: Parts, radius: number, length: number, count: number, seed: number, axis: 'z' | 'x' = 'z',
): void {
  const rng = mulberry32(seed ^ 0x9e37);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const t = (rng() - 0.5) * length * 0.82;
    const kind = rng();
    const w = 0.1 + rng() * 0.2;
    const h = 0.05 + rng() * 0.12;
    const l = 0.12 + rng() * 0.3;
    let geo: THREE.BufferGeometry;
    if (kind < 0.45) {
      geo = new THREE.BoxGeometry(w, h, l);
    } else if (kind < 0.75) {
      geo = new THREE.CylinderGeometry(w * 0.4, w * 0.4, h * 2.4, 7, 1);
      geo.rotateZ(Math.PI / 2);
    } else {
      geo = new THREE.TorusGeometry(w * 0.7, 0.022 + rng() * 0.02, 5, 10);
    }
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const r = radius + h * 0.45;
    const m = axis === 'z'
      ? xform(cos * r, sin * r, t, 0, 0, a)
      : xform(t, sin * r, cos * r, 0, Math.PI / 2, a);
    parts.add('trim', geo, m);
  }
}

/** Interior floor grating strip, for corridors and rooms. */
function grating(width: number, length: number, slats: number, seed: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const rng = mulberry32(seed);
  const plate = new THREE.BoxGeometry(width, 0.05, length);
  out.push(plate);
  for (let i = 0; i < slats; i++) {
    const t = (i / (slats - 1) - 0.5) * length * 0.94;
    const b = new THREE.BoxGeometry(width * (0.92 + rng() * 0.06), 0.035, 0.05);
    b.translate(0, 0.04, t);
    out.push(b);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Piece builders
 * ------------------------------------------------------------------ */

function buildFoundation(parts: Parts, seed: number, d: Detail): void {
  const rng = mulberry32(seed);
  // Slab with a chamfered top: two stacked boxes read as a bevel in silhouette.
  const slab = new THREE.BoxGeometry(6, 0.5, 6, 3, 1, 3);
  slab.translate(0, 0.05, 0);
  roughen(slab, 0.02, 0.9, seed * 0.01);
  parts.add('hull', slab);
  const cap = new THREE.BoxGeometry(5.6, 0.16, 5.6, 2, 1, 2);
  cap.translate(0, 0.34, 0);
  parts.add('trim', cap);

  // Deck grating in four quadrants, each slightly different.
  for (let qx = -1; qx <= 1; qx += 2) {
    for (let qz = -1; qz <= 1; qz += 2) {
      for (const g of grating(2.4, 2.4, 7, seed + qx * 31 + qz * 17)) {
        parts.add('trim', g, xform(qx * 1.4, 0.42, qz * 1.4, 0, rng() * 0.02, 0));
      }
    }
  }

  // Screw piles at the corners; each drives to a different depth.
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? 1 : -1;
    const sz = i & 2 ? 1 : -1;
    const len = 1.1 + rng() * 0.7;
    const pile = new THREE.CylinderGeometry(0.16, 0.2, len, 8, 1);
    parts.add('trim', pile, xform(sx * 2.6, -len / 2 + 0.1, sz * 2.6));
    const helix = new THREE.TorusGeometry(0.24, 0.035, 5, 12);
    parts.add('trim', helix, xform(sx * 2.6, -len * 0.6, sz * 2.6, Math.PI / 2, 0, 0));
  }
  boltRing(parts, 'trim', 0, 0.4, 0, 'y', 2.75, 12, 0.05, 0.1, seed + 7);
  void d;
}

function buildCorridorStraight(parts: Parts, seed: number, d: Detail): void {
  const R = CORRIDOR_RADIUS;
  const L = CORRIDOR_LENGTH;
  const shell = tubeAlongZ(R, L, 4, seed, d);
  roughen(shell, 0.012, 1.7, seed * 0.02);
  parts.add('hull', shell);

  // Inner liner, lit from inside.
  const liner = tubeAlongZ(R - 0.1, L - 0.04, 2, seed + 5, d);
  parts.addInverted('interior', liner);

  // End flanges + bolt circles.
  for (const s of [-1, 1]) {
    const flange = new THREE.TorusGeometry(R + 0.03, 0.1, 6, d.radial);
    parts.add('trim', flange, xform(0, 0, (s * L) / 2));
    boltRing(parts, 'trim', 0, 0, (s * L) / 2, 'z', R + 0.06, 12, 0.045, 0.09, seed + s * 13);
    const gasket = new THREE.TorusGeometry(R - 0.02, 0.045, 5, d.radial);
    parts.add('rubber', gasket, xform(0, 0, (s * L) / 2 - s * 0.06));
  }

  // Structural ribs, deliberately unevenly spaced.
  const rng = mulberry32(seed + 91);
  for (let i = 0; i < 4; i++) {
    const t = (-0.5 + (i + 0.5) / 4) * L + (rng() - 0.5) * 0.25;
    const rib = new THREE.TorusGeometry(R + 0.035, 0.055 + rng() * 0.02, 5, d.radial);
    parts.add('trim', rib, xform(0, 0, t));
  }

  for (const g of grating(1.5, L - 0.3, 9, seed + 3)) parts.add('trim', g, xform(0, -R + 0.42, 0));

  // Ceiling light strip + two wall indicator panels.
  const strip = new THREE.BoxGeometry(0.22, 0.05, L - 1.2);
  parts.add('glow', strip, xform(0, R - 0.22, 0));
  for (const s of [-1, 1]) {
    const panel = new THREE.BoxGeometry(0.02, 0.16, 0.28);
    parts.add('glow', panel, xform(s * (R - 0.13), 0.35, L * 0.28 * s));
  }

  // Conduit bundle running the length of the tube.
  for (let i = 0; i < 3; i++) {
    const a = -0.55 + i * 0.16;
    const hose = new THREE.CylinderGeometry(0.05, 0.05, L - 0.2, 6, 1);
    hose.rotateX(Math.PI / 2);
    parts.add('rubber', hose, xform(Math.cos(a) * (R - 0.14), Math.sin(a) * (R - 0.14), 0));
  }

  greebleTube(parts, R, L, d.greebles, seed);
}

function buildCorridorBend(parts: Parts, seed: number, d: Detail): void {
  const R = CORRIDOR_RADIUS;
  const arc = 2.5;
  const shell = new THREE.TorusGeometry(arc, R, d.radial, Math.max(10, d.tubular), Math.PI / 2);
  shell.rotateX(Math.PI / 2);
  shell.rotateY(Math.PI);
  shell.translate(arc, 0, arc);
  roughen(shell, 0.012, 1.6, seed * 0.03);
  parts.add('hull', shell);

  const liner = new THREE.TorusGeometry(arc, R - 0.1, d.radial, Math.max(10, d.tubular), Math.PI / 2);
  liner.rotateX(Math.PI / 2);
  liner.rotateY(Math.PI);
  liner.translate(arc, 0, arc);
  parts.addInverted('interior', liner);

  // Flanges at both open ends.
  const ends: Array<[number, number, number, number]> = [
    [0, 0, arc, 0],            // faces +Z
    [arc, 0, 0, Math.PI / 2],  // faces +X
  ];
  for (const [x, y, z, ry] of ends) {
    const flange = new THREE.TorusGeometry(R + 0.03, 0.1, 6, d.radial);
    parts.add('trim', flange, xform(x, y, z, 0, ry, 0));
    const gasket = new THREE.TorusGeometry(R - 0.02, 0.045, 5, d.radial);
    parts.add('rubber', gasket, xform(x, y, z, 0, ry, 0));
    boltRing(parts, 'trim', x, y, z, ry === 0 ? 'z' : 'x', R + 0.06, 12, 0.045, 0.09, seed + x * 7 + z * 3);
  }

  // Ribs following the arc.
  const rng = mulberry32(seed + 44);
  for (let i = 1; i < 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    const px = arc - Math.cos(a) * arc;
    const pz = arc - Math.sin(a) * arc;
    const rib = new THREE.TorusGeometry(R + 0.035, 0.05 + rng() * 0.02, 5, d.radial);
    parts.add('trim', rib, xform(px, 0, pz, 0, -a + Math.PI / 2, 0));
  }

  const strip = new THREE.TorusGeometry(arc, 0.05, 4, Math.max(10, d.tubular), Math.PI / 2 * 0.85);
  strip.rotateX(Math.PI / 2);
  strip.rotateY(Math.PI);
  strip.translate(arc, R - 0.22, arc);
  parts.add('glow', strip);
}

function buildJunction(parts: Parts, seed: number, d: Detail, arms: Array<[number, number, number]>): void {
  const R = CORRIDOR_RADIUS;
  // Hub: a slightly squashed, roughened sphere reads as a welded pressure node.
  const hub = new THREE.SphereGeometry(R + 0.1, d.radial + 4, Math.max(8, d.radial >> 1));
  hub.scale(1, 0.94, 1);
  roughen(hub, 0.02, 1.4, seed * 0.05);
  parts.add('hull', hub);

  const hubIn = new THREE.SphereGeometry(R, d.radial + 2, Math.max(8, d.radial >> 1));
  hubIn.scale(1, 0.94, 1);
  parts.addInverted('interior', hubIn);

  for (const [ax, ay, az] of arms) {
    const len = 2.5;
    const dir = new THREE.Vector3(ax, ay, az).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const arm = tubeAlongZ(R, len, 2, seed + yaw * 11, d);
    arm.translate(0, 0, len / 2);
    parts.add('hull', arm, xform(0, 0, 0, 0, yaw, 0));

    const liner = tubeAlongZ(R - 0.1, len - 0.02, 1, seed + yaw * 5, d);
    liner.translate(0, 0, len / 2);
    parts.addInverted('interior', liner, xform(0, 0, 0, 0, yaw, 0));

    const px = dir.x * len;
    const pz = dir.z * len;
    const flange = new THREE.TorusGeometry(R + 0.03, 0.1, 6, d.radial);
    parts.add('trim', flange, xform(px, 0, pz, 0, yaw, 0));
    const gasket = new THREE.TorusGeometry(R - 0.02, 0.045, 5, d.radial);
    parts.add('rubber', gasket, xform(px, 0, pz, 0, yaw, 0));
    boltRing(parts, 'trim', px, 0, pz, Math.abs(dir.z) > 0.5 ? 'z' : 'x', R + 0.06, 12, 0.045, 0.09, seed + px * 3 + pz * 7);

    const collar = new THREE.TorusGeometry(R + 0.06, 0.07, 5, d.radial);
    parts.add('trim', collar, xform(dir.x * (R + 0.12), 0, dir.z * (R + 0.12), 0, yaw, 0));
  }

  const lamp = new THREE.SphereGeometry(0.16, 8, 6);
  parts.add('glow', lamp, xform(0, R - 0.18, 0));
  greebleTube(parts, R + 0.1, 1.4, Math.max(2, d.greebles >> 1), seed + 3);
}

function buildRoom(parts: Parts, seed: number, d: Detail): void {
  const R = ROOM_RADIUS;
  const H = ROOM_HEIGHT;
  const rng = mulberry32(seed);

  // Outer shell: a lathe profile with a domed top, waisted middle and ribs.
  const pts: THREE.Vector2[] = [];
  const steps = Math.max(20, d.tubular);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -H / 2 + t * H;
    const dome = Math.sin(t * Math.PI) * 0.06 * R;
    const rib = Math.pow(Math.abs(Math.sin(t * Math.PI * 5)), 10) * 0.07;
    const wob = SHARED_NOISE.noise2(t * 6 + seed * 0.01, seed * 0.03) * 0.02 * R;
    const chamfer = t < 0.06 ? -(0.06 - t) * 3.2 : t > 0.94 ? -(t - 0.94) * 3.2 : 0;
    pts.push(new THREE.Vector2(Math.max(0.2, R + dome + rib + wob + chamfer), y));
  }
  const shell = new THREE.LatheGeometry(pts, d.radial + 6);
  roughen(shell, 0.02, 1.1, seed * 0.02);
  parts.add('hull', shell);

  const inner = new THREE.LatheGeometry(
    pts.map((p) => new THREE.Vector2(Math.max(0.15, p.x - 0.14), p.y)),
    d.radial + 4,
  );
  parts.addInverted('interior', inner);

  // Caps.
  const top = new THREE.CircleGeometry(R * 0.98, d.radial + 6);
  top.rotateX(-Math.PI / 2);
  parts.add('hull', top, xform(0, H / 2, 0));
  const bottom = new THREE.CircleGeometry(R * 0.98, d.radial + 6);
  bottom.rotateX(Math.PI / 2);
  parts.add('hull', bottom, xform(0, -H / 2, 0));

  // Walkable deck slightly above the floor, plus a ring kerb.
  const deck = new THREE.CircleGeometry(R - 0.22, d.radial + 4);
  deck.rotateX(-Math.PI / 2);
  parts.add('trim', deck, xform(0, -H / 2 + 0.14, 0));
  const kerb = new THREE.TorusGeometry(R - 0.22, 0.07, 5, d.radial + 4);
  parts.add('trim', kerb, xform(0, -H / 2 + 0.16, 0, Math.PI / 2, 0, 0));

  // Four port collars at the cardinal directions.
  for (let i = 0; i < 4; i++) {
    const yaw = (i / 4) * Math.PI * 2;
    const px = Math.sin(yaw) * R;
    const pz = Math.cos(yaw) * R;
    const collar = new THREE.CylinderGeometry(CORRIDOR_RADIUS + 0.1, CORRIDOR_RADIUS + 0.16, 0.34, d.radial, 1, true);
    collar.rotateX(Math.PI / 2);
    parts.add('trim', collar, xform(px * 0.97, 0, pz * 0.97, 0, yaw, 0));
    const gasket = new THREE.TorusGeometry(CORRIDOR_RADIUS + 0.02, 0.05, 5, d.radial);
    parts.add('rubber', gasket, xform(px, 0, pz, 0, yaw, 0));
    boltRing(parts, 'trim', px, 0, pz, Math.abs(Math.cos(yaw)) > 0.5 ? 'z' : 'x',
      CORRIDOR_RADIUS + 0.2, 10, 0.045, 0.08, seed + i * 29);
  }

  // Vertical structural ribs on the outside, unevenly distributed.
  const ribCount = Math.max(5, Math.round(d.radial * 0.5));
  for (let i = 0; i < ribCount; i++) {
    const yaw = (i / ribCount) * Math.PI * 2 + rng() * 0.08;
    const rib = new THREE.BoxGeometry(0.14, H * (0.86 + rng() * 0.1), 0.1);
    parts.add('trim', rib, xform(Math.sin(yaw) * (R + 0.06), 0, Math.cos(yaw) * (R + 0.06), 0, yaw, 0));
  }

  // Ceiling light ring + deck edge lighting.
  const ring = new THREE.TorusGeometry(R * 0.62, 0.055, 5, d.radial + 8);
  parts.add('glow', ring, xform(0, H / 2 - 0.24, 0, Math.PI / 2, 0, 0));
  const edge = new THREE.TorusGeometry(R - 0.3, 0.03, 4, d.radial + 6);
  parts.add('glow', edge, xform(0, -H / 2 + 0.24, 0, Math.PI / 2, 0, 0));

  // A few exterior greebles: pumps, sensor booms, patch plates.
  for (let i = 0; i < d.greebles; i++) {
    const yaw = rng() * Math.PI * 2;
    const y = (rng() - 0.5) * H * 0.7;
    const kind = rng();
    const geo = kind < 0.5
      ? new THREE.BoxGeometry(0.3 + rng() * 0.3, 0.16 + rng() * 0.2, 0.12)
      : new THREE.CylinderGeometry(0.07, 0.07, 0.4 + rng() * 0.5, 6, 1);
    parts.add('trim', geo, xform(Math.sin(yaw) * (R + 0.1), y, Math.cos(yaw) * (R + 0.1), rng() * 0.3, yaw, 0));
  }
}

function buildHatch(parts: Parts, seed: number, d: Detail): void {
  const rng = mulberry32(seed);
  const R = 1.0;
  const ring = new THREE.CylinderGeometry(R, R + 0.08, 0.42, d.radial + 4, 1, true);
  ring.rotateX(Math.PI / 2);
  parts.add('hull', ring, xform(0, 0, 0.21));
  const collar = new THREE.TorusGeometry(R + 0.05, 0.09, 6, d.radial + 4);
  parts.add('trim', collar, xform(0, 0, 0.42));
  const gasket = new THREE.TorusGeometry(R - 0.04, 0.06, 5, d.radial + 4);
  parts.add('rubber', gasket, xform(0, 0, 0.06));

  // Door: a shallow dished disc, dogged shut with six latches.
  const door = new THREE.SphereGeometry(R * 1.5, d.radial + 4, 8, 0, Math.PI * 2, 0, 0.42);
  door.scale(1, 0.42, 1);
  door.rotateX(-Math.PI / 2);
  roughen(door, 0.012, 2.4, seed * 0.07);
  parts.add('hull', door, xform(0, 0, 0.36));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.1;
    const latch = new THREE.BoxGeometry(0.16, 0.07, 0.1);
    parts.add('trim', latch, xform(Math.cos(a) * (R - 0.1), Math.sin(a) * (R - 0.1), 0.44, 0, 0, a));
  }

  // Wheel: hub + spokes + rim.
  const rim = new THREE.TorusGeometry(0.34, 0.045, 6, 18);
  parts.add('trim', rim, xform(0, 0, 0.52));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.045, 0.34, 0.045);
    parts.add('trim', spoke, xform(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.52, 0, 0, a + Math.PI / 2));
  }
  const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 8, 1);
  hub.rotateX(Math.PI / 2);
  parts.add('trim', hub, xform(0, 0, 0.53));

  const lamp = new THREE.BoxGeometry(0.3, 0.07, 0.03);
  parts.add('glow', lamp, xform(0, R - 0.18, 0.45));
  boltRing(parts, 'trim', 0, 0, 0.02, 'z', R + 0.1, 14, 0.04, 0.08, seed + 5);
  void d;
}

function buildWindow(parts: Parts, seed: number, d: Detail): void {
  const w = 1.05;
  const h = 0.78;
  // Frame: four bevelled members, each slightly different.
  const rng = mulberry32(seed);
  const members: Array<[number, number, number, number, number]> = [
    [0, h, w * 2 + 0.2, 0.14, 0.22],
    [0, -h, w * 2 + 0.2, 0.14, 0.22],
    [w, 0, 0.14, h * 2 + 0.2, 0.22],
    [-w, 0, 0.14, h * 2 + 0.2, 0.22],
  ];
  for (const [x, y, bw, bh, bd] of members) {
    const b = new THREE.BoxGeometry(bw, bh, bd * (0.9 + rng() * 0.2));
    parts.add('trim', b, xform(x, y, 0.02));
  }
  const gasket = new THREE.BoxGeometry(w * 2, h * 2, 0.06);
  parts.add('rubber', gasket, xform(0, 0, -0.02));

  // Pane: a shallow spherical cap so it catches a specular sweep.
  const pane = new THREE.SphereGeometry(2.2, 24, 12, 0, 0.52, Math.PI / 2 - 0.2, 0.4);
  pane.scale(0.5, 0.5, 0.12);
  pane.rotateY(-0.26);
  parts.add('glass', pane, xform(0, 0, 0.06, 0, 0, 0, 1, 1, 1));

  boltRing(parts, 'trim', 0, 0, 0.06, 'z', Math.min(w, h) + 0.28, 10, 0.035, 0.07, seed + 11);
  void d;
}

function buildMoonpool(parts: Parts, seed: number, d: Detail): void {
  const rng = mulberry32(seed);
  const HX = 4.2;
  const HZ = 3.2;
  const HY = 2.2;

  // Frame: four walls around an open bay.
  const walls: Array<[number, number, number, number, number, number]> = [
    [0, 0, HZ, HX * 2, HY * 2, 0.5],
    [0, 0, -HZ, HX * 2, HY * 2, 0.5],
    [HX, 0, 0, 0.5, HY * 2, HZ * 2],
    [-HX, 0, 0, 0.5, HY * 2, HZ * 2],
  ];
  for (const [x, y, z, sx, sy, sz] of walls) {
    const b = new THREE.BoxGeometry(sx, sy, sz, 3, 3, 3);
    roughen(b, 0.02, 0.9, seed + x + z);
    parts.add('hull', b, xform(x, y, z));
  }
  // Roof with a hatch collar; floor is an open rectangular lip.
  const roof = new THREE.BoxGeometry(HX * 2, 0.4, HZ * 2, 3, 1, 3);
  parts.add('hull', roof, xform(0, HY, 0));
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
    const lip = new THREE.BoxGeometry(sx ? 0.9 : HX * 2, 0.35, sz ? 0.9 : HZ * 2);
    parts.add('trim', lip, xform(sx * (HX - 0.45), -HY + 0.18, sz * (HZ - 0.45)));
  }

  // Rounded corner columns kill the "box" read.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const col = new THREE.CylinderGeometry(0.42, 0.5, HY * 2, d.radial, 1);
      parts.add('trim', col, xform(sx * HX, 0, sz * HZ));
    }
  }

  // Docking clamps hanging over the bay.
  for (const sx of [-1, 1]) {
    const arm = new THREE.BoxGeometry(1.1, 0.22, 0.3);
    parts.add('trim', arm, xform(sx * 1.7, HY - 0.5, 0, 0, 0, sx * 0.12));
    const pad = new THREE.CylinderGeometry(0.28, 0.22, 0.16, 10, 1);
    parts.add('rubber', pad, xform(sx * 2.2, HY - 0.72, 0));
    const piston = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 8, 1);
    parts.add('trim', piston, xform(sx * 1.2, HY - 0.85, 0));
  }

  // Port collars.
  for (const sx of [-1, 1]) {
    const collar = new THREE.CylinderGeometry(CORRIDOR_RADIUS + 0.1, CORRIDOR_RADIUS + 0.18, 0.4, d.radial, 1, true);
    collar.rotateZ(Math.PI / 2);
    parts.add('trim', collar, xform(sx * (HX + 0.05), 0, 0));
    const gasket = new THREE.TorusGeometry(CORRIDOR_RADIUS + 0.02, 0.05, 5, d.radial);
    parts.add('rubber', gasket, xform(sx * HX, 0, 0, 0, Math.PI / 2, 0));
  }

  // Bay lighting: strips down all four lips, plus corner spots.
  for (const sz of [-1, 1]) {
    const strip = new THREE.BoxGeometry(HX * 1.6, 0.06, 0.1);
    parts.add('glow', strip, xform(0, -HY + 0.42, sz * (HZ - 0.5)));
  }
  for (const sx of [-1, 1]) {
    const spot = new THREE.SphereGeometry(0.14, 8, 6);
    parts.add('glow', spot, xform(sx * (HX - 0.7), HY - 0.34, HZ - 0.7));
  }

  // Panel greebles + pumps.
  for (let i = 0; i < d.greebles; i++) {
    const side = rng() < 0.5 ? 1 : -1;
    const geo = rng() < 0.5
      ? new THREE.BoxGeometry(0.4 + rng() * 0.5, 0.3 + rng() * 0.3, 0.2)
      : new THREE.CylinderGeometry(0.18, 0.18, 0.6 + rng() * 0.5, 8, 1);
    parts.add('trim', geo, xform((rng() - 0.5) * HX * 1.6, (rng() - 0.5) * HY * 1.2, side * (HZ + 0.3), 0, 0, rng()));
  }
}

function buildSolarPanel(parts: Parts, seed: number, d: Detail): void {
  const rng = mulberry32(seed);
  const pole = new THREE.CylinderGeometry(0.11, 0.16, 1.5, d.radial, 1);
  parts.add('trim', pole, xform(0, 0.75, 0));
  const foot = new THREE.CylinderGeometry(0.5, 0.62, 0.16, d.radial + 2, 1);
  parts.add('hull', foot, xform(0, 0.08, 0));
  const joint = new THREE.SphereGeometry(0.2, 10, 8);
  parts.add('trim', joint, xform(0, 1.5, 0));

  const tiltX = -0.5 - rng() * 0.25;
  const yaw = rng() * Math.PI * 2;
  // Backing plate + cell surface + frame.
  const back = new THREE.BoxGeometry(2.2, 0.09, 1.5);
  parts.add('hull', back, xform(0, 1.62, 0, tiltX, yaw, 0));
  const cells = new THREE.BoxGeometry(2.05, 0.03, 1.36);
  parts.add('glass', cells, xform(0, 1.69, 0, tiltX, yaw, 0));
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.BoxGeometry(0.03, 0.035, 1.36);
    const off = (i / 4 - 0.5) * 1.9;
    const m = xform(0, 1.7, 0, tiltX, yaw, 0);
    bar.translate(off, 0, 0);
    parts.add('trim', bar, m);
  }
  const rim = new THREE.TorusGeometry(1.1, 0.05, 4, 4);
  rim.scale(1, 0.68, 1);
  parts.add('trim', rim, xform(0, 1.63, 0, tiltX + Math.PI / 2, yaw, 0));

  const led = new THREE.BoxGeometry(0.1, 0.06, 0.03);
  parts.add('glow', led, xform(0, 1.15, 0.13));
  void d;
}

function buildThermalPlant(parts: Parts, seed: number, d: Detail): void {
  const rng = mulberry32(seed);
  const base = new THREE.CylinderGeometry(1.3, 1.55, 0.55, d.radial + 4, 1);
  roughen(base, 0.02, 1.2, seed * 0.02);
  parts.add('hull', base, xform(0, 0.27, 0));

  // Stack: three stepped cylinders, each slightly off-axis.
  let y = 0.55;
  for (let i = 0; i < 3; i++) {
    const h = 0.75 - i * 0.12;
    const r = 0.62 - i * 0.11;
    const seg = new THREE.CylinderGeometry(r * 0.94, r, h, d.radial, 1);
    parts.add('hull', seg, xform((rng() - 0.5) * 0.06, y + h / 2, (rng() - 0.5) * 0.06));
    const band = new THREE.TorusGeometry(r + 0.03, 0.055, 5, d.radial);
    parts.add('trim', band, xform(0, y + h, 0, Math.PI / 2, 0, 0));
    y += h;
  }

  // Heat-exchanger coil.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const coil = new THREE.TorusGeometry(0.78 + t * 0.06, 0.05, 5, Math.max(12, d.radial));
    parts.add('trim', coil, xform(0, 0.62 + t * 1.5, 0, Math.PI / 2, 0, 0));
  }

  // Radiator fins, uneven count and length.
  const fins = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < fins; i++) {
    const a = (i / fins) * Math.PI * 2 + rng() * 0.15;
    const len = 0.7 + rng() * 0.45;
    const fin = new THREE.BoxGeometry(len, 1.5 + rng() * 0.5, 0.06);
    parts.add('trim', fin, xform(Math.cos(a) * (0.9 + len / 2), 1.2, Math.sin(a) * (0.9 + len / 2), 0, -a, 0));
  }

  // Intake hose to the vent + glowing exhaust ports.
  const hose = new THREE.CylinderGeometry(0.14, 0.14, 1.6, 8, 1);
  parts.add('rubber', hose, xform(0.9, 0.35, 0.5, 0, 0, 1.25));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const port = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8, 1);
    port.rotateZ(Math.PI / 2);
    parts.add('glow', port, xform(Math.cos(a) * 0.52, 2.4, Math.sin(a) * 0.52, 0, -a, 0));
  }
}

function buildTank(parts: Parts, seed: number, d: Detail, opts: {
  w: number; h: number; depth: number; glass: boolean; ports: number; lamp: boolean;
}): void {
  const rng = mulberry32(seed);
  const body = new THREE.BoxGeometry(opts.w, opts.h, opts.depth, 2, 3, 2);
  roughen(body, 0.012, 1.6, seed * 0.03);
  parts.add('hull', body, xform(0, opts.h / 2, 0));

  // Corner posts.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.CylinderGeometry(0.055, 0.07, opts.h, 6, 1);
      parts.add('trim', post, xform(sx * opts.w / 2, opts.h / 2, sz * opts.depth / 2));
    }
  }
  // Top cap + handle.
  const cap = new THREE.BoxGeometry(opts.w * 1.04, 0.1, opts.depth * 1.04);
  parts.add('trim', cap, xform(0, opts.h, 0));
  const handle = new THREE.TorusGeometry(0.14, 0.03, 5, 12, Math.PI);
  parts.add('trim', handle, xform(0, opts.h + 0.05, opts.depth * 0.3, 0, 0, 0));

  if (opts.glass) {
    const win = new THREE.CylinderGeometry(opts.w * 0.34, opts.w * 0.34, opts.h * 0.5, 14, 1, true);
    parts.add('glass', win, xform(0, opts.h * 0.55, 0));
  }
  for (let i = 0; i < opts.ports; i++) {
    const a = rng() * Math.PI * 2;
    const port = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 7, 1);
    port.rotateZ(Math.PI / 2);
    parts.add('rubber', port, xform(Math.cos(a) * opts.w * 0.5, 0.25 + rng() * (opts.h - 0.5), Math.sin(a) * opts.depth * 0.5, 0, -a, 0));
  }
  if (opts.lamp) {
    const gauge = new THREE.BoxGeometry(opts.w * 0.34, 0.12, 0.02);
    parts.add('glow', gauge, xform(0, opts.h * 0.78, opts.depth / 2 + 0.01));
  }
  void d;
}

function buildLocker(parts: Parts, seed: number, d: Detail): void {
  const rng = mulberry32(seed);
  const body = new THREE.BoxGeometry(1.2, 1.8, 0.7, 2, 3, 2);
  parts.add('hull', body, xform(0, 0, -0.02));
  // Two doors with a centre seam and offset hinges.
  for (const s of [-1, 1]) {
    const door = new THREE.BoxGeometry(0.56, 1.68, 0.07);
    parts.add('trim', door, xform(s * 0.3, 0, 0.36, 0, 0, s * rng() * 0.02));
    const handle = new THREE.BoxGeometry(0.06, 0.3, 0.05);
    parts.add('trim', handle, xform(s * 0.06, 0, 0.42));
    for (let i = 0; i < 3; i++) {
      const hinge = new THREE.CylinderGeometry(0.045, 0.045, 0.14, 7, 1);
      parts.add('trim', hinge, xform(s * 0.58, (i - 1) * 0.62, 0.33));
    }
  }
  const label = new THREE.BoxGeometry(0.42, 0.12, 0.02);
  parts.add('glow', label, xform(0, 0.68, 0.4));
  void d;
}

function buildWallStation(parts: Parts, seed: number, d: Detail, opts: { w: number; h: number; arm: boolean }): void {
  const rng = mulberry32(seed);
  const back = new THREE.BoxGeometry(opts.w, opts.h, 0.28, 2, 2, 1);
  parts.add('hull', back, xform(0, 0, -0.02));
  const bezel = new THREE.BoxGeometry(opts.w * 1.06, opts.h * 1.06, 0.08);
  parts.add('trim', bezel, xform(0, 0, 0.14));
  // Screen + status strip.
  const screen = new THREE.BoxGeometry(opts.w * 0.7, opts.h * 0.42, 0.02);
  parts.add('glow', screen, xform(0, opts.h * 0.22, 0.19));
  const strip = new THREE.BoxGeometry(opts.w * 0.8, 0.05, 0.02);
  parts.add('glow', strip, xform(0, -opts.h * 0.34, 0.19));

  if (opts.arm) {
    // Fold-out print head on a two-segment arm.
    const a1 = new THREE.BoxGeometry(0.09, 0.09, 0.55);
    parts.add('trim', a1, xform(0, -opts.h * 0.05, 0.36, 0.5, 0, 0));
    const a2 = new THREE.BoxGeometry(0.08, 0.08, 0.4);
    parts.add('trim', a2, xform(0, -opts.h * 0.3, 0.6, -0.6, 0, 0));
    const head = new THREE.CylinderGeometry(0.11, 0.07, 0.16, 8, 1);
    parts.add('trim', head, xform(0, -opts.h * 0.42, 0.72));
    const beam = new THREE.CylinderGeometry(0.02, 0.09, 0.34, 8, 1);
    parts.add('glow', beam, xform(0, -opts.h * 0.62, 0.72));
  }
  for (let i = 0; i < 4; i++) {
    const bolt = new THREE.CylinderGeometry(0.03, 0.035, 0.06, 6, 1);
    bolt.rotateX(Math.PI / 2);
    parts.add('trim', bolt, xform((i & 1 ? 1 : -1) * opts.w * 0.46, (i & 2 ? 1 : -1) * opts.h * 0.44, 0.17));
  }
  void rng;
  void d;
}

function buildGrowbed(parts: Parts, seed: number, d: Detail): void {
  const rng = mulberry32(seed);
  const tray = new THREE.BoxGeometry(2.6, 0.35, 1.8, 3, 1, 2);
  parts.add('hull', tray, xform(0, 0.18, 0));
  const rim = new THREE.BoxGeometry(2.72, 0.12, 1.92);
  parts.add('trim', rim, xform(0, 0.38, 0));
  // Substrate: a noisy plane so it does not read as a flat box lid.
  const soil = new THREE.PlaneGeometry(2.4, 1.6, 12, 8);
  soil.rotateX(-Math.PI / 2);
  const sp = soil.getAttribute('position').array as Float32Array;
  for (let i = 0; i < sp.length; i += 3) {
    sp[i + 1] += SHARED_NOISE.fbm2(sp[i] * 2.2 + seed, sp[i + 2] * 2.2, 3) * 0.05;
  }
  soil.computeVertexNormals();
  parts.add('interior', soil, xform(0, 0.34, 0));
  // Glass sides.
  for (const sz of [-1, 1]) {
    const pane = new THREE.BoxGeometry(2.36, 0.2, 0.03);
    parts.add('glass', pane, xform(0, 0.26, sz * 0.9));
  }
  // Grow-light gantry.
  for (const sx of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 7, 1);
    parts.add('trim', post, xform(sx * 1.2, 0.8, 0));
  }
  const bar = new THREE.BoxGeometry(2.5, 0.09, 0.16);
  parts.add('trim', bar, xform(0, 1.24, 0));
  for (let i = 0; i < 4; i++) {
    const lamp = new THREE.BoxGeometry(0.5, 0.04, 0.11);
    parts.add('glow', lamp, xform((i / 3 - 0.5) * 2.0, 1.17, (rng() - 0.5) * 0.05));
  }
  void d;
}

function buildBulkhead(parts: Parts, seed: number, d: Detail): void {
  // A curved plasteel rib clamped to the inside of the hull.
  const rib = new THREE.TorusGeometry(1.42, 0.13, 6, Math.max(14, d.radial), Math.PI * 0.9);
  rib.rotateZ(Math.PI * 0.05);
  parts.add('hull', rib, xform(0, 0, 0));
  const plate = new THREE.BoxGeometry(0.5, 0.5, 0.09);
  parts.add('trim', plate, xform(0, 1.42, 0));
  boltRing(parts, 'trim', 0, 0, 0, 'z', 1.42, 12, 0.05, 0.14, seed);
  const led = new THREE.BoxGeometry(0.22, 0.04, 0.02);
  parts.add('glow', led, xform(0, 1.42, 0.06));
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

const TINTS: Record<MaterialBucket, THREE.Color> = {
  hull: new THREE.Color(0.86, 0.84, 0.79),
  trim: new THREE.Color(0.62, 0.64, 0.67),
  interior: new THREE.Color(0.9, 0.9, 0.88),
  rubber: new THREE.Color(0.34, 0.35, 0.36),
  glass: new THREE.Color(0.8, 0.92, 0.95),
  glow: new THREE.Color(1, 1, 1),
};

/**
 * Builds one placement's meshes. `seed` must differ per placed piece so no two
 * instances in a frame share a silhouette.
 */
export function buildPieceGeometry(def: BuildPieceDef, seed: number, tier: QualityTier): PieceGeometry {
  const d = detailFor(tier);
  const parts = new Parts();

  switch (def.id) {
    case 'foundation': buildFoundation(parts, seed, d); break;
    case 'corridor_straight': buildCorridorStraight(parts, seed, d); break;
    case 'corridor_bend': buildCorridorBend(parts, seed, d); break;
    case 'corridor_tee':
      buildJunction(parts, seed, d, [[0, 0, 1], [0, 0, -1], [1, 0, 0]]);
      break;
    case 'corridor_cross':
      buildJunction(parts, seed, d, [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]]);
      break;
    case 'room_multipurpose': buildRoom(parts, seed, d); break;
    case 'moonpool': buildMoonpool(parts, seed, d); break;
    case 'hatch': buildHatch(parts, seed, d); break;
    case 'window': buildWindow(parts, seed, d); break;
    case 'solar_panel': buildSolarPanel(parts, seed, d); break;
    case 'thermal_plant': buildThermalPlant(parts, seed, d); break;
    case 'nuclear_reactor':
      buildTank(parts, seed, d, { w: 1.5, h: 1.9, depth: 1.5, glass: false, ports: 4, lamp: true });
      break;
    case 'bioreactor':
      buildTank(parts, seed, d, { w: 1.0, h: 1.55, depth: 1.0, glass: true, ports: 3, lamp: true });
      break;
    case 'water_filtration':
      buildTank(parts, seed, d, { w: 0.85, h: 1.65, depth: 0.65, glass: true, ports: 4, lamp: true });
      break;
    case 'locker': buildLocker(parts, seed, d); break;
    case 'fabricator_wall': buildWallStation(parts, seed, d, { w: 1.0, h: 1.5, arm: true }); break;
    case 'workbench': buildWallStation(parts, seed, d, { w: 1.5, h: 1.9, arm: true }); break;
    case 'growbed': buildGrowbed(parts, seed, d); break;
    case 'reinforced_bulkhead': buildBulkhead(parts, seed, d); break;
    default: {
      // Unknown piece: a chamfered crate, still textured and worn rather than a
      // naked box, so a data error never produces programmer art.
      const box = new THREE.BoxGeometry(def.extents[0] * 2, def.extents[1] * 2, def.extents[2] * 2, 2, 2, 2);
      roughen(box, 0.02, 1.5, seed);
      parts.add('hull', box);
      boltRing(parts, 'trim', 0, 0, def.extents[2], 'z', Math.min(def.extents[0], def.extents[1]) * 0.7, 8, 0.04, 0.07, seed);
      break;
    }
  }

  // Merge buckets, then bake vertex colours against the final bounds.
  const out: PieceGeometry = {
    hull: mergeBucket(parts.take('hull')),
    trim: mergeBucket(parts.take('trim')),
    interior: mergeBucket(parts.take('interior')),
    rubber: mergeBucket(parts.take('rubber')),
    glass: mergeBucket(parts.take('glass')),
    glow: mergeBucket(parts.take('glow')),
    bounds: new THREE.Box3(),
  };

  const all: Array<[MaterialBucket, THREE.BufferGeometry | null]> = [
    ['hull', out.hull], ['trim', out.trim], ['interior', out.interior],
    ['rubber', out.rubber], ['glass', out.glass], ['glow', out.glow],
  ];
  for (const [, geo] of all) {
    if (!geo) continue;
    geo.computeBoundingBox();
    if (geo.boundingBox) out.bounds.union(geo.boundingBox);
  }
  if (out.bounds.isEmpty()) {
    out.bounds.set(
      new THREE.Vector3(-def.extents[0], -def.extents[1], -def.extents[2]),
      new THREE.Vector3(def.extents[0], def.extents[1], def.extents[2]),
    );
  }
  for (const [bucket, geo] of all) {
    if (!geo) continue;
    // Glass and glow are shaded by their own materials; the rest carry wear.
    if (bucket === 'glass' || bucket === 'glow') continue;
    paint(geo, seed + bucket.length * 977, TINTS[bucket], out.bounds);
  }
  return out;
}

export function disposePieceGeometry(pg: PieceGeometry): void {
  pg.hull?.dispose();
  pg.trim?.dispose();
  pg.interior?.dispose();
  pg.rubber?.dispose();
  pg.glass?.dispose();
  pg.glow?.dispose();
}

/** Coarse convex-ish box used for the ghost preview and collision. */
export function pieceBoundsFor(def: BuildPieceDef): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(-def.extents[0], -def.extents[1], -def.extents[2]),
    new THREE.Vector3(def.extents[0], def.extents[1], def.extents[2]),
  );
}

export { ROOM_RADIUS, ROOM_HEIGHT, CORRIDOR_RADIUS, CORRIDOR_LENGTH };

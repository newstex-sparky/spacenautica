/**
 * Set-piece geometry: the broken ship hull you can swim into, the crashed
 * escape pod, and the precursor structure.
 *
 * These are the frame's landmarks, so they are built as individual meshes
 * (frustum-culled per object, shadow casting) rather than batched instances.
 *
 * The hull is a two-shell construction: an outer plated skin and an inset
 * interior liner, both torn by the *same* noise field so the rips line up and
 * the gap between the shells reads as plate thickness. Interior ambient
 * occlusion is baked from the distance to the nearest opening, which is what
 * makes the inside actually go dark and brighten as you approach a tear.
 */
import * as THREE from 'three';
import { Noise, mulberry32 } from '../../core/Noise';
import {
  adjacency, appendSoft, bakeCavityAO, boundsOf, dropFaces, emptySoft, gridSurface,
  laplacian, markBoundaryWear, superBox, toGeometry, transformSoft,
} from './GeoUtil';
import type { SoftMesh } from './GeoUtil';
import type { PropMatId } from './PropMaterials';

const _m4 = new THREE.Matrix4();
const _box = new THREE.Box3();
const _v = new THREE.Vector3();

export interface WreckLight {
  pos: THREE.Vector3;
  color: number;
  intensity: number;
  distance: number;
  /** 0 = steady, 1 = badly failing emergency lamp. */
  flicker: number;
}

export interface WreckPart {
  mat: PropMatId;
  geo: THREE.BufferGeometry;
  castShadow: boolean;
}

export interface WreckBuild {
  parts: WreckPart[];
  lights: WreckLight[];
  /** Lootable containers, local space. */
  containers: Array<{ pos: THREE.Vector3; yaw: number }>;
  /** Sphere markers describing enclosed interior volume (HUD / audio / fog). */
  interior: Array<{ pos: THREE.Vector3; radius: number }>;
  /** Local bounding radius, for placement and culling. */
  radius: number;
  /** How far below the terrain the local origin should sit. */
  sink: number;
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

/**
 * Bakes interior darkness: AO falls off with distance from the nearest opening.
 * `floorAO` is how black the deepest recess is allowed to get.
 */
function bakeInteriorAO(
  m: SoftMesh, portals: Array<{ p: THREE.Vector3; r: number }>, falloff: number, floorAO: number,
): void {
  for (let i = 0; i < m.verts.length; i++) {
    let best = Infinity;
    for (const q of portals) best = Math.min(best, _v.subVectors(m.verts[i], q.p).length() - q.r);
    const d = Math.max(0, best);
    const open = Math.exp(-d / falloff);
    m.surf[i].x *= floorAO + (1 - floorAO) * open;
  }
}

/* ------------------------------------------------------------------ *
 * Broken ship hull section
 * ------------------------------------------------------------------ */

export function makeHullSection(seed: number): WreckBuild {
  const noise = new Noise(seed ^ 0x5c1f);
  const rng = mulberry32(seed);
  const L = 30;                       // length along local Z
  const R = 6.4;                      // outer radius
  const RADIAL = 34;
  const SLICES = 26;

  /** Shared tear field. > 0 keeps the plate. */
  const tear = (x: number, y: number, z: number): number => {
    const n = noise.fbm3(x * 0.26, y * 0.26, z * 0.26, 4) * 0.5 + 0.5;
    const endT = smooth01(0.34, 0.5, Math.abs(z) / L);
    const a = Math.atan2(y, x);
    // a lens-shaped gash torn out of the upper flank
    const dz = (z - 3.5) / 6.5;
    const da = (a - 1.05) / 0.62;
    const gash = Math.exp(-(dz * dz + da * da));
    // a second, smaller puncture near the bow
    const dz2 = (z + 9) / 3.2;
    const da2 = (a + 2.1) / 0.5;
    const hole = Math.exp(-(dz2 * dz2 + da2 * da2));
    return n - endT * 0.62 - gash * 0.85 - hole * 0.8 - 0.3;
  };

  const skin = (scale: number): SoftMesh => gridSurface(RADIAL, SLICES, (u, v, out) => {
    const ang = u * Math.PI * 2;
    const z = (v - 0.5) * L;
    // hull tapers toward the torn stern and carries long plate bulges
    const taper = 1 - 0.16 * smooth01(0.1, 1, v);
    const bulge = 1 + 0.035 * Math.sin(ang * 6 + z * 0.35) + 0.045 * noise.fbm2(ang * 1.6, z * 0.22);
    const r = R * scale * taper * bulge;
    out.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.9, z);
  }, true);

  const outer = skin(1);
  const inner = skin(0.955);
  const keep = (c: THREE.Vector3) => tear(c.x, c.y / 0.9, c.z) > 0;
  dropFaces(outer, keep);
  dropFaces(inner, keep);

  // Openings we treat as light portals for the interior AO bake.
  const portals = [
    { p: new THREE.Vector3(0, 0, -L * 0.5), r: R * 0.9 },
    { p: new THREE.Vector3(0, 0, L * 0.5), r: R * 0.9 },
    { p: new THREE.Vector3(Math.cos(1.05) * R, Math.sin(1.05) * R * 0.9, 3.5), r: R * 0.55 },
    { p: new THREE.Vector3(Math.cos(-2.1) * R, Math.sin(-2.1) * R * 0.9, -9), r: R * 0.3 },
  ];

  {
    const adj = adjacency(outer);
    bakeCavityAO(outer, adj, 0.9, 0.35);
    markBoundaryWear(outer, 1, 2);
    for (let i = 0; i < outer.verts.length; i++) {
      const v = outer.verts[i];
      outer.surf[i].z = Math.min(1, 0.35 + 0.75 * (noise.fbm3(v.x * 0.5, v.y * 0.5, v.z * 0.5, 3) * 0.5 + 0.5));
    }
  }
  {
    const adj = adjacency(inner);
    bakeCavityAO(inner, adj, 0.9, 0.4);
    markBoundaryWear(inner, 1, 2);
    for (let i = 0; i < inner.verts.length; i++) inner.surf[i].z = 0.12;
    bakeInteriorAO(inner, portals, 5.5, 0.1);
  }

  const parts: WreckPart[] = [];
  parts.push({ mat: 'hull_painted', geo: toGeometry(outer, { facet: 0.28 }), castShadow: true });
  parts.push({ mat: 'hull_interior', geo: toGeometry(inner, { facet: 0.3, flip: true }), castShadow: false });

  /* --- interior structure: deck, ribs, bulkhead ------------------- */
  const structure = emptySoft();

  // deck plating, torn open in places so you can drop to the bilge
  const deckY = -R * 0.42;
  const deck = gridSurface(18, 22, (u, v, out) => {
    const z = (v - 0.5) * (L * 0.9);
    const halfW = Math.sqrt(Math.max(0, 1 - (deckY / (R * 0.9)) ** 2)) * R * 0.94;
    out.set((u - 0.5) * 2 * halfW, deckY + 0.1 * noise.fbm2(u * 6, v * 9), z);
  });
  dropFaces(deck, (c) => noise.fbm3(c.x * 0.5 + 20, c.y, c.z * 0.5, 3) * 0.5 + 0.5 > 0.24);
  markBoundaryWear(deck, 1, 2);
  appendSoft(structure, deck);

  // ring frames
  for (let i = 0; i < 6; i++) {
    const z = -L * 0.4 + (i / 5) * L * 0.8;
    const rib = gridSurface(RADIAL, 2, (u, v, out) => {
      const ang = u * Math.PI * 2;
      const r = R * (0.9 - v * 0.13);
      out.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.9, z + (v - 0.5) * 0.34);
    }, true);
    dropFaces(rib, (c) => tear(c.x / 0.9, c.y / 0.82, c.z) > -0.25);
    markBoundaryWear(rib, 1, 1);
    appendSoft(structure, rib);
  }

  // a bulkhead with a doorway you can swim through
  const bulk = gridSurface(RADIAL, 7, (u, v, out) => {
    const ang = u * Math.PI * 2;
    const r = R * 0.9 * (0.18 + 0.82 * v);
    out.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.9, 6.5 + 0.06 * Math.sin(ang * 8));
  }, true);
  dropFaces(bulk, (c) => !(Math.abs(c.x) < 1.15 && c.y > deckY - 0.2 && c.y < deckY + 2.6));
  markBoundaryWear(bulk, 1, 2);
  appendSoft(structure, bulk);

  {
    const adj = adjacency(structure);
    bakeCavityAO(structure, adj, 1, 0.3);
    for (const s of structure.surf) s.z = 0.1;
    bakeInteriorAO(structure, portals, 5, 0.12);
  }
  parts.push({ mat: 'hull_interior', geo: toGeometry(structure, { facet: 0.4 }), castShadow: false });

  /* --- fittings: lamp housing, pipes, a lootable locker ---------- */
  const fittings = emptySoft();
  const lampPos = new THREE.Vector3(0.4, R * 0.42, 1.5);
  const lamp = superBox(0.34, 0.16, 0.2, 10, 2);
  _m4.makeTranslation(lampPos.x, lampPos.y, lampPos.z);
  appendSoft(fittings, lamp, _m4);
  for (let i = 0; i < 5; i++) {
    const z = -L * 0.35 + rng() * L * 0.7;
    const pipe = gridSurface(8, 6, (u, v, out) => {
      const a = u * Math.PI * 2;
      const rr = 0.075 + 0.03 * rng();
      out.set(Math.cos(a) * rr, Math.sin(a) * rr, (v - 0.5) * (3 + rng() * 5));
    }, true);
    const ang = 0.9 + rng() * 2.6;
    _m4.makeTranslation(Math.cos(ang) * R * 0.78, Math.sin(ang) * R * 0.72, z);
    appendSoft(fittings, pipe, _m4);
  }
  {
    const adj = adjacency(fittings);
    bakeCavityAO(fittings, adj, 1, 0.3);
    for (const s of fittings.surf) s.z = 0.25;
    bakeInteriorAO(fittings, portals, 5, 0.15);
  }
  parts.push({ mat: 'hull_interior', geo: toGeometry(fittings, { facet: 0.6 }), castShadow: false });

  boundsOf(outer, _box);
  return {
    parts,
    lights: [
      { pos: lampPos.clone().add(new THREE.Vector3(0, -0.3, 0)), color: 0xffb46a, intensity: 26, distance: 22, flicker: 0.8 },
      { pos: new THREE.Vector3(0, deckY + 1.6, -8), color: 0x6ad0ff, intensity: 8, distance: 14, flicker: 0.15 },
    ],
    containers: [{ pos: new THREE.Vector3(1.6, deckY + 0.42, -3.2), yaw: 0.6 }],
    interior: [
      { pos: new THREE.Vector3(0, 0, -6), radius: R * 0.85 },
      { pos: new THREE.Vector3(0, 0, 2), radius: R * 0.85 },
    ],
    radius: Math.max(_box.max.length(), _box.min.length()),
    sink: R * 0.42,
  };
}

/* ------------------------------------------------------------------ *
 * Crashed escape pod
 * ------------------------------------------------------------------ */

export function makeEscapePod(seed: number): WreckBuild {
  const noise = new Noise(seed ^ 0x2ac9);
  const rng = mulberry32(seed);
  const shell = emptySoft();

  // Ovoid pressure hull with a crumpled, scorched flank.
  const body = gridSurface(28, 20, (u, v, out) => {
    const ang = u * Math.PI * 2;
    const th = v * Math.PI;
    const r = 1.65 * (1 + 0.06 * noise.fbm2(ang * 2, v * 4));
    const dent = 0.82 + 0.18 * smooth01(0.2, 0.9, Math.cos(ang - 2.2) * Math.sin(th));
    out.set(
      Math.cos(ang) * Math.sin(th) * r * dent,
      -Math.cos(th) * r * 1.28,
      Math.sin(ang) * Math.sin(th) * r * dent,
    );
  }, true);
  {
    const adj = adjacency(body);
    laplacian(body, adj, 1, 0.2);
    bakeCavityAO(body, adj, 1, 0.28);
    for (let i = 0; i < body.verts.length; i++) {
      const p = body.verts[i];
      // scorch/damage concentrated on the impact flank
      body.surf[i].y = Math.min(1, Math.max(0, 0.15 + 0.85 * smooth01(0.1, 1.4, -p.x - p.y * 0.4)));
      body.surf[i].z = Math.min(1, 0.4 + 0.6 * (noise.fbm3(p.x, p.y, p.z, 3) * 0.5 + 0.5)) * smooth01(0.6, -0.6, p.y);
    }
  }
  appendSoft(shell, body);

  // equator flange + hatch ring
  const flange = gridSurface(28, 2, (u, v, out) => {
    const ang = u * Math.PI * 2;
    const r = 1.7 + v * 0.26;
    out.set(Math.cos(ang) * r, 0.1 - v * 0.06, Math.sin(ang) * r);
  }, true);
  appendSoft(shell, flange);

  const hatch = gridSurface(20, 3, (u, v, out) => {
    const ang = u * Math.PI * 2;
    const r = 0.55 + v * 0.16;
    out.set(Math.cos(ang) * r, 1.62 - v * 0.1, Math.sin(ang) * r);
  }, true);
  appendSoft(shell, hatch);

  // antennae, bent
  for (let i = 0; i < 3; i++) {
    const rod = gridSurface(6, 6, (u, v, out) => {
      const a = u * Math.PI * 2;
      const rr = 0.035 * (1 - v * 0.5);
      out.set(Math.cos(a) * rr + v * v * 0.5, v * (0.9 + rng() * 0.8), Math.sin(a) * rr);
    }, true);
    _m4.makeRotationY((i / 3) * Math.PI * 2 + 0.4);
    _m4.setPosition(Math.cos(i * 2.1) * 0.7, 1.5, Math.sin(i * 2.1) * 0.7);
    appendSoft(shell, rod, _m4);
  }

  {
    const adj = adjacency(shell);
    bakeCavityAO(shell, adj, 0.9, 0.3);
  }

  const parts: WreckPart[] = [
    { mat: 'hull_orange', geo: toGeometry(shell, { facet: 0.3 }), castShadow: true },
  ];

  // dark window ports, and the interior we can see through them
  const glass = gridSurface(16, 3, (u, v, out) => {
    const ang = u * Math.PI * 2;
    const r = 0.42 * (1 - v * 0.15);
    out.set(1.34 + v * 0.1, 0.55 + Math.sin(ang) * r * 0.8, Math.cos(ang) * r);
  }, true);
  {
    const adj = adjacency(glass);
    bakeCavityAO(glass, adj, 1, 0.1);
    for (const s of glass.surf) { s.x *= 0.2; s.z = 0; }
  }
  parts.push({ mat: 'hull_interior', geo: toGeometry(glass, { facet: 0.5 }), castShadow: false });

  return {
    parts,
    lights: [
      { pos: new THREE.Vector3(0, 1.75, 0), color: 0xff5a3c, intensity: 16, distance: 18, flicker: 0.95 },
      { pos: new THREE.Vector3(1.5, 0.55, 0), color: 0xffd9a0, intensity: 5, distance: 8, flicker: 0.25 },
    ],
    containers: [{ pos: new THREE.Vector3(-1.15, 0.2, 1.05), yaw: 2.1 }],
    interior: [],
    radius: 2.6,
    sink: 0.9,
  };
}

/* ------------------------------------------------------------------ *
 * Precursor / alien structure
 * ------------------------------------------------------------------ */

export function makePrecursorStructure(seed: number): WreckBuild {
  const rng = mulberry32(seed);
  const body = emptySoft();

  const slab = (
    hx: number, hy: number, hz: number, x: number, y: number, z: number,
    rotY: number, rotZ = 0,
  ) => {
    const s = superBox(hx, hy, hz, 14, 3);
    _m4.makeRotationY(rotY);
    if (rotZ !== 0) _m4.multiply(new THREE.Matrix4().makeRotationZ(rotZ));
    _m4.setPosition(x, y, z);
    appendSoft(body, s, _m4);
  };

  // stepped plinth — three slabs, each turned so it never reads as a box stack
  slab(6.2, 0.55, 6.2, 0, 0.55, 0, 0.0);
  slab(5.0, 0.5, 5.0, 0, 1.5, 0, 0.42);
  slab(3.9, 0.45, 3.9, 0, 2.35, 0, 0.85);

  // portal legs, leaning inward, tapering
  for (const sx of [-1, 1]) {
    slab(0.75, 4.6, 1.05, sx * 3.0, 7.1, 0, 0, sx * -0.075);
    slab(0.55, 1.9, 0.8, sx * 2.35, 12.4, 0, 0, sx * -0.22);
  }
  // lintel + keystone
  slab(3.35, 0.7, 1.25, 0, 13.7, 0, 0);
  slab(1.0, 1.0, 1.0, 0, 15.0, 0, 0.79, 0.62);

  // angled buttresses so the silhouette is not symmetric
  slab(0.45, 3.1, 0.9, -4.4, 3.9, 1.3, 0.5, 0.33);
  slab(0.45, 2.4, 0.8, 4.1, 3.4, -1.7, -0.7, -0.28);

  // a low broken wall fanning out from the plinth
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45 + rng() * 0.1;
    const d = 7.5 + rng() * 3.5;
    slab(0.4, 0.9 + rng() * 1.5, 1.4, Math.cos(a) * d, 0.9, Math.sin(a) * d, a, (rng() - 0.5) * 0.3);
  }

  {
    const adj = adjacency(body);
    bakeCavityAO(body, adj, 1.1, 0.25);
    for (const s of body.surf) { s.y = 0; s.z = 0; }
  }

  return {
    parts: [{ mat: 'precursor', geo: toGeometry(body, { facet: 0.9 }), castShadow: true }],
    lights: [
      { pos: new THREE.Vector3(0, 15.0, 0), color: 0x2ce8d0, intensity: 60, distance: 46, flicker: 0.06 },
      { pos: new THREE.Vector3(0, 3.0, 0), color: 0x7a4bd0, intensity: 22, distance: 24, flicker: 0.03 },
    ],
    containers: [],
    interior: [],
    radius: 12,
    sink: 0.4,
  };
}

/* ------------------------------------------------------------------ *
 * Lootable container
 * ------------------------------------------------------------------ */

/** A dented supply locker with a lid seam. Reused for every wreck. */
export function makeContainer(seed: number): THREE.BufferGeometry {
  const noise = new Noise(seed ^ 0x9911);
  const m = superBox(0.46, 0.34, 0.34, 10, 3);
  for (const v of m.verts) {
    v.multiplyScalar(1 + 0.05 * noise.fbm3(v.x * 5, v.y * 5, v.z * 5, 2));
    // crease a lid line just below the top
    if (Math.abs(v.y - 0.22) < 0.03) v.y -= 0.02;
  }
  const adj = adjacency(m);
  bakeCavityAO(m, adj, 1, 0.3);
  for (const s of m.surf) {
    s.y = 0.3;
    s.z = 0.5;
  }
  transformSoft(m, _m4.makeTranslation(0, 0.34, 0));
  return toGeometry(m, { facet: 0.85 });
}

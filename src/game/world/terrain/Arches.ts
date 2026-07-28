/**
 * Arches — the one part of the sea floor that a heightfield cannot express.
 *
 * Each arch is a swept tube along a flattened, noise-perturbed arc with an
 * asymmetric elliptical cross-section that varies along the span, so no two read
 * the same. They use the terrain material, so their rock matches the cliffs they
 * grow out of, and they expose their swept skeleton for `isSolid` so you can
 * swim under them and bump into the legs.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/Noise';
import type { TerrainField, SetPiece } from './TerrainField';
import type { BiomeMap, BiomeShading } from './Biomes';

const RADIAL = 10;
const SPANS = 30;

export interface ArchBuild {
  geometry: THREE.BufferGeometry;
  /** World-space skeleton: [x, y, z, radius] per node, used by isSolid. */
  skeleton: Float32Array;
  /** World centre + bounding radius for cheap rejection. */
  cx: number;
  cy: number;
  cz: number;
  boundRadius: number;
}

const shade: BiomeShading = { r: 0.7, g: 0.68, b: 0.6, sediment: 0.1, ripple: 0.2 };
const flow = { x: 1, y: 0 };

export function buildArch(field: TerrainField, biomes: BiomeMap, piece: SetPiece): ArchBuild {
  const rnd = mulberry32(piece.seed | 0);
  const span = piece.radius * 0.86;
  const rise = piece.amp * 1.55 + 6;
  const thick = piece.width ?? 3.4;
  const ca = Math.cos(piece.rot);
  const sa = Math.sin(piece.rot);

  // Base height: sink the legs into whichever footing is lower.
  const legLx = piece.x - span * ca;
  const legLz = piece.z - span * sa;
  const legRx = piece.x + span * ca;
  const legRz = piece.z + span * sa;
  const baseY = Math.min(field.height(legLx, legLz), field.height(legRx, legRz)) - 3.5;

  // Per-arch shape jitter.
  const leanA = (rnd() - 0.5) * 0.35;
  const flatten = 0.72 + rnd() * 0.35;
  const twist = (rnd() - 0.5) * 1.4;
  const warpAmp = 0.16 + rnd() * 0.22;
  const phase = rnd() * 10;

  const nodes = SPANS + 1;
  const skeleton = new Float32Array(nodes * 4);
  const centres = new Float32Array(nodes * 3);
  const radii = new Float32Array(nodes);

  for (let s = 0; s < nodes; s++) {
    // Extend 6% past each footing so the ends are buried in rock.
    const t = -0.06 + (1.12 * s) / SPANS;
    const th = Math.PI * t;
    let u = -span * Math.cos(th) * 1.04;
    const hgt = rise * Math.pow(Math.max(0, Math.sin(th)), flatten);
    // Asymmetry: lean, plus a wandering keystone.
    u += leanA * rise * Math.sin(th);
    const sway = warpAmp * span * Math.sin(th * 2.3 + phase) * Math.sin(th);
    const v = sway;

    const wx = piece.x + u * ca - v * sa;
    const wz = piece.z + u * sa + v * ca;
    const wy = baseY + hgt;

    // Cross-section thickens toward the legs and at the keystone.
    const r =
      thick *
      (0.78 +
        0.5 * Math.pow(1 - Math.abs(Math.sin(th)), 1.4) +
        0.22 * Math.sin(th * 3 + phase * 1.7));

    centres[s * 3] = wx;
    centres[s * 3 + 1] = wy;
    centres[s * 3 + 2] = wz;
    radii[s] = Math.max(1.1, r);
    skeleton[s * 4] = wx;
    skeleton[s * 4 + 1] = wy;
    skeleton[s * 4 + 2] = wz;
    skeleton[s * 4 + 3] = Math.max(1.1, r);
  }

  const vc = nodes * (RADIAL + 1);
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const col = new Float32Array(vc * 3);
  const aCoarse = new Float32Array(vc * 4);
  const aSurf = new Float32Array(vc * 4);
  const aMorph = new Float32Array(vc * 2);

  const tan = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const bin = new THREE.Vector3();
  const nor = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (let s = 0; s < nodes; s++) {
    const s0 = Math.max(0, s - 1);
    const s1 = Math.min(nodes - 1, s + 1);
    tan.set(
      centres[s1 * 3] - centres[s0 * 3],
      centres[s1 * 3 + 1] - centres[s0 * 3 + 1],
      centres[s1 * 3 + 2] - centres[s0 * 3 + 2],
    );
    if (tan.lengthSq() < 1e-8) tan.set(1, 0, 0);
    tan.normalize();
    bin.copy(up).cross(tan);
    if (bin.lengthSq() < 1e-6) bin.set(0, 0, 1);
    bin.normalize();
    nor.copy(tan).cross(bin).normalize();

    const cxs = centres[s * 3];
    const cys = centres[s * 3 + 1];
    const czs = centres[s * 3 + 2];
    const rBase = radii[s];
    const roll = twist * (s / SPANS);

    for (let k = 0; k <= RADIAL; k++) {
      const a = (k / RADIAL) * Math.PI * 2 + roll;
      // Eroded, non-circular cross-section: two lobes + fine chipping.
      const lobe =
        1 +
        0.24 * Math.sin(a * 2 + phase) +
        0.14 * Math.sin(a * 5 - phase * 2.1) +
        0.09 * Math.sin(a * 9 + s * 0.7);
      // Flattened underside reads as water-worn.
      const flat = 1 - 0.22 * Math.max(0, -Math.cos(a));
      const r = rBase * lobe * flat * (0.92 + 0.16 * Math.sin(s * 0.9 + a));

      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      p.set(
        cxs + (bin.x * cosA + nor.x * sinA) * r,
        cys + (bin.y * cosA + nor.y * sinA) * r,
        czs + (bin.z * cosA + nor.z * sinA) * r,
      );

      const v = s * (RADIAL + 1) + k;
      pos[v * 3] = p.x - piece.x;
      pos[v * 3 + 1] = p.y;
      pos[v * 3 + 2] = p.z - piece.z;

      // Outward normal (recomputed exactly below via face averaging is overkill;
      // the analytic radial normal is correct for a tube of slowly varying r).
      const nx = bin.x * cosA + nor.x * sinA;
      const ny = bin.y * cosA + nor.y * sinA;
      const nz = bin.z * cosA + nor.z * sinA;
      nrm[v * 3] = nx;
      nrm[v * 3 + 1] = ny;
      nrm[v * 3 + 2] = nz;

      field.flowInto(p.x, p.z, flow);
      biomes.shadeInto(p.x, p.z, -p.y, shade);
      // Arches are bare rock: darken the biome tint and force sediment low.
      col[v * 3] = shade.r * 0.82;
      col[v * 3 + 1] = shade.g * 0.84;
      col[v * 3 + 2] = shade.b * 0.86;

      aCoarse[v * 4] = pos[v * 3 + 1];
      aCoarse[v * 4 + 1] = nx;
      aCoarse[v * 4 + 2] = ny;
      aCoarse[v * 4 + 3] = nz;

      aSurf[v * 4] = flow.x;
      aSurf[v * 4 + 1] = flow.y;
      aSurf[v * 4 + 2] = 0.55; // convex: favours the coral-rock layer
      aSurf[v * 4 + 3] = 0.05; // bare rock
      aMorph[v * 2] = 1e7;
      aMorph[v * 2 + 1] = 1e7 + 1;
    }
  }

  const triCount = SPANS * RADIAL * 2;
  const idx = new Uint16Array(triCount * 3);
  let q = 0;
  for (let s = 0; s < SPANS; s++) {
    for (let k = 0; k < RADIAL; k++) {
      const a = s * (RADIAL + 1) + k;
      const b = a + 1;
      const c = a + (RADIAL + 1);
      const d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aCoarse', new THREE.BufferAttribute(aCoarse, 4));
  geo.setAttribute('aSurf', new THREE.BufferAttribute(aSurf, 4));
  geo.setAttribute('aMorph', new THREE.BufferAttribute(aMorph, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  return {
    geometry: geo,
    skeleton,
    cx: piece.x,
    cy: baseY + rise * 0.5,
    cz: piece.z,
    boundRadius: span * 1.35 + rise * 0.7 + thick * 3,
  };
}

/** Distance test against the swept skeleton; used by `WorldQuery.isSolid`. */
export function archSolid(arch: ArchBuild, x: number, y: number, z: number): boolean {
  const dxc = x - arch.cx;
  const dyc = y - arch.cy;
  const dzc = z - arch.cz;
  if (dxc * dxc + dyc * dyc + dzc * dzc > arch.boundRadius * arch.boundRadius) return false;
  const s = arch.skeleton;
  const nodes = s.length / 4;
  for (let i = 0; i + 1 < nodes; i++) {
    const ax = s[i * 4], ay = s[i * 4 + 1], az = s[i * 4 + 2], ar = s[i * 4 + 3];
    const bx = s[(i + 1) * 4], by = s[(i + 1) * 4 + 1], bz = s[(i + 1) * 4 + 2], br = s[(i + 1) * 4 + 3];
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const len2 = ex * ex + ey * ey + ez * ez;
    let t = len2 > 1e-8 ? ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ex * t, py = ay + ey * t, pz = az + ez * t;
    const r = ar + (br - ar) * t;
    const qx = x - px, qy = y - py, qz = z - pz;
    if (qx * qx + qy * qy + qz * qz < r * r * 0.85) return true;
  }
  return false;
}

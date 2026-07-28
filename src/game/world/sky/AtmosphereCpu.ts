import * as THREE from 'three';
import { ATMO } from './Atmosphere';

/**
 * CPU mirror of the atmosphere solver. It is *much* coarser than the GPU LUTs
 * but it runs on the main thread, which is where the directional-light colour,
 * the ambient term and the biome fog tint have to be decided.
 *
 * Built once: a 96x24 transmittance table (r, mu) integrated with 40 steps.
 * Queried per frame: a handful of single-scatter integrations.
 */

const TW = 96;
const TH = 24;
const STEPS = 40;

const scratchP = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchSunT = new THREE.Vector3();

function tent(h: number): number {
  return Math.max(0, 1 - Math.abs(h - ATMO.ozoneCentre) / ATMO.ozoneWidth);
}

/** Extinction of the medium at altitude h (km) into `out` (length 3). */
function extinctionAt(h: number, out: Float64Array): void {
  const hh = Math.max(h, 0);
  const dR = Math.exp(-hh / ATMO.rayleighH);
  const dM = Math.exp(-hh / ATMO.mieH);
  const dO = tent(hh);
  const mie = (ATMO.mieS + ATMO.mieA) * dM;
  out[0] = ATMO.rayleighS[0] * dR + mie + ATMO.ozoneA[0] * dO;
  out[1] = ATMO.rayleighS[1] * dR + mie + ATMO.ozoneA[1] * dO;
  out[2] = ATMO.rayleighS[2] * dR + mie + ATMO.ozoneA[2] * dO;
}

function sphereHit(ox: number, oy: number, dx: number, dy: number, rad: number): number {
  // 2D is enough: everything is solved in the (horizontal, up) plane.
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - rad * rad;
  const d = b * b - c;
  if (d < 0) return -1;
  const s = Math.sqrt(d);
  const t0 = -b - s;
  const t1 = -b + s;
  if (t1 < 0) return -1;
  return t0 < 0 ? t1 : t0;
}

export class AtmosphereCpu {
  /** Transmittance table, RGB triplets, TW*TH*3. */
  private table = new Float32Array(TW * TH * 3);
  private ext = new Float64Array(3);

  constructor() {
    this.build();
  }

  private build(): void {
    const H = Math.sqrt(ATMO.topR * ATMO.topR - ATMO.groundR * ATMO.groundR);
    const od = new Float64Array(3);
    for (let y = 0; y < TH; y++) {
      // Guard is against a degenerate one-row table; TH is a literal type, so it
      // needs widening for the comparison to typecheck.
      const vy = (TH as number) === 1 ? 0 : y / (TH - 1);
      const rho = vy * H;
      const r = Math.sqrt(rho * rho + ATMO.groundR * ATMO.groundR);
      const dMin = ATMO.topR - r;
      const dMax = rho + H;
      for (let x = 0; x < TW; x++) {
        const vx = x / (TW - 1);
        const d = dMin + vx * (dMax - dMin);
        const mu = d === 0 ? 1 : Math.max(-1, Math.min(1, (H * H - rho * rho - d * d) / (2 * r * d)));
        const dx = Math.sqrt(Math.max(0, 1 - mu * mu));
        const dy = mu;
        let tTop = sphereHit(0, r, dx, dy, ATMO.topR);
        const tGnd = sphereHit(0, r, dx, dy, ATMO.groundR);
        if (tTop < 0) tTop = 0;
        const tMax = tGnd > 0 ? Math.min(tTop, tGnd) : tTop;
        od[0] = od[1] = od[2] = 0;
        const dt = tMax / STEPS;
        for (let i = 0; i < STEPS; i++) {
          const t = (i + 0.5) * dt;
          const px = dx * t;
          const py = r + dy * t;
          extinctionAt(Math.sqrt(px * px + py * py) - ATMO.groundR, this.ext);
          od[0] += this.ext[0] * dt;
          od[1] += this.ext[1] * dt;
          od[2] += this.ext[2] * dt;
        }
        const o = (y * TW + x) * 3;
        this.table[o] = Math.exp(-od[0]);
        this.table[o + 1] = Math.exp(-od[1]);
        this.table[o + 2] = Math.exp(-od[2]);
      }
    }
  }

  /** Bilinear lookup of transmittance from radius r (km) and cos-zenith mu. */
  transmittance(r: number, mu: number, out: THREE.Vector3): THREE.Vector3 {
    const rr = Math.max(ATMO.groundR, Math.min(ATMO.topR, r));
    const m = Math.max(-1, Math.min(1, mu));
    const H = Math.sqrt(ATMO.topR * ATMO.topR - ATMO.groundR * ATMO.groundR);
    const rho = Math.sqrt(Math.max(0, rr * rr - ATMO.groundR * ATMO.groundR));
    const disc = rr * rr * (m * m - 1) + ATMO.topR * ATMO.topR;
    const d = Math.max(0, -rr * m + Math.sqrt(Math.max(disc, 0)));
    const dMin = ATMO.topR - rr;
    const dMax = rho + H;
    const u = Math.max(0, Math.min(1, (d - dMin) / Math.max(dMax - dMin, 1e-5))) * (TW - 1);
    const v = Math.max(0, Math.min(1, rho / H)) * (TH - 1);
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const x1 = Math.min(TW - 1, x0 + 1);
    const y1 = Math.min(TH - 1, y0 + 1);
    const fx = u - x0;
    const fy = v - y0;
    const t = this.table;
    const i00 = (y0 * TW + x0) * 3;
    const i10 = (y0 * TW + x1) * 3;
    const i01 = (y1 * TW + x0) * 3;
    const i11 = (y1 * TW + x1) * 3;
    const lerp = (k: number) =>
      (t[i00 + k] * (1 - fx) + t[i10 + k] * fx) * (1 - fy) + (t[i01 + k] * (1 - fx) + t[i11 + k] * fx) * fy;
    return out.set(lerp(0), lerp(1), lerp(2));
  }

  /**
   * Single-scattering sky radiance along `dir` for an observer at `observerR`
   * km, scaled by `ATMO.skyScale`. A flat 1.9x boost stands in for the multiple
   * scattering the GPU LUT resolves properly — it keeps CPU ambient and GPU sky
   * within a few percent of each other, which is all the light rig needs.
   */
  skyRadiance(observerR: number, dir: THREE.Vector3, sunDir: THREE.Vector3, out: THREE.Color): THREE.Color {
    const marchSteps = 14;
    const ro = scratchP.set(0, observerR, 0);
    let tTop = sphereHit(0, observerR, Math.hypot(dir.x, dir.z), dir.y, ATMO.topR);
    const tGnd = sphereHit(0, observerR, Math.hypot(dir.x, dir.z), dir.y, ATMO.groundR);
    if (tTop < 0) tTop = 0;
    const tMax = Math.min(tGnd > 0 ? Math.min(tTop, tGnd) : tTop, 400);
    if (tMax <= 0) return out.setRGB(0, 0, 0);

    const cosT = dir.dot(sunDir);
    const phR = 0.05968310365946075 * (1 + cosT * cosT);
    const g = ATMO.mieG;
    const kM = (3 / (8 * Math.PI)) * ((1 - g * g) / (2 + g * g));
    const phM = (kM * (1 + cosT * cosT)) / Math.pow(Math.max(1e-4, 1 + g * g - 2 * g * cosT), 1.5);

    let lr = 0;
    let lg = 0;
    let lb = 0;
    let tr = 1;
    let tg = 1;
    let tb = 1;
    const dt = tMax / marchSteps;
    const sunT = scratchSunT;

    for (let i = 0; i < marchSteps; i++) {
      const t = (i + 0.5) * dt;
      const px = ro.x + dir.x * t;
      const py = ro.y + dir.y * t;
      const pz = ro.z + dir.z * t;
      const rr = Math.sqrt(px * px + py * py + pz * pz);
      const h = rr - ATMO.groundR;
      const dR = Math.exp(-Math.max(0, h) / ATMO.rayleighH);
      const dM = Math.exp(-Math.max(0, h) / ATMO.mieH);
      extinctionAt(h, this.ext);
      scratchUp.set(px / rr, py / rr, pz / rr);
      const muS = scratchUp.dot(sunDir);
      this.transmittance(rr, muS, sunT);
      const lit = sphereHit(Math.hypot(px, pz), py, Math.hypot(sunDir.x, sunDir.z), sunDir.y, ATMO.groundR) < 0 ? 1 : 0;
      const stR = Math.exp(-this.ext[0] * dt);
      const stG = Math.exp(-this.ext[1] * dt);
      const stB = Math.exp(-this.ext[2] * dt);
      const mieS = ATMO.mieS * dM;
      const inR = (ATMO.rayleighS[0] * dR * phR + mieS * phM) * lit * sunT.x;
      const inG = (ATMO.rayleighS[1] * dR * phR + mieS * phM) * lit * sunT.y;
      const inB = (ATMO.rayleighS[2] * dR * phR + mieS * phM) * lit * sunT.z;
      lr += tr * ((inR - inR * stR) / Math.max(this.ext[0], 1e-9));
      lg += tg * ((inG - inG * stG) / Math.max(this.ext[1], 1e-9));
      lb += tb * ((inB - inB * stB) / Math.max(this.ext[2], 1e-9));
      tr *= stR;
      tg *= stG;
      tb *= stB;
    }

    const s = ATMO.skyScale * 1.9;
    return out.setRGB(lr * s, lg * s, lb * s);
  }
}

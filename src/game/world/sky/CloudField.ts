import * as THREE from 'three';
import { hash2 } from '../../core/Noise';

/**
 * Procedural cloud field.
 *
 * The base coverage signal lives in a single 256x256 RGBA texture baked at boot
 * from *periodic* value noise, so it tiles seamlessly and — crucially — the CPU
 * can sample the exact same bytes with the exact same bilinear filter as the
 * GPU. That is what lets the sun light dim when a cloud actually drifts in front
 * of the sun instead of on an unrelated schedule.
 *
 * Channels:
 *   R  5-octave fbm      — cumulus field / big holes
 *   G  2-scale worley    — individual cauliflower lumps
 *   B  3-octave fine fbm — edge erosion seed
 *   A  4-octave macro    — weather-front scale variation
 */

export const CLOUD_TEX_SIZE = 256;

/** Tiles per kilometre for the two coverage taps. Mirrored in GLSL below. */
export const CLOUD_SCALE_A = 1 / 38;
export const CLOUD_SCALE_B = 1 / 9.3;

/* ------------------------------------------------------------------ *
 * Periodic (tileable) noise bakery
 * ------------------------------------------------------------------ */

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrap(i: number, p: number): number {
  return ((i % p) + p) % p;
}

function periodicValue(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const ux = quintic(x - ix);
  const uy = quintic(y - iy);
  const a = hash2(wrap(ix, period), wrap(iy, period), seed);
  const b = hash2(wrap(ix + 1, period), wrap(iy, period), seed);
  const c = hash2(wrap(ix, period), wrap(iy + 1, period), seed);
  const d = hash2(wrap(ix + 1, period), wrap(iy + 1, period), seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

function periodicFbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let norm = 0;
  let sum = 0;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValue(u * p, v * p, p, seed + o * 977);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Periodic worley F1 in 0..1 (0 at cell centres). */
function periodicWorley(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const wx = wrap(cx, period);
      const wy = wrap(cy, period);
      const px = cx + 0.15 + 0.7 * hash2(wx, wy, seed);
      const py = cy + 0.15 + 0.7 * hash2(wx, wy, seed ^ 0x5f3759df);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) best = d;
    }
  }
  return Math.min(1, Math.sqrt(best));
}

/* ------------------------------------------------------------------ *
 * CloudField
 * ------------------------------------------------------------------ */

export class CloudField {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly size = CLOUD_TEX_SIZE;

  constructor(seed = 0x51c1) {
    const n = this.size;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      const v = y / n;
      for (let x = 0; x < n; x++) {
        const u = x / n;
        // R — cumulus field. Contrast-stretched so holes are genuinely empty.
        let r = periodicFbm(u, v, 3, 5, seed);
        r = Math.max(0, Math.min(1, (r - 0.34) / 0.44));
        r = r * r * (3 - 2 * r);
        // G — lumps: two worley scales, inverted so cell centres are dense.
        const w1 = 1 - periodicWorley(u, v, 6, seed + 31);
        const w2 = 1 - periodicWorley(u, v, 13, seed + 77);
        const g = Math.max(0, Math.min(1, w1 * 0.66 + w2 * 0.34));
        // B — fine erosion seed.
        const b = Math.max(0, Math.min(1, periodicFbm(u, v, 14, 3, seed + 211) * 0.5 + 0.5));
        // A — macro front variation.
        const a = Math.max(0, Math.min(1, periodicFbm(u, v, 2, 4, seed + 401) * 0.72 + 0.28));
        const o = (y * n + x) * 4;
        data[o] = (r * 255) | 0;
        data[o + 1] = (g * 255) | 0;
        data[o + 2] = (b * 255) | 0;
        data[o + 3] = (a * 255) | 0;
      }
    }
    this.data = data;
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  /** Bilinear tap of the baked texture — bit-for-bit what the sampler does. */
  private tap(u: number, v: number, channel: number): number {
    const n = this.size;
    const x = u * n - 0.5;
    const y = v * n - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ax = wrap(x0, n);
    const ay = wrap(y0, n);
    const bx = wrap(x0 + 1, n);
    const by = wrap(y0 + 1, n);
    const d = this.data;
    const p00 = d[(ay * n + ax) * 4 + channel];
    const p10 = d[(ay * n + bx) * 4 + channel];
    const p01 = d[(by * n + ax) * 4 + channel];
    const p11 = d[(by * n + bx) * 4 + channel];
    return ((p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy) / 255;
  }

  /**
   * Coverage signal at a horizontal position, kilometres, already advected by
   * `offset`. Mirrors `cloudCoverage()` in CLOUD_GLSL exactly.
   */
  coverageAt(xKm: number, zKm: number, offsetX: number, offsetZ: number): number {
    const qx = (xKm + offsetX) * CLOUD_SCALE_A;
    const qy = (zKm + offsetZ) * CLOUD_SCALE_A;
    const sx = (xKm + offsetX * 1.7) * CLOUD_SCALE_B + 0.37;
    const sy = (zKm + offsetZ * 1.7) * CLOUD_SCALE_B + 0.11;
    const ar = this.tap(qx, qy, 0);
    const ag = this.tap(qx, qy, 1);
    const bg = this.tap(sx, sy, 1);
    const ba = this.tap(sx, sy, 3);
    const base = ar * 0.65 + ba * 0.35;
    const lumps = ag * 0.58 + bg * 0.42;
    return Math.max(0, Math.min(1, base * 0.66 + lumps * 0.34));
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * GLSL — coverage, 3D density, volumetric march
 * ------------------------------------------------------------------ */

export const CLOUD_GLSL = /* glsl */ `
uniform sampler2D uCloudTex;
uniform vec2  uCloudOffset;      // km, wind advection
uniform float uCloudCoverage;    // 0..1
uniform float uCloudBase;        // km above sea level
uniform float uCloudTop;         // km
uniform float uCloudDensity;
uniform float uCloudErode;
uniform float uCloudDetail;      // detail frequency, 1/km
uniform float uCloudSigmaE;      // extinction, 1/km
uniform float uCloudPowder;
uniform float uCloudSunGain;
uniform int   uCloudSteps;
uniform int   uCloudLightSteps;

const float CL_A = ${CLOUD_SCALE_A.toFixed(9)};
const float CL_B = ${CLOUD_SCALE_B.toFixed(9)};

float cloudCoverage(vec2 pKm) {
  vec2 q = (pKm + uCloudOffset) * CL_A;
  vec2 s = (pKm + uCloudOffset * 1.7) * CL_B + vec2(0.37, 0.11);
  vec4 a = texture2D(uCloudTex, q);
  vec4 b = texture2D(uCloudTex, s);
  float base = a.r * 0.65 + b.a * 0.35;
  float lumps = a.g * 0.58 + b.g * 0.42;
  return clamp(base * 0.66 + lumps * 0.34, 0.0, 1.0);
}

float cloudHeightGradient(float hN) {
  // Cumulus: flat wind-sheared base, cauliflower crown, anvil under storm.
  return smoothstep(0.0, 0.12, hN) * (1.0 - smoothstep(0.42, 1.0, hN));
}

/** p is planet-centred, km. Returns density 0..1. */
float cloudDensity(vec3 p, float alt, int detailOctaves) {
  float hN = (alt - uCloudBase) / max(1e-3, uCloudTop - uCloudBase);
  if (hN <= 0.0 || hN >= 1.0) return 0.0;
  float cov = cloudCoverage(p.xz);
  float thr = 1.0 - uCloudCoverage;
  float shape = clamp((cov - thr) / max(1e-3, 1.0 - thr), 0.0, 1.0);
  float d = shape * cloudHeightGradient(hN);
  if (d <= 0.0) return 0.0;
  if (detailOctaves > 0) {
    vec3 dp = p * uCloudDetail + vec3(uCloudOffset.x, alt * 0.6, uCloudOffset.y) * uCloudDetail;
    float det = fbm3(dp, detailOctaves) * 0.5 + 0.5;
    float e = uCloudErode * (0.3 + 0.7 * hN);
    d = clamp((d - det * e) / max(1e-3, 1.0 - e), 0.0, 1.0);
  }
  return d * uCloudDensity;
}

float cloudHG(float c, float g) {
  float gg = g * g;
  return (1.0 - gg) / (12.566370614 * pow(max(1e-4, 1.0 + gg - 2.0 * g * c), 1.5));
}

/**
 * Volumetric march through the cloud shell.
 * Returns rgb = in-scattered radiance, a = transmittance.
 */
vec4 cloudsMarch(vec3 ro, vec3 rd, vec3 sunDir, vec3 sunRadiance, vec3 ambTop, vec3 ambBottom, float jitter) {
  if (uCloudSteps <= 0) return vec4(0.0, 0.0, 0.0, 1.0);

  float rBase = ATMO_GROUND_R + uCloudBase;
  float rTop = ATMO_GROUND_R + uCloudTop;
  float tB = atmoSphere(ro, rd, rBase);
  float tT = atmoSphere(ro, rd, rTop);
  if (tB < 0.0 || tT < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float tGnd = atmoSphere(ro, rd, ATMO_GROUND_R);
  if (tGnd > 0.0 && tGnd < tB) return vec4(0.0, 0.0, 0.0, 1.0);

  float t0 = min(tB, tT);
  float t1 = max(tB, tT);
  if (t0 > 130.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float horizonFade = smoothstep(130.0, 88.0, t0);
  float span = min(t1 - t0, 42.0);

  float cosT = dot(rd, sunDir);
  vec3 scat = vec3(0.0);
  float trans = 1.0;
  float fs = float(uCloudSteps);

  for (int i = 0; i < 48; i++) {
    if (i >= uCloudSteps) break;
    float f0 = (float(i) + jitter) / fs;
    float f1 = (float(i) + 1.0 + jitter) / fs;
    // Quadratic step growth: fine near the entry face, coarse deep in.
    float a0 = f0 * f0 * 0.62 + f0 * 0.38;
    float a1 = f1 * f1 * 0.62 + f1 * 0.38;
    float dt = (a1 - a0) * span;
    vec3 p = ro + rd * (t0 + a0 * span);
    float alt = length(p) - ATMO_GROUND_R;
    float d = cloudDensity(p, alt, 3);
    if (d <= 0.002) continue;

    // --- light march toward the sun, geometric step growth
    float lightOd = 0.0;
    float lt = 0.0;
    float ls = 0.055;
    for (int j = 0; j < 8; j++) {
      if (j >= uCloudLightSteps) break;
      lt += ls;
      vec3 lp = p + sunDir * lt;
      float lalt = length(lp) - ATMO_GROUND_R;
      lightOd += cloudDensity(lp, lalt, j < 2 ? 2 : 0) * ls;
      ls *= 2.05;
    }

    // --- energy-conserving multi-scatter approximation (3 octaves)
    vec3 sunE = vec3(0.0);
    float att = 1.0, contrib = 1.0, pg = 1.0;
    for (int o = 0; o < 3; o++) {
      float od = lightOd * uCloudSigmaE * att;
      float beer = exp(-od);
      float powder = 1.0 - exp(-od * 2.4);
      float ph = mix(cloudHG(cosT, 0.80 * pg), cloudHG(cosT, -0.28 * pg), 0.26);
      sunE += contrib * beer * mix(1.0, powder, uCloudPowder) * ph;
      att *= 0.34;
      contrib *= 0.52;
      pg *= 0.66;
    }

    float hN = clamp((alt - uCloudBase) / max(1e-3, uCloudTop - uCloudBase), 0.0, 1.0);
    vec3 amb = mix(ambBottom, ambTop, hN * hN);
    vec3 lightCol = sunRadiance * sunE * uCloudSunGain + amb;

    float stepTrans = exp(-uCloudSigmaE * d * dt);
    scat += trans * lightCol * (1.0 - stepTrans);
    trans *= stepTrans;
    if (trans < 0.012) break;
  }

  scat *= horizonFade;
  trans = mix(1.0, trans, horizonFade);
  return vec4(scat, trans);
}
`;

/**
 * Deterministic procedural noise, shared by terrain, materials, flora and
 * shaders. The CPU implementation and the GLSL chunks below produce the *same*
 * field, so collision meshes agree with what the vertex shader draws.
 */

/* ------------------------------------------------------------------ *
 * Deterministic PRNG (mulberry32) + hashing
 * ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ *
 * Simplex noise (Ashima/Gustavson formulation, matching the GLSL below)
 * ------------------------------------------------------------------ */

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export class Noise {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);

  constructor(public readonly seed = 1337) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** 2D simplex noise in [-1, 1]. */
  noise2(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi = this.permMod12[ii + this.perm[jj]] * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi = this.permMod12[ii + i1 + this.perm[jj + j1]] * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi = this.permMod12[ii + 1 + this.perm[jj + 1]] * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2);
    }
    return 70 * n;
  }

  /** 3D simplex noise in [-1, 1]. */
  noise3(xin: number, yin: number, zin: number): number {
    const F3 = 1 / 3;
    const G3 = 1 / 6;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    const corner = (tv: number, gi: number, x: number, y: number, z: number) => {
      if (tv <= 0) return 0;
      const t2v = tv * tv;
      const g = gi * 3;
      return t2v * t2v * (GRAD3[g] * x + GRAD3[g + 1] * y + GRAD3[g + 2] * z);
    };
    n += corner(0.6 - x0 * x0 - y0 * y0 - z0 * z0, this.permMod12[ii + this.perm[jj + this.perm[kk]]], x0, y0, z0);
    n += corner(0.6 - x1 * x1 - y1 * y1 - z1 * z1, this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]], x1, y1, z1);
    n += corner(0.6 - x2 * x2 - y2 * y2 - z2 * z2, this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]], x2, y2, z2);
    n += corner(0.6 - x3 * x3 - y3 * y3 - z3 * z3, this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]], x3, y3, z3);
    return 32 * n;
  }

  /** Fractional Brownian motion, returns roughly [-1, 1]. */
  fbm2(x: number, y: number, octaves = 5, lacunarity = 2.02, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x: number, y: number, z: number, octaves = 4, lacunarity = 2.02, gain = 0.5): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal — produces sharp crests, good for reefs and spires. */
  ridged2(x: number, y: number, octaves = 5, lacunarity = 2.07, gain = 0.5): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    let prev = 1;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise2(x * freq, y * freq));
      const v = n * n * prev;
      prev = v;
      sum += amp * v;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Billowy noise — rounded blobs, good for sand dunes and cloud bellies. */
  billow2(x: number, y: number, octaves = 4): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (Math.abs(this.noise2(x * freq, y * freq)) * 2 - 1);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  /** Worley/cellular F1 distance in [0, ~1.4]; cell id returned via `outCell`. */
  worley2(x: number, y: number, outCell?: { x: number; y: number }): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let best = Infinity;
    let bx = 0;
    let by = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const px = cx + hash2(cx, cy, this.seed);
        const py = cy + hash2(cx, cy, this.seed ^ 0x5f3759df);
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < best) {
          best = d;
          bx = cx;
          by = cy;
        }
      }
    }
    if (outCell) {
      outCell.x = bx;
      outCell.y = by;
    }
    return Math.sqrt(best);
  }

  /** Domain-warped fbm — the workhorse for organic terrain silhouettes. */
  warpedFbm2(x: number, y: number, warp = 1.2, octaves = 5): number {
    const qx = this.fbm2(x + 0.0, y + 0.0, 3);
    const qy = this.fbm2(x + 5.2, y + 1.3, 3);
    const rx = this.fbm2(x + warp * qx + 1.7, y + warp * qy + 9.2, 3);
    const ry = this.fbm2(x + warp * qx + 8.3, y + warp * qy + 2.8, 3);
    return this.fbm2(x + warp * rx, y + warp * ry, octaves);
  }
}

/** Shared default noise instance for systems that do not need their own seed. */
export const defaultNoise = new Noise(20260728);

/* ------------------------------------------------------------------ *
 * GLSL chunks — inject with `NOISE_GLSL` into any shader that needs
 * the same field on the GPU.
 * ------------------------------------------------------------------ */

export const NOISE_GLSL = /* glsl */ `
#ifndef SN_NOISE_INCLUDED
#define SN_NOISE_INCLUDED
vec3 sn_mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 sn_mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 sn_permute(vec3 x){ return sn_mod289(((x*34.0)+1.0)*x); }
vec4 sn_permute(vec4 x){ return sn_mod289(((x*34.0)+1.0)*x); }
vec4 sn_taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = sn_permute( sn_permute( i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = sn_mod289(i);
  vec4 p = sn_permute( sn_permute( sn_permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = sn_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec2 p, int octaves){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    s += a * snoise(p);
    n += a;
    p *= 2.02;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}

float fbm3(vec3 p, int octaves){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    s += a * snoise(p);
    n += a;
    p *= 2.02;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}

float ridged(vec2 p, int octaves){
  float a = 0.5, s = 0.0, n = 0.0, prev = 1.0;
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    float v = 1.0 - abs(snoise(p));
    v *= v * prev;
    prev = v;
    s += a * v;
    n += a;
    p *= 2.07;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}

// Voronoi F1/F2. x = F1 distance, y = F2 distance, z = cell hash.
vec3 voronoi(vec2 p){
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++){
    for (int i = -1; i <= 1; i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = fract(sin(vec2(dot(ip+g, vec2(127.1,311.7)), dot(ip+g, vec2(269.5,183.3)))) * 43758.5453);
      float d = length(g + o - fp);
      if (d < f1){ f2 = f1; f1 = d; id = o.x + o.y; }
      else if (d < f2){ f2 = d; }
    }
  }
  return vec3(f1, f2, id);
}

float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3  hash33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
#endif
`;

/** Utility GLSL shared by many materials: triplanar sampling, ACES, blending. */
export const COMMON_GLSL = /* glsl */ `
vec3 blendWeights(vec3 n, float sharpness){
  vec3 w = pow(abs(n), vec3(sharpness));
  return w / max(w.x + w.y + w.z, 1e-4);
}

vec3 triplanar(sampler2D tex, vec3 wpos, vec3 wnorm, float scale, float sharpness){
  vec3 w = blendWeights(wnorm, sharpness);
  vec3 xz = texture2D(tex, wpos.xz * scale).rgb;
  vec3 xy = texture2D(tex, wpos.xy * scale).rgb;
  vec3 zy = texture2D(tex, wpos.zy * scale).rgb;
  return zy * w.x + xz * w.y + xy * w.z;
}

// Height-aware blend: keeps the higher-relief texture on top instead of
// cross-fading to mush. Standard "height blend" from Bogart/Gehling.
float heightBlend(float h1, float h2, float t, float depth){
  float m1 = h1 * (1.0 - t);
  float m2 = h2 * t;
  float ma = max(m1, m2) - depth;
  float b1 = max(m1 - ma, 0.0);
  float b2 = max(m2 - ma, 0.0);
  return b2 / max(b1 + b2, 1e-4);
}

// Named snLuminance, not luminance: three emits its own
// "float luminance(const in vec3)" in the fragment prefix for tone mapping, and
// GLSL treats a differing parameter qualifier as a redefinition.
float snLuminance(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

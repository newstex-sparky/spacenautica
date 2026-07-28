/**
 * GLSL noise used *only* by the texture bakers.
 *
 * Why not `core/Noise.ts`'s `NOISE_GLSL`? Because simplex noise is not periodic,
 * and every map produced here is sampled with `RepeatWrapping`. Non-periodic
 * noise leaves a hard seam at the u=0/u=1 and v=0/v=1 boundaries that reads as a
 * grid across the sea floor. Everything below is *exactly* tileable: the lattice
 * cell index is reduced modulo an integer period, so noise(uv) == noise(uv + 1).
 *
 * All periods are `vec2` so a material can be anisotropic (stretched ripples,
 * elongated scales, brushed metal) and still tile.
 *
 * Prefix: `bk_`. Nothing here is meant for runtime shaders — runtime helpers
 * live in `MaterialGlsl.ts`.
 */
export const BAKE_NOISE_GLSL = /* glsl */ `
uniform float uSeed;

const float BK_TAU = 6.28318530718;

/* ---------------------------------------------------------------- *
 * Hashing (Dave Hoskins style, sine-free so it is stable across GPUs).
 * Inputs are always reduced lattice indices, so magnitudes stay small
 * and mediump-class precision is never an issue.
 * ---------------------------------------------------------------- */
float bk_h21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33 + uSeed);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 bk_h22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33 + uSeed);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 bk_h23(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33 + uSeed);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

/* ---------------------------------------------------------------- *
 * Periodic gradient (Perlin) noise. \`per\` is the lattice period in
 * cells; call as bk_perlin(uv * C, C) with integer C to tile.
 * ---------------------------------------------------------------- */
vec2 bk_grad(vec2 cell, vec2 per){
  float a = bk_h21(mod(cell, per)) * 6.28318530718;
  return vec2(cos(a), sin(a));
}

/**
 * Snaps a requested period to the nearest integer and returns the matching
 * rescale factor for the sample position. Call sites are written as
 * bk_perlin(uv * C, C) with C a *cell count*; when C is fractional (e.g. a
 * derived C * 0.7) the lattice would no longer wrap at uv + 1 and the map would
 * show a seam. Rounding the period and rescaling p by the same ratio keeps the
 * relationship p == uv * period exact, so every call site tiles whatever it is
 * handed. The feature scale shifts by at most half a cell, which is invisible.
 */
vec2 bk_snapPeriod(inout vec2 p, vec2 per){
  vec2 q = max(floor(per + 0.5), vec2(1.0));
  p *= q / max(per, vec2(1e-4));
  return q;
}

float bk_perlin(vec2 p, vec2 per){
  per = bk_snapPeriod(p, per);
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(bk_grad(i, per), f);
  float b = dot(bk_grad(i + vec2(1.0, 0.0), per), f - vec2(1.0, 0.0));
  float c = dot(bk_grad(i + vec2(0.0, 1.0), per), f - vec2(0.0, 1.0));
  float d = dot(bk_grad(i + vec2(1.0, 1.0), per), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142136;
}

/** Fractional Brownian motion. Period doubles with frequency so tiling holds. */
float bk_fbm(vec2 p, vec2 per, int oct, float gain){
  float a = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * bk_perlin(p, per);
    n += a;
    p *= 2.0; per *= 2.0; a *= gain;
  }
  return s / max(n, 1e-4);
}

/** Ridged multifractal — sharp crests for fractures, reef spines, veins. */
float bk_ridge(vec2 p, vec2 per, int oct){
  float a = 1.0, s = 0.0, n = 0.0, prev = 1.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    float v = 1.0 - abs(bk_perlin(p, per));
    v *= v * prev;
    prev = clamp(v * 1.4, 0.0, 1.0);
    s += a * v;
    n += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / max(n, 1e-4);
}

/** Billowy noise — rounded lobes for dunes, brain coral, cloud bellies. */
float bk_billow(vec2 p, vec2 per, int oct){
  float a = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * (abs(bk_perlin(p, per)) * 2.0 - 1.0);
    n += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / max(n, 1e-4);
}

/** Periodic domain warp. Returns the *offset*, in the same units as p. */
vec2 bk_warp(vec2 p, vec2 per, float amt){
  float qx = bk_fbm(p + vec2(0.31, 5.17), per, 3, 0.5);
  float qy = bk_fbm(p + vec2(7.83, 1.29), per, 3, 0.5);
  return vec2(qx, qy) * amt;
}

/* ---------------------------------------------------------------- *
 * Periodic Voronoi / Worley.
 *   .x = F1 distance   .y = F2 distance
 *   .z = cell hash id  .w = second-nearest cell hash id
 * ---------------------------------------------------------------- */
vec4 bk_voronoi(vec2 p, vec2 per, float jitter){
  per = bk_snapPeriod(p, per);
  vec2 ip = floor(p);
  vec2 fp = p - ip;
  float f1 = 8.0, f2 = 8.0, id1 = 0.0, id2 = 0.0;
  for (int j = -1; j <= 1; j++){
    for (int i = -1; i <= 1; i++){
      vec2 g = vec2(float(i), float(j));
      vec2 cell = mod(ip + g, per);
      vec2 o = bk_h22(cell) * jitter + 0.5 * (1.0 - jitter);
      float d = length(g + o - fp);
      float id = bk_h21(cell + 17.31);
      if (d < f1){ f2 = f1; id2 = id1; f1 = d; id1 = id; }
      else if (d < f2){ f2 = d; id2 = id; }
    }
  }
  return vec4(f1, f2, id1, id2);
}

/** Cell-boundary field: 0 inside cells, 1 on the shared edge. */
float bk_cellEdge(vec4 v, float width){
  return 1.0 - smoothstep(0.0, width, v.y - v.x);
}

/** Multi-octave Worley — porous, spongy, foamy structure. */
float bk_worleyFbm(vec2 p, vec2 per, int oct, float jitter){
  float a = 0.6, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * (1.0 - bk_voronoi(p, per, jitter).x);
    n += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / max(n, 1e-4);
}

/* ---------------------------------------------------------------- *
 * Small utilities
 * ---------------------------------------------------------------- */

/** Sparse bright glints: returns 0..1, 'density' in 0..1 controls coverage. */
float bk_sparkle(vec2 p, vec2 per, float density){
  per = bk_snapPeriod(p, per);
  vec2 ip = floor(p);
  vec3 h = bk_h23(mod(ip, per) + 3.7);
  vec2 c = h.xy;
  float d = length((p - ip) - c);
  float on = step(1.0 - density, h.z);
  return on * (1.0 - smoothstep(0.0, 0.34, d));
}

/**
 * Rotation. Safe for *direction vectors and wave numbers* only — never rotate a
 * lattice coordinate, because the modulo period no longer wraps and you get a
 * seam. Use bk_shear for oblique features that must still tile.
 */
vec2 bk_rot(vec2 p, float a){
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

/**
 * Integer shear of the unit square. Applied to uv *before* scaling by an
 * integer cell count this rotates features obliquely while keeping the lattice
 * exactly periodic (uv + 1 maps to an integer lattice translation).
 */
vec2 bk_shear(vec2 uv, float kx, float ky){
  return vec2(uv.x + kx * uv.y, uv.y + ky * uv.x);
}

/**
 * Sharp-crested directional wave train. 'k' is an integer wave-number pair, so
 * the train tiles: k = vec2(14, 3) gives ~14.3 crests per tile running obliquely.
 */
float bk_ripple(vec2 uv, vec2 k, float wobble, vec2 per, float sharp){
  float phase = dot(uv, k) * BK_TAU + bk_fbm(uv * per, per, 3, 0.5) * wobble;
  return pow(0.5 + 0.5 * sin(phase), sharp);
}

/**
 * Periodic pulse train, for panel lines / laminations / hazard stripes / seams.
 * 'duty' is the pulse width as a fraction of the period; the pulse is centred on
 * the period boundary so it never notches at t = 0.
 */
float bk_stripe(vec2 uv, vec2 k, float duty, float soft, float wobble, vec2 per){
  float t = fract(dot(uv, k) + bk_fbm(uv * per, per, 3, 0.5) * wobble);
  float d = min(t, 1.0 - t);
  return 1.0 - smoothstep(duty * 0.5, duty * 0.5 + soft, d);
}

/** Linear-space luminance. */
float bk_luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/** Cheap perceptual hue rotation for per-instance/per-cell colour variance. */
vec3 bk_hueShift(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

/** sRGB-ish gamma helpers for authoring colours by eye. */
vec3 bk_toLinear(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
`;

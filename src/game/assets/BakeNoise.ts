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
 * Periodic gradient (Perlin) noise. 'per' is the lattice period in
 * cells; call as bk_perlin(uv * C, C) with integer C to tile.
 * ---------------------------------------------------------------- */
vec2 bk_grad(vec2 cell, vec2 per){
  float a = bk_h21(mod(cell, per)) * 6.28318530718;
  return vec2(cos(a), sin(a));
}

/* ---------------------------------------------------------------- *
 * BAND LIMITING - read this before touching any cell count.
 *
 * Every map here is rendered at a finite resolution and then mip-filtered. A
 * noise layer whose lattice period is close to that resolution cannot be
 * represented: neighbouring texels get uncorrelated values. That alone would
 * only be mild noise, but the normal map is a central difference of the height
 * field over ONE texel, so an unresolvable layer is differentiated into a
 * full-amplitude random tangent per texel. The result is a regular dithered /
 * maze-like speckle that survives mip filtering as moire and reads as a broken
 * normal map rather than a surface. (This is exactly what the round-1 rock and
 * sand frames showed.)
 *
 * So resolution is a hard ceiling on frequency, and it is enforced here, once,
 * for the whole library instead of by hand-tuning every cell count per tier:
 *
 *  - bk_snapPeriod* clamps any requested period to what the current bake size
 *    can carry, and rescales p to match so the layer still tiles. A single
 *    over-frequency call therefore renders at the finest representable scale
 *    rather than turning into dither.
 *  - the octave loops stop as soon as the *next* octave would cross the
 *    ceiling; past it every extra octave would be a coherent duplicate of the
 *    one before, which just inflates amplitude.
 *
 * BK_RES is the edge length of the map being baked, in texels. Different field
 * types need different texel budgets: smooth quintic-interpolated Perlin holds
 * up at ~4 texels per cell, a Voronoi distance field has a crease at every cell
 * centre and needs ~7, and a hard-edged sparkle dot needs ~8.
 * ---------------------------------------------------------------- */
#define BK_RES (1.0 / max(uP[9].x, 1e-6))

const float BK_TEXELS_LATTICE = 4.0;
const float BK_TEXELS_CELL    = 7.0;
const float BK_TEXELS_DOT     = 8.0;

/** Highest cell count this bake resolution can carry for a given field type. */
vec2 bk_cellCeiling(float minTexels){
  return vec2(max(4.0, floor(BK_RES / minTexels)));
}

/**
 * Snaps a requested period to an integer, clamped to the resolution ceiling,
 * and rescales p so that p == uv * returned-period still holds.
 *
 * Call sites are written as bk_perlin(uv * C, C) with C a *cell count*; when C
 * is fractional (e.g. a derived C * 0.7) the lattice would no longer wrap at
 * uv + 1 and the map would show a seam. Rounding the period and rescaling p by
 * the same ratio keeps the relationship exact, so every call site tiles
 * whatever it is handed. The feature scale shifts by at most half a cell, which
 * is invisible; the resolution clamp shifts it more, but only in the band where
 * the alternative is aliasing.
 */
vec2 bk_snapPeriodT(inout vec2 p, vec2 per, float minTexels){
  vec2 q = max(floor(min(per, bk_cellCeiling(minTexels)) + 0.5), vec2(1.0));
  p *= q / max(per, vec2(1e-4));
  return q;
}

vec2 bk_snapPeriod(inout vec2 p, vec2 per){
  return bk_snapPeriodT(p, per, BK_TEXELS_LATTICE);
}

/** True once doubling this period would cross the resolution ceiling. */
bool bk_atCeiling(vec2 per, float minTexels){
  return max(per.x, per.y) * 2.0 > max(bk_cellCeiling(minTexels).x, 1.0);
}

/**
 * Amplitude compensation for the period clamp, for use on a *detail* layer.
 *
 * A height layer contributes amplitude * cells to the normal map, so when the
 * resolution ceiling cuts a layer's cell count in half, leaving its amplitude
 * alone halves its slope too — and the material quietly loses its grain as the
 * bake gets smaller. That is the wrong degradation: the feature has to get
 * bigger (it cannot be helped) but it should not also get flatter, or a 192px
 * bake reads as a washed-out different material instead of the same one seen
 * coarsely. Multiplying the layer by this keeps the slope, and therefore the lit
 * appearance, roughly constant across bake sizes.
 *
 * Only for high-frequency detail. Do not apply it to a macro layer: there the
 * amplitude is the silhouette, not the grain.
 */
float bk_detailGain(vec2 per){
  float lim = max(bk_cellCeiling(BK_TEXELS_LATTICE).x, 1.0);
  float cells = max(max(per.x, per.y), 1.0);
  return cells / max(min(cells, lim), 1.0);
}

/**
 * Clamps an integer wave-number pair so a directional wave train stays
 * resolvable. Kept integer so the train still tiles.
 */
vec2 bk_limitK(vec2 k){
  float m = max(length(k), 1e-4);
  float lim = max(2.0, floor(BK_RES / 6.0));
  return m > lim ? floor(k * (lim / m) + 0.5) : k;
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

/**
 * Fractional Brownian motion. Period doubles with frequency so tiling holds, and
 * the cascade stops at the resolution ceiling (see BAND LIMITING above) so the
 * result is always representable. Normalising by the accumulated weight keeps
 * the amplitude and the mean stable however many octaves actually ran, so a
 * low-resolution bake reads as a softer version of the same material rather
 * than a differently-exposed one.
 */
float bk_fbm(vec2 p, vec2 per, int oct, float gain){
  float a = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * bk_perlin(p, per);
    n += a;
    if (bk_atCeiling(per, BK_TEXELS_LATTICE)) break;
    p *= 2.0; per *= 2.0; a *= gain;
  }
  return s / max(n, 1e-4);
}

/** Band-limited detail fbm with the slope compensation already applied. */
float bk_detailFbm(vec2 p, vec2 per, int oct, float gain){
  return bk_fbm(p, per, oct, gain) * bk_detailGain(per);
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
    if (bk_atCeiling(per, BK_TEXELS_LATTICE)) break;
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
    if (bk_atCeiling(per, BK_TEXELS_LATTICE)) break;
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
  // Stricter ceiling than the Perlin lattice: the F1 distance field has a crease
  // at every cell centre and bk_cellEdge turns F2-F1 into a hairline, so a
  // Voronoi cell needs roughly twice the texels a Perlin cell does before the
  // edges start dithering.
  per = bk_snapPeriodT(p, per, BK_TEXELS_CELL);
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

/**
 * Cell-boundary field: 0 inside cells, 1 on the shared edge. 'width' is in cell
 * units and 'per' must be the period handed to the matching bk_voronoi call:
 * F2-F1 is a hairline, and the authored widths (0.05-0.16 of a cell) fall well
 * below one texel once the cell count is high, which turns a crack network into
 * a dithered stipple. The width is therefore floored at ~1.6 texels so an edge
 * is always something the map can actually resolve.
 */
float bk_cellEdge(vec4 v, float width, vec2 per){
  float texelInCells = max(max(per.x, per.y), 1.0) * uP[9].x;
  float w = max(width, texelInCells * 1.6);
  return 1.0 - smoothstep(0.0, w, v.y - v.x);
}

/** Multi-octave Worley — porous, spongy, foamy structure. */
float bk_worleyFbm(vec2 p, vec2 per, int oct, float jitter){
  float a = 0.6, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * (1.0 - bk_voronoi(p, per, jitter).x);
    n += a;
    if (bk_atCeiling(per, BK_TEXELS_CELL)) break;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / max(n, 1e-4);
}

/* ---------------------------------------------------------------- *
 * Small utilities
 * ---------------------------------------------------------------- */

/**
 * Sparse bright glints: returns 0..1, 'density' in 0..1 controls coverage.
 *
 * The dot radius is floored at ~2 texels. A one-texel glint is not a quartz
 * grain catching the light, it is salt-and-pepper noise: it cannot survive mip
 * filtering, and while it lives it is indistinguishable from a stuck pixel.
 */
float bk_sparkle(vec2 p, vec2 per, float density){
  per = bk_snapPeriodT(p, per, BK_TEXELS_DOT);
  vec2 ip = floor(p);
  vec3 h = bk_h23(mod(ip, per) + 3.7);
  vec2 c = h.xy;
  float d = length((p - ip) - c);
  float on = step(1.0 - density, h.z);
  float rad = max(0.34, max(per.x, per.y) * uP[9].x * 2.0);
  return on * (1.0 - smoothstep(0.0, rad, d));
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
  k = bk_limitK(k);
  float phase = dot(uv, k) * BK_TAU + bk_fbm(uv * per, per, 3, 0.5) * wobble;
  // pow() on a sine crest sharpens toward a cusp; keep the exponent bounded by
  // how many texels a half-wavelength actually occupies, or the crest line
  // itself becomes a sub-texel hairline.
  float texelsPerWave = BK_RES / max(length(k), 1e-4);
  float maxSharp = max(1.0, texelsPerWave * 0.35);
  return pow(0.5 + 0.5 * sin(phase), min(sharp, maxSharp));
}

/**
 * Periodic pulse train, for panel lines / laminations / hazard stripes / seams.
 * 'duty' is the pulse width as a fraction of the period; the pulse is centred on
 * the period boundary so it never notches at t = 0.
 */
float bk_stripe(vec2 uv, vec2 k, float duty, float soft, float wobble, vec2 per){
  k = bk_limitK(k);
  float t = fract(dot(uv, k) + bk_fbm(uv * per, per, 3, 0.5) * wobble);
  float d = min(t, 1.0 - t);
  // duty and soft are fractions of one stripe period; floor the falloff at ~1.5
  // texels so a panel line or weld seam antialiases instead of stair-stepping.
  float texelFrac = max(length(k), 1e-4) * uP[9].x;
  float s = max(soft, texelFrac * 1.5);
  return 1.0 - smoothstep(duty * 0.5, duty * 0.5 + s, d);
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

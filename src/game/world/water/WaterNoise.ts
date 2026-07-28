/**
 * Private GLSL noise for the water system.
 *
 * `core/Noise.ts`'s `NOISE_GLSL` cannot currently be included in a shader at
 * all: its `snoise(vec2)` calls `sn_permute(vec3)`, but only the `vec4` overload
 * is defined, so the chunk fails to link even if you never call it. (Reported
 * to the integrator — it is a one-line fix in a file this module does not own.)
 *
 * Everything here is prefixed `wn` so it can never collide with that chunk once
 * it is fixed, or with any other module's helpers.
 *
 * `wnVoronoiTiled` is the important one: its cell hash wraps modulo a period, so
 * the caustics tile is genuinely seamless instead of nearly seamless.
 */
export const WATER_NOISE_GLSL = /* glsl */ `
vec2 wnMod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 wnMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 wnMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 wnPermute(vec3 x) { return wnMod289(((x * 34.0) + 1.0) * x); }
vec4 wnPermute(vec4 x) { return wnMod289(((x * 34.0) + 1.0) * x); }
vec4 wnTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float wnHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 wnHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

/** 2D simplex noise in roughly [-1, 1]. */
float wnSnoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = wnMod289(i);
  vec3 p = wnPermute(wnPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float wnFbm(vec2 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * wnSnoise(p);
    n += a;
    p *= 2.03;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}

/** Voronoi. x = F1 distance, y = F2 distance, z = cell id in 0..1. */
vec3 wnVoronoi(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = wnHash22(ip + g);
      float d = length(g + o - fp);
      if (d < f1) { f2 = f1; f1 = d; id = o.x * 0.5 + o.y * 0.5; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(f1, f2, id);
}

/**
 * Voronoi whose cell hash wraps every 'period' cells, so the pattern is exactly
 * periodic — required for anything baked into a tiling texture.
 */
vec3 wnVoronoiTiled(vec2 p, float period) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = wnHash22(mod(ip + g, period));
      float d = length(g + o - fp);
      if (d < f1) { f2 = f1; f1 = d; id = o.x * 0.5 + o.y * 0.5; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(f1, f2, id);
}
`;

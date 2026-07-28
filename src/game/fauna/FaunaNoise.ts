/**
 * Self-contained GLSL noise for the creature shaders.
 *
 * `core/Noise.ts` exports a shared `NOISE_GLSL` chunk, but every symbol in it is
 * unprefixed (`snoise`, `fbm`, `voronoi`, `hash12`, `sn_permute`...), and several
 * modules now concatenate it alongside the water system's material patch. That
 * collides, and the shared chunk also has a real bug: its 2D `snoise` calls
 * `sn_permute` with a vec3 while only the vec4 overload is declared, so any
 * program including it fails to link (see INTEGRATION REQUESTS).
 *
 * Everything here is namespaced `fn*` so it cannot clash with anything injected
 * into the same program by another system, and it is field-compatible with the
 * shared chunk (same Ashima simplex formulation) so terrain and creatures agree.
 */
export const FAUNA_NOISE_GLSL = /* glsl */ `
vec3 fnMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 fnMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 fnPermute(vec3 x) { return fnMod289(((x * 34.0) + 1.0) * x); }
vec4 fnPermute(vec4 x) { return fnMod289(((x * 34.0) + 1.0) * x); }
vec4 fnTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

/** 2D simplex noise, [-1, 1]. */
float fnSnoise2(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = fnPermute(fnPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/** 3D simplex noise, [-1, 1]. */
float fnSnoise3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
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
  i = fnMod289(i);
  vec4 p = fnPermute(fnPermute(fnPermute(
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
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = fnTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/** Fractional Brownian motion over 2D simplex; 4 octaves. */
float fnFbm2(vec2 p) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * fnSnoise2(p);
    n += a;
    p *= 2.03;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}

/** Voronoi F1/F2 + cell hash. x = F1, y = F2, z = per-cell random. */
vec3 fnVoronoi(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = fract(sin(vec2(dot(ip + g, vec2(127.1, 311.7)),
                              dot(ip + g, vec2(269.5, 183.3)))) * 43758.5453);
      float d = length(g + o - fp);
      if (d < f1) { f2 = f1; f1 = d; id = fract(o.x * 3.1 + o.y * 7.7); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(f1, f2, id);
}
`;

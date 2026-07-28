/**
 * Shared GLSL building blocks for the post stack.
 *
 * Everything here assumes three's ShaderMaterial path, which is always compiled
 * as `#version 300 es` on WebGL2 — so `textureLod`, dynamic loops and modern
 * built-ins are available while still writing `varying` / `gl_FragColor` /
 * `texture2D` in GLSL1 style (three defines them away).
 *
 * Colour policy for the whole stack: everything between the scene render and the
 * very last line of `GradePass` is **linear** and stored in half float. The sRGB
 * transfer function is applied exactly once, at the end of `GradePass`.
 */

/** Fullscreen-triangle vertex shader (matches {@link Blitter}'s geometry). */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Small maths helpers: colour spaces, hashes, luminance. */
export const MATH_GLSL = /* glsl */ `
const float PI = 3.14159265359;
const vec3 LUMA_W = vec3(0.2126, 0.7152, 0.0722);

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2  sat(vec2 x)  { return clamp(x, vec2(0.0), vec2(1.0)); }
vec3  sat(vec3 x)  { return clamp(x, vec3(0.0), vec3(1.0)); }

float luma(vec3 c) { return dot(c, LUMA_W); }
float maxc(vec3 c) { return max(c.r, max(c.g, c.b)); }

// Reversible YCoCg — the right space for temporal neighbourhood clipping because
// chroma and luma variance decorrelate.
vec3 rgb2ycocg(vec3 c) {
  return vec3(
     0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
     0.5  * c.r              - 0.5  * c.b,
    -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 ycocg2rgb(vec3 c) {
  float t = c.x - c.z;
  return vec3(t + c.y, c.x + c.z, t - c.y);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
/** Jimenez interleaved-gradient noise — spatially high frequency, cheap. */
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

/** Depth reconstruction. `tDepth` is a real depth attachment (window z, 0..1). */
export const DEPTH_GLSL = /* glsl */ `
// three's perspectiveDepthToViewZ. Returns a NEGATIVE view-space z.
float viewZFromDepth(float d, float near, float far) {
  return (near * far) / ((far - near) * d - far);
}
/** 0 at the near plane, 1 at the far plane, linear in metres. */
float linear01(float d, float near, float far) {
  return -viewZFromDepth(d, near, far) / far;
}
/** Metres in front of the eye. */
float depthMetres(float d, float near, float far) {
  return -viewZFromDepth(d, near, far);
}
vec3 viewPosFromDepth(vec2 uv, float d, mat4 projInv) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = projInv * ndc;
  return v.xyz / v.w;
}
// Unit ray from the eye through uv, in view space.
vec3 viewRay(vec2 uv, mat4 projInv) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec4 v = projInv * ndc;
  return normalize(v.xyz / v.w);
}
`;

/**
 * G-buffer layout produced by {@link GeometryPrepass}:
 *   attachment 0: RGBA16F — `rgb` = world-space normal, `a` = coverage mask
 *                 (1 = geometry, 0 = sky/background).
 * Other systems may sample `PostStack.normalTexture` with this decode.
 */
export const GBUFFER_GLSL = /* glsl */ `
vec3 gbufferNormal(sampler2D tNormal, vec2 uv) {
  vec3 n = texture2D(tNormal, uv).xyz;
  float l = length(n);
  return l > 1e-4 ? n / l : vec3(0.0, 1.0, 0.0);
}
float gbufferMask(sampler2D tNormal, vec2 uv) {
  return texture2D(tNormal, uv).w;
}
`;

/** Filmic tonemappers. Both take linear scene-referred and return linear display. */
export const TONEMAP_GLSL = /* glsl */ `
// --- ACES (Stephen Hill's RRT+ODT fit) ---
const mat3 ACES_IN = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(
  1.60475, -0.10208, -0.00327,
 -0.53108,  1.10813, -0.07276,
 -0.07367, -0.00605,  1.07602);
vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 tonemapACES(vec3 c) {
  c = ACES_IN * c;
  c = rrtOdtFit(c);
  return sat(ACES_OUT * c);
}

// --- AgX (Sobotka's curve, Blender/Filament inset+outset matrices) ---
const mat3 AGX_IN = mat3(
  0.8424790622530, 0.0423282422610, 0.0423756549057,
  0.0784335999999, 0.8784686364698, 0.0784336000000,
  0.0792237451478, 0.0791661274605, 0.8791429737931);
const mat3 AGX_OUT = mat3(
  1.1968790051202, -0.0528968517575, -0.0529716355144,
 -0.0980208811401,  1.1519031299042, -0.0980434501171,
 -0.0990297440797, -0.0989611768448,  1.1510736726412);
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x
       + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 tonemapAgX(vec3 c, float saturation, float punch) {
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  c = AGX_IN * max(c, vec3(0.0));
  c = clamp(log2(max(c, vec3(1e-10))), minEv, maxEv);
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrast(c);
  // "look": power for contrast punch, then saturation about luma.
  c = pow(max(c, vec3(0.0)), vec3(punch));
  float l = luma(c);
  c = l + saturation * (c - l);
  c = AGX_OUT * c;
  return sat(pow(max(c, vec3(0.0)), vec3(2.2)));   // -> linear display referred
}
`;

/** sRGB transfer functions. Only ever used once, in GradePass. */
export const SRGB_GLSL = /* glsl */ `
vec3 srgbOETF(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c));
}
vec3 srgbEOTF(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

/**
 * 5-tap Catmull-Rom bilinear reconstruction. Used for the TAA history fetch so
 * reprojection does not soften the image every frame (the single biggest cause
 * of "TAA mush").
 */
export const CATMULL_ROM_GLSL = /* glsl */ `
vec4 sampleCatmullRom(sampler2D tex, vec2 uv, vec2 texSize) {
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / max(w12, vec2(1e-5));

  vec2 texPos0 = (texPos1 - 1.0) / texSize;
  vec2 texPos3 = (texPos1 + 2.0) / texSize;
  vec2 texPos12 = (texPos1 + offset12) / texSize;

  vec4 result = vec4(0.0);
  result += texture2D(tex, vec2(texPos12.x, texPos0.y))  * w12.x * w0.y;
  result += texture2D(tex, vec2(texPos0.x,  texPos12.y)) * w0.x  * w12.y;
  result += texture2D(tex, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
  result += texture2D(tex, vec2(texPos3.x,  texPos12.y)) * w3.x  * w12.y;
  result += texture2D(tex, vec2(texPos12.x, texPos3.y))  * w12.x * w3.y;
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return result / max(wsum, 1e-5);
}
`;

/** Everything most passes need, in one string. */
export const POST_COMMON = MATH_GLSL + DEPTH_GLSL + GBUFFER_GLSL;

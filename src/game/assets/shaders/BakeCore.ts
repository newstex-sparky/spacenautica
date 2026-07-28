/**
 * Shared scaffolding for every procedural material bake.
 *
 * A family shader only has to provide two functions:
 *
 *   float matHeight(vec2 uv);                       // the height field, 0..1
 *   void  matSurface(MatCtx c, inout MatOut o);     // albedo / rough / metal
 *
 * This file supplies everything else, identically for all families:
 *
 *  - a full-screen quad vertex stage,
 *  - the tangent-space normal, derived by central differences of the *height
 *    field function* (never a sobel of the albedo — that bakes colour detail
 *    into the geometry and is the classic "fake normal map" tell),
 *  - mean-vs-centre curvature at two radii, which drives grime in cavities and
 *    wear on convex edges,
 *  - horizon-ratio ambient occlusion from the same height field at two radii,
 *  - MRT packing so one draw call produces albedo, normal+height and ORM
 *    (optionally a fourth displacement/aux target).
 *
 * Channel layout (frozen — other systems rely on it):
 *   target 0  rgb = albedo (linear; the attachment is SRGB8_ALPHA8 so the
 *                   hardware encodes on write and decodes on sample)
 *             a   = opacity / coverage mask
 *   target 1  rgb = tangent-space normal, 0..1 encoded
 *             a   = height, 0..1   <-- parallax + POM read this
 *   target 2  r   = ambient occlusion      (three's aoMap reads .r)
 *             g   = roughness              (three's roughnessMap reads .g)
 *             b   = metalness              (three's metalnessMap reads .b)
 *             a   = aux: emissive mask / iridescence / translucency per family
 *   target 3  r   = height (so it works directly as a displacementMap, .x)
 *             g   = curvature, 0.5-centred
 *             b   = anisotropic flow direction proxy
 *             a   = micro-sparkle mask
 */

export const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Declarations + family contract. Injected before the family body. */
export const BAKE_PROLOGUE = /* glsl */ `
precision highp float;

varying vec2 vUv;

/* uP slots, shared by every family:
 *  0: macro cells.xy, macro amplitude.z, warp amount.w
 *  1: mid cells.xy,   mid amplitude.z,   mid octaves.w
 *  2: micro cells.xy, micro amplitude.z, micro roughness.w
 *  3: family tuning A
 *  4: family tuning B
 *  5: family tuning C
 *  6: roughness base.x, roughness variance.y, metalness base.z, aux base.w
 *  7: hue jitter.x, value jitter.y, cavity grime.z, edge wear.w
 *  8: aniso dir.xy (unit), aniso stretch.z, spare.w
 *  9: sample epsilon.x, bump strength.y, AO strength.z, curvature gain.w
 */
uniform vec4 uP[10];
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uColD;
uniform int  uSub;
uniform int  uAoTaps;

struct MatCtx {
  vec2  uv;
  float h;      // height at uv, 0..1
  float curv;   // ring mean - centre; > 0 cavity, < 0 ridge
  float curvHi; // same at the micro radius
  float ao;     // 0..1
  float slope;  // |grad h|, uv units
  vec3  n;      // tangent-space normal
};

struct MatOut {
  vec3  albedo;   // linear
  float opacity;
  float rough;
  float metal;
  float aux;
  float sparkle;
};

float matHeight(vec2 uv);
void  matSurface(MatCtx c, inout MatOut o);
`;

/** The main() frame. Injected after the family body. */
export const BAKE_EPILOGUE = /* glsl */ `
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oOrm;
#ifdef WANT_DISPLACEMENT
layout(location = 3) out vec4 oAux;
#endif

void main(){
  vec2 uv = vUv;
  float e = uP[9].x;

  float hC = matHeight(uv);
  float hL = matHeight(uv - vec2(e, 0.0));
  float hR = matHeight(uv + vec2(e, 0.0));
  float hD = matHeight(uv - vec2(0.0, e));
  float hU = matHeight(uv + vec2(0.0, e));

  // Analytic-by-differences gradient of the height field.
  float dHdu = (hR - hL) / (2.0 * e);
  float dHdv = (hU - hD) / (2.0 * e);
  vec3 n = normalize(vec3(-dHdu * uP[9].y, -dHdv * uP[9].y, 1.0));
  float slope = length(vec2(dHdu, dHdv));

  // Two rings of taps: the near ring gives micro curvature + contact AO, the
  // far ring gives the macro form factor. Both reuse matHeight, so occlusion
  // agrees with the normal map exactly.
  float rNear = e * 3.0;
  float rFar  = e * 14.0;
  float sumNear = 0.0;
  float sumFar = 0.0;
  float occNear = 0.0;
  float occFar = 0.0;
  float taps = float(uAoTaps);
  for (int i = 0; i < 8; i++){
    if (i >= uAoTaps) break;
    float a = (float(i) + 0.5) * BK_TAU / taps;
    vec2 d = vec2(cos(a), sin(a));
    float hn = matHeight(uv + d * rNear);
    float hf = matHeight(uv + d * rFar);
    sumNear += hn;
    sumFar += hf;
    occNear += max(0.0, hn - hC) / rNear;
    occFar  += max(0.0, hf - hC) / rFar;
  }
  sumNear /= taps; sumFar /= taps;
  occNear /= taps; occFar /= taps;

  float curvHi = (sumNear - hC) * uP[9].w;
  float curv   = (sumFar - hC) * uP[9].w;
  float ao = 1.0 - clamp((occNear * 0.45 + occFar * 0.55) * uP[9].z, 0.0, 1.0);
  ao = clamp(ao, 0.0, 1.0);
  // Slight gamma so contact shadows stay tight instead of washing the map out.
  ao = pow(ao, 1.35);

  MatCtx c;
  c.uv = uv;
  c.h = hC;
  c.curv = curv;
  c.curvHi = curvHi;
  c.ao = ao;
  c.slope = slope;
  c.n = n;

  MatOut o;
  o.albedo = uColA;
  o.opacity = 1.0;
  o.rough = uP[6].x;
  o.metal = uP[6].z;
  o.aux = uP[6].w;
  o.sparkle = 0.0;
  matSurface(c, o);

  // Cavity grime and convex wear are applied here so every family gets them
  // for free and consistently: grime darkens + roughens, wear brightens +
  // polishes. Both are driven by curvature of the height field, not by noise.
  float cavity = clamp(c.curv * 2.0, 0.0, 1.0);
  float edge   = clamp(-c.curvHi * 2.2, 0.0, 1.0);
  float grime  = cavity * uP[7].z;
  float wear   = edge * uP[7].w;
  o.albedo = mix(o.albedo, o.albedo * uColD, grime);
  o.rough  = mix(o.rough, min(0.97, o.rough + 0.25), grime);
  o.rough  = mix(o.rough, max(0.05, o.rough - 0.18), wear);
  o.albedo *= 1.0 + wear * 0.16;

  o.rough = clamp(o.rough, 0.03, 1.0);
  o.metal = clamp(o.metal, 0.0, 1.0);

  oAlbedo = vec4(max(o.albedo, vec3(0.0)), clamp(o.opacity, 0.0, 1.0));
  oNormal = vec4(n * 0.5 + 0.5, clamp(hC, 0.0, 1.0));
  oOrm    = vec4(ao, o.rough, o.metal, clamp(o.aux, 0.0, 1.0));
#ifdef WANT_DISPLACEMENT
  oAux    = vec4(clamp(hC, 0.0, 1.0), clamp(c.curv * 0.5 + 0.5, 0.0, 1.0),
                 clamp(0.5 + dHdu * 0.5, 0.0, 1.0), clamp(o.sparkle, 0.0, 1.0));
#endif
}
`;

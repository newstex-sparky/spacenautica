/**
 * Utility maps other systems layer on top of their own shading.
 *
 * Sub-types (uSub): 0 detail_grunge, 1 detail_noise, 2 foam_mask,
 *                   3 caustic_tile, 4 wet_ripple.
 *
 * These are *data*, so their albedo attachment is allocated linear (no sRGB
 * transfer) — see `MaterialDefs.dataAlbedo`.
 *
 *  detail_grunge  rgb = grey grunge multiplier, a = coverage
 *  detail_noise   r = fbm, g = worley, b = ridged, a = white hash
 *  foam_mask      rgb = foam colour, a = coverage
 *  caustic_tile   rgb = caustic irradiance with chromatic dispersion, a = luma
 *  wet_ripple     normal + height are the payload; rgb = wetness tint
 *
 * Params
 *   uP[3] = primary cells.xy, sharpness.z, secondary weight.w
 *   uP[4] = dispersion.x, bubble density.y, spare.zw
 */
export const UTILITY_GLSL = /* glsl */ `
/**
 * Caustic web. Light refracted through a wavy surface concentrates on the
 * equidistant boundaries between wave "lenses", which is exactly the F2-F1
 * Voronoi edge field; raising it to a high power gives the thin bright filaments
 * and bright nodes where filaments cross.
 */
float causticWeb(vec2 uv, vec2 cells, float warpAmt, float sharp){
  vec2 p = uv * cells;
  p += bk_warp(p, cells, warpAmt);
  vec4 v = bk_voronoi(p, cells, 1.0);
  float edge = 1.0 - clamp((v.y - v.x) * 1.6, 0.0, 1.0);
  float node = 1.0 - clamp(v.x * 1.4, 0.0, 1.0);
  return pow(edge, sharp) + pow(node, sharp * 1.6) * 0.55;
}

float matHeight(vec2 uv){
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;
  float h = 0.5;

  if (uSub == 0) {
    // Grunge relief: three scales of dirt build-up.
    h = 0.42
      + bk_fbm(uv * mC, mC, 4, 0.6) * uP[0].z
      + bk_worleyFbm(uv * dC, dC, 3, 1.0) * uP[1].z
      + bk_fbm(uv * uC, uC, 3, 0.55) * uP[2].z;
  } else if (uSub == 1) {
    h = 0.5 + bk_fbm(uv * dC, dC, 5, 0.55) * uP[1].z;
  } else if (uSub == 2) {
    // Foam: packed bubble rafts, larger bubbles where foam is thickest.
    float thick = 0.5 + 0.5 * bk_fbm(uv * mC, mC, 4, 0.6);
    vec4 b1 = bk_voronoi(uv * dC, dC, 1.0);
    vec4 b2 = bk_voronoi(uv * dC * 2.3, dC * 2.3, 1.0);
    float bub = mix(1.0 - b2.x, 1.0 - b1.x, thick);
    h = 0.4 + pow(clamp(bub, 0.0, 1.0), 1.6) * uP[1].z + thick * uP[0].z;
  } else if (uSub == 3) {
    h = 0.5 + causticWeb(uv, uP[3].xy, 0.8, uP[3].z) * 0.08;
  } else {
    // Wet ripple: crossed capillary wave trains, the payload is the normal.
    h = 0.5
      + bk_ripple(uv, uP[3].xy, 1.1, dC, 1.6) * uP[1].z
      + bk_ripple(uv, uP[3].xy.yx * vec2(-1.0, 1.0) + vec2(2.0, 1.0), 1.5, dC, 1.4) * uP[1].z * 0.7
      + bk_fbm(uv * uC, uC, 3, 0.6) * uP[2].z;
  }
  return clamp(h, 0.0, 1.0);
}

void matSurface(MatCtx c, inout MatOut o){
  vec2 uv = c.uv;
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;

  if (uSub == 0) {
    // Grunge: a multiply layer. Mid-grey mean so it darkens without shifting hue.
    float g = c.h;
    float streak = 0.5 + 0.5 * bk_fbm(vec2(uv.x * dC.x * 2.0, uv.y * 2.0), vec2(dC.x * 2.0, 2.0), 4, 0.6);
    g = mix(g, g * streak, 0.45);
    vec3 col = mix(uColA, uColB, clamp(g * 1.3, 0.0, 1.0));
    o.albedo = col;
    o.opacity = clamp(1.0 - g * 1.1, 0.0, 1.0);
    o.rough = uP[6].x + (1.0 - g) * uP[6].y;
    o.aux = clamp(1.0 - g, 0.0, 1.0);
  } else if (uSub == 1) {
    // A four-channel noise pack other systems can sample once instead of
    // evaluating fbm in their own shaders.
    float f = 0.5 + 0.5 * bk_fbm(uv * dC, dC, 5, 0.55);
    float w = 1.0 - bk_voronoi(uv * dC, dC, 1.0).x;
    float r = bk_ridge(uv * dC, dC, 5);
    float n = bk_h21(floor(uv * uC));
    o.albedo = vec3(f, w, r);
    o.opacity = n;
    o.rough = 0.5;
    o.aux = n;
  } else if (uSub == 2) {
    float thick = 0.5 + 0.5 * bk_fbm(uv * mC, mC, 4, 0.6);
    vec4 b1 = bk_voronoi(uv * dC, dC, 1.0);
    float rim = bk_cellEdge(b1, 0.16);
    vec3 col = mix(uColA, uColB, rim * 0.6);
    // thinner at the edges of the raft, and torn by the shear noise
    float cover = smoothstep(0.34, 0.72, thick) * (0.55 + 0.6 * (1.0 - b1.x));
    cover *= 0.6 + 0.55 * (0.5 + 0.5 * bk_fbm(uv * dC * 2.0, dC * 2.0, 4, 0.6));
    o.albedo = col;
    o.opacity = clamp(cover, 0.0, 1.0);
    o.rough = uP[6].x - rim * 0.2;
    o.aux = clamp(cover, 0.0, 1.0);
  } else if (uSub == 3) {
    // Chromatic dispersion: red, green and blue focus at slightly different
    // warp offsets, which is what gives real caustics their coloured fringes.
    float d = uP[4].x;
    float r = causticWeb(uv, uP[3].xy, 0.8 - d, uP[3].z);
    float g = causticWeb(uv, uP[3].xy, 0.8, uP[3].z);
    float b = causticWeb(uv, uP[3].xy, 0.8 + d, uP[3].z);
    // second, larger-scale system so the network has structure at two scales
    float g2 = causticWeb(uv, uP[3].xy * 0.45, 1.1, uP[3].z * 0.7);
    vec3 col = vec3(r, g, b) * (0.7 + uP[3].w * g2);
    col = col * uColA + uColB * g2 * 0.15;
    o.albedo = col;
    o.opacity = clamp(bk_luma(col), 0.0, 1.0);
    o.rough = 1.0;
    o.aux = clamp(g, 0.0, 1.0);
  } else {
    float wet = 0.5 + 0.5 * bk_fbm(uv * mC, mC, 3, 0.6);
    o.albedo = mix(uColA, uColB, wet);
    o.opacity = 1.0;
    o.rough = uP[6].x + wet * uP[6].y;
    o.aux = wet;
  }

  o.metal = 0.0;
  o.sparkle = bk_sparkle(uv * uC, uC, 0.05);
}
`;

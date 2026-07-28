/**
 * Reef organics: brain/tube/fan coral, sponge, algae mat, kelp blade, seagrass,
 * bioluminescent tissue.
 *
 * Sub-types (uSub): 0 brain, 1 tube, 2 fan, 3 sponge, 4 algae mat,
 *                   5 kelp blade, 6 seagrass, 7 bioluminescent.
 *
 * The shared trick for all of these is a fake-thickness term: crevices get
 * darker *and more saturated*, tips get lighter and desaturated. That is what
 * subsurface scattering does to a translucent organism, and it is the difference
 * between "coral" and "a lumpy grey rock".
 *
 * Params
 *   uP[3] = structure cells.xy, meander frequency.z, rim sharpness.w
 *   uP[4] = polyp cells.xy, polyp depth.z, bleach amount.w
 *   uP[5] = vein wave numbers.xy, epiphyte density.z, translucency.w
 */
export const ORGANIC_GLSL = /* glsl */ `
/** Labyrinthine meander used by brain coral and by cerebriform sponges. */
float organicMeander(vec2 uv, vec2 cells, float freq){
  vec2 p = uv * cells;
  p += bk_warp(p, cells, 1.15);
  float f = bk_fbm(p, cells, 4, 0.6);
  // Folding a smooth field through sin() produces nested, non-repeating ridges.
  return 0.5 + 0.5 * sin(f * freq * BK_TAU);
}

float matHeight(vec2 uv){
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;
  float h = 0.45 + bk_fbm(uv * mC + bk_warp(uv * mC, mC, uP[0].w), mC, 3, 0.6) * uP[0].z;

  if (uSub == 0) {
    // Brain coral: meandering ridges with rounded crowns and deep valleys.
    float m = organicMeander(uv, uP[3].xy, uP[3].z);
    float ridge = pow(m, 0.55);
    h += ridge * uP[1].z;
    // corallite rows along the ridge crests
    vec4 pv = bk_voronoi(uv * uP[4].xy, uP[4].xy, 0.85);
    h -= (1.0 - smoothstep(0.0, 0.34, pv.x)) * uP[4].z * ridge;
  } else if (uSub == 1) {
    // Tube coral: raised rims around dark central mouths.
    vec4 v = bk_voronoi(uv * uP[3].xy, uP[3].xy, 0.82);
    float r = v.x;
    float wall = 0.30 + v.z * 0.16;
    float rim = exp(-pow(abs(r - wall) / max(uP[3].w, 1e-3), 2.0));
    float bore = 1.0 - smoothstep(wall * 0.35, wall * 0.85, r);
    h += rim * uP[1].z - bore * uP[1].z * 1.1;
    h += bk_ripple(uv, uP[5].xy, 1.0, uC, 1.0) * uP[2].z * 2.0; // longitudinal ribs
  } else if (uSub == 2) {
    // Gorgonian fan: an anisotropic strut lattice with cross-links.
    vec2 sp = uv * uP[3].xy * vec2(1.0, 0.34);
    vec4 v = bk_voronoi(sp, uP[3].xy * vec2(1.0, 0.34), 0.95);
    float strut = bk_cellEdge(v, uP[3].w);
    vec4 v2 = bk_voronoi(bk_shear(uv, 1.0, 0.0) * uP[3].xy * vec2(0.34, 1.0),
                         uP[3].xy * vec2(0.34, 1.0), 0.9);
    strut = max(strut, bk_cellEdge(v2, uP[3].w) * 0.8);
    h = 0.30 + strut * uP[1].z * 1.4;
    // polyps studded along the struts
    h += strut * bk_ripple(uv, uP[4].xy, 0.6, uC, 2.0) * uP[4].z;
  } else if (uSub == 3) {
    // Sponge: porous body with a few large oscula.
    float pore = bk_worleyFbm(uv * uP[3].xy, uP[3].xy, 3, 1.0);
    h -= pow(pore, 1.6) * uP[1].z;
    vec4 os = bk_voronoi(uv * uP[3].xy * 0.32, uP[3].xy * 0.32, 1.0);
    h -= step(0.72, os.z) * (1.0 - smoothstep(0.0, 0.30, os.x)) * 0.30;
  } else if (uSub == 4) {
    // Algae mat: filamentous, clumped, directional.
    vec2 fp = uv * vec2(uC.x * 2.0, uC.y * 0.35);
    float fil = 0.5 + 0.5 * bk_fbm(fp, vec2(uC.x * 2.0, uC.y * 0.35), 4, 0.6);
    float clump = 0.5 + 0.5 * bk_fbm(uv * dC, dC, 3, 0.6);
    h += fil * clump * uP[1].z;
  } else if (uSub == 5) {
    // Kelp blade: central midrib, transverse wrinkles, gas bladders.
    float mid = exp(-pow((uv.x - 0.5) / 0.09, 2.0));
    h += mid * uP[1].z * 1.2;
    h += bk_ripple(uv, uP[5].xy, 1.6, dC, 1.2) * uP[1].z * 0.55 * (1.0 - mid * 0.7);
    vec4 bl = bk_voronoi(uv * uP[4].xy, uP[4].xy, 0.9);
    h += step(0.70, bl.z) * (1.0 - smoothstep(0.0, 0.40, bl.x)) * uP[4].z;
    // ruffled, torn margins
    h -= smoothstep(0.42, 0.5, abs(uv.x - 0.5)) * 0.10;
  } else if (uSub == 6) {
    // Seagrass: parallel veins and fine longitudinal striations.
    h += bk_ripple(uv, uP[5].xy, 0.4, uC, 1.6) * uP[1].z;
    h += bk_ripple(uv, uP[5].xy * 3.0, 0.3, uC, 1.2) * uP[2].z * 2.0;
    h -= smoothstep(0.44, 0.5, abs(uv.x - 0.5)) * 0.06;
  } else {
    // Bioluminescent tissue: cellular vesicles with bright cores.
    vec4 v = bk_voronoi(uv * uP[3].xy, uP[3].xy, 0.9);
    h += (1.0 - smoothstep(0.0, 0.42, v.x)) * uP[1].z;
    h -= bk_cellEdge(v, 0.10) * uP[1].z * 0.5;
  }

  h += bk_fbm(uv * uC, uC, 3, 0.55) * uP[2].z;
  return clamp(h, 0.0, 1.0);
}

void matSurface(MatCtx c, inout MatOut o){
  vec2 uv = c.uv;
  vec2 mC = uP[0].xy;
  vec2 uC = uP[2].xy;

  // Fake thickness: deep = saturated + dark, proud = pale + desaturated.
  float depth = 1.0 - c.h;
  float macro = bk_fbm(uv * mC * 0.7, mC * 0.7, 4, 0.6);

  vec3 base = mix(uColB, uColA, smoothstep(0.15, 0.9, c.h));
  base = bk_hueShift(base, macro * uP[7].x);
  base *= 1.0 + macro * uP[7].y;
  // saturate toward the shadowed interior
  float lum = bk_luma(base);
  base = mix(vec3(lum), base, 1.0 + depth * 0.55);
  base *= mix(0.55, 1.08, c.h);

  float emissive = 0.0;
  float translucency = uP[5].w;

  if (uSub == 0) {
    // per-lobe hue drift; brain corals are patchy green/gold/olive
    float m = organicMeander(uv, uP[3].xy, uP[3].z);
    base = mix(base, uColC, smoothstep(0.55, 1.0, m) * 0.45);
    vec4 pv = bk_voronoi(uv * uP[4].xy, uP[4].xy, 0.85);
    base *= 0.82 + 0.36 * pv.z;                        // per-corallite variance
    base = mix(base, base * 0.45, 1.0 - smoothstep(0.0, 0.3, pv.x));
  } else if (uSub == 1) {
    vec4 v = bk_voronoi(uv * uP[3].xy, uP[3].xy, 0.82);
    base = bk_hueShift(base, (v.z - 0.5) * 0.55);       // per-tube hue
    base *= 0.75 + 0.5 * v.w;
    float bore = 1.0 - smoothstep(0.10, 0.28, v.x);
    base = mix(base, base * 0.18, bore);               // dark mouths
    translucency *= 1.0 - bore;
  } else if (uSub == 2) {
    vec4 v = bk_voronoi(uv * uP[3].xy * vec2(1.0, 0.34), uP[3].xy * vec2(1.0, 0.34), 0.95);
    base = bk_hueShift(base, (v.z - 0.5) * 0.35);
    o.opacity = clamp(bk_cellEdge(v, uP[3].w * 1.6) * 1.6, 0.0, 1.0);
  } else if (uSub == 3) {
    float pore = bk_worleyFbm(uv * uP[3].xy, uP[3].xy, 3, 1.0);
    base = mix(base, base * vec3(0.35, 0.30, 0.34), pore * 0.8);
  } else if (uSub == 4) {
    // algae: chlorophyll green with senescent yellow-brown patches
    float sen = smoothstep(0.55, 0.95, 0.5 + 0.5 * bk_fbm(uv * mC * 1.4 + 5.0, mC * 1.4, 4, 0.6));
    base = mix(base, uColC, sen * 0.7);
  } else if (uSub == 5 || uSub == 6) {
    // kelp / seagrass: light gradient along the blade, epiphytes, torn edges
    float alongBlade = uv.y;
    base *= mix(0.70, 1.12, alongBlade);
    float sen = smoothstep(0.6, 1.0, 0.5 + 0.5 * bk_fbm(uv * mC * 1.2 + 9.0, mC * 1.2, 3, 0.6));
    base = mix(base, uColC, sen * 0.65);
    // encrusting bryozoans: small pale rosettes
    vec4 ep = bk_voronoi(uv * uC * 0.5, uC * 0.5, 1.0);
    float epi = step(1.0 - uP[5].z, ep.z) * (1.0 - smoothstep(0.10, 0.22, ep.x));
    base = mix(base, vec3(0.72, 0.70, 0.62), epi * 0.8);
    float edge = smoothstep(0.44, 0.5, abs(uv.x - 0.5));
    o.opacity = 1.0 - edge * 0.9;
    translucency = mix(translucency, 1.0, 0.5);
  } else if (uSub == 7) {
    vec4 v = bk_voronoi(uv * uP[3].xy, uP[3].xy, 0.9);
    float core = 1.0 - smoothstep(0.0, 0.26, v.x);
    // only some vesicles are lit, and they pulse in brightness
    float lit = smoothstep(0.35, 0.75, v.z);
    emissive = core * lit * (0.55 + 0.45 * v.w);
    base = mix(base, uColC, core * lit * 0.85);
    base *= 0.5 + 0.9 * lit;
  }

  // Bleached / dead patches on the most exposed convex tips.
  float bleach = smoothstep(0.72, 1.0, c.h) * uP[4].w
               * smoothstep(0.45, 0.9, 0.5 + 0.5 * bk_fbm(uv * mC * 2.1 + 31.0, mC * 2.1, 3, 0.6));
  base = mix(base, vec3(0.78, 0.76, 0.71), bleach);

  // Micro polyp/pore speckle at the very finest scale.
  float speck = bk_sparkle(uv * uC * 1.2, uC * 1.2, 0.16);
  base *= 1.0 - speck * 0.28;

  // Roughness: living tissue is wet and glossy in the folds, matte where
  // bleached or algal-fuzzed.
  float rvar = bk_fbm(uv * uC * 0.45, uC * 0.45, 3, 0.55);
  float rough = uP[6].x + rvar * uP[6].y;
  rough -= clamp(c.curv, 0.0, 1.0) * 0.12;   // mucus pools in the crevices
  rough += bleach * 0.35;
  rough = clamp(rough, 0.06, 1.0);

  o.albedo = base;
  o.rough = rough;
  o.metal = 0.0;
  o.aux = max(emissive, translucency * 0.75);
  o.sparkle = speck;
}
`;

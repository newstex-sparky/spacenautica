/**
 * Sea-floor sediments: fine sand, current-rippled sand, gravel, silt, red clay.
 *
 * Sub-types (uSub): 0 fine sand, 1 rippled sand, 2 gravel, 3 silt, 4 clay.
 *
 * Params
 *   uP[3] = ripple wave numbers.xy (integer, tileable), phase wobble.z, crest sharpness.w
 *   uP[4] = trough mineral concentrate.x, detritus film.y, crack width.z, pebble size.w
 *   uP[5] = shell-chip cells.xy, chip density.z, chip size.w
 */
export const SEDIMENT_GLSL = /* glsl */ `
float matHeight(vec2 uv){
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;

  // Macro bedform: domain-warped fbm so dune crests meander instead of
  // running in parallel lines.
  vec2 wp = uv * mC;
  wp += bk_warp(wp, mC, uP[0].w);
  float h = 0.45 + bk_fbm(wp, mC, 4, 0.55) * uP[0].z;

  if (uSub == 1) {
    // Two superposed wave trains at slightly different angles and wavelengths.
    // A single train reads as corduroy; two produce the bifurcating, forking
    // crests that real current ripples have.
    float r1 = bk_ripple(uv, uP[3].xy, uP[3].z, dC, uP[3].w);
    float r2 = bk_ripple(uv, uP[3].xy * vec2(1.0, -2.0) + vec2(3.0, 0.0),
                         uP[3].z * 1.5, dC, uP[3].w * 0.7);
    float rip = r1 * 0.72 + r2 * 0.34 - r1 * r2 * 0.2;
    // Lee-side asymmetry: crests are steeper downstream of the current.
    float asym = 0.5 + 0.5 * bk_perlin(uv * mC, mC);
    rip = pow(clamp(rip, 0.0, 1.0), 0.75 + asym * 0.7);
    h += rip * uP[1].z;
  } else if (uSub == 2) {
    // Packed pebbles: F1 distance shapes a dome, the cell hash varies the
    // radius so no two pebbles are the same size.
    vec4 v = bk_voronoi(uv * dC, dC, 0.95);
    float rad = uP[4].w * (0.62 + v.z * 0.55);
    float t = clamp(v.x / max(rad, 1e-3), 0.0, 1.0);
    float dome = sqrt(max(0.0, 1.0 - t * t));
    h += dome * uP[1].z * (0.65 + 0.7 * v.z);
    // sand infill in the interstices
    h += (1.0 - dome) * bk_fbm(uv * uC, uC, 3, 0.5) * 0.05;
  } else if (uSub >= 3) {
    // Silt / clay: near-flat, cut by a desiccation-crack polygon network.
    vec2 cp = uv * dC;
    cp += bk_warp(cp, dC, 0.7);
    vec4 v = bk_voronoi(cp, dC, 0.88);
    float crack = bk_cellEdge(v, uP[4].z, dC);
    // Secondary, finer crack generation inside the primary polygons.
    vec4 v2 = bk_voronoi(cp * 2.0, dC * 2.0, 0.9);
    crack = max(crack, bk_cellEdge(v2, uP[4].z * 0.7, dC * 2.0) * 0.55);
    h -= crack * uP[1].z;
    h += bk_billow(uv * dC * 0.5, dC * 0.5, 3) * 0.035;
    // curled polygon edges lift slightly
    h += bk_cellEdge(v, uP[4].z * 3.0, dC) * 0.02;
  } else {
    // Fine sand. Isotropic fbm alone reads as lumpy cobbles at any tiling
    // distance, because nothing in it says "this was worked by water moving in a
    // direction". So most of the mid band is a low-amplitude oblique lineation —
    // the residue of a current — with the isotropic component kept as the
    // irregularity on top of it rather than as the whole story.
    float lin = bk_ripple(uv, vec2(9.0, 4.0), 2.4, dC, 0.85);
    float lin2 = bk_ripple(uv, vec2(5.0, -11.0), 3.1, dC, 0.9);
    h += (lin * 0.62 + lin2 * 0.38 - 0.5) * uP[1].z * 0.85;
    h += bk_fbm(uv * dC, dC, 4, 0.5) * uP[1].z * 0.55;
    // faint biogenic pits and worm casts
    vec4 pv = bk_voronoi(uv * dC * 1.7, dC * 1.7, 1.0);
    h -= step(0.86, pv.z) * (1.0 - smoothstep(0.0, 0.22, pv.x)) * 0.06;
  }

  // Micro grain, on every variant — this is what holds up at 30 cm. Uses the
  // detail variant so the grain keeps its slope when the bake resolution forces
  // the cell count down (see bk_detailGain).
  h += bk_detailFbm(uv * uC, uC, 2, 0.5) * uP[2].z;
  return clamp(h, 0.0, 1.0);
}

void matSurface(MatCtx c, inout MatOut o){
  vec2 uv = c.uv;
  vec2 mC = uP[0].xy;
  vec2 uC = uP[2].xy;

  // --- substrate: two-tone, blended by a large patch mask, plus a very low
  //     frequency hue/value drift. This is the macro-variation layer that keeps
  //     the tile from reading as one flat colour when repeated 40 times.
  float patchN = 0.5 + 0.5 * bk_fbm(uv * mC * 0.5, mC * 0.5, 3, 0.6);
  float macro = bk_perlin(uv * vec2(2.0, 2.0), vec2(2.0, 2.0));
  vec3 base = mix(uColA, uColB, smoothstep(0.2, 0.85, patchN));
  base = bk_hueShift(base, macro * uP[7].x);
  base *= 1.0 + macro * uP[7].y;

  // --- heavy-mineral (magnetite/ilmenite) concentrate settles in troughs
  float trough = 1.0 - smoothstep(0.28, 0.72, c.h);
  base = mix(base, base * vec3(0.46, 0.50, 0.60), trough * uP[4].x);

  // --- diatom film / organic detritus in sheltered patches
  float film = smoothstep(0.52, 0.95, 0.5 + 0.5 * bk_fbm(uv * mC * 1.7 + 13.0, mC * 1.7, 4, 0.55));
  base = mix(base, uColC, film * uP[4].y);

  // --- shell fragments: flat bright chips, some pink/nacreous. Sheared so
  //     they lie obliquely without breaking the tile.
  vec2 sp = bk_shear(uv, 1.0, 0.0) * uP[5].xy;
  vec4 sv = bk_voronoi(sp, uP[5].xy, 1.0);
  float chip = step(1.0 - uP[5].z, sv.z) * (1.0 - smoothstep(uP[5].w * 0.55, uP[5].w, sv.x));
  vec3 shellCol = mix(vec3(0.80, 0.77, 0.71), vec3(0.78, 0.55, 0.52), sv.w);
  base = mix(base, shellCol, chip * 0.9);

  // --- pebble lithology: each gravel cell gets its own rock colour
  if (uSub == 2) {
    vec4 pv = bk_voronoi(uv * uP[1].xy, uP[1].xy, 0.95);
    vec3 lith = mix(uColA, uColD, pv.z);
    lith = bk_hueShift(lith, (pv.w - 0.5) * 0.5);
    lith *= 0.72 + pv.z * 0.6;
    // banded and speckled pebbles
    float band = 0.5 + 0.5 * sin((pv.z * 30.0 + pv.x * 18.0) * 3.0);
    lith = mix(lith, lith * 1.25, band * step(0.6, pv.w) * 0.5);
    base = mix(base, lith, smoothstep(0.02, 0.35, 1.0 - pv.x));
  }

  // --- quartz grain glints: tiny, very bright, very smooth
  float sparkle = bk_sparkle(uv * uC * 1.4, uC * 1.4, uP[2].w);

  // --- roughness: never constant. Sand is rough; packed troughs are tighter
  //     and smoother; shell nacre and quartz are near-specular.
  float rvar = bk_fbm(uv * uC * 0.35, uC * 0.35, 3, 0.5);
  float rough = uP[6].x + rvar * uP[6].y;
  rough -= trough * 0.07;
  rough += film * 0.06;
  rough = mix(rough, 0.34, chip * 0.85);
  rough = mix(rough, 0.14, sparkle * 0.9);

  o.albedo = base * (0.88 + 0.24 * c.h);
  o.rough = rough;
  o.metal = 0.0;
  o.aux = film * 0.5;
  o.sparkle = sparkle;
}
`;

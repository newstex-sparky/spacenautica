/**
 * Creature skin: scaled, smooth, leathery, spotted, striped.
 *
 * Sub-types (uSub): 0 scales, 1 smooth, 2 leathery, 3 spotted, 4 striped.
 *
 * ORIENTATION CONTRACT: v = 0 is DORSAL (back), v = 1 is VENTRAL (belly),
 * u runs head-to-tail. Countershading is baked along v, so fauna meshes must
 * unwrap that way. The iridescence *mask* is written to the ORM alpha channel;
 * combine it with `mx_thinFilmIridescence()` from MaterialGlsl.ts in the
 * creature shader for the view-dependent part, which cannot be baked.
 *
 * Params
 *   uP[3] = scale cells.xy, scale free-edge.z, keel ridge.w
 *   uP[4] = pattern cells.xy, pattern contrast.z, per-patch hue jitter.w
 *   uP[5] = stripe wave numbers.xy, spot density.z, scar density.w
 */
export const SKIN_GLSL = /* glsl */ `
/** Overlapping scale field. Returns the cap profile; id/edge via out params. */
float skinScales(vec2 uv, vec2 cells, float freeEdge, out float id, out float edge){
  // Brick-offset rows: real fish scales are staggered, not on a square grid.
  vec2 p = uv * cells;
  p.x += mod(floor(p.y), 2.0) * 0.5;
  vec2 ip = floor(p);
  vec2 f = p - ip;
  id = bk_h21(mod(ip, cells));
  // Elliptical cap, wider than tall, with the exposed margin toward +u.
  vec2 q = (f - vec2(0.5, 0.5)) * vec2(1.0, 1.35);
  float r = length(q);
  float rad = 0.46 + id * 0.09;
  float cap = sqrt(max(0.0, 1.0 - pow(clamp(r / rad, 0.0, 1.0), 2.2)));
  edge = smoothstep(rad, rad * (1.0 - freeEdge), r);
  return cap;
}

float matHeight(vec2 uv){
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;

  // Macro: muscle blocks / myomere undulation along the body.
  float h = 0.45 + bk_fbm(uv * mC + bk_warp(uv * mC, mC, uP[0].w), mC, 3, 0.6) * uP[0].z;
  // dorsal keel
  h += exp(-pow(uv.y / 0.10, 2.0)) * uP[3].w;

  if (uSub == 0) {
    float id, edge;
    float cap = skinScales(uv, uP[3].xy, uP[3].z, id, edge);
    h += cap * uP[1].z * (0.75 + id * 0.5);
    h -= edge * uP[1].z * 0.35;                     // shadowed free margin
    // radiating ctenii / growth rings on each scale
    vec2 p = uv * uP[3].xy;
    p.x += mod(floor(p.y), 2.0) * 0.5;
    vec2 f = p - floor(p);
    float rings = 0.5 + 0.5 * sin(length(f - 0.5) * 34.0);
    h += rings * cap * uP[2].z * 2.0;
  } else if (uSub == 1) {
    // Smooth skin: dermal denticles only visible at micro scale.
    h += bk_worleyFbm(uv * uC, uC, 2, 1.0) * uP[2].z * 1.6;
    h += bk_ripple(uv, uP[5].xy, 1.4, dC, 1.0) * uP[1].z * 0.35;  // skin folds
  } else if (uSub == 2) {
    // Leathery: polygonal cracks, wrinkles, barnacle scars.
    vec2 lp = uv * uP[3].xy;
    lp += bk_warp(lp, uP[3].xy, 0.6);
    vec4 v = bk_voronoi(lp, uP[3].xy, 0.9);
    h += (v.z - 0.5) * uP[1].z * 0.6;
    h -= bk_cellEdge(v, 0.12, uP[3].xy) * uP[1].z;
    vec4 v2 = bk_voronoi(lp * 2.5, uP[3].xy * 2.5, 0.9);
    h -= bk_cellEdge(v2, 0.10, uP[3].xy * 2.5) * uP[1].z * 0.45;
    vec4 sc = bk_voronoi(uv * dC, dC, 1.0);
    float scar = step(1.0 - uP[5].w, sc.z);
    h -= scar * (1.0 - smoothstep(0.0, 0.26, sc.x)) * uP[1].z * 1.4;
    h += scar * (1.0 - smoothstep(0.20, 0.32, sc.x)) * uP[1].z * 0.8;  // raised rim
  } else {
    // Spotted / striped skin is smooth; the pattern is pigment, not relief,
    // except for a faint tubercle over each pigment cell cluster.
    h += bk_worleyFbm(uv * uC, uC, 2, 1.0) * uP[2].z;
    h += bk_ripple(uv, uP[5].xy, 1.2, dC, 1.0) * uP[1].z * 0.3;
  }

  h += bk_detailFbm(uv * uC, uC, 2, 0.5) * uP[2].z * 0.7;
  return clamp(h, 0.0, 1.0);
}

void matSurface(MatCtx c, inout MatOut o){
  vec2 uv = c.uv;
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;

  // --- countershading: dark dorsal, pale ventral, with a soft transition and
  //     a mottled boundary rather than a clean gradient.
  float dorsal = uv.y;
  float boundary = bk_fbm(uv * vec2(mC.x, 2.0), vec2(mC.x, 2.0), 4, 0.6) * 0.12;
  float shade = smoothstep(0.18, 0.82, dorsal + boundary);
  vec3 base = mix(uColA, uColB, shade);
  float macro = bk_perlin(uv * vec2(3.0, 2.0), vec2(3.0, 2.0));
  base = bk_hueShift(base, macro * uP[7].x);
  base *= 1.0 + macro * uP[7].y;

  float irid = 0.0;

  if (uSub == 0) {
    float id, edge;
    float cap = skinScales(uv, uP[3].xy, uP[3].z, id, edge);
    // Per-scale value and hue jitter — the single biggest anti-flatness win.
    base *= 0.78 + id * 0.44;
    base = bk_hueShift(base, (id - 0.5) * uP[4].w);
    // guanine platelets: silvery, strongest on the flanks
    float silver = smoothstep(0.35, 0.75, shade) * (0.4 + 0.6 * id);
    base = mix(base, base * 0.5 + vec3(0.34, 0.37, 0.40), silver * 0.55);
    base *= 0.68 + 0.55 * cap;                      // scale cap shading
    base = mix(base * 0.45, base, 1.0 - edge * 0.8); // dark under the margin
    irid = cap * (0.45 + 0.55 * id) * smoothstep(0.25, 0.8, shade);
  } else if (uSub == 1) {
    // Smooth skin: mucus sheen, blotchy pigment, a few remora scars.
    float blotch = smoothstep(0.4, 0.8, 0.5 + 0.5 * bk_fbm(uv * uP[4].xy, uP[4].xy, 4, 0.6));
    base = mix(base, uColC, blotch * uP[4].z * 0.6);
    irid = 0.25 * smoothstep(0.3, 0.8, shade);
  } else if (uSub == 2) {
    vec2 lp = uv * uP[3].xy;
    lp += bk_warp(lp, uP[3].xy, 0.6);
    vec4 v = bk_voronoi(lp, uP[3].xy, 0.9);
    base *= 0.80 + v.z * 0.40;                       // per-plate value
    base = bk_hueShift(base, (v.w - 0.5) * uP[4].w * 0.6);
    base = mix(base, base * 0.35, bk_cellEdge(v, 0.14, uP[3].xy) * 0.8);
    // barnacle/lamprey scars: pale rings
    vec4 sc = bk_voronoi(uv * dC, dC, 1.0);
    float scar = step(1.0 - uP[5].w, sc.z) * (1.0 - smoothstep(0.20, 0.30, sc.x));
    base = mix(base, vec3(0.60, 0.57, 0.53), scar * 0.75);
    irid = 0.05;
  } else if (uSub == 3) {
    // Spots: two size classes, soft haloes, per-spot hue jitter. Voronoi picks
    // the centres, fbm breaks the outlines so they are not discs.
    vec2 sp = uv * uP[4].xy;
    sp += bk_warp(sp, uP[4].xy, 0.5);
    vec4 v = bk_voronoi(sp, uP[4].xy, 1.0);
    float rad = 0.20 + v.z * 0.22;
    float on = step(1.0 - uP[5].z, v.w);
    float spot = on * (1.0 - smoothstep(rad, rad + 0.10, v.x));
    float halo = on * (1.0 - smoothstep(rad + 0.06, rad + 0.26, v.x)) * 0.5;
    vec3 spotCol = bk_hueShift(uColC, (v.z - 0.5) * uP[4].w);
    base = mix(base, base * 1.5 + 0.04, halo * 0.4);
    base = mix(base, spotCol, spot * uP[4].z);
    // second, finer size class
    vec4 v2 = bk_voronoi(sp * 2.7, uP[4].xy * 2.7, 1.0);
    float spot2 = step(0.72, v2.w) * (1.0 - smoothstep(0.24, 0.32, v2.x));
    base = mix(base, spotCol * 0.8, spot2 * uP[4].z * 0.55);
    irid = 0.18;
  } else {
    // Stripes: wobbling bands that fork and fade into the countershading.
    float band = bk_ripple(uv, uP[5].xy, 2.6, dC, 0.8);
    float fork = 0.5 + 0.5 * bk_fbm(uv * dC * 1.4, dC * 1.4, 4, 0.6);
    float stripe = smoothstep(0.42, 0.62, band * (0.6 + fork * 0.7));
    stripe *= smoothstep(0.05, 0.45, dorsal);        // stripes fade on the belly
    vec3 stripeCol = bk_hueShift(uColC, (fork - 0.5) * uP[4].w);
    base = mix(base, stripeCol, stripe * uP[4].z);
    // faint secondary bars between the primaries
    float band2 = bk_ripple(uv, uP[5].xy * 2.0, 3.0, dC, 1.2);
    base = mix(base, stripeCol * 0.85, smoothstep(0.6, 0.85, band2) * uP[4].z * 0.3);
    irid = 0.22 * smoothstep(0.3, 0.85, shade);
  }

  // Wet skin: glossy overall, glossier still where mucus pools in the crevices,
  // matte where scarred or abraded.
  float rvar = bk_fbm(uv * uC * 0.5, uC * 0.5, 3, 0.55);
  float rough = uP[6].x + rvar * uP[6].y;
  rough -= clamp(c.curv * 2.0, 0.0, 1.0) * 0.12;
  rough += clamp(-c.curvHi * 2.0, 0.0, 1.0) * 0.06;

  o.albedo = base * (0.9 + 0.2 * c.h);
  o.rough = rough;
  o.metal = 0.0;
  o.aux = clamp(irid, 0.0, 1.0);
  o.sparkle = bk_sparkle(uv * uC * 1.5, uC * 1.5, 0.04);
}
`;

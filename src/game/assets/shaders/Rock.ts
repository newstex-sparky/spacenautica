/**
 * Rock: basalt, limestone, sandstone, dark shale, crystal facets.
 *
 * Sub-types (uSub): 0 basalt, 1 limestone, 2 sandstone, 3 shale, 4 crystal.
 *
 * Params
 *   uP[3] = joint cells.xy, joint width.z, joint depth.w
 *   uP[4] = bedding wave numbers.xy, bedding amplitude.z, vesicle/pit density.w
 *   uP[5] = encrustation coverage.x, coralline patchN scale.y, barnacle density.z, biofilm.w
 */
export const ROCK_GLSL = /* glsl */ `
// Two generations of fracture joints, coarse then fine, so the rock has a
// hierarchy of breaks rather than one uniform crack size.
float rockJoints(vec2 uv, vec2 cells, float width, out float cellId){
  vec2 p = uv * cells;
  p += bk_warp(p, cells, 0.55);
  vec4 v1 = bk_voronoi(p, cells, 0.9);
  vec4 v2 = bk_voronoi(p * 2.0, cells * 2.0, 0.92);
  cellId = v1.z;
  float j1 = bk_cellEdge(v1, width, cells);
  float j2 = bk_cellEdge(v2, width * 0.8, cells * 2.0) * 0.55;
  return clamp(max(j1, j2), 0.0, 1.0);
}

float matHeight(vec2 uv){
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;

  // Macro form: ridged multifractal for angular, eroded block shapes; warped so
  // nothing lines up with the axes.
  vec2 wp = uv * mC;
  wp += bk_warp(wp, mC, uP[0].w);
  float h = 0.40 + bk_ridge(wp, mC, 5) * uP[0].z;

  float cellId;
  float joints = rockJoints(uv, uP[3].xy, uP[3].z, cellId);
  // Per-block height offset: differential erosion leaves some blocks proud.
  h += (cellId - 0.5) * uP[3].w * 0.6;
  h -= joints * uP[3].w;

  if (uSub == 0) {
    // Basalt: columnar jointing plus gas vesicles.
    vec4 col = bk_voronoi(uv * dC, dC, 0.42);
    h += (col.z - 0.5) * uP[1].z * 0.8;
    h -= bk_cellEdge(col, 0.10, dC) * uP[1].z * 0.5;
    vec4 ves = bk_voronoi(uv * uC * 0.55, uC * 0.55, 1.0);
    float pit = step(1.0 - uP[4].w, ves.z) * (1.0 - smoothstep(0.0, 0.30, ves.x));
    h -= pit * 0.10;
  } else if (uSub == 1) {
    // Limestone: karst dissolution — smooth rounded pits and runnels.
    float diss = bk_worleyFbm(uv * dC, dC, 3, 1.0);
    h -= pow(diss, 2.0) * uP[1].z;
    vec4 hole = bk_voronoi(uv * dC * 0.6, dC * 0.6, 1.0);
    float bore = step(1.0 - uP[4].w, hole.z) * (1.0 - smoothstep(0.0, 0.34, hole.x));
    h -= bore * 0.16;
    h += bk_billow(uv * uC * 0.4, uC * 0.4, 3) * uP[2].z * 2.0;
  } else if (uSub == 2) {
    // Sandstone: sedimentary bedding. Softer beds recess, harder beds stand
    // proud, and the bedding plane itself undulates.
    float bed = bk_ripple(uv, uP[4].xy, uP[4].z * 4.0, dC, 1.0);
    float hard = 0.5 + 0.5 * bk_perlin(uv * vec2(1.0, 8.0), vec2(1.0, 8.0));
    h += (bed - 0.5) * uP[1].z * (0.5 + hard);
    h += bk_fbm(uv * uC * 0.5, uC * 0.5, 3, 0.5) * uP[2].z * 1.5;
  } else if (uSub == 3) {
    // Shale: thin fissile laminations that split into platy flakes.
    float lam = bk_ripple(uv, uP[4].xy, uP[4].z * 6.0, dC, 1.4);
    h += (lam - 0.5) * uP[1].z;
    vec4 flake = bk_voronoi(bk_shear(uv, 2.0, 0.0) * dC * vec2(1.0, 3.0), dC * vec2(1.0, 3.0), 0.95);
    h += (flake.z - 0.5) * uP[1].z * 0.7;
    h -= bk_cellEdge(flake, 0.09, dC * vec2(1.0, 3.0)) * uP[1].z * 0.8;
  } else {
    // Crystal: flat facets. Each Voronoi cell becomes a plane tilted by its own
    // hash, with a sharp break along the cell boundary.
    vec4 v = bk_voronoi(uv * dC, dC, 0.75);
    vec2 tilt = bk_h22(vec2(v.z, v.w) * 37.0) - 0.5;
    h = 0.55 + dot(fract(uv * dC) - 0.5, tilt) * uP[1].z * 3.0 + (v.z - 0.5) * 0.12;
    h -= bk_cellEdge(v, 0.05, dC) * 0.10;
    // conchoidal micro-fracture on the facets
    h += bk_fbm(uv * uC, uC, 2, 0.5) * uP[2].z * 0.5;
  }

  h += bk_fbm(uv * uC, uC, 3, 0.5) * uP[2].z;
  return clamp(h, 0.0, 1.0);
}

void matSurface(MatCtx c, inout MatOut o){
  vec2 uv = c.uv;
  vec2 mC = uP[0].xy;
  vec2 uC = uP[2].xy;

  float cellId;
  float joints = rockJoints(uv, uP[3].xy, uP[3].z, cellId);

  // --- base lithology, varied per block and drifting at macro scale
  float macro = bk_perlin(uv * vec2(2.0, 2.0), vec2(2.0, 2.0));
  vec3 base = mix(uColA, uColB, 0.5 + 0.5 * bk_fbm(uv * mC * 0.6, mC * 0.6, 4, 0.6));
  base = bk_hueShift(base, macro * uP[7].x + (cellId - 0.5) * uP[7].x * 0.8);
  base *= 1.0 + macro * uP[7].y + (cellId - 0.5) * uP[7].y * 0.7;

  // --- lithology detail per sub-type
  if (uSub == 2) {
    // sandstone: visible bands of alternating iron content
    float bed = bk_ripple(uv, uP[4].xy, uP[4].z * 4.0, uP[1].xy, 1.0);
    base = mix(base, base * vec3(1.22, 0.92, 0.70), smoothstep(0.35, 0.9, bed) * 0.65);
    base = mix(base, base * vec3(0.80, 0.82, 0.86), smoothstep(0.35, 0.05, bed) * 0.45);
  } else if (uSub == 3) {
    // shale: graphite-grey laminae with a slight micaceous sheen
    float lam = bk_ripple(uv, uP[4].xy, uP[4].z * 6.0, uP[1].xy, 1.4);
    base *= 0.80 + lam * 0.45;
  } else if (uSub == 0) {
    // basalt: plagioclase phenocrysts as pale specks
    float spec = bk_sparkle(uv * uC * 0.8, uC * 0.8, 0.10);
    base = mix(base, vec3(0.62, 0.61, 0.58), spec * 0.55);
  } else if (uSub == 4) {
    // crystal: per-facet tint and internal cloudiness
    vec4 v = bk_voronoi(uv * uP[1].xy, uP[1].xy, 0.75);
    base = mix(uColA, uColB, v.z);
    base = bk_hueShift(base, (v.w - 0.5) * 0.9);
    base *= 0.7 + 0.8 * v.w;
    float cloud = 0.5 + 0.5 * bk_fbm(uv * uC * 0.5, uC * 0.5, 4, 0.6);
    base = mix(base, base * 1.6 + 0.06, cloud * 0.35);
  }

  // --- joints read darker and wetter than the faces
  base *= 1.0 - joints * 0.45;

  // --- biological encrustation. Only in crevices (curvature) AND inside large
  //     patches, so it looks colonised rather than sprayed on uniformly.
  float patchN = smoothstep(0.35, 0.8, 0.5 + 0.5 * bk_fbm(uv * uP[5].y + 7.0, vec2(uP[5].y), 4, 0.6));
  float shelter = clamp(c.curv * 2.2, 0.0, 1.0) * 0.6 + joints * 0.7 + (1.0 - c.ao) * 0.5;
  float bio = clamp(shelter, 0.0, 1.0) * patchN * uP[5].x;

  // coralline algae (pink), green film, dark biofilm — three species, not one
  float which = 0.5 + 0.5 * bk_fbm(uv * uP[5].y * 2.3 + 21.0, vec2(uP[5].y * 2.3), 3, 0.6);
  vec3 coralline = vec3(0.42, 0.15, 0.19);
  vec3 greenAlg  = vec3(0.10, 0.20, 0.10);
  vec3 bioCol = mix(coralline, greenAlg, smoothstep(0.35, 0.7, which));
  bioCol = mix(bioCol, uColC, smoothstep(0.6, 1.0, which));
  // fine mottling inside the encrustation so it is not a flat wash
  bioCol *= 0.7 + 0.6 * (0.5 + 0.5 * bk_fbm(uv * uC * 1.6, uC * 1.6, 3, 0.55));
  base = mix(base, bioCol, bio);

  // dark biofilm deep in the joints
  base = mix(base, vec3(0.035, 0.045, 0.042), joints * uP[5].w);

  // --- barnacles / serpulid tubes: tiny white rings on flatter upward faces
  vec4 bv = bk_voronoi(uv * uC * 0.45, uC * 0.45, 1.0);
  float ringR = 0.13 + bv.w * 0.10;
  float ring = (1.0 - smoothstep(ringR, ringR + 0.07, bv.x)) * smoothstep(ringR * 0.45, ringR * 0.7, bv.x);
  float barn = step(1.0 - uP[5].z, bv.z) * ring * (1.0 - clamp(c.slope * 0.6, 0.0, 1.0));
  base = mix(base, vec3(0.74, 0.72, 0.67), barn * 0.9);

  // --- roughness: three overlapping scales, plus wet-polish on the crests
  float rvar = bk_fbm(uv * uC * 0.4, uC * 0.4, 4, 0.55);
  float rough = uP[6].x + rvar * uP[6].y;
  rough += bio * 0.16;                      // encrustation is matte
  rough += joints * 0.10;                   // grit-filled cracks
  rough -= smoothstep(0.6, 1.0, c.h) * 0.10; // current-polished high points
  rough = mix(rough, 0.42, barn * 0.7);
  if (uSub == 4) {
    // faceted crystal: glassy faces with per-facet variation, matte on breaks
    vec4 v = bk_voronoi(uv * uP[1].xy, uP[1].xy, 0.75);
    rough = mix(0.06 + v.w * 0.16, rough, bio * 0.8 + bk_cellEdge(v, 0.06, uP[1].xy) * 0.7);
    o.aux = 0.8;
  }

  o.albedo = base;
  o.rough = rough;
  o.metal = uP[6].z;
  o.sparkle = bk_sparkle(uv * uC, uC, 0.05);
}
`;

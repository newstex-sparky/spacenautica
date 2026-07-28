/**
 * Man-made surfaces: painted and rusted hull plate, brushed and scuffed metal,
 * scratched glass, rubber seal, circuit panel, moulded plastic, hazard decal,
 * woven dive-suit fabric.
 *
 * Sub-types (uSub): 0 hull_painted, 1 hull_rusted, 2 metal_brushed,
 *                   3 metal_scuffed, 4 glass_scratched, 5 rubber_seal,
 *                   6 circuit_panel, 7 plastic_orange, 8 decal_warning,
 *                   9 fabric_suit.
 *
 * ORIENTATION CONTRACT: these maps are authored with **+V pointing DOWN**.
 * Rust bleeds, paint runs and salt streaks all flow toward increasing v. Map
 * hull UVs so v increases downward or the streaks will run up the wall.
 *
 * Params
 *   uP[3] = panel cells.xy, gap width.z, plate relief.w
 *   uP[4] = rivets per panel.xy, rivet radius.z, weld probability.w
 *   uP[5] = chip threshold.x, rust amount.y, streak falloff.z, scratch density.w
 */
export const MANMADE_GLSL = /* glsl */ `
/* ---------------------------------------------------------------- *
 * Plating: staggered rectangular plates, recessed seams, weld beads
 * on some seams and rivet rows on the others.
 * ---------------------------------------------------------------- */
void mmPlate(vec2 uv, out float gap, out float bead, out float rivet,
             out float plateId, out float border){
  vec2 cells = uP[3].xy;
  vec2 p = uv * cells;
  // brick-stagger alternate courses (needs an even cells.y to stay tileable)
  p.x += mod(floor(p.y), 2.0) * 0.5;
  vec2 ip = floor(p);
  vec2 f = p - ip;
  plateId = bk_h21(mod(ip, cells));

  vec2 dv = min(f, 1.0 - f);
  float d = min(dv.x, dv.y);
  float w = uP[3].z;
  gap = 1.0 - smoothstep(w * 0.45, w, d);
  border = 1.0 - smoothstep(0.0, 0.16, d);

  // Weld bead: a lumpy sausage sitting proud of the seam, on ~half the seams.
  float along = (dv.x < dv.y) ? f.y : f.x;
  float welded = step(1.0 - uP[4].w, bk_h21(mod(ip, cells) + 5.0));
  float lump = 0.62 + 0.38 * sin(along * BK_TAU * 26.0 + plateId * 20.0);
  lump *= 0.75 + 0.5 * bk_perlin(vec2(along * 40.0, plateId * 20.0), vec2(40.0, 20.0));
  bead = welded * (1.0 - smoothstep(w * 0.7, w * 2.1, d)) * lump;

  // Rivet rows: a regular lattice, kept to the plate borders, absent on welds.
  vec2 rc = cells * uP[4].xy;
  vec4 rv = bk_voronoi(uv * rc, rc, 0.0);
  float dome = 1.0 - smoothstep(uP[4].z * 0.7, uP[4].z, rv.x);
  rivet = dome * border * (1.0 - welded) * step(0.18, bk_h21(mod(floor(uv * rc), rc) + 2.0));
}

/**
 * Rust bleeding DOWNWARD from fasteners. For each of the three fastener rows
 * above the current pixel we accumulate an exponentially decaying, laterally
 * wandering, vertically stretched stain. Wrapped in v, so it still tiles.
 */
float mmRustStreak(vec2 uv){
  vec2 rc = uP[3].xy * uP[4].xy;
  float col = floor(uv.x * rc.x);
  float rowNow = floor(uv.y * rc.y);
  float acc = 0.0;
  for (int k = 0; k < 3; k++){
    float row = rowNow - float(k);
    float srcY = (row + 0.5) / rc.y;
    float dv = uv.y - srcY;
    if (dv < 0.0) dv += 1.0;
    vec2 cell = mod(vec2(col, row), rc);
    float bleeds = step(0.52, bk_h21(cell + 9.0));
    // the stain widens and wanders as it runs
    float wander = bk_perlin(vec2(uv.x * rc.x * 1.5, uv.y * 4.0), vec2(rc.x * 1.5, 4.0)) * 0.35;
    float cx = (col + 0.5) / rc.x;
    float halfW = (0.30 + dv * 1.4) / rc.x;
    float lat = exp(-pow(((uv.x - cx) / halfW) + wander, 2.0));
    // vertical streakiness: fine variation across, smooth along
    float streaky = 0.45 + 0.55 * (0.5 + 0.5 * bk_perlin(vec2(uv.x * rc.x * 6.0, uv.y * 3.0),
                                                          vec2(rc.x * 6.0, 3.0)));
    acc += bleeds * exp(-dv * uP[5].z) * lat * streaky;
  }
  return clamp(acc, 0.0, 1.0);
}

/**
 * Layered fine scratches. Three wave trains with coprime integer wave-number
 * pairs run obliquely (and therefore tile); a very high crest exponent turns
 * each train into thin lines, and a coarse noise mask breaks the lines into
 * finite-length scratches instead of infinite stripes.
 */
float mmScratches(vec2 uv, vec2 uC, float density){
  float s = 0.0;
  s = max(s, bk_ripple(uv, vec2(37.0, 13.0), 2.2, uC, 34.0));
  s = max(s, bk_ripple(uv, vec2(-23.0, 41.0), 2.8, uC, 46.0) * 0.8);
  s = max(s, bk_ripple(uv, vec2(53.0, -19.0), 3.1, uC, 40.0) * 0.6);
  s = max(s, bk_ripple(uv, vec2(11.0, 67.0), 2.4, uC, 52.0) * 0.5);
  float breakUp = smoothstep(0.30, 0.75, 0.5 + 0.5 * bk_fbm(uv * uC * 0.4, uC * 0.4, 3, 0.6));
  return s * breakUp * density;
}

/** Circuit trace field: Manhattan segments snapped to a cell grid, plus vias. */
void mmCircuit(vec2 uv, vec2 cells, out float trace, out float via, out float pad){
  vec2 p = uv * cells;
  vec2 ip = floor(p);
  vec2 f = p - ip;
  float h = bk_h21(mod(ip, cells));
  float w = 0.055;
  float dH = abs(f.y - 0.5);
  float dV = abs(f.x - 0.5);
  float tH = 1.0 - smoothstep(w, w * 1.7, dH);
  float tV = 1.0 - smoothstep(w, w * 1.7, dV);
  if (h < 0.30)      trace = tH;
  else if (h < 0.58) trace = tV;
  else if (h < 0.80) trace = max(tH * step(f.x, 0.5 + w), tV * step(f.y, 0.5 + w));
  else               trace = max(tH * step(0.5 - w, f.x), tV * step(f.y, 0.5 + w));
  float r = length(f - 0.5);
  via = (1.0 - smoothstep(0.085, 0.115, r)) * step(0.72, bk_h21(mod(ip, cells) + 3.0));
  pad = (1.0 - smoothstep(0.20, 0.24, max(abs(f.x - 0.5) * 1.9, abs(f.y - 0.5))))
      * step(0.86, bk_h21(mod(ip, cells) + 8.0));
}

/** Signed distance to a warning triangle outline, in tile space. */
float mmTriangleSdf(vec2 p){
  p = (p - 0.5) * 2.0;
  p.y = -p.y;
  const float k = 1.7320508;
  p.x = abs(p.x) - 1.0;
  p.y = p.y + 1.0 / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0, 0.0);
  return -length(p) * sign(p.y);
}

float matHeight(vec2 uv){
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;
  float h = 0.5;

  if (uSub <= 1) {
    float gap, bead, rivet, plateId, border;
    mmPlate(uv, gap, bead, rivet, plateId, border);
    // dished plating: each plate bows slightly, some are dented
    h += (plateId - 0.5) * uP[3].w * 0.5;
    h += bk_fbm(uv * mC, mC, 3, 0.55) * uP[0].z;
    h -= gap * uP[3].w;
    h += bead * uP[3].w * 0.9;
    h += rivet * uP[4].z * 1.6;
    // impact dents
    vec4 dv = bk_voronoi(uv * dC * 0.5, dC * 0.5, 1.0);
    h -= step(0.86, dv.z) * (1.0 - smoothstep(0.0, 0.42, dv.x)) * uP[3].w * 1.2;
    if (uSub == 1) {
      // scale rust: flaky, blistered crust with real relief
      float crust = bk_worleyFbm(uv * dC * 2.0, dC * 2.0, 3, 1.0);
      float rust = clamp(mmRustStreak(uv) + gap * 0.7, 0.0, 1.0);
      h += (crust - 0.35) * rust * uP[5].y * 0.10;
      h -= step(0.72, crust) * rust * 0.05;   // spalled flakes
    }
  } else if (uSub == 2) {
    // brushed: unidirectional micro grooves at several depths
    h += bk_fbm(uv * vec2(uC.x * 3.0, uC.y * 0.05), vec2(uC.x * 3.0, uC.y * 0.05), 3, 0.6) * uP[2].z * 3.0;
    h += bk_fbm(uv * vec2(uC.x * 0.6, uC.y * 0.02), vec2(uC.x * 0.6, uC.y * 0.02), 2, 0.5) * uP[1].z;
    h += mmScratches(uv, uC, uP[5].w) * 0.02;
  } else if (uSub == 3) {
    h += bk_fbm(uv * dC, dC, 4, 0.55) * uP[1].z;
    vec4 dv = bk_voronoi(uv * dC, dC, 1.0);
    h -= step(0.62, dv.z) * (1.0 - smoothstep(0.0, 0.36, dv.x)) * uP[3].w;  // dents
    h += mmScratches(uv, uC, uP[5].w) * 0.05;
    h += bk_fbm(uv * uC, uC, 2, 0.5) * uP[2].z;
  } else if (uSub == 4) {
    // glass: almost flat. Polish swirls, a few deep scratches, salt spots.
    h = 0.5 + bk_fbm(uv * dC, dC, 3, 0.5) * uP[1].z * 0.15;
    h -= mmScratches(uv, uC, uP[5].w) * 0.04;
    vec4 sv = bk_voronoi(uv * dC * 1.5, dC * 1.5, 1.0);
    h += step(0.80, sv.z) * (1.0 - smoothstep(0.0, 0.24, sv.x)) * 0.02;   // dried salt
  } else if (uSub == 5) {
    // rubber: moulded ribs plus a matte micro pebble grain
    h += bk_ripple(uv, vec2(0.0, uP[3].xy.y), 0.25, dC, 1.0) * uP[1].z;
    h += bk_worleyFbm(uv * uC, uC, 2, 1.0) * uP[2].z * 2.0;
  } else if (uSub == 6) {
    float trace, via, pad;
    mmCircuit(uv, uP[3].xy, trace, via, pad);
    h += trace * uP[3].w * 0.5 + pad * uP[3].w * 0.7;
    h -= via * uP[3].w;
    // surface-mount components stand proud
    vec2 p = uv * uP[3].xy * 0.5;
    vec2 f = fract(p);
    float comp = step(0.80, bk_h21(mod(floor(p), uP[3].xy * 0.5) + 11.0))
               * (1.0 - smoothstep(0.26, 0.30, max(abs(f.x - 0.5) * 1.5, abs(f.y - 0.5))));
    h += comp * uP[3].w * 2.2;
    h += bk_fbm(uv * uC, uC, 2, 0.5) * uP[2].z;
  } else if (uSub == 7) {
    // moulded plastic: orange-peel, a parting line, scuffs
    h += bk_fbm(uv * uC * 0.5, uC * 0.5, 3, 0.6) * uP[2].z * 2.0;
    h += bk_ripple(uv, vec2(1.0, 0.0), 0.4, dC, 3.0) * uP[1].z * 0.5;
    h += mmScratches(uv, uC, uP[5].w * 0.6) * 0.03;
  } else if (uSub == 8) {
    // decal on a plate: relief is only the chipped paint edge + substrate grain
    h += bk_fbm(uv * uC, uC, 3, 0.55) * uP[2].z;
    float stripe = bk_stripe(bk_shear(uv, 1.0, 0.0), vec2(uP[3].xy.x, 0.0), 0.5, 0.03, 0.0, dC);
    h += stripe * uP[3].w * 0.25;
  } else {
    // woven fabric: twill. Warp and weft cross-sections interleave on a
    // 3-cell diagonal, giving the characteristic diagonal wale.
    vec2 p = uv * uP[3].xy;
    vec2 ip = floor(p);
    vec2 f = p - ip;
    float warp = pow(max(sin(f.x * 3.14159265), 0.0), 0.55);
    float weft = pow(max(sin(f.y * 3.14159265), 0.0), 0.55);
    float over = step(1.5, mod(ip.x + 2.0 * ip.y, 3.0));
    h = 0.42 + mix(weft * 0.85, warp, over) * uP[1].z;
    // fibre fuzz and pilling
    h += bk_fbm(uv * uC, uC, 3, 0.6) * uP[2].z;
    // seams with stitch lines
    float seam = bk_stripe(uv, vec2(0.0, 2.0), 0.06, 0.02, 0.0, dC);
    h += seam * uP[3].w;
    h += seam * bk_ripple(uv, vec2(uP[3].xy.x * 0.5, 0.0), 0.0, uC, 3.0) * uP[3].w;
  }

  return clamp(h, 0.0, 1.0);
}

void matSurface(MatCtx c, inout MatOut o){
  vec2 uv = c.uv;
  vec2 mC = uP[0].xy;
  vec2 dC = uP[1].xy;
  vec2 uC = uP[2].xy;

  float macro = bk_perlin(uv * vec2(2.0, 2.0), vec2(2.0, 2.0));
  vec3 albedo = uColA;
  float rough = uP[6].x;
  float metal = uP[6].z;
  float aux = 0.0;

  if (uSub <= 1) {
    float gap, bead, rivet, plateId, border;
    mmPlate(uv, gap, bead, rivet, plateId, border);

    /* ---- layer 0: bare steel ---- */
    vec3 steel = uColD * (0.85 + 0.3 * bk_fbm(uv * uC * 0.5, uC * 0.5, 3, 0.5));
    /* ---- layer 1: primer ---- */
    vec3 primer = uColC;
    /* ---- layer 2: top coat, faded per plate and drifting at macro scale ---- */
    vec3 paint = bk_hueShift(uColA, macro * uP[7].x + (plateId - 0.5) * uP[7].x);
    paint *= 1.0 + macro * uP[7].y + (plateId - 0.5) * uP[7].y * 1.2;
    // UV fade on the exposed, convex areas
    float fade = smoothstep(0.55, 1.0, c.h) * 0.35;
    paint = mix(paint, mix(paint, vec3(bk_luma(paint)), 0.45) * 1.1, fade);

    /* ---- chipping: paint fails first on edges, rivets and seams ---- */
    float wearPatch = smoothstep(0.25, 0.85, 0.5 + 0.5 * bk_fbm(uv * mC * 0.8 + 3.0, mC * 0.8, 4, 0.6));
    float chipNoise = 0.5 + 0.5 * bk_fbm(uv * dC * 1.6, dC * 1.6, 5, 0.58);
    float drive = chipNoise
                + clamp(-c.curvHi * 2.5, 0.0, 1.0) * 0.55   // convex edges
                + rivet * 0.45 + bead * 0.35 + gap * 0.30;
    drive *= 0.45 + wearPatch;
    float thr = uP[5].x;
    float chip = smoothstep(thr, thr + 0.045, drive);
    float primerRing = smoothstep(thr - 0.13, thr - 0.02, drive) - chip;

    albedo = mix(paint, primer, clamp(primerRing, 0.0, 1.0));
    albedo = mix(albedo, steel, chip);
    metal = chip * 0.95;
    rough = mix(0.30 + macro * 0.06, 0.66, clamp(primerRing, 0.0, 1.0));
    rough = mix(rough, 0.38, chip);
    // orange-peel: paint gloss is never uniform
    rough += (1.0 - chip) * bk_fbm(uv * uC * 0.6, uC * 0.6, 3, 0.55) * 0.10;

    /* ---- rust: on the exposed steel, bleeding down from every fastener ---- */
    float streak = mmRustStreak(uv);
    float rustPatch = smoothstep(0.30, 0.9, 0.5 + 0.5 * bk_fbm(uv * dC * 0.7 + 17.0, dC * 0.7, 4, 0.6));
    float rust = clamp((chip * 0.9 + streak * 1.15 + gap * 0.55 + bead * 0.3) * rustPatch, 0.0, 1.0);
    rust *= uP[5].y;
    // three-tone oxide: near-black pit, maroon body, bright ochre bloom
    float rt = bk_fbm(uv * dC * 2.6, dC * 2.6, 4, 0.6);
    vec3 rustCol = mix(vec3(0.085, 0.030, 0.014), vec3(0.30, 0.105, 0.040), smoothstep(-0.35, 0.15, rt));
    rustCol = mix(rustCol, vec3(0.52, 0.245, 0.085), smoothstep(0.10, 0.55, rt));
    rustCol = mix(rustCol, vec3(0.62, 0.42, 0.20), smoothstep(0.45, 0.85, rt) * 0.7);
    rustCol *= 0.75 + 0.5 * (0.5 + 0.5 * bk_fbm(uv * uC * 1.4, uC * 1.4, 3, 0.55));

    albedo = mix(albedo, rustCol, rust);
    metal *= 1.0 - rust;                    // oxide is a dielectric
    rough = mix(rough, 0.90 + rt * 0.06, rust);

    /* ---- marine growth: barnacles and biofilm, mostly low and sheltered ---- */
    float growth = clamp((1.0 - c.ao) * 0.8 + gap * 0.6, 0.0, 1.0)
                 * smoothstep(0.4, 0.9, 0.5 + 0.5 * bk_fbm(uv * dC * 1.1 + 29.0, dC * 1.1, 3, 0.6))
                 * uP[5].y * 0.8;
    vec4 bv = bk_voronoi(uv * uC * 0.4, uC * 0.4, 1.0);
    float barn = step(0.88, bv.z) * (1.0 - smoothstep(0.14, 0.20, bv.x));
    albedo = mix(albedo, vec3(0.055, 0.075, 0.060), growth * 0.7);
    albedo = mix(albedo, vec3(0.70, 0.68, 0.62), barn * growth * 1.6);
    rough = mix(rough, 0.85, growth * 0.6);
    metal *= 1.0 - growth;

    aux = rust;
  } else if (uSub == 2 || uSub == 3) {
    // Bare metal. Brushing/scuffing shows up mostly in roughness, which is how
    // real anisotropy reads under an isotropic BRDF.
    float brush = bk_fbm(uv * vec2(uC.x * 3.0, uC.y * 0.05), vec2(uC.x * 3.0, uC.y * 0.05), 4, 0.6);
    float scr = mmScratches(uv, uC, uP[5].w);
    albedo = uColA * (0.90 + brush * 0.16 + macro * uP[7].y);
    albedo = mix(albedo, uColB, smoothstep(0.4, 0.95, 0.5 + 0.5 * bk_fbm(uv * dC + 11.0, dC, 4, 0.6)) * 0.4);
    metal = 1.0;
    rough = uP[6].x + brush * uP[6].y;
    rough = mix(rough, 0.14, scr * 0.8);      // fresh scratches are shiny
    if (uSub == 3) {
      // scuffed: hazed patches, oxide bloom, grime in the dents
      float haze = smoothstep(0.35, 0.9, 0.5 + 0.5 * bk_fbm(uv * dC * 1.4 + 7.0, dC * 1.4, 4, 0.6));
      rough += haze * 0.30;
      albedo = mix(albedo, albedo * vec3(1.05, 0.94, 0.86), haze * 0.5);
      metal -= haze * 0.25;
      float grime = clamp(c.curv * 2.0, 0.0, 1.0);
      albedo = mix(albedo, vec3(0.045, 0.043, 0.040), grime * 0.55);
      metal *= 1.0 - grime * 0.6;
      rough = mix(rough, 0.88, grime * 0.6);
    }
    aux = 0.4;
  } else if (uSub == 4) {
    // Glass: dark dielectric albedo, very low roughness, scratches and salt.
    float scr = mmScratches(uv, uC, uP[5].w);
    vec4 sv = bk_voronoi(uv * dC * 1.5, dC * 1.5, 1.0);
    float salt = step(0.80, sv.z) * (1.0 - smoothstep(0.10, 0.24, sv.x));
    float swirl = bk_ripple(uv, vec2(23.0, 11.0), 3.0, uC, 6.0);
    albedo = mix(uColA, uColB, salt);
    metal = 0.0;
    rough = uP[6].x + swirl * 0.05 + scr * 0.35 + salt * 0.5;
    o.opacity = clamp(0.06 + scr * 0.55 + salt * 0.8 + swirl * 0.05, 0.0, 1.0);
    aux = 1.0;
  } else if (uSub == 5) {
    float rib = bk_ripple(uv, vec2(0.0, uP[3].xy.y), 0.25, dC, 1.0);
    float grain = bk_worleyFbm(uv * uC, uC, 2, 1.0);
    albedo = uColA * (0.80 + grain * 0.3) * (0.92 + rib * 0.14);
    // talc bloom / salt creep in the creases
    float bloom = clamp(c.curv * 2.4, 0.0, 1.0);
    albedo = mix(albedo, uColB, bloom * 0.6);
    metal = 0.0;
    rough = uP[6].x + grain * uP[6].y + bloom * 0.10;
    aux = 0.0;
  } else if (uSub == 6) {
    float trace, via, pad;
    mmCircuit(uv, uP[3].xy, trace, via, pad);
    vec3 mask = uColA * (0.85 + 0.3 * bk_fbm(uv * uC * 0.5, uC * 0.5, 3, 0.5));
    vec3 copper = uColD;
    albedo = mix(mask, copper * 0.55, trace * 0.5);      // traces under the mask
    albedo = mix(albedo, copper, pad);
    albedo = mix(albedo, vec3(0.02), via);
    // silkscreen legend blocks
    vec2 sp = uv * uP[3].xy * 2.0;
    float silk = step(0.90, bk_h21(mod(floor(sp), uP[3].xy * 2.0) + 23.0))
               * (1.0 - smoothstep(0.30, 0.36, max(abs(fract(sp.x) - 0.5) * 2.4, abs(fract(sp.y) - 0.5))));
    albedo = mix(albedo, uColB, silk * 0.9);
    // components
    vec2 p2 = uv * uP[3].xy * 0.5;
    float comp = step(0.80, bk_h21(mod(floor(p2), uP[3].xy * 0.5) + 11.0))
               * (1.0 - smoothstep(0.26, 0.30, max(abs(fract(p2.x) - 0.5) * 1.5, abs(fract(p2.y) - 0.5))));
    albedo = mix(albedo, vec3(0.018, 0.020, 0.024), comp * 0.9);
    metal = max(pad, via) * 0.9;
    rough = mix(uP[6].x, 0.22, max(pad, via)) + bk_fbm(uv * uC, uC, 3, 0.5) * uP[6].y;
    rough = mix(rough, 0.55, comp);
    // faint indicator glow
    aux = step(0.965, bk_h21(mod(floor(uv * uP[3].xy), uP[3].xy) + 41.0)) * via;
  } else if (uSub == 7) {
    float peel = bk_fbm(uv * uC * 0.5, uC * 0.5, 4, 0.6);
    float scr = mmScratches(uv, uC, uP[5].w * 0.6);
    albedo = uColA * (0.94 + peel * 0.12);
    albedo = bk_hueShift(albedo, macro * uP[7].x);
    // sun-bleached and chalky on the high points
    float chalk = smoothstep(0.6, 1.0, c.h) * 0.4;
    albedo = mix(albedo, mix(albedo, vec3(bk_luma(albedo)), 0.5) * 1.15, chalk);
    albedo = mix(albedo, uColB, scr * 0.6);       // stress-whitened scuffs
    metal = 0.0;
    rough = uP[6].x + peel * uP[6].y + scr * 0.25 + chalk * 0.18;
    aux = 0.55;                                    // plastic reads slightly translucent
  } else if (uSub == 8) {
    float stripe = bk_stripe(bk_shear(uv, 1.0, 0.0), vec2(uP[3].xy.x, 0.0), 0.5, 0.035, 0.0, dC);
    vec3 hazard = mix(uColB, uColA, stripe);
    float tri = mmTriangleSdf(uv);
    float outline = 1.0 - smoothstep(0.02, 0.05, abs(tri - 0.06));
    float bang = (1.0 - smoothstep(0.045, 0.06, abs(uv.x - 0.5)))
               * step(0.30, uv.y) * step(uv.y, 0.62);
    bang = max(bang, (1.0 - smoothstep(0.05, 0.065, length((uv - vec2(0.5, 0.70)) * vec2(1.0, 1.0)))));
    float glyph = clamp(max(outline, bang) * step(0.0, tri + 0.35), 0.0, 1.0);
    albedo = mix(hazard, uColC, glyph);
    // chipped, scratched, salt-crusted decal
    float chipN = 0.5 + 0.5 * bk_fbm(uv * dC * 2.2, dC * 2.2, 5, 0.6);
    float chip = smoothstep(uP[5].x, uP[5].x + 0.05, chipN + clamp(-c.curvHi * 2.0, 0.0, 1.0) * 0.5);
    albedo = mix(albedo, uColD, chip * 0.85);
    o.opacity = 1.0 - chip * 0.55;
    metal = chip * 0.5;
    rough = mix(uP[6].x, 0.55, chip) + bk_fbm(uv * uC, uC, 3, 0.5) * uP[6].y;
    aux = glyph;
  } else {
    // Woven fabric: per-thread shading, dye lot variance, abrasion, seams.
    vec2 p = uv * uP[3].xy;
    vec2 ip = floor(p);
    vec2 f = p - ip;
    float over = step(1.5, mod(ip.x + 2.0 * ip.y, 3.0));
    float threadId = bk_h21(mod(vec2(over > 0.5 ? ip.x : ip.y, over), uP[3].xy));
    albedo = mix(uColA, uColB, over);
    albedo *= 0.82 + threadId * 0.34;                    // dye-lot variance
    albedo = bk_hueShift(albedo, macro * uP[7].x);
    // thread cross-section shading (self-shadowing between threads)
    float xsec = mix(pow(max(sin(f.y * 3.14159265), 0.0), 0.55),
                     pow(max(sin(f.x * 3.14159265), 0.0), 0.55), over);
    albedo *= 0.62 + 0.5 * xsec;
    // abrasion at the wear points: fibres break and lighten
    float abr = smoothstep(0.55, 0.95, 0.5 + 0.5 * bk_fbm(uv * dC + 19.0, dC, 4, 0.6))
              * clamp(-c.curvHi * 2.0, 0.0, 1.0);
    albedo = mix(albedo, albedo * 1.5 + 0.05, abr * 0.7);
    float seam = bk_stripe(uv, vec2(0.0, 2.0), 0.06, 0.02, 0.0, dC);
    albedo = mix(albedo, uColC, seam * 0.8);
    metal = 0.0;
    rough = uP[6].x + (1.0 - xsec) * uP[6].y + abr * 0.15;
    aux = 0.35;
  }

  o.albedo = albedo;
  o.rough = rough;
  o.metal = metal;
  o.aux = aux;
  o.sparkle = bk_sparkle(uv * uC, uC, 0.03);
}
`;

/**
 * GLSL for every prop surface in the game.
 *
 * Props are shaded entirely procedurally — there is not a single sampled
 * texture in here — which is what lets one rock geometry be reused at any
 * scale, in any biome, without a UV seam or a visible tile. Every material
 * builds detail at three frequencies:
 *
 *   macro  — strata / paint panels / precursor inlay, metres across
 *   mid    — fracture cells, rust drips, barnacle clusters, decimetres
 *   micro  — grain and brushed scratches that only resolve at 30 cm
 *
 * Per-instance variation is derived from a hash of the instance's own world
 * translation (`batchingMatrix`/`instanceMatrix`), so a `BatchedMesh` needs no
 * extra per-instance attributes and no two rocks in a frame read the same.
 *
 * These chunks are injected into `MeshStandardMaterial` via `onBeforeCompile`,
 * so props get the engine's real lighting, shadows and IBL for free, and the
 * final colour is pushed through `applyUnderwater()` from
 * `world/water/UnderwaterFog.ts` exactly once, at `opaque_fragment`.
 */
import { NOISE_GLSL } from '../../core/Noise';
import { UNDERWATER_GLSL } from '../water/UnderwaterFog';

/**
 * Two compatibility shims for the shared chunks, both verified against a real
 * GLSL compile (see FINAL REPORT → INTEGRATION REQUESTS):
 *
 *  1. `core/Noise.ts`'s `NOISE_GLSL` calls `sn_permute(vec3)` inside
 *     `snoise(vec2)` but only declares the `vec4` overload, so *any* shader
 *     that includes the chunk fails to compile. Declaring the missing overload
 *     ahead of the chunk fixes it without touching `core/`.
 *  2. `COMMON_GLSL` declares `float luminance(vec3)`, which collides with the
 *     `float luminance(const in vec3)` that three's own fragment prefix emits
 *     for tone mapping. We simply do not include `COMMON_GLSL`.
 */
export const NOISE_COMPAT_GLSL = /* glsl */ `
vec3 sn_permute(vec3 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }
`;

/** Material families. Each compiles to its own program via a `#define`. */
export type PropMatKind = 'rock' | 'metal' | 'alien' | 'crystal' | 'organic';

/* ------------------------------------------------------------------ *
 * Vertex
 * ------------------------------------------------------------------ */

export const PROP_VERT_PARS = /* glsl */ `
attribute vec4 aPropSurf;      // (bakedAO, wear, encrustation, materialClass)
varying vec4 vPropSurf;
varying vec3 vPropObj;
varying vec3 vPropObjN;
varying vec4 vPropInst;        // (seed.xyz, patternScale)

vec3 propHash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
`;

/** Injected immediately after `#include <defaultnormal_vertex>`. */
export const PROP_VERT_NORMAL = /* glsl */ `
  vPropObjN = normalize(objectNormal);
`;

/** Injected immediately after `#include <begin_vertex>`. */
export const PROP_VERT_BODY = /* glsl */ `
  vPropObj = transformed;
  vPropSurf = aPropSurf;
  {
    // Instance origin in world space — works for BatchedMesh, InstancedMesh
    // and plain meshes alike, and is the only per-instance data we need.
    vec3 iOrigin = modelMatrix[3].xyz;
    #ifdef USE_BATCHING
      iOrigin += (modelMatrix * vec4(batchingMatrix[3].xyz, 0.0)).xyz;
    #elif defined( USE_INSTANCING )
      iOrigin += (modelMatrix * vec4(instanceMatrix[3].xyz, 0.0)).xyz;
    #endif
    vec3 h = propHash33(floor(iOrigin * 3.17) + 0.5);
    vPropInst = vec4(h * 91.0, 0.72 + h.x * 0.62);
  }
`;

/* ------------------------------------------------------------------ *
 * Fragment — shared library
 * ------------------------------------------------------------------ */

const PROP_LIB = /* glsl */ `
varying vec4 vPropSurf;
varying vec3 vPropObj;
varying vec3 vPropObjN;
varying vec4 vPropInst;

uniform vec3  uPropColA;
uniform vec3  uPropColB;
uniform vec3  uPropColDark;
uniform vec3  uPropSilt;
uniform vec3  uPropAccent;    // ore / rust-B / glow / vein colour
uniform vec3  uPropAccent2;   // primer / rust-A / secondary glow
uniform vec4  uPropParams;    // (roughness, bedding|panelSize, accentAmount, siltLevel)
uniform vec4  uPropParams2;   // (detailScale, crustAmount, chipThreshold, emissiveGain)

// Set by the surface block, consumed at the aomap_fragment hook.
float propAO = 1.0;

/* --- space reconstruction (no extra varyings) --------------------- */

vec3 propViewToWorldDir(vec3 v){ return (vec4(v, 0.0) * viewMatrix).xyz; }

/* --- cellular / bump helpers ------------------------------------- */

// 3D cellular noise. x = F1, y = F2, z = cell id.
vec3 propWorley3(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int k = -1; k <= 1; k++){
    for (int j = -1; j <= 1; j++){
      for (int i = -1; i <= 1; i++){
        vec3 g = vec3(float(i), float(j), float(k));
        vec3 o = hash33(ip + g);
        float d = length(g + o - fp);
        if (d < f1){ f2 = f1; f1 = d; id = o.x + o.y * 0.37 + o.z * 0.11; }
        else if (d < f2){ f2 = d; }
      }
    }
  }
  return vec3(f1, f2, id);
}

/** Two-octave relief used for the analytic normal gradient. */
float propRelief(vec3 p){
  return snoise(p * 2.6) * 0.62 + snoise(p * 6.9) * 0.27;
}

// Perturbs n by the gradient of propRelief, plus a micro grain pass.
vec3 propReliefNormal(vec3 p, vec3 n, float amp, float micro){
  float e = 0.07;
  float h = propRelief(p);
  vec3 g = vec3(propRelief(p + vec3(e, 0.0, 0.0)) - h,
                propRelief(p + vec3(0.0, e, 0.0)) - h,
                propRelief(p + vec3(0.0, 0.0, e)) - h) / e;
  g -= n * dot(g, n);                       // keep it a perturbation
  vec3 nn = normalize(n - g * amp);
  if (micro > 0.0){
    vec3 t1 = normalize(cross(nn, vec3(0.0, 1.0, 0.0001)));
    vec3 t2 = cross(nn, t1);
    float m1 = snoise(p * 23.0);
    float m2 = snoise(p * 23.0 + vec3(11.3, 5.7, 2.1));
    nn = normalize(nn + (t1 * m1 + t2 * m2) * micro);
  }
  return nn;
}

/**
 * Single-cell barnacle / coral encrustation. Cheap on purpose (one hash, no
 * 3x3 search): the gaps between cells read as natural clumping.
 * Returns coverage; outDir is the unnormalised bump direction.
 */
float propEncrust(vec3 wp, float scale, out vec3 outDir, out float cellId){
  vec3 bp = wp * scale;
  vec3 bi = floor(bp);
  vec3 bf = fract(bp) - 0.5;
  vec3 bh = hash33(bi);
  vec3 off = (bh - 0.5) * 0.62;
  vec3 d = bf - off;
  float r = length(d);
  cellId = bh.z;
  outDir = d;
  float rad = 0.16 + bh.x * 0.20;
  return smoothstep(rad, rad * 0.35, r) * step(0.44, bh.y);
}

/* --- panel frame for stamped / plated surfaces -------------------- */

void propPanelFrame(vec3 op, vec3 on, out vec2 uv, out vec3 tu, out vec3 tv){
  vec3 a = abs(on);
  if (a.y >= a.x && a.y >= a.z){ uv = op.xz; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0); }
  else if (a.x >= a.z){ uv = op.zy; tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0); }
  else { uv = op.xy; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0); }
}

/** Panel seam + rivet height field. x = height, y = seam mask, z = rivet mask. */
vec3 propPanelField(vec2 pc){
  float row = floor(pc.y);
  pc.x += 0.5 * mod(row, 2.0) + hash11(row * 7.3) * 0.3;   // stagger: no lattice
  vec2 cell = floor(pc);
  vec2 f = fract(pc);
  float ch = hash12(cell);
  if (ch > 0.58) f.x = fract(f.x * 2.0);                   // some panels split
  if (ch < 0.17) f.y = fract(f.y * 2.0);
  float lineD = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float seam = 1.0 - smoothstep(0.0, 0.04, lineD);
  vec2 q = abs(f - 0.5);
  float edge = max(q.x, q.y);
  float along = (q.x > q.y) ? f.y : f.x;
  float rr = abs(fract(along * 11.0) - 0.5);
  float rivet = smoothstep(0.05, 0.0, abs(edge - 0.44)) * smoothstep(0.3, 0.1, rr);
  float h = -seam * 0.55 + rivet * 0.75 + (hash12(cell) - 0.5) * 0.12;
  return vec3(h, seam, rivet);
}
`;

/* ------------------------------------------------------------------ *
 * Fragment — per-family surface blocks
 * ------------------------------------------------------------------ */

const SURFACE_ROCK = /* glsl */ `
  // --- rock / bedrock / vent chimney -----------------------------
  float baseRough = uPropParams.x;
  float bedding   = uPropParams.y;
  float accentAmt = uPropParams.z;
  float siltLevel = uPropParams.w;
  float dScale    = uPropParams2.x;
  float crustAmt  = uPropParams2.y;

  vec3 sp = op * dScale * vPropInst.w + vPropInst.xyz;

  // macro: warped bedding planes. Flat, near-horizontal strata in object
  // space read as sedimentary layering once the rock is tipped by placement.
  float bandN = fbm3(sp * 0.24, 3);
  float band  = sin((op.y * 1.05 * dScale + bandN * 1.7) * PI);
  float strata = smoothstep(-0.3, 0.3, band);

  // mid: plate fracture. Cell walls become chipped, darker, rougher edges.
  vec3 cel = propWorley3(sp * 0.8 + 3.1);
  float crack = 1.0 - smoothstep(0.02, 0.15, cel.y - cel.x);

  // micro
  float grain = fbm3(sp * 5.2, 3);

  float tint = clamp(mix(0.5, strata, bedding) + bandN * 0.28, 0.0, 1.0);
  albedo = mix(uPropColA, uPropColB, tint);
  albedo *= 0.76 + 0.36 * (grain * 0.5 + 0.5);
  albedo = mix(albedo, uPropColDark, crack * 0.7);
  albedo *= 0.8 + 0.4 * fract(vPropInst.x * 0.113 + vPropInst.z * 0.037);

  rough = baseRough * (0.86 + 0.24 * (grain * 0.5 + 0.5));
  metal = 0.0;
  nrm = propReliefNormal(sp, nrm, 0.16 + 0.1 * bedding, 0.035);
  // crease the fracture walls into the normal
  nrm = normalize(nrm - on * crack * 0.22);

  // ore: blobby veins with a metallic glint, the "mine me" read
  float oreN = fbm3(sp * 8.5 + 21.0, 2) * 0.5 + 0.5;
  float ore = accentAmt * smoothstep(0.52, 0.72, oreN) * (1.0 - crack * 0.5);
  albedo = mix(albedo, uPropAccent, ore * 0.92);
  metal = ore * 0.86;
  rough = mix(rough, 0.2, ore);
  emis += uPropAccent * ore * 0.22 * uPropParams2.w;

  // sediment settled on upward faces, keyed to the biome floor colour
  float up = clamp(wn.y, 0.0, 1.0);
  float silt = smoothstep(0.24, 0.95, up) * siltLevel
             * (0.42 + 0.58 * (fbm3(wp * 0.5, 3) * 0.5 + 0.5));
  silt *= 1.0 - crack * 0.55;
  albedo = mix(albedo, uPropSilt, silt * 0.82);
  rough = mix(rough, 0.97, silt);
  nrm = normalize(mix(nrm, on, silt * 0.4));

  propAO = vPropSurf.x * (1.0 - crack * 0.35) * (1.0 - silt * 0.12);

  #ifdef PROP_VENT
    // heat glow bleeding out of the fracture network near the throat
    float hot = smoothstep(-0.15, 0.85, op.y / max(0.001, dScale)) ;
    hot = clamp(hot, 0.0, 1.0);
    float flick = 0.72 + 0.28 * sin(uwTime * 2.7 + vPropInst.y * 6.1)
                       * (0.6 + 0.4 * sin(uwTime * 6.3 + op.y * 2.0));
    float vein = pow(crack, 1.6) * hot * flick;
    emis += uPropAccent2 * vein * 3.2 * uPropParams2.w;
    albedo = mix(albedo, uPropAccent2 * 0.35, vein * 0.4);
    rough = mix(rough, 0.55, vein * 0.5);
  #endif
`;

const SURFACE_METAL = /* glsl */ `
  // --- wreck hull plating ----------------------------------------
  float baseRough = uPropParams.x;
  float panelSize = max(0.15, uPropParams.y);
  float rustAmt   = uPropParams.z;
  float dScale    = uPropParams2.x;
  float crustAmt  = uPropParams2.y;
  float chipBias  = uPropParams2.z;

  float wear = clamp(vPropSurf.y, 0.0, 1.0);

  vec2 pc; vec3 tu, tv;
  propPanelFrame(op, on, pc, tu, tv);
  pc /= panelSize;
  vec3 pf = propPanelField(pc);
  float seam = pf.y;
  float rivet = pf.z;

  // Panel-space normal from the seam/rivet height field.
  float e = 0.012 / panelSize;
  float hu = propPanelField(pc + vec2(e, 0.0)).x - pf.x;
  float hv = propPanelField(pc + vec2(0.0, e)).x - pf.x;
  nrm = normalize(nrm - (tu * hu + tv * hv) * (0.9 / e) * 0.02);

  // paint -> primer -> bare metal chipping, seeded off seams and torn edges
  float wearN = fbm3(op * 2.1 * dScale + vPropInst.xyz, 4) * 0.5 + 0.5;
  float chip = smoothstep(chipBias, chipBias + 0.18, wearN + wear * 0.6 + seam * 0.2);

  // rust: world-space vertical columns so every streak runs downward
  vec3 rp = vec3(wp.x, wp.y * 0.055, wp.z) * 1.3;
  float colN = fbm3(rp, 4) * 0.5 + 0.5;
  float src  = fbm3(vec3(wp.x, wp.y * 0.85, wp.z) * 0.45, 3) * 0.5 + 0.5;
  float rust = clamp(smoothstep(0.44, 0.9, colN * 0.62 + src * 0.52 + wear * 0.45 + seam * 0.22) * rustAmt, 0.0, 1.0);
  rust = clamp(rust + smoothstep(0.45, 1.0, wn.y) * rustAmt * 0.4 * colN, 0.0, 1.0);

  float panelVar = hash12(floor(pc) + 0.5);
  albedo = uPropColA * (0.82 + 0.34 * panelVar);
  albedo = mix(albedo, uPropAccent2, smoothstep(0.0, 0.5, chip));
  albedo = mix(albedo, uPropColB, smoothstep(0.5, 1.0, chip));
  metal  = mix(0.06, 0.92, smoothstep(0.5, 1.0, chip));
  rough  = mix(baseRough, baseRough * 0.72, smoothstep(0.5, 1.0, chip));

  vec3 rustCol = mix(uPropColDark, uPropAccent, fbm3(wp * 2.6, 2) * 0.5 + 0.5);
  albedo = mix(albedo, rustCol, rust);
  metal *= 1.0 - rust * 0.95;
  rough = mix(rough, 0.95, rust);

  // brushed micro scratches, then dents
  nrm = propReliefNormal(op * dScale * 0.7 + vPropInst.xyz, nrm, 0.07, 0.05 + rust * 0.06);
  albedo *= 1.0 - seam * 0.4;
  albedo *= 0.85 + 0.3 * rivet;

  // torn edges: raw metal, heavy rust, jagged normal
  albedo = mix(albedo, uPropColB * 0.7, wear * 0.5);
  rough = mix(rough, 0.6, wear * 0.4);
  metal = mix(metal, 0.75, wear * 0.5);

  propAO = vPropSurf.x * (1.0 - seam * 0.35);
`;

const SURFACE_ALIEN = /* glsl */ `
  // --- precursor / alien: no rust, no barnacles, its own language --
  float baseRough = uPropParams.x;
  float cellSize  = max(0.2, uPropParams.y);
  float glowAmt   = uPropParams.z;
  float dScale    = uPropParams2.x;

  vec2 pc; vec3 tu, tv;
  propPanelFrame(op, on, pc, tu, tv);

  // macro: tessellated dark facets
  vec3 cv = voronoi(pc / cellSize);
  float facetEdge = 1.0 - smoothstep(0.0, 0.06, cv.y - cv.x);

  // the inlay: a second, finer cell network whose walls glow and pulse
  vec3 cv2 = voronoi(pc / (cellSize * 0.34) + 17.0);
  float trace = smoothstep(0.055, 0.012, cv2.y - cv2.x);
  trace *= step(0.35, fract(cv2.z * 13.0));

  float pulse = 0.45 + 0.55 * sin(uwTime * 1.7 - wp.y * 0.5 + cv2.z * 24.0);
  pulse = pulse * pulse;

  float sheen = fbm3(op * 3.0 * dScale, 3) * 0.5 + 0.5;
  albedo = mix(uPropColA, uPropColB, sheen);
  albedo = mix(albedo, uPropColDark, facetEdge * 0.7);
  rough = mix(baseRough, baseRough * 2.2, facetEdge);
  metal = 0.22;

  // faint iridescence: viewing-angle hue shift, no texture needed
  float fres = pow(1.0 - clamp(dot(nrm, normalize(propViewToWorldDir(normalize(vViewPosition)))), 0.0, 1.0), 4.0);
  albedo += uPropAccent2 * fres * 0.14;

  nrm = propReliefNormal(op * dScale * 1.4, nrm, 0.05, 0.02);
  nrm = normalize(nrm - on * facetEdge * 0.3);

  emis += uPropAccent * trace * (0.35 + 1.65 * pulse) * glowAmt * uPropParams2.w;
  albedo = mix(albedo, uPropAccent * 0.5, trace * 0.5);
  rough = mix(rough, 0.15, trace);

  propAO = vPropSurf.x * (1.0 - facetEdge * 0.3);
`;

const SURFACE_CRYSTAL = /* glsl */ `
  // --- quartz / crystal cluster ----------------------------------
  float baseRough = uPropParams.x;
  float glowAmt   = uPropParams.z;
  float dScale    = uPropParams2.x;

  vec3 sp = op * dScale * vPropInst.w + vPropInst.xyz;
  float milk = fbm3(sp * 3.4, 4) * 0.5 + 0.5;
  float veins = 1.0 - smoothstep(0.0, 0.1, abs(fbm3(sp * 1.6, 3)));

  albedo = mix(uPropColA, uPropColB, milk);
  albedo = mix(albedo, uPropColDark, veins * 0.35);
  rough = mix(baseRough, baseRough * 3.5, milk * 0.6 + veins * 0.4);
  metal = 0.0;

  nrm = propReliefNormal(sp * 0.6, nrm, 0.05, 0.015);

  // Fake internal scatter: bright rim, warm core, brighter where the crystal
  // is thin. Reads as translucency without paying for real transmission.
  vec3 vdirW = normalize(propViewToWorldDir(normalize(vViewPosition)));
  float fres = pow(1.0 - clamp(dot(nrm, vdirW), 0.0, 1.0), 2.2);
  emis += uPropAccent * (fres * 0.9 + 0.16) * (0.55 + 0.45 * milk) * glowAmt * uPropParams2.w;

  propAO = mix(1.0, vPropSurf.x, 0.5);
`;

const SURFACE_ORGANIC = /* glsl */ `
  // --- eggs, coral samples, soft tissue --------------------------
  float baseRough = uPropParams.x;
  float glowAmt   = uPropParams.z;
  float dScale    = uPropParams2.x;

  vec3 sp = op * dScale * vPropInst.w + vPropInst.xyz;
  vec3 cel = propWorley3(sp * 2.4);
  float vein = 1.0 - smoothstep(0.0, 0.13, cel.y - cel.x);
  float blotch = fbm3(sp * 1.5, 3) * 0.5 + 0.5;
  float mottle = fbm3(sp * 7.0, 2) * 0.5 + 0.5;

  albedo = mix(uPropColA, uPropColB, blotch);
  albedo = mix(albedo, uPropColDark, vein * 0.55);
  albedo *= 0.85 + 0.3 * mottle;
  rough = baseRough * (0.8 + 0.4 * mottle);
  metal = 0.0;

  nrm = propReliefNormal(sp * 0.9, nrm, 0.12, 0.03);
  nrm = normalize(nrm - on * vein * 0.25);

  vec3 vdirW = normalize(propViewToWorldDir(normalize(vViewPosition)));
  float fres = pow(1.0 - clamp(dot(nrm, vdirW), 0.0, 1.0), 1.6);
  float beat = 0.45 + 0.55 * sin(uwTime * 1.1 + vPropInst.y * 5.3 + blotch * 4.0);
  emis += uPropAccent * (fres * 0.6 + 0.35) * (0.4 + 0.6 * beat) * glowAmt * uPropParams2.w;
  emis += uPropAccent2 * vein * beat * 0.5 * glowAmt * uPropParams2.w;

  propAO = mix(1.0, vPropSurf.x, 0.7);
`;

const SURFACES: Record<PropMatKind, string> = {
  rock: SURFACE_ROCK,
  metal: SURFACE_METAL,
  alien: SURFACE_ALIEN,
  crystal: SURFACE_CRYSTAL,
  organic: SURFACE_ORGANIC,
};

/** Encrustation is shared by rock and metal — it is what sells "submerged". */
const ENCRUST_BLOCK = /* glsl */ `
  #ifdef PROP_ENCRUST
  {
    vec3 bdir; float bid;
    float cover = propEncrust(wp, 3.1, bdir, bid);
    cover *= clamp(vPropSurf.z, 0.0, 1.0) * crustAmt;
    cover *= smoothstep(-0.35, 0.55, wn.y) * 0.85 + 0.15;
    if (cover > 0.001){
      // barnacles pale and chalky, coral tinted by cell id
      vec3 barnCol = vec3(0.62, 0.60, 0.55);
      vec3 coralCol = mix(vec3(0.42, 0.13, 0.16), vec3(0.55, 0.34, 0.10), fract(bid * 7.0));
      float isCoral = step(0.6, fract(bid * 31.0));
      vec3 cCol = mix(barnCol, coralCol, isCoral);
      albedo = mix(albedo, cCol, cover);
      rough = mix(rough, mix(0.55, 0.82, isCoral), cover);
      metal *= 1.0 - cover;
      nrm = normalize(nrm + normalize(bdir + on * 0.35) * cover * 0.85);
      emis += coralCol * isCoral * cover * 0.05 * uPropParams2.w;
      propAO *= 1.0 - cover * 0.25;
    }
  }
  #endif
`;

/**
 * The whole fragment surface block, injected after `<normal_fragment_maps>`.
 * `nrm` starts as the geometric world normal and ends as the shading normal.
 */
function surfaceBlock(kind: PropMatKind): string {
  return /* glsl */ `
{
  vec3 op = vPropObj;
  vec3 on = normalize(vPropObjN);
  vec3 wp = cameraPosition - propViewToWorldDir(vViewPosition);
  vec3 wn = normalize(propViewToWorldDir(normal));

  vec3 albedo = vec3(0.5);
  vec3 emis = vec3(0.0);
  float rough = 0.8;
  float metal = 0.0;
  vec3 nrm = wn;

${SURFACES[kind]}
${kind === 'rock' || kind === 'metal' ? ENCRUST_BLOCK : ''}

  diffuseColor.rgb *= albedo;
  roughnessFactor = clamp(rough, 0.035, 1.0);
  metalnessFactor = clamp(metal, 0.0, 1.0);
  totalEmissiveRadiance += emis;
  normal = normalize(mat3(viewMatrix) * nrm);
}
`;
}

/** Replaces `<aomap_fragment>`: applies our baked + procedural occlusion. */
export const PROP_AO_FRAG = /* glsl */ `
#include <aomap_fragment>
  {
    float ao = clamp(propAO, 0.0, 1.0);
    reflectedLight.indirectDiffuse *= ao;
    reflectedLight.indirectSpecular *= mix(1.0, ao, 0.7);
    reflectedLight.directDiffuse *= mix(1.0, ao, 0.3);
    reflectedLight.directSpecular *= mix(1.0, ao, 0.2);
  }
`;

/** Replaces `<opaque_fragment>`: the single underwater-scattering apply. */
export const PROP_UNDERWATER_FRAG = /* glsl */ `
#include <opaque_fragment>
  {
    float propDist = length(vViewPosition);
    vec3 propW = cameraPosition - propViewToWorldDir(vViewPosition);
    vec3 propVD = normalize(propViewToWorldDir(normalize(vViewPosition)));
    gl_FragColor.rgb = applyUnderwater(gl_FragColor.rgb, propDist, propW.y, propVD);
  }
`;

/** Fragment declarations for a given family. */
export function propFragPars(kind: PropMatKind): string {
  return `${NOISE_COMPAT_GLSL}\n${NOISE_GLSL}\n${UNDERWATER_GLSL}\n${PROP_LIB}\n// kind: ${kind}\n`;
}

export function propSurfaceBlock(kind: PropMatKind): string {
  return surfaceBlock(kind);
}

/* ------------------------------------------------------------------ *
 * Stand-alone shaders (not MeshStandardMaterial derivatives)
 * ------------------------------------------------------------------ */

/**
 * "Look at me" highlight shell. A single reusable mesh that borrows the
 * geometry of whatever harvestable the player is aiming at and draws an
 * additive fresnel rim with a travelling scan line — the affordance, with zero
 * per-instance state and one extra draw call.
 */
export const HIGHLIGHT_VERT = /* glsl */ `
varying vec3 vHN;
varying vec3 vHV;
varying vec3 vHObj;
uniform float uGrow;
void main(){
  vHObj = position;
  vec3 p = position + normal * uGrow;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vHV = -mv.xyz;
  vHN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}
`;

export const HIGHLIGHT_FRAG = /* glsl */ `
varying vec3 vHN;
varying vec3 vHV;
varying vec3 vHObj;
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
void main(){
  vec3 n = normalize(vHN);
  vec3 v = normalize(vHV);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);
  float scan = 0.5 + 0.5 * sin(vHObj.y * 5.0 - uTime * 3.4);
  float a = (fres * 0.85 + 0.1) * (0.55 + 0.45 * scan) * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/**
 * Hydrothermal plume / marine-snow column. Fully GPU-animated: instance data
 * is baked once into static attributes and the vertex shader advects each
 * particle, so a whole vent field costs nothing on the CPU.
 */
export const PLUME_VERT = /* glsl */ `
${UNDERWATER_GLSL}
attribute vec2 aCorner;    // quad corner in [-1,1]
attribute vec4 aSeed;      // (phase, radius, angle, sizeScale)
attribute vec4 aOrigin;    // (x, y, z, kind) vent mouth in group space
varying vec2  vQ;
varying float vLife;
varying float vKind;
varying vec3  vWorld;
varying float vDist;
uniform float uTime;
uniform float uHeight;
uniform float uRise;
uniform float uSpread;
uniform float uSize;
uniform vec3  uCurrent;
void main(){
  float life = fract(aSeed.x + uTime * uRise * (0.6 + aSeed.w * 0.7));
  vLife = life;
  vKind = aOrigin.w;
  vQ = aCorner;
  float h = life * uHeight;
  // widening cone + slow swirl + advection by the ambient current
  float sw = aSeed.z + life * 2.4 + sin(uTime * 0.5 + aSeed.x * 12.0) * 0.8;
  float rad = aSeed.y * (0.22 + uSpread * life);
  vec3 local = aOrigin.xyz + vec3(cos(sw) * rad, h, sin(sw) * rad) + uCurrent * h;
  vec4 world = modelMatrix * vec4(local, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vDist = length(mv.xyz);
  float size = uSize * aSeed.w * (0.3 + 1.7 * life);
  mv.xy += aCorner * size;                 // camera-facing billboard
  gl_Position = projectionMatrix * mv;
}
`;

export const PLUME_FRAG = /* glsl */ `
${UNDERWATER_GLSL}
varying vec2  vQ;
varying float vLife;
varying float vKind;
varying vec3  vWorld;
varying float vDist;
uniform vec3  uColorHot;
uniform vec3  uColorCool;
uniform float uOpacity;
void main(){
  float r = length(vQ);
  if (r > 1.0) discard;
  // soft round particle with a bright core; bubbles get a rim highlight
  float core = pow(1.0 - r, 2.0);
  float rim = smoothstep(0.62, 0.98, r) * vKind;
  float fade = (1.0 - vLife) * (1.0 - vLife * 0.4);
  float a = (core * 0.9 + rim * 0.7) * fade * uOpacity;
  if (a < 0.002) discard;
  vec3 c = mix(uColorHot, uColorCool, smoothstep(0.0, 0.5, vLife));
  c += rim * 0.6;
  // additive particles still have to obey the water column
  vec3 vd = normalize(cameraPosition - vWorld);
  c = applyUnderwater(c * a, vDist, vWorld.y, vd);
  gl_FragColor = vec4(c, a);
}
`;

/**
 * The flora material: one `MeshStandardMaterial` per species/LOD, extended
 * through `onBeforeCompile`.
 *
 * Vertex stage
 *   - Per-instance shape warp (height, twist about Y, progressive lean) so two
 *     instances sharing a baked mesh still read as different plants.
 *   - Sway driven by the *shared* current field. The system samples
 *     `ctx.world.currentAt` at the camera and two offset probes each frame and
 *     hands the shader a base vector plus an XZ gradient, so flora and fauna
 *     agree about which way the water is moving. A cheap two-sine gust adds
 *     travelling low-frequency variation on top.
 *   - Compliance ramps as `pow(t, stiffness)` from the holdfast to the tip, and
 *     a travelling sine along `t` makes long kelp *undulate* over its whole
 *     length rather than pivoting rigidly at the base.
 *   - Secondary high-frequency flutter gated by the per-vertex `blade` weight.
 *   - Player parting: a radial push, plus a velocity term, that visibly opens a
 *     corridor when you swim through a kelp bed.
 *   - Arc-length compensation (`y -= disp^2 / 2h`) so bending never stretches.
 *
 * Fragment stage
 *   - Screen-space blue-noise dither for the LOD crossfade. Neighbouring LODs
 *     use complementary noise so total coverage stays exactly 1 through the
 *     transition — no pop, no double-darkening, and TAA resolves the pattern.
 *   - Three texture scales: mid (species UV), micro (8-14x), and a macro layer
 *     keyed to world XZ so adjacent plants never share a pattern.
 *   - Real two-sided back-scatter: light travelling *through* the lamina, tinted
 *     by wavelength-dependent downwelling, so blades ignite when the sun is
 *     behind them.
 *   - Wet specular sheen with a Fresnel edge term.
 *   - Bioluminescent emission, pulsed and depth-weighted.
 *   - `applyUnderwater()` last, always.
 */
import * as THREE from 'three';
import {
  UNDERWATER_CAUSTICS_GLSL,
  UNDERWATER_CAUSTICS_UNIFORMS_GLSL,
  UNDERWATER_FUNCS_GLSL,
  UNDERWATER_UNIFORMS_GLSL,
} from '../water/UnderwaterFog';

/** Uniforms shared by every flora material — written once per frame. */
export interface FloraGlobals {
  uTime: THREE.IUniform<number>;
  uFlowBase: THREE.IUniform<THREE.Vector3>;
  uFlowGradX: THREE.IUniform<THREE.Vector3>;
  uFlowGradZ: THREE.IUniform<THREE.Vector3>;
  uFlowOrigin: THREE.IUniform<THREE.Vector3>;
  uGustAmp: THREE.IUniform<number>;
  uPlayerPos: THREE.IUniform<THREE.Vector3>;
  uPlayerVel: THREE.IUniform<THREE.Vector3>;
  uPushRadius: THREE.IUniform<number>;
  uPushStrength: THREE.IUniform<number>;
  uBlueNoise: THREE.IUniform<THREE.Texture | null>;
  uBlueNoiseScale: THREE.IUniform<THREE.Vector2>;
  uDitherOffset: THREE.IUniform<THREE.Vector2>;
}

export function createFloraGlobals(): FloraGlobals {
  return {
    uTime: { value: 0 },
    uFlowBase: { value: new THREE.Vector3(0.35, 0, 0.2) },
    uFlowGradX: { value: new THREE.Vector3() },
    uFlowGradZ: { value: new THREE.Vector3() },
    uFlowOrigin: { value: new THREE.Vector3() },
    uGustAmp: { value: 0.35 },
    uPlayerPos: { value: new THREE.Vector3(0, 1e5, 0) },
    uPlayerVel: { value: new THREE.Vector3() },
    uPushRadius: { value: 2.4 },
    uPushStrength: { value: 0.9 },
    uBlueNoise: { value: null },
    uBlueNoiseScale: { value: new THREE.Vector2(1 / 128, 1 / 128) },
    uDitherOffset: { value: new THREE.Vector2() },
  };
}

/** Fallback water uniforms, used if `world.water` is not registered. */
export function fallbackWaterUniforms(): Record<string, THREE.IUniform> {
  return {
    uwExtinction: { value: new THREE.Vector3(0.42, 0.09, 0.045) },
    uwInscatter: { value: new THREE.Color(0.06, 0.3, 0.38) },
    uwSurfaceY: { value: 0 },
    uwDensity: { value: 1 },
    uwSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3) },
    uwSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
    uwTime: { value: 0 },
    uwCameraDepth: { value: 0 },
  };
}

export interface FloraMaterialParams {
  color: THREE.Color;
  maps: { map: THREE.Texture; normalMap: THREE.Texture | null; roughnessMap: THREE.Texture | null };
  roughness: number;
  metalness: number;
  normalScale: number;
  /** Animation. */
  swayAmp: number;
  swayFreq: number;
  stiffness: number;
  undulate: number;
  waveScale: number;
  flutter: number;
  plantHeight: number;
  /** Texturing. */
  texScale: number;
  microScale: number;
  microAmt: number;
  macroScale: number;
  macroAmt: number;
  aoAmt: number;
  /** Shading. */
  transColor: THREE.Color;
  transStrength: number;
  transPower: number;
  sheen: number;
  sheenGloss: number;
  emissiveColor: THREE.Color;
  emissiveStrength: number;
  emissivePulse: number;
  /** LOD crossfade windows in metres: [fadeInStart, fadeInEnd] / [outStart, outEnd]. */
  lodIn: [number, number];
  lodOut: [number, number];
  /** Complementary dither parity — alternate per LOD level. */
  ditherInvert: boolean;
  /** Alpha handling: gated by the vertex blade weight, straight from the card, or off. */
  alphaMode: 'blade' | 'card' | 'none';
  alphaTest: number;
  card: boolean;
  depthWrite: boolean;
  /** Debug/label name. */
  name: string;
}

export interface FloraMaterial extends THREE.MeshStandardMaterial {
  floraUniforms: Record<string, THREE.IUniform>;
}

/* ------------------------------------------------------------------ *
 * GLSL
 * ------------------------------------------------------------------ */

const FLORA_VARYINGS = /* glsl */ `
varying vec3 vFloraWorld;
varying vec3 vFloraNormalW;
varying float vFloraDist;
varying float vFloraAo;
varying float vFloraBlade;
varying float vFloraEmit;
varying float vFloraThick;
varying float vFloraPhase;
varying vec3 vFloraTint;
`;

const FLORA_VERT_PARS = /* glsl */ `
attribute vec4 aBend;
attribute vec3 aFlora;
#ifdef USE_INSTANCING
attribute vec4 aInst;
attribute vec4 aWarp;
attribute vec3 aTint;
#endif

uniform float uTime;
uniform vec3 uFlowBase;
uniform vec3 uFlowGradX;
uniform vec3 uFlowGradZ;
uniform vec3 uFlowOrigin;
uniform float uGustAmp;
uniform vec3 uPlayerPos;
uniform vec3 uPlayerVel;
uniform float uPushRadius;
uniform float uPushStrength;
uniform float uSwayAmp;
uniform float uSwayFreq;
uniform float uStiffness;
uniform float uUndulate;
uniform float uWaveScale;
uniform float uFlutter;
uniform float uPlantHeight;
${FLORA_VARYINGS}

void floraDeform(inout vec3 P, inout vec3 N) {
  mat4 IM = mat4(1.0);
  vec4 inst = vec4(0.0, 0.0, 1.0, 0.0);
  vec4 warp = vec4(0.0);
  vec3 tint = vec3(1.0);
#ifdef USE_INSTANCING
  IM = instanceMatrix;
  inst = aInst;
  warp = aWarp;
  tint = aTint;
#endif
  mat3 M3 = mat3(modelMatrix) * mat3(IM);
  float s2 = max(dot(M3[0], M3[0]), 1e-6);
  vec3 originW = (modelMatrix * IM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

  float t = clamp(aBend.x, 0.0, 1.0);
  float phase = inst.y;

  // ---- per-instance shape warp: no two plants share a silhouette ----
  P.y *= inst.z;
  float tw = warp.x * t * aFlora.z;
  float cw = cos(tw);
  float sw = sin(tw);
  P.xz = mat2(cw, -sw, sw, cw) * P.xz;
  P.xz += vec2(warp.z, warp.w) * warp.y * t * t;

  // ---- shared current field + travelling gust ----
  vec3 flowW = uFlowBase
    + uFlowGradX * (originW.x - uFlowOrigin.x)
    + uFlowGradZ * (originW.z - uFlowOrigin.z);
  float nt = uTime * uSwayFreq;
  vec2 gp = originW.xz * 0.045;
  flowW.x += sin(gp.x * 1.7 + nt * 0.9) * cos(gp.y * 1.3 - nt * 0.7) * uGustAmp;
  flowW.z += sin(gp.y * 1.9 - nt * 0.8) * cos(gp.x * 1.1 + nt * 0.6) * uGustAmp;

  // World -> instance-local. The instance basis is a rotation times a uniform
  // scale, so the inverse is the transpose over the squared scale.
  vec3 flowL = vec3(dot(M3[0], flowW), dot(M3[1], flowW), dot(M3[2], flowW)) / s2;

  float compliance = pow(t, uStiffness);
  float amp = uSwayAmp * compliance;
  vec3 disp = flowL * amp;

  // ---- travelling undulation along the whole length ----
  float travel = t * uWaveScale - uTime * uSwayFreq * 1.9 + (phase + aBend.z) * 6.2831853;
  vec3 lat = vec3(-flowL.z, 0.0, flowL.x);
  float latLen = length(lat);
  lat = latLen > 1e-5 ? lat / latLen : vec3(1.0, 0.0, 0.0);
  disp += lat * (sin(travel) * amp * uUndulate);
  disp.y += cos(travel) * amp * uUndulate * 0.22 * t;

  // ---- secondary lamina flutter ----
  float fl = aBend.y * uFlutter * (0.30 + 0.70 * t);
  float fp = uTime * uSwayFreq * 6.2 + phase * 17.0 + (P.x + P.z) * 3.1 + aBend.z * 9.0;
  disp += vec3(sin(fp), sin(fp * 1.7 + 1.1) * 0.45, cos(fp * 0.93)) * fl;

  // ---- player parting ----
  vec3 preW = (modelMatrix * IM * vec4(P, 1.0)).xyz;
  vec3 rel = preW - uPlayerPos;
  float pf = smoothstep(uPushRadius, uPushRadius * 0.18, length(rel.xz))
           * smoothstep(uPushRadius * 1.5, uPushRadius * 0.2, abs(rel.y));
  if (pf > 0.002) {
    vec3 away = vec3(rel.x, rel.y * 0.25, rel.z);
    float al = length(away);
    away = al > 1e-4 ? away / al : vec3(1.0, 0.0, 0.0);
    vec3 pushW = (away * uPushStrength + uPlayerVel * 0.10) * pf * compliance;
    disp += vec3(dot(M3[0], pushW), dot(M3[1], pushW), dot(M3[2], pushW)) / s2;
  }

  P += disp;

  // ---- arc-length compensation: bending shortens, it does not stretch ----
  float span = max(uPlantHeight * inst.z, 0.3);
  P.y -= 0.5 * dot(disp.xz, disp.xz) / span * t;

  // ---- carry the normal with the bend ----
  float dl = length(disp);
  if (dl > 0.001) {
    vec3 bd = disp / dl;
    vec3 ax = cross(vec3(0.0, 1.0, 0.0), bd);
    float axl = length(ax);
    if (axl > 1e-4) {
      ax /= axl;
      float ang = clamp(dl / span, 0.0, 0.9) * 1.15;
      float ca = cos(ang);
      float sa = sin(ang);
      N = N * ca + cross(ax, N) * sa + ax * (dot(ax, N) * (1.0 - ca));
    }
  }

  vFloraWorld = (modelMatrix * IM * vec4(P, 1.0)).xyz;
  vFloraNormalW = normalize(M3 * N);
  vFloraDist = length(cameraPosition - originW);
  vFloraAo = aBend.w;
  vFloraBlade = aBend.y;
  vFloraEmit = aFlora.x;
  vFloraThick = aFlora.y;
  vFloraPhase = phase;
  vFloraTint = tint;
}
`;

const FLORA_FRAG_PARS_CAUSTICS = /* glsl */ `
${UNDERWATER_CAUSTICS_UNIFORMS_GLSL}
${UNDERWATER_CAUSTICS_GLSL}
`;

const FLORA_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uBlueNoise;
uniform vec2 uBlueNoiseScale;
uniform vec2 uDitherOffset;
uniform vec2 uLodIn;
uniform vec2 uLodOut;
uniform float uTexScale;
uniform float uMicroScale;
uniform float uMicroAmt;
uniform float uMacroScale;
uniform float uMacroAmt;
uniform float uAoAmt;
uniform vec3 uTransColor;
uniform float uTransStrength;
uniform float uTransPower;
uniform float uSheen;
uniform float uSheenGloss;
uniform vec3 uEmissiveColor;
uniform float uEmissiveStrength;
uniform float uEmissivePulse;
${UNDERWATER_UNIFORMS_GLSL}
${UNDERWATER_FUNCS_GLSL}
${FLORA_VARYINGS}

// Coverage of this LOD level at a given instance distance. Adjacent levels are
// exact complements inside their shared transition window.
float floraVis(float d) {
  return smoothstep(uLodIn.x, uLodIn.y, d) * (1.0 - smoothstep(uLodOut.x, uLodOut.y, d));
}
`;

const FLORA_DITHER = /* glsl */ `
  float floraCoverage = floraVis(vFloraDist);
  float floraNoise = texture2D(uBlueNoise, gl_FragCoord.xy * uBlueNoiseScale + uDitherOffset).r * 0.998 + 0.001;
  #ifdef FLORA_DITHER_INVERT
    floraNoise = 1.0 - floraNoise;
  #endif
  if (floraCoverage < floraNoise) discard;
`;

const FLORA_MAP = /* glsl */ `
  vec4 floraTex = texture2D(map, vMapUv * uTexScale);
  diffuseColor.rgb *= floraTex.rgb;
  #ifndef FLORA_CARD
    // Micro grain: a second, much higher-frequency tap so the surface still has
    // structure at 30 cm without visibly tiling at 30 m.
    vec3 floraMicro = texture2D(map, vMapUv * uMicroScale + vec2(0.37, 0.11)).rgb;
    diffuseColor.rgb *= mix(vec3(1.0), floraMicro * 1.45, uMicroAmt);
    // Macro layer keyed to world XZ: adjacent plants can never share a pattern.
    vec3 floraMacro = texture2D(map, vFloraWorld.xz * uMacroScale).rgb;
    diffuseColor.rgb *= mix(vec3(1.0), 0.55 + 0.95 * floraMacro.gbr, uMacroAmt);
  #endif
  diffuseColor.rgb *= vFloraTint;
  diffuseColor.rgb *= mix(1.0, vFloraAo, uAoAmt);
  #ifdef FLORA_ALPHA_BLADE
    diffuseColor.a *= mix(1.0, floraTex.a, vFloraBlade);
  #endif
  #ifdef FLORA_ALPHA_CARD
    diffuseColor.a *= floraTex.a;
  #endif
`;

const FLORA_ALPHATEST = /* glsl */ `
#ifdef USE_ALPHATEST
  // Rescale coverage by its own screen-space derivative. Without this the mip
  // chain averages the cutout toward the test value and distant foliage
  // dissolves; with it the apparent thickness stays constant.
  float floraA = (diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) * 0.55 + 0.5;
  if (floraA < 0.5) discard;
  diffuseColor.a = 1.0;
#endif
`;

const FLORA_SHADE = /* glsl */ `
{
  vec3 fV = cameraPosition - vFloraWorld;
  float fDist = length(fV);
  fV = fDist > 1e-4 ? fV / fDist : vec3(0.0, 0.0, 1.0);
  // View-space normal back to world without transpose() (ESSL1 lacks it):
  // column i of viewMatrix dotted with n gives (M^T n).i.
  vec3 fN = normalize(vec3(
    dot(viewMatrix[0].xyz, normal),
    dot(viewMatrix[1].xyz, normal),
    dot(viewMatrix[2].xyz, normal)));
  vec3 fL = normalize(uwSunDir);
  vec3 fNg = normalize(vFloraNormalW) * (gl_FrontFacing ? 1.0 : -1.0);

  // Wavelength-dependent downwelling from the shared water model: red is gone
  // by ~5 m, blue survives — so backlit blades read warm-green near the surface
  // and cyan at depth, exactly as they should.
  float fDepth = max(0.0, uwSurfaceY - vFloraWorld.y);
  vec3 fDown = waterDownwelling(fDepth);

  // ---- caustic dapple across the foliage ----
#ifdef FLORA_CAUSTICS
  if (uwCausticsParams.w > 0.5 && vFloraWorld.y < uwSurfaceY) {
    gl_FragColor.rgb += waterCaustics(vFloraWorld, fNg) * uwSunColor * fDown * 0.75;
  }
#endif

  // ---- back-scatter: sunlight travelling THROUGH the lamina ----
  float back = pow(clamp(dot(-fL, fV), 0.0, 1.0), uTransPower);
  // Wrapped diffuse from the *geometric* normal: the normal-mapped one is too
  // noisy for a term this soft and would sparkle as the blade flexes.
  float wrapped = clamp(0.5 - 0.5 * dot(fNg, fL), 0.0, 1.0);
  float rim = 1.0 - abs(dot(fN, fV)) * 0.45;
  vec3 trans = uTransColor * diffuseColor.rgb * uwSunColor * fDown;
  gl_FragColor.rgb += trans * (back * (0.30 + 0.70 * wrapped) * vFloraThick * rim * uTransStrength);

  // ---- wet specular sheen ----
  vec3 fH = normalize(fL + fV);
  float spec = pow(clamp(dot(fN, fH), 0.0, 1.0), uSheenGloss);
  float fres = pow(1.0 - clamp(dot(fN, fV), 0.0, 1.0), 4.0);
  gl_FragColor.rgb += uwSunColor * fDown * (spec * uSheen * (0.30 + fres));

  // ---- bioluminescence: reads at depth without saturating bloom ----
  if (uEmissiveStrength > 0.0) {
    float pulse = 0.70 + 0.30 * sin(uTime * uEmissivePulse + vFloraPhase * 19.0 + vFloraWorld.y * 0.7);
    gl_FragColor.rgb += uEmissiveColor * (vFloraEmit * uEmissiveStrength * pulse);
  }

  // ---- water is always the last word ----
  gl_FragColor.rgb = applyUnderwater(gl_FragColor.rgb, fDist, vFloraWorld.y, -fV);
}
`;

/* ------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------ */

let materialSerial = 0;

export function createFloraMaterial(
  p: FloraMaterialParams,
  globals: FloraGlobals,
  water: Record<string, THREE.IUniform>,
): FloraMaterial {
  const own: Record<string, THREE.IUniform> = {
    uSwayAmp: { value: p.swayAmp },
    uSwayFreq: { value: p.swayFreq },
    uStiffness: { value: p.stiffness },
    uUndulate: { value: p.undulate },
    uWaveScale: { value: p.waveScale },
    uFlutter: { value: p.flutter },
    uPlantHeight: { value: p.plantHeight },
    uTexScale: { value: p.texScale },
    uMicroScale: { value: p.microScale },
    uMicroAmt: { value: p.microAmt },
    uMacroScale: { value: p.macroScale },
    uMacroAmt: { value: p.macroAmt },
    uAoAmt: { value: p.aoAmt },
    uTransColor: { value: p.transColor.clone() },
    uTransStrength: { value: p.transStrength },
    uTransPower: { value: p.transPower },
    uSheen: { value: p.sheen },
    uSheenGloss: { value: p.sheenGloss },
    uEmissiveColor: { value: p.emissiveColor.clone() },
    uEmissiveStrength: { value: p.emissiveStrength },
    uEmissivePulse: { value: p.emissivePulse },
    uLodIn: { value: new THREE.Vector2(p.lodIn[0], p.lodIn[1]) },
    uLodOut: { value: new THREE.Vector2(p.lodOut[0], p.lodOut[1]) },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    map: p.maps.map,
    normalMap: p.maps.normalMap ?? undefined,
    roughnessMap: p.maps.roughnessMap ?? undefined,
    roughness: p.roughness,
    metalness: p.metalness,
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: p.alphaMode === 'none' ? 0 : p.alphaTest,
    depthWrite: p.depthWrite,
    // Water colour is applied analytically in the shader; scene fog would
    // flatten it back to a single colour.
    fog: false,
    dithering: true,
  }) as FloraMaterial;
  if (mat.normalMap) mat.normalScale.set(p.normalScale, p.normalScale);
  mat.floraUniforms = own;
  mat.name = p.name;
  // Opt out of `world/water/MaterialPatch`: this material already mixes in
  // `sharedUniforms` and calls `applyUnderwater()` itself, and a second
  // injection would redeclare the whole chunk and fail to compile.
  mat.userData.underwater = true;
  mat.userData.waterAware = true;

  const caustics = water.uwCausticsMap !== undefined && water.uwCausticsParams !== undefined;

  const defines: Record<string, string> = {};
  if (p.alphaMode === 'blade') defines.FLORA_ALPHA_BLADE = '1';
  if (p.alphaMode === 'card') defines.FLORA_ALPHA_CARD = '1';
  if (p.ditherInvert) defines.FLORA_DITHER_INVERT = '1';
  if (p.card) defines.FLORA_CARD = '1';
  if (caustics) defines.FLORA_CAUSTICS = '1';
  mat.defines = { ...(mat.defines ?? {}), ...defines };

  const key = `flora|${Object.keys(defines).sort().join(',')}|${p.alphaMode}|${materialSerial++}`;
  mat.customProgramCacheKey = () => key;

  // Keep the literal marker that `MaterialPatch.isWaterAware` looks for inside
  // this closure's own source, belt-and-braces with the userData flags above:
  // applyUnderwater / uwExtinction.
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, water, globals, own);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FLORA_VERT_PARS}`)
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n\tvec3 floraPos = vec3( position );\n\tfloraDeform( floraPos, objectNormal );',
      )
      .replace('#include <begin_vertex>', '\tvec3 transformed = floraPos;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${FLORA_FRAG_PARS}${caustics ? FLORA_FRAG_PARS_CAUSTICS : ''}`,
      )
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FLORA_DITHER}`)
      .replace('#include <map_fragment>', FLORA_MAP)
      .replace('#include <alphatest_fragment>', FLORA_ALPHATEST)
      .replace('#include <tonemapping_fragment>', `${FLORA_SHADE}\n#include <tonemapping_fragment>`);
  };

  return mat;
}

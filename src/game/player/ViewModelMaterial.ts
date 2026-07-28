/**
 * Materials for the first-person view model.
 *
 * Everything is generated in the shader — there are no texture files and no
 * TextureLibrary tiling to give away. Each material layers detail at three
 * scales so the hands read at 30 cm and at arm's length:
 *
 *   macro  — broad tonal drift and dirt accumulation over the whole part
 *   mid    — suit ribs / machined panel lines / grip lugs, plus a cavity term
 *   micro  — fabric weave and grit that only shows up close, in roughness and
 *            in a derivative-based bump so the specular breaks up
 *
 * A baked `vmMask` attribute (ambient occlusion, edge exposure, per-part random)
 * comes in from the geometry builders and drives crevice darkening and edge
 * wear, which is what stops procedural greebles looking like flat plastic.
 *
 * Two additional jobs:
 *
 *  1. **Near-clip.** The vertex stage rewrites `gl_Position.z` so the geometry
 *     writes depth as if it were 0.45–1.8 m away, while still being drawn at its
 *     true 0.15–1.2 m position. Because the player capsule has a 0.42 m radius,
 *     no world surface can ever be closer than that, so the hands can never
 *     clip into geometry — without a second render pass.
 *  2. **Water integration.** Depth-graded downwelling extinction, animated
 *     caustic dapple and the shared underwater inscatter are applied in linear
 *     space before tone mapping, using `WaterSystem.sharedUniforms` by
 *     reference, so the hands always match the water the rest of the frame is
 *     rendered in.
 */
import * as THREE from 'three';
import { NOISE_GLSL } from '../core/Noise';
import * as UnderwaterFogNS from '../world/water/UnderwaterFog';

/* ------------------------------------------------------------------ *
 * Defensive access to the water module's shared GLSL. The water agent owns
 * that file; only `applyUnderwater()`'s signature and the uniform names are
 * frozen, so fall back to a local copy if the exported chunk names change.
 * ------------------------------------------------------------------ */
const FALLBACK_UNIFORMS = /* glsl */ `
uniform vec3  uwExtinction;
uniform vec3  uwInscatter;
uniform float uwSurfaceY;
uniform float uwDensity;
uniform vec3  uwSunDir;
uniform vec3  uwSunColor;
uniform float uwTime;
uniform float uwCameraDepth;
`;

const FALLBACK_FUNCS = /* glsl */ `
vec3 applyUnderwater(vec3 color, float dist, float wy, vec3 viewDir) {
  float depth = max(0.0, uwSurfaceY - wy);
  vec3 downwelling = exp(-uwExtinction * depth * uwDensity);
  vec3 transmittance = exp(-uwExtinction * dist * uwDensity);
  float cosT = dot(normalize(viewDir), normalize(uwSunDir));
  const float g = 0.55;
  float hg = (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
  vec3 inscattered = (uwInscatter * downwelling + uwSunColor * downwelling * hg * 0.9) * (1.0 - transmittance);
  return color * transmittance + inscattered;
}
`;

function sharedGlsl(key: string, fallback: string): string {
  const v = (UnderwaterFogNS as unknown as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 16 ? v : fallback;
}

const UW_UNIFORMS = sharedGlsl('UNDERWATER_UNIFORMS_GLSL', FALLBACK_UNIFORMS);
const UW_FUNCS = sharedGlsl('UNDERWATER_FUNCS_GLSL', FALLBACK_FUNCS);

/* ------------------------------------------------------------------ *
 * Style presets
 * ------------------------------------------------------------------ */

export type VmStyle =
  | 'suit'
  | 'glove'
  | 'rubber'
  | 'metal'
  | 'painted'
  | 'plastic'
  | 'glass'
  | 'emissive';

interface StyleDef {
  color: number;
  tint: number;
  rough: [number, number];
  metal: number;
  /** macroScale, midScale, microScale, bumpStrength */
  detail: [number, number, number, number];
  /** wear, grime, ribAmount, ribFreq */
  wear: [number, number, number, number];
  metalWear: number;
  ao: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

const STYLES: Record<VmStyle, StyleDef> = {
  // Dive-suit fabric: neoprene, ribbed panels, matte with a slight sheen.
  suit: {
    color: 0x2b3b44,
    tint: 0x121a20,
    rough: [0.58, 0.9],
    metal: 0.02,
    detail: [2.6, 26, 190, 0.55],
    wear: [0.16, 0.4, 0.55, 62],
    metalWear: 0,
    ao: 0.95,
  },
  // Glove rubber: darker, grippier, coarse pebbling on the palm side.
  glove: {
    color: 0x1a2226,
    tint: 0x0a0e10,
    rough: [0.5, 0.86],
    metal: 0.03,
    detail: [3.4, 42, 320, 0.8],
    wear: [0.3, 0.45, 0.3, 130],
    metalWear: 0.05,
    ao: 1,
  },
  rubber: {
    color: 0x14181a,
    tint: 0x090b0c,
    rough: [0.72, 0.96],
    metal: 0.02,
    detail: [3, 34, 260, 0.6],
    wear: [0.12, 0.3, 0.4, 90],
    metalWear: 0,
    ao: 1,
  },
  // Machined aluminium: fine directional brushing, scuffed edges.
  metal: {
    color: 0x9aa3ab,
    tint: 0x4a5157,
    rough: [0.18, 0.52],
    metal: 0.92,
    detail: [2.2, 30, 420, 0.35],
    wear: [0.55, 0.3, 0.22, 210],
    metalWear: 0.9,
    ao: 0.9,
  },
  // Painted equipment orange over metal: chips reveal the substrate.
  painted: {
    color: 0xd4691d,
    tint: 0x6e3a14,
    rough: [0.26, 0.62],
    metal: 0.12,
    detail: [2.4, 22, 300, 0.4],
    wear: [0.6, 0.4, 0.18, 150],
    metalWear: 0.75,
    ao: 0.9,
  },
  plastic: {
    color: 0xb9bdc0,
    tint: 0x5c6265,
    rough: [0.3, 0.6],
    metal: 0.04,
    detail: [2.8, 26, 240, 0.3],
    wear: [0.3, 0.35, 0.25, 120],
    metalWear: 0.1,
    ao: 0.9,
  },
  // Visor / lens glass: smooth, thin, with a faint smear film.
  glass: {
    color: 0x8fc6cf,
    tint: 0x2a4a52,
    rough: [0.03, 0.16],
    metal: 0.1,
    detail: [1.6, 18, 160, 0.12],
    wear: [0.12, 0.18, 0.05, 60],
    metalWear: 0,
    ao: 0.4,
    transparent: true,
    opacity: 0.42,
  },
  // Status LEDs and screens.
  emissive: {
    color: 0x0d1418,
    tint: 0x05080a,
    rough: [0.22, 0.4],
    metal: 0.1,
    detail: [2, 60, 380, 0.2],
    wear: [0.1, 0.15, 0.1, 240],
    metalWear: 0,
    ao: 0.5,
    emissive: 0x39d8ff,
    emissiveIntensity: 2.4,
  },
};

/* ------------------------------------------------------------------ *
 * GLSL
 * ------------------------------------------------------------------ */

const VM_DECLS = /* glsl */ `
varying vec3 vVmLocal;
varying vec3 vVmWorld;
varying vec3 vVmView;
varying vec3 vVmMask;
uniform vec2  uVmDepthRange;
uniform vec4  uVmDetail;
uniform vec4  uVmWear;
uniform vec2  uVmRough;
uniform vec3  uVmTint;
uniform float uVmMetalWear;
uniform float uVmAO;
uniform float uVmCaustics;
uniform float uVmFogDist;
uniform float uVmCausticsTexMix;
uniform sampler2D uVmCausticsTex;
uniform float uVmWetness;
`;

const VM_FUNCS = /* glsl */ `
float vmHeightField(vec3 lp, out float macro, out float mid, out float micro) {
  macro = fbm3(lp * uVmDetail.x, 3);
  mid   = fbm3(lp * uVmDetail.y, 2);
  micro = snoise(lp * uVmDetail.z);
  // Ribs / panel lines: a triangle wave along the part's long axis, warped by
  // the mid noise so the lines are never perfectly straight.
  float rib = abs(fract(lp.z * uVmWear.w + mid * 0.35) - 0.5) * 2.0;
  rib = smoothstep(0.25, 0.75, rib);
  return mid * 0.55 + micro * 0.22 + (rib - 0.5) * uVmWear.z;
}

/** Animated caustic dapple. Procedural, with an optional blend of the water
 *  system's own caustics texture when it has published one. */
float vmCaustics(vec3 wpos) {
  vec2 p = wpos.xz * 0.85;
  float t = uwTime;
  vec3 v1 = voronoi(p * 1.6 + vec2(t * 0.11, -t * 0.08));
  vec3 v2 = voronoi(p * 2.7 - vec2(t * 0.06, t * 0.13));
  float c = pow(1.0 - min(v1.x, 1.0), 3.0) + 0.6 * pow(1.0 - min(v2.x, 1.0), 4.0);
  float texC = texture2D(uVmCausticsTex, wpos.xz * 0.06 + vec2(t * 0.006, t * 0.004)).r;
  return mix(c, c * 0.45 + texC * 1.6, uVmCausticsTexMix);
}
`;

/* ------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------ */

export interface VmMaterialOptions {
  /** Shared water uniforms, mixed in by reference. */
  water?: Record<string, THREE.IUniform>;
  /** Override the preset base colour. */
  color?: number;
  /** Override emissive colour (LEDs, screens, laser). */
  emissive?: number;
  emissiveIntensity?: number;
  /** Depth-remap window in metres; keep above the capsule radius (0.42 m). */
  depthRange?: [number, number];
  /** Caustic strength multiplier, 0 disables. */
  caustics?: number;
  /** Roughness window override. */
  rough?: [number, number];
  side?: THREE.Side;
}

export interface VmMaterial extends THREE.MeshStandardMaterial {
  /** The uniforms this material owns (water uniforms are shared by reference). */
  vmUniforms: Record<string, THREE.IUniform>;
}

const WHITE_1PX = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

/** Disposes the fallback caustics texture. Called by the view-model system. */
export function disposeViewModelShared(): void {
  WHITE_1PX.dispose();
}

export function createViewModelMaterial(style: VmStyle, opts: VmMaterialOptions = {}): VmMaterial {
  const def = STYLES[style];
  const rough = opts.rough ?? def.rough;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? def.color).convertSRGBToLinear(),
    roughness: rough[1],
    metalness: def.metal,
    transparent: def.transparent ?? false,
    opacity: def.opacity ?? 1,
    depthWrite: !(def.transparent ?? false),
    side: opts.side ?? THREE.FrontSide,
    emissive: new THREE.Color(opts.emissive ?? def.emissive ?? 0x000000).convertSRGBToLinear(),
    emissiveIntensity: opts.emissiveIntensity ?? def.emissiveIntensity ?? 1,
    dithering: true,
  }) as VmMaterial;
  mat.name = `viewmodel.${style}`;

  const uniforms: Record<string, THREE.IUniform> = {
    uVmDepthRange: { value: new THREE.Vector2(...(opts.depthRange ?? [0.45, 1.8])) },
    uVmDetail: { value: new THREE.Vector4(...def.detail) },
    uVmWear: { value: new THREE.Vector4(...def.wear) },
    uVmRough: { value: new THREE.Vector2(rough[0], rough[1]) },
    uVmTint: { value: new THREE.Color(def.tint).convertSRGBToLinear() },
    uVmMetalWear: { value: def.metalWear },
    uVmAO: { value: def.ao },
    uVmCaustics: { value: opts.caustics ?? 0.55 },
    uVmFogDist: { value: 2.6 },
    uVmCausticsTexMix: { value: 0 },
    uVmCausticsTex: { value: WHITE_1PX },
    uVmWetness: { value: 1 },
  };
  mat.vmUniforms = uniforms;

  const water = opts.water;

  mat.onBeforeCompile = (shader) => {
    // Water uniforms are shared *by reference* so the water system's per-frame
    // writes land here with no bookkeeping.
    if (water) for (const k of Object.keys(water)) shader.uniforms[k] = water[k];
    for (const k of Object.keys(uniforms)) shader.uniforms[k] = uniforms[k];

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 vmMask;
varying vec3 vVmLocal;
varying vec3 vVmWorld;
varying vec3 vVmView;
varying vec3 vVmMask;
uniform vec2 uVmDepthRange;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vVmLocal = position;
  vVmMask = vmMask;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vVmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vVmView = mvPosition.xyz;
  {
    // Near-clip: write depth as if the part were further away than any surface
    // the collision capsule allows, so hands and tools never intersect geometry.
    float vmViewZ = -mvPosition.z;
    float vmT = clamp((vmViewZ - 0.12) / 1.10, 0.0, 1.0);
    float vmRemap = mix(uVmDepthRange.x, uVmDepthRange.y, vmT);
    float vmZr = -vmRemap;
    float vmNdc = (projectionMatrix[2][2] * vmZr + projectionMatrix[3][2]) / (-vmZr);
    gl_Position.z = vmNdc * gl_Position.w;
  }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${VM_DECLS}
${UW_UNIFORMS}
${NOISE_GLSL}
${UW_FUNCS}
${VM_FUNCS}
float vmAOFactor = 1.0;
float vmBumpHeight = 0.0;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  {
    float macro, mid, micro;
    float hgt = vmHeightField(vVmLocal, macro, mid, micro);
    // vmMask.x stores *occlusion*, so a geometry that forgot the attribute
    // (all zeros) shades neutrally instead of turning black.
    float ao = 1.0 - clamp(vVmMask.x, 0.0, 1.0);
    float edge = clamp(vVmMask.y, 0.0, 1.0);
    float partId = vVmMask.z;

    // --- albedo: macro drift, grime in the cavities, wear on the edges ---
    float grime = clamp(uVmWear.y * (0.55 + 0.45 * macro) * (1.0 - ao * 0.7), 0.0, 1.0);
    float wear = clamp(uVmWear.x * edge * (0.45 + 0.55 * (mid * 0.5 + 0.5)), 0.0, 1.0);
    vec3 alb = diffuseColor.rgb * (0.86 + 0.24 * macro + 0.05 * partId);
    alb = mix(alb, uVmTint, grime * 0.75);
    alb = mix(alb, alb * 1.9 + vec3(0.06), wear * 0.6);
    diffuseColor.rgb = alb;

    // --- roughness: three-scale variation, wetter where water pools ---
    float rMix = clamp(0.5 + 0.5 * mid + micro * 0.3 + grime * 0.35 - wear * 0.3, 0.0, 1.0);
    float rough = mix(uVmRough.x, uVmRough.y, rMix);
    rough *= mix(1.0, 0.72, uVmWetness * (0.35 + 0.35 * ao));
    roughnessFactor = clamp(rough, 0.02, 1.0);

    // --- metalness: paint chips and scuffs expose the substrate ---
    metalnessFactor = clamp(metalnessFactor + wear * uVmMetalWear - grime * 0.15, 0.0, 1.0);

    vmAOFactor = mix(1.0, ao, uVmAO) * (1.0 - 0.18 * (1.0 - (mid * 0.5 + 0.5)));

    // --- derivative bump so the specular breaks up at grazing angles ---
    vmBumpHeight = hgt;
  }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    // Surface-gradient bump (Mikkelsen) in view space — no tangents needed.
    vec3 sx = dFdx(vVmView);
    vec3 sy = dFdy(vVmView);
    float dhx = dFdx(vmBumpHeight);
    float dhy = dFdy(vmBumpHeight);
    vec3 r1 = cross(sy, normal);
    vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(det) * normal - uVmDetail.w * 0.06 * grad);
  }`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= vmAOFactor;
  reflectedLight.indirectSpecular *= mix(1.0, vmAOFactor, 0.7);`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        `{
    // Light that reaches the hands has already been filtered on the way down.
    float wdepth = max(0.0, uwSurfaceY - vVmWorld.y);
    vec3 down = exp(-uwExtinction * wdepth * uwDensity);
    vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float up = clamp(wn.y * 0.5 + 0.55, 0.0, 1.0);
    float caust = vmCaustics(vVmWorld) * up * uVmCaustics;
    vec3 col = gl_FragColor.rgb * mix(vec3(1.0), down, step(0.02, wdepth));
    col += uwSunColor * down * caust * (0.35 + 0.65 * vmAOFactor);
    vec3 vdir = normalize(vVmWorld - cameraPosition);
    gl_FragColor.rgb = applyUnderwater(col, length(vVmView) * uVmFogDist, vVmWorld.y, vdir);
  }
  #include <tonemapping_fragment>`,
      );
  };

  // One program for every view-model material: the source is identical, only
  // uniforms differ.
  mat.customProgramCacheKey = () => 'spacenautica.viewmodel.v1';
  return mat;
}

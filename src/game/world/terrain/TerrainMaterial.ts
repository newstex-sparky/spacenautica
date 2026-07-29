/**
 * TerrainMaterial — triplanar, height-blended splatting of five procedural PBR
 * sets, with stochastic anti-tiling, a macro-variation layer, procedural detail
 * normals that fade in under ~3 m, wetness/roughness variation, biome vertex
 * tint, caustic dappling and the shared underwater scattering as the last step
 * of the fragment shader.
 *
 * Implementation notes that matter:
 *
 * - The five PBR sets from `TextureLibrary` are **packed into two
 *   `sampler2DArray`s** on the GPU at init:
 *       tAlbH : rgb = albedo (gamma 2.2), a = height
 *       tNRA  : rg  = tangent normal xy, b = roughness, a = AO
 *   Five sets x four maps would be twenty samplers; Apple GPUs expose only
 *   sixteen to a fragment shader. Two array samplers also let the shader index
 *   layers dynamically, so we only ever fetch the *two dominant* layers.
 *
 * - We extend `MeshStandardMaterial` through `onBeforeCompile` rather than
 *   writing a raw shader, so we keep three's real PBR lighting, IBL, cascaded
 *   shadow support and tone mapping.
 *
 * - CDLOD vertex morphing lives in the vertex shader here (and in a matching
 *   custom depth material) so LOD transitions never pop and never crack.
 */
import * as THREE from 'three';
import { COMMON_GLSL, NOISE_GLSL } from '../../core/Noise';
import { UNDERWATER_GLSL } from '../water/UnderwaterFog';
import type { PbrMaps } from '../../assets/TextureLibrary';

export const TERRAIN_LAYERS = 5;

/** Physical tiling size in metres and base roughness for each splat layer. */
export interface LayerConfig {
  /** Tiling period in metres. */
  metres: number;
  /** Base roughness multiplier. */
  roughness: number;
  /** Albedo tint, linear. */
  tint: THREE.Color;
}

/* ------------------------------------------------------------------ *
 * GPU packing
 * ------------------------------------------------------------------ */

const PACK_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

const PACK_ALBEDO_FRAG = /* glsl */ `
uniform sampler2D srcMap;
uniform sampler2D srcDisp;
uniform float hasDisp;
varying vec2 vUv;
void main(){
  vec3 alb = max(texture2D(srcMap, vUv).rgb, vec3(0.0));
  float h = hasDisp > 0.5 ? texture2D(srcDisp, vUv).r : clamp(dot(alb, vec3(0.34, 0.4, 0.26)) * 1.15, 0.0, 1.0);
  // Store gamma-encoded so 8 bits are spent where the eye looks.
  gl_FragColor = vec4(pow(alb, vec3(1.0 / 2.2)), h);
}
`;

const PACK_NRA_FRAG = /* glsl */ `
uniform sampler2D srcNrm;
uniform sampler2D srcRgh;
uniform sampler2D srcAo;
varying vec2 vUv;
void main(){
  vec2 n = texture2D(srcNrm, vUv).xy;
  float r = texture2D(srcRgh, vUv).g;
  float a = texture2D(srcAo, vUv).r;
  gl_FragColor = vec4(n, r, a);
}
`;

export interface PackedTerrainTextures {
  albH: THREE.Texture;
  nra: THREE.Texture;
  dispose(): void;
}

/**
 * Packs N PBR sets into two RGBA8 texture arrays. Runs once, costs 2N tiny
 * fullscreen passes, and buys us a 2-sampler material with dynamic layer
 * indexing.
 */
export function packTerrainTextures(
  renderer: THREE.WebGLRenderer,
  sets: PbrMaps[],
  size: number,
  anisotropy: number,
): PackedTerrainTextures {
  const layers = sets.length;
  const opts: THREE.RenderTargetOptions = {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
    colorSpace: THREE.LinearSRGBColorSpace,
  };
  const rtA = new THREE.WebGLArrayRenderTarget(size, size, layers, opts);
  const rtB = new THREE.WebGLArrayRenderTarget(size, size, layers, opts);
  for (const rt of [rtA, rtB]) {
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.RepeatWrapping;
    rt.texture.anisotropy = anisotropy;
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.Camera();

  const matA = new THREE.ShaderMaterial({
    vertexShader: PACK_VERT,
    fragmentShader: PACK_ALBEDO_FRAG,
    uniforms: {
      srcMap: { value: null },
      srcDisp: { value: null },
      hasDisp: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const matB = new THREE.ShaderMaterial({
    vertexShader: PACK_VERT,
    fragmentShader: PACK_NRA_FRAG,
    uniforms: {
      srcNrm: { value: null },
      srcRgh: { value: null },
      srcAo: { value: null },
    },
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(quad, matA);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = true;

  for (let i = 0; i < layers; i++) {
    const s = sets[i];
    mesh.material = matA;
    matA.uniforms.srcMap.value = s.map;
    matA.uniforms.srcDisp.value = s.displacementMap ?? s.map;
    matA.uniforms.hasDisp.value = s.displacementMap ? 1 : 0;
    renderer.setRenderTarget(rtA, i);
    renderer.render(scene, cam);

    mesh.material = matB;
    matB.uniforms.srcNrm.value = s.normalMap;
    matB.uniforms.srcRgh.value = s.roughnessMap;
    matB.uniforms.srcAo.value = s.aoMap;
    renderer.setRenderTarget(rtB, i);
    renderer.render(scene, cam);
  }

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;

  quad.dispose();
  matA.dispose();
  matB.dispose();

  return {
    albH: rtA.texture,
    nra: rtB.texture,
    dispose() {
      rtA.dispose();
      rtB.dispose();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

const PROBE_ARRAY_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tArr;
uniform float uCount;
uniform float uLod;
void main(){
  float layer = floor(gl_FragCoord.x);
  gl_FragColor = textureLod(tArr, vec3(0.371, 0.629, layer), uLod);
}
`;

const PROBE_2D_FRAG = /* glsl */ `
uniform sampler2D tSrc;
void main(){
  gl_FragColor = texture2D(tSrc, vec2(0.371, 0.629));
}
`;

/**
 * Reads back one texel per layer from a packed array (and optionally from the
 * source 2D textures) so a headless harness can prove whether the pack step
 * produced real content. Diagnostic only; never called on a normal frame.
 */
export function probeTerrainTextures(
  renderer: THREE.WebGLRenderer,
  packed: PackedTerrainTextures,
  sources: PbrMaps[],
  lod = 0,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const quad = new THREE.PlaneGeometry(1, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.Camera();
  const arrMat = new THREE.ShaderMaterial({
    vertexShader: PACK_VERT,
    fragmentShader: PROBE_ARRAY_FRAG,
    uniforms: { tArr: { value: null }, uCount: { value: sources.length }, uLod: { value: lod } },
    depthTest: false,
    depthWrite: false,
  });
  const srcMat = new THREE.ShaderMaterial({
    vertexShader: PACK_VERT,
    fragmentShader: PROBE_2D_FRAG,
    uniforms: { tSrc: { value: null } },
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(quad, arrMat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const rt = new THREE.WebGLRenderTarget(Math.max(sources.length, 1), 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const buf = new Uint8Array(Math.max(sources.length, 1) * 4);
  const prev = renderer.getRenderTarget();

  const shoot = (label: string): void => {
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, 1, buf);
    out[label] = Array.from(buf);
  };

  mesh.material = arrMat;
  arrMat.uniforms.tArr.value = packed.albH;
  shoot('albH');
  arrMat.uniforms.tArr.value = packed.nra;
  shoot('nra');

  // Source maps, one render per layer into texel 0 — proves whether the
  // library handed us real content in the first place.
  mesh.material = srcMat;
  const srcAlb: number[] = [];
  const srcNrm: number[] = [];
  const srcOrm: number[] = [];
  for (let i = 0; i < sources.length; i++) {
    for (const [tex, sink] of [
      [sources[i].map, srcAlb],
      [sources[i].normalMap, srcNrm],
      [sources[i].roughnessMap, srcOrm],
    ] as Array<[THREE.Texture, number[]]>) {
      srcMat.uniforms.tSrc.value = tex;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
      sink.push(buf[0], buf[1], buf[2], buf[3]);
    }
  }
  out.srcAlbedo = srcAlb;
  out.srcNormal = srcNrm;
  out.srcOrm = srcOrm;

  renderer.setRenderTarget(prev);
  rt.dispose();
  quad.dispose();
  arrMat.dispose();
  srcMat.dispose();
  return out;
}

/* ------------------------------------------------------------------ *
 * Shader source
 * ------------------------------------------------------------------ */

const MORPH_GLSL = /* glsl */ `
attribute vec4 aCoarse;   // x = coarse height, yzw = coarse normal
attribute vec4 aSurf;     // xy = current direction, z = curvature, w = sediment
attribute vec2 aMorph;    // x = morph start distance, y = morph end distance

varying vec3  vTWorld;
varying vec3  vTNormalW;
varying vec2  vTFlow;
varying vec2  vTCurvSed;
varying float vTViewDist;
varying float vTMorph;

float terrainMorphFactor(vec3 localPos) {
  vec3 wp = (modelMatrix * vec4(localPos, 1.0)).xyz;
  // Horizontal distance only: the LOD selection uses the same metric, which is
  // what makes the morph provably continuous across a chunk boundary.
  float d = length(wp.xz - cameraPosition.xz);
  return clamp((d - aMorph.x) / max(aMorph.y - aMorph.x, 1e-3), 0.0, 1.0);
}
`;

const TERRAIN_FRAG_PARS = /* glsl */ `
precision highp sampler2DArray;

uniform sampler2DArray tAlbH;
uniform sampler2DArray tNRA;
uniform sampler2D tDetailNrm;
uniform sampler2D tCaustics;

uniform float uLayerScale[${TERRAIN_LAYERS}];
uniform float uLayerRough[${TERRAIN_LAYERS}];
uniform vec3  uLayerTint[${TERRAIN_LAYERS}];

uniform float uTriSharp;
uniform float uStochastic;    // 0 = single tap, 1 = 3-tap stochastic
uniform float uHexScale;
uniform float uMacroAmt;
uniform float uDetailAmt;
uniform float uRippleAmt;
uniform float uRockReliefAmt;
uniform float uCausticAmt;
uniform float uCausticTile;
uniform float uCausticFall;
uniform float uWetness;
uniform float uTerrainTime;
uniform vec3  uRockTint;
// Diagnostic view selector. 0 = shipped look. Non-zero values bypass parts of
// the pipeline so a headless harness can see which stage loses the detail:
// 1 = no water scattering, 2 = splat albedo only, 3 = splat normal,
// 4 = dominant layer id, 5 = splat weights (rgb = sand/gravel/rock).
uniform float uDebugView;

varying vec3  vTWorld;
varying vec3  vTNormalW;
varying vec2  vTFlow;
varying vec2  vTCurvSed;
varying float vTViewDist;
varying float vTMorph;

${NOISE_GLSL}
${COMMON_GLSL}
${UNDERWATER_GLSL}

/* ---- stochastic (triangle-grid) tiling ------------------------------- *
 * Three randomly offset taps of the same tile, blended on the barycentric
 * weights of a skewed triangle lattice. Removes visible repetition without the
 * ghosting of a plain blend, and needs explicit gradients because the offsets
 * are discontinuous. Heitz & Neyret, simplified.                          */
void triGrid(vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
  uv *= 3.4641016;
  const mat2 skew = mat2(1.0, 0.0, -0.57735027, 1.15470054);
  vec2 sk = skew * uv;
  vec2 base = floor(sk);
  vec3 t = vec3(fract(sk), 0.0);
  t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z);
  float s2 = 2.0 * s - 1.0;
  w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  v1 = base + vec2(s, s);
  v2 = base + vec2(s, 1.0 - s);
  v3 = base + vec2(1.0 - s, s);
}

vec4 tapArray(sampler2DArray T, vec2 uv, float layer, vec2 dx, vec2 dy) {
  if (uStochastic < 0.5) return textureGrad(T, vec3(uv, layer), dx, dy);
  vec3 w;
  vec2 v1, v2, v3;
  triGrid(uv * uHexScale, w, v1, v2, v3);
  vec4 a = textureGrad(T, vec3(uv + hash22(v1), layer), dx, dy);
  vec4 b = textureGrad(T, vec3(uv + hash22(v2), layer), dx, dy);
  vec4 c = textureGrad(T, vec3(uv + hash22(v3), layer), dx, dy);
  // Sharpened weights: mostly one tap is visible, so contrast survives.
  vec3 ww = w * w;
  ww *= ww;
  ww /= max(ww.x + ww.y + ww.z, 1e-5);
  return a * ww.x + b * ww.y + c * ww.z;
}

struct SplatSample {
  vec3 albedo;
  float height;
  vec3 normalW;
  float rough;
  float ao;
};

/** Triplanar sample of one packed layer, returning world-space normal. */
void sampleLayer(int layer, vec3 wp, vec3 wn, vec3 tw, out SplatSample o) {
  float sc = uLayerScale[layer];
  float fl = float(layer);

  vec2 uvY = wp.xz * sc;
  vec2 uvX = wp.zy * sc;
  vec2 uvZ = wp.xy * sc;

  vec4 albAcc = vec4(0.0);
  vec4 nraAcc = vec4(0.0);
  vec3 nAcc = vec3(0.0);

  if (tw.y > 0.004) {
    vec2 dx = dFdx(uvY), dy = dFdy(uvY);
    vec4 a = tapArray(tAlbH, uvY, fl, dx, dy);
    vec4 n = tapArray(tNRA, uvY, fl, dx, dy);
    albAcc += a * tw.y;
    nraAcc += n * tw.y;
    vec2 t = n.xy * 2.0 - 1.0;
    nAcc += vec3(t.x, 0.0, t.y) * tw.y;
  }
  if (tw.x > 0.004) {
    vec2 dx = dFdx(uvX), dy = dFdy(uvX);
    vec4 a = tapArray(tAlbH, uvX, fl, dx, dy);
    vec4 n = tapArray(tNRA, uvX, fl, dx, dy);
    albAcc += a * tw.x;
    nraAcc += n * tw.x;
    vec2 t = n.xy * 2.0 - 1.0;
    nAcc += vec3(0.0, t.y, t.x) * tw.x;
  }
  if (tw.z > 0.004) {
    vec2 dx = dFdx(uvZ), dy = dFdy(uvZ);
    vec4 a = tapArray(tAlbH, uvZ, fl, dx, dy);
    vec4 n = tapArray(tNRA, uvZ, fl, dx, dy);
    albAcc += a * tw.z;
    nraAcc += n * tw.z;
    vec2 t = n.xy * 2.0 - 1.0;
    nAcc += vec3(t.x, t.y, 0.0) * tw.z;
  }

  o.albedo = pow(max(albAcc.rgb, vec3(0.0)), vec3(2.2)) * uLayerTint[layer];
  o.height = albAcc.a;
  o.rough = clamp(nraAcc.b * uLayerRough[layer], 0.04, 1.0);
  o.ao = clamp(nraAcc.a, 0.0, 1.0);
  // Whiteout-style blend: each projection contributes a world-space slope
  // offset which is added to the geometric normal. Never inverts, no TBN.
  o.normalW = normalize(wn + nAcc);
}

/* ---- multi-scale analytic sea-floor relief ---------------------------- *
 * The texture-sampled detail can only survive out to a few metres before the
 * mip chain averages it to a flat colour, which is why a purely texture-driven
 * floor reads as an untextured blob at 20 m. So the dune / ripple structure is
 * generated analytically instead, in four octaves, and each octave is faded out
 * exactly when its wavelength approaches one pixel footprint. That keeps real
 * relief on screen at every distance without ever crawling or aliasing.       */

/** 1 while a band of this wavelength is comfortably wider than a pixel. */
float bandFade(float lambda, float footprint) {
  return smoothstep(1.5, 4.5, lambda / max(footprint, 1e-4));
}

/** One current-aligned ripple octave. Accumulates cross-crest slope and height. */
void rippleBand(
  float lambda, float amp, float along, float lateral, float bend, float footprint,
  inout float g, inout float h
) {
  float f = bandFade(lambda, footprint);
  if (f <= 0.002) return;
  float k = 6.2831853 / lambda;
  float ph = along * k + bend + lateral * k * 0.07;
  g += amp * k * cos(ph) * f;
  h += amp * sin(ph) * f;
}

/**
 * Perturbs the world normal with dune + megaripple + ripple + micro-ripple
 * bands aligned to the local current. Writes a signed crest/trough signal so
 * albedo can be graded to match (crests winnow pale, troughs collect silt).
 */
vec3 floorRelief(
  vec3 wp, vec3 wn, float amount, float footprint, out float crest
) {
  // Local current direction, rotated by a slow field so neighbouring dune
  // patches do not all march in lockstep the way a single global vector would.
  float swing = snoise(wp.xz * 0.0042) * 0.85;
  float cs = cos(swing);
  float sn = sin(swing);
  vec2 f0 = normalize(vTFlow + vec2(1e-4, 0.0));
  vec2 fl = vec2(f0.x * cs - f0.y * sn, f0.x * sn + f0.y * cs);
  vec2 across = vec2(-fl.y, fl.x);
  float along = dot(wp.xz, fl);
  float lateral = dot(wp.xz, across);
  // Crest lines meander instead of running dead straight across the basin.
  float bend = 2.7 * snoise(wp.xz * 0.019) + 1.2 * snoise(wp.xz * 0.0068);

  // Ripple fields are patchy: current shadows, coarse lag deposits and scoured
  // pans all leave smooth ground between rippled ground. Without this the floor
  // reads as one continuous corrugation, which is a texture, not a place.
  // NB: 'patch' is a reserved word in GLSL ES 3.0 — do not name a local that.
  float patchField = fbm(wp.xz * 0.0135 + 7.3, 3);
  float ripplePatch = smoothstep(-0.32, 0.42, patchField);
  float fineMask = smoothstep(-0.1, 0.55, snoise(wp.xz * 0.048));

  float g = 0.0;
  float h = 0.0;
  rippleBand(24.0, 0.24 * (0.45 + 0.55 * ripplePatch), along, lateral, bend * 0.55, footprint, g, h);
  rippleBand(7.3, 0.25 * ripplePatch, along, lateral, bend, footprint, g, h);
  rippleBand(1.85, 0.17 * ripplePatch * (0.3 + 0.7 * fineMask), along, lateral, bend * 1.7, footprint, g, h);
  rippleBand(0.47, 0.07 * (0.35 + 0.65 * fineMask), along, lateral, bend * 2.6, footprint, g, h);
  crest = h;

  vec3 alongW = vec3(fl.x, 0.0, fl.y);
  vec3 tangent = normalize(alongW - wn * dot(alongW, wn));
  return normalize(wn - tangent * g * amount);
}

/**
 * Isotropic meso-relief for ground that is not sand: a cheap two-octave
 * gradient-noise bump that keeps boulders and basalt from going smooth at
 * distance. Faded on footprint like the ripples.
 */
vec3 rockRelief(vec3 wp, vec3 wn, float amount, float footprint) {
  float f1 = bandFade(9.0, footprint);
  float f2 = bandFade(2.6, footprint);
  if (f1 + f2 <= 0.004) return wn;
  float e = 0.35;
  // Central differences on a 2-octave field; cheap and stable.
  float hx0 = snoise((wp.xz + vec2(e, 0.0)) * 0.111) * f1
            + snoise((wp.xz + vec2(e, 0.0)) * 0.385) * 0.45 * f2;
  float hx1 = snoise((wp.xz - vec2(e, 0.0)) * 0.111) * f1
            + snoise((wp.xz - vec2(e, 0.0)) * 0.385) * 0.45 * f2;
  float hz0 = snoise((wp.xz + vec2(0.0, e)) * 0.111) * f1
            + snoise((wp.xz + vec2(0.0, e)) * 0.385) * 0.45 * f2;
  float hz1 = snoise((wp.xz - vec2(0.0, e)) * 0.111) * f1
            + snoise((wp.xz - vec2(0.0, e)) * 0.385) * 0.45 * f2;
  vec3 grad = vec3((hx0 - hx1) / (2.0 * e), 0.0, (hz0 - hz1) / (2.0 * e));
  return normalize(wn - (grad - wn * dot(grad, wn)) * amount);
}
`;

const TERRAIN_SPLAT_BODY = /* glsl */ `
  vec3 wp = vTWorld;
  vec3 wn = normalize(vTNormalW);
  float slope = 1.0 - clamp(wn.y, 0.0, 1.0);
  float depth = max(0.0, -wp.y);
  float curv = vTCurvSed.x;
  float sed = clamp(vTCurvSed.y, 0.0, 1.0);

  // Metres of world space covered by this pixel. Every procedural band below is
  // faded against it, which is what lets detail run to the horizon safely.
  float footprint = max(length(dFdx(wp.xz)), length(dFdy(wp.xz)));

  /* ---- macro variation: kills large-scale repetition ------------------ */
  float macroA = fbm(wp.xz * 0.0075, 3);          // ~130 m blotches
  float macroB = fbm(wp.xz * 0.031 + 21.7, 2);    // ~32 m
  float macroC = snoise(wp.xz * 0.19);            // ~5 m
  float macro = 1.0 + uMacroAmt * (0.55 * macroA + 0.32 * macroB + 0.16 * macroC);

  /* ---- splat weights from slope / depth / curvature / biome ----------- */
  float flat_ = smoothstep(0.42, 0.05, slope);
  float steep = smoothstep(0.24, 0.60, slope);
  float deep = smoothstep(90.0, 250.0, depth);
  float shallow = smoothstep(140.0, 20.0, depth);
  float convex = clamp(curv * 0.5 + 0.5, 0.0, 1.0);

  float w[${TERRAIN_LAYERS}];
  // 0 sand (rippled), 1 gravel, 2 basalt, 3 silt, 4 coral rock
  w[0] = flat_ * shallow * (0.35 + 0.95 * sed) * (0.72 + 0.55 * macroB) + 0.03;
  w[1] = (smoothstep(0.07, 0.30, slope) * smoothstep(0.66, 0.26, slope)
          + 0.42 * max(0.0, macroC)) * (0.45 + 0.55 * (1.0 - sed)) + 0.02;
  w[2] = steep * (0.55 + 0.8 * (1.0 - sed)) + 0.55 * deep * steep + 0.02;
  w[3] = flat_ * deep * (0.35 + 0.9 * sed) * (0.7 + 0.6 * macroA) + 0.015;
  w[4] = (0.25 + 0.9 * convex) * (1.0 - sed) * smoothstep(0.03, 0.30, slope)
         * smoothstep(280.0, 30.0, depth) + 0.015;

  /* ---- pick the two dominant layers ---------------------------------- */
  int i0 = 0; int i1 = 1;
  float b0 = -1.0; float b1 = -1.0;
  for (int i = 0; i < ${TERRAIN_LAYERS}; i++) {
    float v = w[i];
    if (v > b0) { b1 = b0; i1 = i0; b0 = v; i0 = i; }
    else if (v > b1) { b1 = v; i1 = i; }
  }

  vec3 tw = blendWeights(wn, uTriSharp);

  SplatSample s0, s1;
  sampleLayer(i0, wp, wn, tw, s0);
  sampleLayer(i1, wp, wn, tw, s1);

  float mixT = b1 / max(b0 + b1, 1e-4);
  // Height blend so the coarser material pokes through instead of cross-fading.
  float hb = heightBlend(s0.height + 0.02, s1.height + 0.02, mixT, 0.20);

  vec3 splatAlbedo = mix(s0.albedo, s1.albedo, hb);
  vec3 splatNormal = normalize(mix(s0.normalW, s1.normalW, hb));
  float splatRough = mix(s0.rough, s1.rough, hb);
  float splatAO = mix(s0.ao, s1.ao, hb);

  /* ---- micro grain: texture-driven, only while it is above the mip floor */
  float near = bandFade(0.34, footprint);
  if (near > 0.002) {
    vec3 dtw = tw;
    vec2 duv = wp.xz * 2.9;
    vec3 dn = texture(tDetailNrm, duv).xyz * 2.0 - 1.0;
    vec3 dnX = texture(tDetailNrm, wp.zy * 2.9).xyz * 2.0 - 1.0;
    vec3 dnZ = texture(tDetailNrm, wp.xy * 2.9).xyz * 2.0 - 1.0;
    vec3 acc = vec3(dn.x, 0.0, dn.y) * dtw.y
             + vec3(0.0, dnX.y, dnX.x) * dtw.x
             + vec3(dnZ.x, dnZ.y, 0.0) * dtw.z;
    splatNormal = normalize(splatNormal + acc * uDetailAmt * near * (1.0 - vTMorph * 0.7));
    // micro grain also breaks up the albedo very slightly
    splatAlbedo *= 1.0 + 0.06 * near * (dn.z - 0.5);
  }

  /* ---- current-aligned relief, present at every distance --------------- */
  float sandiness = clamp((1.0 - slope * 2.2) * sed, 0.0, 1.0);
  float crest = 0.0;
  splatNormal = floorRelief(wp, splatNormal, uRippleAmt * sandiness, footprint, crest);
  // Hard ground gets an isotropic bump instead of directional ripples.
  splatNormal = rockRelief(wp, splatNormal, uRockReliefAmt * (1.0 - sandiness), footprint);

  /* ---- albedo grading ------------------------------------------------- */
  vec3 rockish = mix(uRockTint, vec3(1.0), sed);
  splatAlbedo *= macro * rockish;
  // Ripple crests are winnowed clean and read pale; troughs collect dark silt.
  // This is the one albedo cue that survives to distance, because it is analytic
  // and therefore never averaged away by a mip level.
  splatAlbedo *= 1.0 + clamp(crest * 1.7, -1.0, 1.0) * 0.26 * sandiness;
  // Concavities silt up: darker, smoother, slightly greener.
  float silted = clamp(-curv, 0.0, 1.0) * (0.4 + 0.6 * sed);
  splatAlbedo = mix(splatAlbedo, splatAlbedo * vec3(0.72, 0.78, 0.7), silted * 0.55);

  /* ---- roughness / wetness ------------------------------------------- */
  float wet = uWetness * (0.35 + 0.65 * silted) * smoothstep(0.5, 0.05, slope);
  splatRough = clamp(splatRough * (0.85 + 0.3 * macroB) - wet * 0.28, 0.06, 1.0);

  // Ambient occlusion from concavity, plus a little from the analytic troughs so
  // dune fields still self-shade once the light is flat.
  float splatAOFinal = clamp(
    splatAO * (1.0 - 0.42 * clamp(-curv, 0.0, 1.0))
            * (1.0 - 0.22 * sandiness * clamp(-crest * 1.4, 0.0, 1.0)),
    0.0, 1.0);

  vec3 dbgLayer = vec3(float(i0) / float(${TERRAIN_LAYERS} - 1));
  vec3 dbgWeights = vec3(w[0], w[1], w[2]) / max(w[0] + w[1] + w[2] + w[3] + w[4], 1e-4);
`;

/* ------------------------------------------------------------------ *
 * Material construction
 * ------------------------------------------------------------------ */

export interface TerrainMaterialOptions {
  packed: PackedTerrainTextures;
  detailNormal: THREE.Texture;
  caustics: THREE.Texture;
  layers: LayerConfig[];
  /** Shared uniform block from the water system. */
  waterUniforms: Record<string, THREE.IUniform>;
  stochastic: boolean;
  rockTint: THREE.Color;
}

export interface TerrainMaterialBundle {
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

export function createTerrainMaterial(opts: TerrainMaterialOptions): TerrainMaterialBundle {
  const scales = new Float32Array(TERRAIN_LAYERS);
  const roughs = new Float32Array(TERRAIN_LAYERS);
  const tints: THREE.Color[] = [];
  for (let i = 0; i < TERRAIN_LAYERS; i++) {
    const cfg = opts.layers[Math.min(i, opts.layers.length - 1)];
    scales[i] = 1 / cfg.metres;
    roughs[i] = cfg.roughness;
    tints.push(cfg.tint.clone());
  }

  const uniforms: Record<string, THREE.IUniform> = {
    tAlbH: { value: opts.packed.albH },
    tNRA: { value: opts.packed.nra },
    tDetailNrm: { value: opts.detailNormal },
    tCaustics: { value: opts.caustics },
    uLayerScale: { value: scales },
    uLayerRough: { value: roughs },
    uLayerTint: { value: tints },
    uTriSharp: { value: 5.5 },
    uStochastic: { value: opts.stochastic ? 1 : 0 },
    uHexScale: { value: 0.115 },
    uMacroAmt: { value: 0.34 },
    uDetailAmt: { value: 0.85 },
    uRippleAmt: { value: 0.85 },
    uRockReliefAmt: { value: 0.5 },
    uCausticAmt: { value: 0.9 },
    uCausticTile: { value: 48 },
    uCausticFall: { value: 0.02 },
    uWetness: { value: 0.5 },
    uTerrainTime: { value: 0 },
    uRockTint: { value: opts.rockTint.clone() },
    uDebugView: { value: 0 },
  };
  // Sensible standalone defaults for the frozen underwater block, so the terrain
  // renders correctly even if the ocean system is absent (verification harness,
  // or a boot where `world.water` failed to init).
  // Matches `world/water/WaterProfiles.ts` Jerlov IA at BEAM_RATIO 1.35, i.e. the
  // shallows profile the ocean actually publishes. Keeping these in step matters:
  // if the fallback is murkier than the real water, the terrain is tuned against
  // a wash that the shipped game never shows.
  const waterDefaults: Record<string, THREE.IUniform> = {
    uwExtinction: { value: new THREE.Vector3(0.4725, 0.081, 0.0297) },
    uwInscatter: { value: new THREE.Color(0.06, 0.3, 0.38) },
    uwSurfaceY: { value: 0 },
    uwDensity: { value: 1 },
    uwSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3).normalize() },
    uwSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
    uwTime: { value: 0 },
    uwCameraDepth: { value: 0 },
  };
  for (const key of Object.keys(waterDefaults)) uniforms[key] = waterDefaults[key];
  // Water uniforms are shared *by reference* so the ocean owns water colour.
  for (const key of Object.keys(opts.waterUniforms)) uniforms[key] = opts.waterUniforms[key];

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    dithering: true,
    side: THREE.FrontSide,
  });
  material.fog = false;
  // Tells `world/water/MaterialPatch.ts` that we already apply the scattering
  // ourselves — without this it would inject a second copy and the shader would
  // fail to link on redefinition.
  material.userData.underwater = true;
  material.userData.waterAware = true;

  material.onBeforeCompile = (shader) => {
    for (const key of Object.keys(uniforms)) shader.uniforms[key] = uniforms[key];

    /* ---------------- vertex ---------------- */
    shader.vertexShader = MORPH_GLSL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        float tMorph = terrainMorphFactor(position);
        vec3 objectNormal = normalize(mix(normal, aCoarse.yzw, tMorph));
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        vec3 transformed = vec3(position.x, mix(position.y, aCoarse.x, tMorph), position.z);
        `,
      )
      .replace(
        '#include <fog_vertex>',
        /* glsl */ `
        vec3 tWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTWorld = tWorld;
        vTNormalW = normalize(mat3(modelMatrix) * objectNormal);
        vTFlow = aSurf.xy;
        vTCurvSed = aSurf.zw;
        vTViewDist = length(tWorld - cameraPosition);
        vTMorph = tMorph;
        `,
      );

    /* ---------------- fragment ---------------- */
    shader.fragmentShader = TERRAIN_FRAG_PARS + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        TERRAIN_SPLAT_BODY + '\n  diffuseColor.rgb *= splatAlbedo;\n',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = clamp(roughness * splatRough, 0.045, 1.0);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        'normal = normalize((viewMatrix * vec4(splatNormal, 0.0)).xyz);',
      )
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `
        {
          float ao = splatAOFinal;
          reflectedLight.indirectDiffuse *= ao;
          reflectedLight.indirectSpecular *= ao;
          // Caustic dapple. Two rotated samples of the seamless tile are
          // multiplied and mean-removed, which leaves the bright filament
          // network and destroys any trace of the repeat. Gated by depth, by
          // how much the surface faces up, and by how much sun is left.
          float cDepth = max(0.0, uwSurfaceY - vTWorld.y);
          float cAtt = exp(-cDepth * uCausticFall) * clamp(splatNormal.y * 0.85 + 0.15, 0.0, 1.0);
          vec2 cUv = vTWorld.xz / max(uCausticTile, 1.0);
          vec2 cUvA = cUv + vec2(uTerrainTime * 0.0035, uTerrainTime * -0.0026);
          vec2 cUvB = vec2(cUv.x * 0.7986 - cUv.y * 0.6018, cUv.x * 0.6018 + cUv.y * 0.7986) * 1.73
                      + vec2(uTerrainTime * -0.0042, uTerrainTime * 0.0031);
          float c1 = texture2D(tCaustics, cUvA).r;
          float c2 = texture2D(tCaustics, cUvB).r;
          float caust = max(c1 * c2 * 2.4 - 0.42, 0.0);
          float cAmt = uCausticAmt * cAtt * (1.0 - smoothstep(0.55, 0.95, roughnessFactor) * 0.25);
          reflectedLight.directDiffuse *= 1.0 + caust * cAmt * 1.9;
          reflectedLight.directDiffuse += uwSunColor * caust * cAmt * 0.10;
        }
        `,
      )
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `
        if (uDebugView < 0.5) {
          gl_FragColor.rgb = applyUnderwater(
            gl_FragColor.rgb, vTViewDist, vTWorld.y, normalize(vTWorld - cameraPosition));
        } else if (uDebugView < 1.5) {
          // raw lit PBR, no water column
        } else if (uDebugView < 2.5) {
          gl_FragColor.rgb = splatAlbedo;
        } else if (uDebugView < 3.5) {
          gl_FragColor.rgb = splatNormal * 0.5 + 0.5;
        } else if (uDebugView < 4.5) {
          gl_FragColor.rgb = dbgLayer;
        } else {
          gl_FragColor.rgb = dbgWeights;
        }
        #include <tonemapping_fragment>
        `,
      );
  };

  /* ---- matching depth material so shadows morph identically ---------- */
  // Matches three's internal shadow depth material (BasicDepthPacking).
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.userData.underwater = true;
  depthMaterial.userData.waterAware = true;
  depthMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader =
      /* glsl */ `
      attribute vec4 aCoarse;
      attribute vec2 aMorph;
      ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      vec3 _wp = (modelMatrix * vec4(position, 1.0)).xyz;
      float _m = clamp((length(_wp.xz - cameraPosition.xz) - aMorph.x)
                       / max(aMorph.y - aMorph.x, 1e-3), 0.0, 1.0);
      vec3 transformed = vec3(position.x, mix(position.y, aCoarse.x, _m), position.z);
      `,
    );
  };

  return {
    material,
    depthMaterial,
    uniforms,
    dispose() {
      material.dispose();
      depthMaterial.dispose();
    },
  };
}

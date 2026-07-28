/**
 * Creature skin material.
 *
 * A `MeshStandardMaterial` patched through `onBeforeCompile`, so creatures get
 * the engine's full PBR + shadow + IBL path while adding:
 *   - analytic spine/fin/limb animation in the vertex shader (no skeletal rig),
 *   - three-scale procedural surface detail (macro blotches, mid scales/stripes,
 *     micro grain) layered over the TextureLibrary skin maps,
 *   - countershading, wet sheen, cheap iridescence, fin subsurface transmission,
 *   - pulsing bioluminescent markings and eyes that read at distance,
 *   - caustic dapple from above,
 *   - `applyUnderwater()` as the final step so water colour stays consistent.
 *
 * A matching depth material is produced so animated creatures cast animated
 * shadows instead of static T-pose blobs.
 */
import * as THREE from 'three';
import { FAUNA_NOISE_GLSL } from './FaunaNoise';
import { UNDERWATER_GLSL } from '../world/water/UnderwaterFog';
import type { PbrMaps } from '../assets/TextureLibrary';
import type { SpeciesDef } from './Species';

const TAU_DEF = /* glsl */ `
#ifndef FAUNA_TAU
#define FAUNA_TAU 6.283185307179586
#endif
`;


/* ------------------------------------------------------------------ *
 * Vertex
 * ------------------------------------------------------------------ */

const VERT_ATTRS = /* glsl */ `
attribute vec4 aBody;   // bodyT, part, wing, vent
attribute vec2 aLimb;   // limbT, limbPhase
attribute vec4 iAnim;   // phase, beatFreq, amplitude, lean
attribute vec3 iTint;
attribute vec2 iExtra;  // glow multiplier, per-instance hash
uniform float uTime;
uniform vec4  uSwim;    // waves, headSway, finFlap, wingWaves
uniform vec4  uShape;   // bodyLength, halfWidth, limbFreq, idle
`;

const VERT_DEFORM = /* glsl */ `
void faunaDeform(inout vec3 pOut, inout vec3 nOut) {
  vec3 p = pOut;
  vec3 n = nOut;
  float t     = max(aBody.x, 0.0);
  float part  = aBody.y;
  float wingF = aBody.z;
  float phase = iAnim.x;
  float freq  = iAnim.y;
  float amp   = iAnim.z;
  float lean  = iAnim.w;

  float bodyLen = max(uShape.x, 1e-3);
  float waves   = uSwim.x;
  float wt      = uTime * freq * FAUNA_TAU;

  // --- travelling wave down the spine, amplitude growing toward the tail ---
  float th   = t * waves * FAUNA_TAU - wt + phase;
  float env  = pow(t, 1.7);
  float lat  = amp * (env * sin(th) + uSwim.y * (1.0 - min(t, 1.0)) * sin(phase - wt));
  float dlat = amp * (1.7 * pow(max(t, 1e-3), 0.7) * sin(th)
                    + env * cos(th) * waves * FAUNA_TAU) / bodyLen;

  // Rotate the whole cross-section into the bent frame; a plain lateral offset
  // would shear the body and make the shading slide.
  float ca = inversesqrt(1.0 + dlat * dlat);
  float sa = dlat * ca;
  vec3 rgt = vec3(ca, 0.0, -sa);
  vec3 upv = vec3(0.0, 1.0, 0.0);
  vec3 tng = vec3(sa, 0.0, ca);
  vec3 q  = vec3(lat, 0.0, p.z) + rgt * p.x + upv * p.y;
  vec3 nn = rgt * n.x + upv * n.y + tng * n.z;

#ifdef FAUNA_WING
  // Rays undulate the entire wing surface outward from the spine.
  float wp  = wingF * uSwim.w * FAUNA_TAU - wt * 0.9 + phase;
  float wa  = amp * 3.4 * pow(wingF, 1.45);
  q.y += wa * sin(wp);
  float dwa = wa * cos(wp) * uSwim.w * FAUNA_TAU / max(uShape.y, 1e-3);
  float sgx = p.x < 0.0 ? -1.0 : 1.0;
  nn.x -= sgx * dwa * nn.y;
  q.z += 0.22 * abs(wa) * sin(wp) * wingF * wingF;
#endif

  // --- fin flap: membrane rotates about its root, tip lagging ---
  if (part > 0.5 && part < 1.5) {
    float u  = aLimb.x;
    float fp = wt * 1.35 + phase + aLimb.y * FAUNA_TAU;
    float fl = uSwim.z * amp * 1.7 * pow(u, 1.5);
    q.y += fl * sin(fp);
    q.x += fl * 0.35 * cos(fp * 0.92) * (p.x < 0.0 ? -1.0 : 1.0);
    nn.y -= 2.4 * fl * cos(fp);
  }

  // --- limbs paddle fore/aft, each with its own phase offset ---
  if (part > 3.5 && part < 4.5) {
    float u  = aLimb.x;
    float lp = wt * uShape.z + phase + aLimb.y * FAUNA_TAU;
    float la = amp * 4.2 * pow(u, 1.6);
    q.z += la * sin(lp);
    q.y += la * 0.5 * cos(lp * 1.3);
    nn.z -= 1.5 * la * cos(lp);
  }

  // --- idle micro-motion: gill breathing when nearly stationary ---
  float idle = uShape.w * (1.0 - clamp(freq * 0.6, 0.0, 1.0));
  float br = 1.0 + idle * 0.028 * sin(uTime * 1.7 + phase * 3.1);
  q.xy *= br;
  q.y += idle * 0.012 * bodyLen * sin(uTime * 0.73 + phase);

  // --- turn lean: roll about the body axis, from angular velocity ---
  float cl = cos(lean), sl = sin(lean);
  q  = vec3(q.x * cl - q.y * sl, q.x * sl + q.y * cl, q.z);
  nn = vec3(nn.x * cl - nn.y * sl, nn.x * sl + nn.y * cl, nn.z);

  pOut = q;
  nOut = normalize(nn);
}
`;

const VERT_VARYINGS = /* glsl */ `
varying vec4  vBody;
varying vec2  vLimb;
varying vec3  vTint;
varying vec2  vExtra;
varying vec2  vFUv;
varying vec3  vFWorld;
varying float vFDist;
varying vec3  vFView;
`;

/* ------------------------------------------------------------------ *
 * Fragment
 * ------------------------------------------------------------------ */

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform vec3  uDorsal;
uniform vec3  uVentral;
uniform vec3  uFinCol;
uniform vec3  uPatCol;
uniform vec3  uIris;
uniform vec3  uGlowCol;
uniform vec4  uPat;    // patternScale, patternFreq, contrast, iridescence
uniform vec4  uSurf;   // roughness, roughnessVar, translucency, glow
uniform vec3  uGlowP;  // glowScale, glowRate, causticAmount
#ifdef FAUNA_CAUSTICS
uniform sampler2D uCaustics;
uniform float uCausticScale;   // 1 / world tile size, matched to the water system
#endif

varying vec4  vBody;
varying vec2  vLimb;
varying vec3  vTint;
varying vec2  vExtra;
varying vec2  vFUv;
varying vec3  vFWorld;
varying float vFDist;
varying vec3  vFView;

/** Surface-gradient bump mapping (Mikkelsen); view-independent, no tangents. */
vec3 faunaBump(vec3 nrm, vec3 viewPos, float h, float scale) {
  vec3 dx = dFdx(viewPos);
  vec3 dy = dFdy(viewPos);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dy, nrm);
  vec3 r2 = cross(nrm, dx);
  float det = dot(dx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * nrm - scale * grad);
}
`;

/** Computes the pattern layers. Injected after <metalnessmap_fragment>. */
const FRAG_SURFACE = /* glsl */ `
  float fT    = clamp(vBody.x, 0.0, 1.3);
  float fPart = vBody.y;
  float fWing = vBody.z;
  float fVent = vBody.w;
  vec2  fUv   = vFUv;
  float fHash = vExtra.y;
  // Micro detail fades with distance so nothing crawls or aliases far away.
  float fFade = exp(-vFDist * 0.10);

  // --- macro: length gradient + saddle blotches (silhouette scale) ---
  float fMacro  = 0.5 + 0.5 * fnSnoise2(vec2(fT * 2.6, fHash * 31.0));
  float fSaddle = smoothstep(0.05, 0.6, fnSnoise2(vec2(fT * 6.0 + fHash * 17.0, fWing * 1.6)));

  // --- mid: species pattern (scales / stripes / spots / leather) ---
  vec2  fPS     = vec2(uPat.x, uPat.x * 0.6);
  vec3  fCell   = fnVoronoi(fUv * fPS);
  float fScales = 1.0 - smoothstep(0.0, 0.30, fCell.y - fCell.x);
  float fStripe = 0.5 + 0.5 * sin(fT * uPat.y * FAUNA_TAU + fnSnoise2(fUv * 7.0) * 1.5);
  float fSpots  = smoothstep(0.42, 0.14, fCell.x) * (0.35 + 0.65 * fCell.z);
  float fLeath  = 0.5 + 0.5 * fnFbm2(fUv * uPat.x * 0.45);

  // --- micro: grain ---
  float fGrain  = fnSnoise2(fUv * 190.0) * fFade;

  float fPat;
  #if FAUNA_PATTERN == 0
    fPat = fScales * (0.5 + 0.5 * fMacro);
  #elif FAUNA_PATTERN == 1
    fPat = mix(fStripe, fSaddle, 0.42) * (0.6 + 0.4 * fScales);
  #elif FAUNA_PATTERN == 2
    fPat = max(fSpots, fSaddle * 0.5);
  #else
    fPat = fLeath * (0.6 + 0.4 * fScales);
  #endif
  fPat = clamp(fPat, 0.0, 1.0);

  // --- countershading: dark dorsal, pale ventral ---
  float fShade = smoothstep(0.10, 0.90, fVent);
  vec3  fAlb   = mix(uDorsal * vTint, uVentral * vTint, fShade);
  fAlb *= 0.86 + 0.28 * fMacro;
  fAlb  = mix(fAlb, uPatCol * vTint, fPat * uPat.z * (1.0 - 0.5 * fShade));
  fAlb *= 1.0 + 0.06 * fGrain;

  float fRough = uSurf.x + uSurf.y * (fPat - 0.5) * 2.0 + fHash * 0.1;
  fRough -= 0.14 * fShade;                 // bellies read wetter/smoother
  float fBumpH = fScales * 0.5 + fLeath * 0.25 + fGrain * 0.12;
  float fBumpS = 0.05;

  if (fPart > 0.5 && fPart < 1.5) {                   // fins / membranes
    fAlb   = mix(fAlb, uFinCol * vTint, 0.72);
    fRough = mix(fRough, 0.26, 0.7);
    fBumpH = 0.5 + 0.5 * sin(vLimb.x * FAUNA_TAU * float(FAUNA_RIBS));
    fBumpS = 0.09;
  } else if (fPart > 1.5 && fPart < 2.5) {            // eyes
    float er    = vLimb.x;
    float pupil = smoothstep(0.88, 0.945, er);
    float iris  = smoothstep(0.66, 0.76, er) * (1.0 - pupil);
    fAlb   = mix(vec3(0.52, 0.50, 0.46) * vTint, uIris, iris);
    fAlb   = mix(fAlb, vec3(0.006), pupil);
    fRough = mix(0.09, 0.035, pupil);
    fBumpS = 0.0;
  } else if (fPart > 4.5) {                           // teeth
    fAlb   = vec3(0.76, 0.73, 0.66) * (0.85 + 0.3 * fGrain);
    fRough = 0.28;
    fBumpS = 0.02;
  }

  diffuseColor.rgb *= fAlb;
  roughnessFactor = clamp(fRough, 0.035, 1.0);
  metalnessFactor = 0.0;
`;

const FRAG_NORMAL = /* glsl */ `
  if (fBumpS > 0.0) {
    normal = faunaBump(normal, -vViewPosition, fBumpH, fBumpS * (0.35 + 0.65 * fFade));
  }
`;

const FRAG_EMISSIVE = /* glsl */ `
  // --- bioluminescent markings ---
  if (uSurf.w > 0.001) {
    float gp = smoothstep(0.45, 0.86, fnSnoise3(vec3(fUv * uGlowP.x, fHash * 9.0)));
    float pulse = 0.5 + 0.5 * sin(uTime * uGlowP.y * 2.0 + fHash * 40.0 + fT * 5.0);
    totalEmissiveRadiance += uGlowCol * gp * (0.4 + 0.6 * pulse) * uSurf.w * vExtra.x;
  }

  // --- iridescence: cheap thin-film hue sweep with view angle ---
  float fFres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.2);
  if (uPat.w > 0.001) {
    vec3 irid = 0.5 + 0.5 * cos(FAUNA_TAU * (vec3(0.0, 0.33, 0.66)
                 + fFres * 1.9 + fT * 0.7 + fHash * 5.0));
    totalEmissiveRadiance += irid * uPat.w * fFres * 0.5 * (1.0 - 0.4 * fShade);
  }

  // --- eyes: iris ring + specular catchlight so they read at distance ---
  if (fPart > 1.5 && fPart < 2.5) {
    float er = vLimb.x;
    totalEmissiveRadiance += uIris * smoothstep(0.64, 0.78, er) * 0.55;
    totalEmissiveRadiance += vec3(1.0) * smoothstep(0.968, 0.995, er) * 0.85;
  }

  // --- thin membranes pick up ambient from both sides ---
  if (fPart > 0.5 && fPart < 1.5) {
    totalEmissiveRadiance += uwInscatter * uSurf.z * 0.5;
  }

  // --- caustic dapple from the surface above ---
  #ifdef FAUNA_CAUSTICS
  {
    // Same two-layer rotated sampling the water system uses on the sea floor, at
    // the same world tile size, so a fish swimming over sand is lit by the same
    // filaments. (1 - fShade) stands in for "this surface faces up".
    vec2 p0 = vFWorld.xz * uCausticScale;
    vec2 p1 = vec2(p0.x * 0.7986 - p0.y * 0.6018, p0.x * 0.6018 + p0.y * 0.7986) * 1.73;
    float c1 = texture2D(uCaustics, p0 + vec2(uwTime * 0.008, -uwTime * 0.006)).r;
    float c2 = texture2D(uCaustics, p1 - vec2(uwTime * 0.011, uwTime * 0.004)).r;
    float caus = max(c1 * c2 - 0.82, 0.0) * 1.45;
    float dep = exp(-max(0.0, uwSurfaceY - vFWorld.y) * 0.022);
    totalEmissiveRadiance += uwSunColor * caus * uGlowP.z * dep
                             * (0.25 + 0.75 * (1.0 - fShade));
  }
  #endif
`;

const FRAG_OUT = /* glsl */ `
  // Subsurface transmission through thin fins when backlit by the sun.
  if (vBody.y > 0.5 && vBody.y < 1.5) {
    float back = pow(max(dot(normalize(vFView), normalize(uwSunDir)), 0.0), 3.0);
    gl_FragColor.rgb += diffuseColor.rgb * uwSunColor * back * uSurf.z * 1.3;
  }
  gl_FragColor.rgb = applyUnderwater(gl_FragColor.rgb, vFDist, vFWorld.y, normalize(vFView));
`;

/* ------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------ */

export interface CreatureUniforms {
  uTime: THREE.IUniform<number>;
  uSwim: THREE.IUniform<THREE.Vector4>;
  uShape: THREE.IUniform<THREE.Vector4>;
  uDorsal: THREE.IUniform<THREE.Color>;
  uVentral: THREE.IUniform<THREE.Color>;
  uFinCol: THREE.IUniform<THREE.Color>;
  uPatCol: THREE.IUniform<THREE.Color>;
  uIris: THREE.IUniform<THREE.Color>;
  uGlowCol: THREE.IUniform<THREE.Color>;
  uPat: THREE.IUniform<THREE.Vector4>;
  uSurf: THREE.IUniform<THREE.Vector4>;
  uGlowP: THREE.IUniform<THREE.Vector3>;
  uCaustics: THREE.IUniform<THREE.Texture | null>;
  uCausticScale: THREE.IUniform<number>;
}

export interface CreatureMaterialSet {
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial | null;
  uniforms: CreatureUniforms;
  dispose(): void;
}

export interface CreatureMaterialOptions {
  species: SpeciesDef;
  maps: PbrMaps;
  /** WaterSystem.sharedUniforms — the same IUniform objects, not copies. */
  shared: Record<string, THREE.IUniform>;
  caustics: THREE.Texture | null;
  /** World size in metres of one caustics tile, from `uwCausticsParams.y`. */
  causticTile: number;
  halfWidth: number;
  /** Build an animated depth material for shadow casting. */
  shadows: boolean;
}

function ribCount(s: SpeciesDef): number {
  let r = 6;
  for (const f of s.body.fins) r = Math.max(r, f.ribs);
  return Math.min(14, r);
}

export function createCreatureMaterial(opts: CreatureMaterialOptions): CreatureMaterialSet {
  const s = opts.species;
  const uniforms: CreatureUniforms = {
    uTime: { value: 0 },
    uSwim: { value: new THREE.Vector4(s.waves, s.headSway, s.finFlap, s.wingWaves) },
    uShape: { value: new THREE.Vector4(s.body.length, opts.halfWidth, s.limbFreq, s.idle) },
    uDorsal: { value: s.dorsal.clone() },
    uVentral: { value: s.ventral.clone() },
    uFinCol: { value: s.finColor.clone() },
    uPatCol: { value: s.patternColor.clone() },
    uIris: { value: s.iris.clone() },
    uGlowCol: { value: s.glowColor.clone() },
    uPat: { value: new THREE.Vector4(s.patternScale, s.patternFreq, s.patternContrast, s.iridescence) },
    uSurf: { value: new THREE.Vector4(s.roughness, s.roughnessVar, s.translucency, s.glow) },
    uGlowP: { value: new THREE.Vector3(s.glowScale, s.glowRate, opts.caustics ? 0.85 : 0) },
    uCaustics: { value: opts.caustics },
    uCausticScale: { value: 1 / Math.max(1, opts.causticTile) },
  };

  const defines: Record<string, unknown> = {
    FAUNA_PATTERN: s.pattern,
    FAUNA_RIBS: ribCount(s),
  };
  if (s.wing) defines.FAUNA_WING = 1;
  if (opts.caustics) defines.FAUNA_CAUSTICS = 1;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: opts.maps.map,
    normalMap: opts.maps.normalMap,
    roughnessMap: opts.maps.roughnessMap,
    aoMap: opts.maps.aoMap,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    // The water shader owns fogging; THREE.Fog would double up on it.
    fog: false,
  });
  material.name = `fauna.${s.id}`;
  material.defines = defines;
  material.normalScale.set(0.7, 0.7);
  // Tell world/water/MaterialPatch.ts we already apply applyUnderwater ourselves;
  // without this it retrofits a second copy of the fog chunk and the program
  // fails to link on "uwExtinction: redefinition".
  material.userData.underwater = true;
  material.userData.waterAware = true;

  /**
   * `lit` selects the MeshStandardMaterial path (which resolves `objectNormal`
   * in <beginnormal_vertex> before <begin_vertex>, so the deformed normal can be
   * handed to the lighting) versus the depth path (position only).
   */
  const patchVertex = (src: string, lit: boolean): string => {
    let out = TAU_DEF + VERT_ATTRS + (lit ? VERT_VARYINGS : '') + VERT_DEFORM + src;
    if (lit) {
      out = out.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vec3 fnPos = position;
        faunaDeform(fnPos, objectNormal);`,
      );
      out = out.replace('#include <begin_vertex>', 'vec3 transformed = fnPos;');
    } else {
      out = out.replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
        vec3 fnNrmTmp = vec3(0.0, 0.0, 1.0);
        faunaDeform(transformed, fnNrmTmp);`,
      );
    }
    if (lit) {
      out = out.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 fnWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fnWp = instanceMatrix * fnWp;
          #endif
          fnWp = modelMatrix * fnWp;
          vBody   = aBody;
          vLimb   = aLimb;
          vTint   = iTint;
          vExtra  = iExtra;
          vFUv    = uv;
          vFWorld = fnWp.xyz;
          vFDist  = length(fnWp.xyz - cameraPosition);
          vFView  = normalize(fnWp.xyz - cameraPosition + vec3(1e-6));
        }`,
      );
    }
    return out;
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, opts.shared);
    shader.vertexShader = patchVertex(shader.vertexShader, true);

    let f = TAU_DEF + FAUNA_NOISE_GLSL + UNDERWATER_GLSL + FRAG_PARS + shader.fragmentShader;
    f = f.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_SURFACE}`);
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
    f = f.replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${FRAG_OUT}`);
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => `fauna|${s.id}|${opts.caustics ? 1 : 0}`;

  let depthMaterial: THREE.MeshDepthMaterial | null = null;
  if (opts.shadows) {
    depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMaterial.name = `fauna.${s.id}.depth`;
    depthMaterial.defines = { ...defines };
    depthMaterial.userData.underwater = true;
    depthMaterial.userData.waterAware = true;
    depthMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = patchVertex(shader.vertexShader, false);
    };
    depthMaterial.customProgramCacheKey = () => `faunaDepth|${s.id}`;
  }

  return {
    material,
    depthMaterial,
    uniforms,
    dispose() {
      material.dispose();
      depthMaterial?.dispose();
    },
  };
}

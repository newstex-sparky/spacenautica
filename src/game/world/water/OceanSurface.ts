import * as THREE from 'three';
import { WATER_NOISE_GLSL } from './WaterNoise';
import { GERSTNER_GLSL, RIPPLE_GLSL } from './WaterSpectrum';
import { ANALYTIC_SKY_GLSL } from './AnalyticSky';
import {
  UNDERWATER_CAUSTICS_GLSL,
  UNDERWATER_CAUSTICS_UNIFORMS_GLSL,
  UNDERWATER_FARFIELD_GLSL,
  UNDERWATER_FUNCS_GLSL,
  UNDERWATER_UNIFORMS_GLSL,
} from './UnderwaterFog';
import { ScreenGrab } from './ScreenGrab';
import type { WaveField } from './WaterSpectrum';

/**
 * The air/water interface.
 *
 * Geometry is a camera-centred *polar* CDLOD grid: rings whose radius grows
 * geometrically, so cell size is a constant fraction of the distance to the eye.
 * That gives sub-metre tessellation at your face and metre-scale cells at the
 * horizon from a single continuous mesh — no LOD seams, no popping, and it never
 * needs rebuilding because it simply follows the camera.
 *
 * Shading covers both sides in one material:
 *  - from above: Fresnel-weighted sky reflection, GGX sun glitter whose
 *    roughness comes from the wave slope and its screen-space derivative
 *    (kills crawling specular), screen-space refraction of the scene below,
 *    Jacobian-driven crest foam.
 *  - from below: Snell's window — a bright refraction disc inside the ~97 deg
 *    cone with per-channel dispersion at the rim, fading to total internal
 *    reflection that mirrors the underwater scene at grazing angles.
 */

interface SurfaceOptions {
  rings: number;
  sectors: number;
  radiusMax: number;
}

const TIER_GEOMETRY: Record<string, SurfaceOptions> = {
  low: { rings: 104, sectors: 128, radiusMax: 2200 },
  medium: { rings: 160, sectors: 192, radiusMax: 2800 },
  high: { rings: 224, sectors: 256, radiusMax: 3300 },
  ultra: { rings: 288, sectors: 352, radiusMax: 3600 },
};

const VERT = /* glsl */ `
uniform float uTime;
uniform vec2  uFade;          // displacement fade start/end in metres
uniform float uRadiusMax;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vJac;
varying float vDist;

${UNDERWATER_UNIFORMS_GLSL}
${GERSTNER_GLSL}

void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float r = length(wp.xz - cameraPosition.xz);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, r);

  vec3 disp;
  vec3 nrm;
  float jac;
  gerstner(wp.xz, uTime, fade, disp, nrm, jac);

  wp.xz += disp.xz;
  wp.y = uwSurfaceY + disp.y;

  // Bend the outermost rings down so the mesh edge sinks under the haze
  // instead of ending in a hard line against the sky.
  //
  // Only when the eye is in air. Seen from below this would drop the far rings
  // several metres *under* the eye at shallow depths, flipping them onto the
  // above-water shading branch and painting a bright band across the horizon.
  float inAir = step(uwSurfaceY, cameraPosition.y);
  float outer = clamp((r - uFade.y) / max(1.0, uRadiusMax - uFade.y), 0.0, 1.0);
  wp.y -= outer * outer * 9.0 * inAir;

  vWorld = wp;
  vNrm = nrm;
  vJac = jac;
  vDist = length(wp - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform vec2  uResolution;
uniform sampler2D uGrab;
uniform float uUseGrab;
uniform float uRefract;
uniform float uRippleAmp;
uniform float uBaseRough;
uniform vec2  uFoam;          // jacobian: full foam below .x, none above .y
uniform vec3  uDeepColor;
uniform vec2  uFade;
uniform float uFoamAmount;
uniform vec2  uWindDir;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vJac;
varying float vDist;

${UNDERWATER_UNIFORMS_GLSL}
${UNDERWATER_CAUSTICS_UNIFORMS_GLSL}
${WATER_NOISE_GLSL}
${UNDERWATER_FUNCS_GLSL}
${UNDERWATER_FARFIELD_GLSL}
${UNDERWATER_CAUSTICS_GLSL}
${RIPPLE_GLSL}
${ANALYTIC_SKY_GLSL}

/** refract() returns 0 on total internal reflection; keep NaNs out. */
bool refractDir(vec3 i, vec3 n, float eta, out vec3 outDir) {
  vec3 t = refract(i, n, eta);
  if (dot(t, t) < 1e-6) { outDir = i; return false; }
  outDir = normalize(t);
  return true;
}

/**
 * GGX specular, hard-limited.
 *
 * A near-mirror water facet has roughness in the thousandths, and the GGX NDF
 * peaks at 1/(pi*a^2) — of order 1e7 at a = 1e-4. Multiplied by sun intensity
 * that overflows a half-float render target to +Inf, and the tone mapper turns
 * +Inf into NaN. So the peak is clamped: no sun glitter needs more than a couple
 * of hundred, and past that it is only aliasing anyway.
 */
float ggx(vec3 N, vec3 V, vec3 L, float rough) {
  vec3 H = normalize(L + V);
  float NoH = max(dot(N, H), 0.0);
  float NoV = max(dot(N, V), 1e-4);
  float NoL = max(dot(N, L), 0.0);
  float a = max(rough * rough, 1e-3);
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * max(d * d, 1e-8));
  float k = a * 0.5;
  float G = (NoV / (NoV * (1.0 - k) + k)) * (NoL / (NoL * (1.0 - k) + k));
  return min(D * G / (4.0 * NoV), 220.0);
}

void main() {
  vec3 eyeToP = vWorld - cameraPosition;
  float dist = max(vDist, 1e-3);
  vec3 V = eyeToP / dist;              // eye -> surface point
  vec3 E = -V;                         // surface point -> eye
  vec3 N = normalize(vNrm);

  // --- micro scale: analytic capillary ripples, faded by distance so the
  //     horizon does not turn into aliasing soup.
  float microFade = 1.0 - smoothstep(26.0, 240.0, dist);
  float chop = 0.55 + 0.75 * uStorm;
  vec2 g = vec2(-N.x, -N.z) / max(N.y, 1e-3);
  vec2 slope = rippleSlope(vWorld.xz, uTime, uRippleAmp * chop) * microFade;
  slope += rippleSlope(vWorld.xz * 0.29 + 17.3, uTime * 0.63, uRippleAmp * 2.6 * chop) * (0.55 * microFade);
  g += slope;
  N = normalize(vec3(-g.x, 1.0, -g.y));

  // --- foam from the horizontal Jacobian: crests that pinch throw white water.
  float foam = 1.0 - smoothstep(uFoam.x, uFoam.y, vJac);
  vec3 vo = wnVoronoi(vWorld.xz * 1.9 + vec2(uTime * 0.21, uTime * -0.13));
  float bubbles = smoothstep(0.62, 0.04, vo.x);
  // Streaks stretched along the wind: foam never appears as isotropic blobs.
  vec2 fuv = vec2(dot(vWorld.xz, uWindDir) * 0.35,
                  dot(vWorld.xz, vec2(-uWindDir.y, uWindDir.x)) * 1.9) + uTime * 0.06;
  float streak = wnFbm(fuv, 3);
  foam *= (0.30 + 0.95 * bubbles) * (0.55 + 0.75 * (streak * 0.5 + 0.5));
  foam = clamp(foam * uFoamAmount, 0.0, 1.0) * (1.0 - smoothstep(300.0, 1100.0, dist));

  // --- roughness: slope variance plus the screen-space derivative of the
  //     normal (a Toksvig-style widening) so distant glitter stops crawling.
  float rough = uBaseRough + 0.22 * length(slope) + 1.9 * length(fwidth(N));
  // The floor is a specular-antialiasing floor, not an art choice: below about
  // 0.03 a single pixel can land on the NDF peak while its neighbours do not,
  // which is exactly the crawling-highlight failure mode.
  rough = clamp(mix(rough, 0.48, foam), 0.032, 0.6);

  vec3 L = normalize(uwSunDir);
  float daylight = smoothstep(-0.05, 0.12, uwSunDir.y);
  vec2 suv = gl_FragCoord.xy / uResolution;

  bool fromAbove = cameraPosition.y > vWorld.y;
  vec3 col;
  float alpha = 1.0;

  if (fromAbove) {
    /* ---------------- seen from the air ---------------- */
    vec3 R = reflect(V, N);
    R.y = max(R.y, 0.004);
    vec3 sky = waterSkyColor(R);

    // Screen-space refraction of whatever is under the surface.
    vec2 off = N.xz * (uRefract / max(dist * 0.06, 1.0));
    vec3 grabbed = texture2D(uGrab, clamp(suv + off, vec2(0.002), vec2(0.998))).rgb;
    vec3 below = mix(uDeepColor, grabbed, uUseGrab);
    // Even a metre of water eats the red end out of the refracted view.
    vec3 shallowT = exp(-uwExtinction * uwDensity * 2.4);
    below = below * shallowT + uwInscatter * waterDownwelling(1.2) * (1.0 - shallowT);

    float cosE = clamp(dot(N, E), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosE, 5.0);
    col = mix(below, sky, F);

    // Sun glitter.
    float spec = ggx(N, E, L, rough) * max(dot(N, L), 0.0);
    col += uSunColor * uSunIntensity * spec * (1.0 - 0.75 * uStorm) * daylight;

    // Foam: rough, bright, slightly warm, with a hint of subsurface blue.
    vec3 foamCol = mix(vec3(0.78, 0.84, 0.86), uSunColor, 0.25) * (0.35 + 0.65 * daylight);
    col = mix(col, foamCol, foam * 0.92);

    // Atmospheric perspective + a soft fade into the sky at the mesh edge.
    float haze = smoothstep(uFade.x * 0.55, uFade.y * 1.15, dist);
    col = mix(col, waterSkyColor(normalize(vec3(V.x, max(V.y, -0.02), V.z))), haze * 0.9);
    // The far band has already been mixed to this shader's own sky colour, so it
    // stays mostly opaque: the ocean-from-above then reads correctly whatever the
    // sky dome behind it is doing, instead of dissolving into it.
    alpha = 1.0 - smoothstep(uFade.y * 0.95, uFade.y * 1.35, dist) * 0.45;
  } else {
    /* ---------------- seen from below: the money shot ---------------- */
    // Angle of incidence from inside the water, measured against the normal.
    float cosI = clamp(dot(V, N), 0.0, 1.0);
    // sin(theta_c) = 1/1.333  =>  cos(theta_c) = 0.6614 (a ~97 deg cone).
    const float COS_CRIT = 0.6614;

    // Refraction into the air, per channel: dispersion paints the rim of the
    // window with real colour separation.
    vec3 dr = V;
    vec3 dg = V;
    vec3 db = V;
    refractDir(V, -N, 1.3300, dg);
    refractDir(V, -N, 1.3255, dr);
    refractDir(V, -N, 1.3395, db);
    vec3 window = vec3(waterSkyColor(dr).r, waterSkyColor(dg).g, waterSkyColor(db).b);
    // Radiance gain across the interface: the whole upper hemisphere is squeezed
    // into a 97 degree cone, so the disc is genuinely brighter than the sky it
    // shows, most strongly at its rim where the compression is greatest.
    window *= 1.35 + 0.9 * (1.0 - clamp((cosI - COS_CRIT) / (1.0 - COS_CRIT), 0.0, 1.0));

    // Total internal reflection.
    //
    // The ray bounces off the underside back down into the water, so what it
    // carries is the open-water radiance along the *reflected* direction — the
    // same integral the far-field backdrop uses. That makes the ceiling agree
    // with the water below it by construction, and because the reflected
    // direction swings with the wave normal, the result ripples and darkens like
    // liquid metal as the angle goes grazing.
    //
    // The obvious cheap alternative — flipping the screen grab about its centre —
    // is geometrically wrong in a way that shows: at 4 m it mirrors Snell's
    // window itself back down across the frame and lays a pale horizontal band
    // exactly where the window's edge reflects to.
    vec3 refl = reflect(V, N);
    refl.y = min(refl.y, -0.008);
    vec3 mirrored = waterFarField(refl, 900.0);
    // Grazing reflections are dimmer and murkier than the near-vertical ones.
    float graze = 1.0 - cosI;
    mirrored *= 0.72 + 0.28 * cosI;
    // Bright wave-lensed sunlight caught in the ceiling at moderate angles.
    mirrored += uwSunColor * uSunIntensity * ggx(N, V, L, max(rough * 2.6, 0.06))
              * 0.05 * daylight * (1.0 - graze * 0.6);

    // Fresnel transmittance across the interface, hard-edged at the critical
    // angle but not aliased.
    float t = smoothstep(COS_CRIT - 0.055, COS_CRIT + 0.075, cosI);
    // Even inside the window, grazing rays reflect more than they transmit.
    float fres = 1.0 - pow(1.0 - clamp((cosI - COS_CRIT) / (1.0 - COS_CRIT), 0.0, 1.0), 3.0);
    float trans = t * mix(0.35, 1.0, fres);

    col = mix(mirrored, window, trans);

    // The rim of the window carries a bright caustic ring.
    float rim = exp(-pow((cosI - COS_CRIT) * 22.0, 2.0));
    col += uSunColor * uSunIntensity * rim * 0.045 * daylight;

    // Refracted sun disc punching through the window, and the shimmering
    // bright network the underside of a wavy surface always shows. The network
    // is what makes the underside read as a moving liquid ceiling rather than a
    // painted dome, so it fades in with the wave detail rather than with range.
    float specW = ggx(N, V, L, max(rough * 1.4, 0.02));
    col += uSunColor * uSunIntensity * specW * trans * 0.45 * daylight;
    vec3 shimmer = waterCaustics(vWorld + vec3(0.0, 0.05, 0.0), vec3(0.0, 1.0, 0.0));
    col += shimmer * (0.10 + 0.30 * trans) * daylight * (0.35 + 0.65 * microFade);

    // Underside of foam: bright bubble rafts.
    col = mix(col, vec3(0.55, 0.66, 0.7) * (0.3 + 0.7 * daylight), foam * 0.6);

    // Finally: everything above is seen *through* water, so fog it properly.
    col = applyUnderwater(col, dist, vWorld.y, V);
  }

  // Final guard. This shader feeds a half-float target that is later tone
  // mapped; one +Inf or NaN leaving here becomes a black or garbage pixel that
  // survives every downstream pass. notEqual(x, x) is the portable NaN test.
  bvec3 bad = notEqual(col, col);
  col = mix(col, uwInscatter, vec3(bad));
  gl_FragColor = vec4(min(max(col, vec3(0.0)), vec3(96.0)), alpha);
}
`;

export class OceanSurface {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private grab = new ScreenGrab([10, 26, 30]);
  /** Screen-space refraction/TIR grab. Disabled on low tier. */
  useGrab = true;

  constructor(tier: string, shared: Record<string, THREE.IUniform>, private waves: WaveField) {
    const opt = TIER_GEOMETRY[tier] ?? TIER_GEOMETRY.high;
    this.geometry = buildPolarGrid(opt.rings, opt.sectors, 0.32, opt.radiusMax);

    const own: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uWaveA: { value: waves.packA },
      uWaveB: { value: waves.packB },
      uFade: { value: new THREE.Vector2(opt.radiusMax * 0.24, opt.radiusMax * 0.72) },
      uRadiusMax: { value: opt.radiusMax },
      uSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
      uSunIntensity: { value: 3.2 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uGrab: { value: this.grab.texture },
      uUseGrab: { value: 0 },
      uRefract: { value: 0.65 },
      uRippleAmp: { value: 0.013 },
      uBaseRough: { value: 0.028 },
      uFoam: { value: new THREE.Vector2(0.42, 0.8) },
      uDeepColor: { value: new THREE.Color(0.02, 0.09, 0.12) },
      uFoamAmount: { value: 0.6 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      // analytic sky block
      uSkyZenith: { value: new THREE.Color(0.09, 0.22, 0.46) },
      uSkyHorizon: { value: new THREE.Color(0.55, 0.68, 0.82) },
      uSunColorSky: { value: new THREE.Color(1, 0.95, 0.86) },
      uSunDisc: { value: 1 },
      uStorm: { value: 0 },
      uSkyTex: { value: this.grab.fallback },
      uSkyTexAmount: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: Object.assign(own, shared),
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'water.surface';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.onBeforeRender = (renderer) => this.captureGrab(renderer);
  }

  /** Keeps the grid centred under the camera; the wave field is world-space. */
  follow(camera: THREE.Camera, surfaceY: number): void {
    this.mesh.position.set(camera.position.x, surfaceY, camera.position.z);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
  }

  setResolution(w: number, h: number): void {
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(Math.max(1, w), Math.max(1, h));
    this.grab.invalidate();
    this.material.uniforms.uGrab.value = this.grab.texture;
    this.material.uniforms.uUseGrab.value = 0;
  }

  /**
   * Grabs the framebuffer just before the surface draws, so the shader can
   * refract what is behind it and mirror it for total internal reflection.
   * The surface renders in the transparent pass, so the opaque scene is already
   * resolved by this point.
   */
  private captureGrab(renderer: THREE.WebGLRenderer): void {
    if (!this.useGrab) {
      this.material.uniforms.uUseGrab.value = 0;
      return;
    }
    const ok = this.grab.capture(renderer);
    this.material.uniforms.uGrab.value = this.grab.texture;
    this.material.uniforms.uUseGrab.value = ok;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.grab.dispose();
  }
}

/**
 * Camera-centred polar CDLOD grid. Ring radii grow geometrically so every cell
 * subtends roughly the same solid angle: dense at the eye, sparse at the
 * horizon, one draw call, zero seams.
 */
function buildPolarGrid(rings: number, sectors: number, rMin: number, rMax: number): THREE.BufferGeometry {
  const vertCount = 1 + rings * sectors;
  const pos = new Float32Array(vertCount * 3);
  const growth = Math.pow(rMax / rMin, 1 / (rings - 1));

  let p = 3; // vertex 0 is the centre, already (0,0,0)
  let r = rMin;
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      pos[p] = Math.cos(a) * r;
      pos[p + 1] = 0;
      pos[p + 2] = Math.sin(a) * r;
      p += 3;
    }
    r *= growth;
  }

  const triCount = sectors + (rings - 1) * sectors * 2;
  const idx = new Uint32Array(triCount * 3);
  let k = 0;
  // Centre fan.
  for (let s = 0; s < sectors; s++) {
    idx[k++] = 0;
    idx[k++] = 1 + s;
    idx[k++] = 1 + ((s + 1) % sectors);
  }
  // Rings.
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * sectors;
    const b0 = 1 + (i + 1) * sectors;
    for (let s = 0; s < sectors; s++) {
      const s1 = (s + 1) % sectors;
      idx[k++] = a0 + s;
      idx[k++] = b0 + s;
      idx[k++] = b0 + s1;
      idx[k++] = a0 + s;
      idx[k++] = b0 + s1;
      idx[k++] = a0 + s1;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), rMax * 1.2);
  return geo;
}

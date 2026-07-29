import * as THREE from 'three';
import { ATMO, ATMOSPHERE_GLSL, ATMOSPHERE_MARCH_GLSL } from './Atmosphere';

/* ------------------------------------------------------------------ *
 * Tiny full-screen pass helper (no post-processing dependency)
 * ------------------------------------------------------------------ */

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

export class FullScreenPass {
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: QUAD_VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      // These passes write raw radiance into a float target: no tonemap, no
      // colour-space conversion.
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function makeTarget(w: number, h: number, wrapS: THREE.Wrapping): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  rt.texture.wrapS = wrapS;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

/* ------------------------------------------------------------------ *
 * Pass 1 — transmittance LUT (static, one shot)
 * ------------------------------------------------------------------ */

const TRANSMITTANCE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${ATMOSPHERE_GLSL}

void main() {
  float r, mu;
  atmoTransParams(vUv, r, mu);

  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  float tTop = atmoSphere(ro, rd, ATMO_TOP_R);
  float tGnd = atmoSphere(ro, rd, ATMO_GROUND_R);
  float tMax = tTop > 0.0 ? tTop : 0.0;
  if (tGnd > 0.0) tMax = min(tMax, tGnd);

  const int STEPS = 40;
  vec3 od = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) / float(STEPS) * tMax;
    float h = length(ro + rd * t) - ATMO_GROUND_R;
    vec3 rayS; float mieS; vec3 ext;
    atmoMedium(h, rayS, mieS, ext);
    od += ext * (tMax / float(STEPS));
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * Pass 2 — multiple-scattering LUT (static, one shot)
 * ------------------------------------------------------------------ */

const MULTISCATTER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTransLut;
uniform sampler2D uZero;
${ATMOSPHERE_GLSL}
${ATMOSPHERE_MARCH_GLSL}

#define MS_DIRS 16

void main() {
  float muS = clamp(vUv.x * 2.0 - 1.0, -1.0, 1.0);
  float r = mix(ATMO_GROUND_R + 0.002, ATMO_TOP_R - 0.002, vUv.y);
  vec3 sunDir = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);

  vec3 lum = vec3(0.0);
  vec3 fms = vec3(0.0);

  // Fibonacci-ish uniform sphere sampling; isotropic phase.
  for (int i = 0; i < MS_DIRS; i++) {
    float fi = (float(i) + 0.5) / float(MS_DIRS);
    float cz = 1.0 - 2.0 * fi;
    float sz = sqrt(max(0.0, 1.0 - cz * cz));
    float ph = fi * 2.399963229728653 * float(MS_DIRS);
    vec3 dir = vec3(cos(ph) * sz, cz, sin(ph) * sz);
    AtmoSample s = atmoMarch(uTransLut, uZero, r, dir, sunDir, vec3(1.0), 20, 0.5, 0.0, 1.0);
    lum += s.lum;
    fms += s.msf;
  }
  lum /= float(MS_DIRS);
  fms /= float(MS_DIRS);

  // Infinite-scattering-order geometric series.
  vec3 psi = lum / max(1.0 - fms, vec3(1e-4));
  gl_FragColor = vec4(psi, 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * Pass 3 — sky-view panorama (per frame, cheap)
 * ------------------------------------------------------------------ */

const SKYVIEW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTransLut;
uniform sampler2D uMsLut;
uniform vec3  uSunDir;
uniform vec3  uSunIrradiance;
uniform float uObserverR;
uniform int   uSteps;
uniform float uHaze;
${ATMOSPHERE_GLSL}
${ATMOSPHERE_MARCH_GLSL}

void main() {
  vec3 dir = skyViewDir(vUv);
  AtmoSample s = atmoMarch(uTransLut, uMsLut, uObserverR, dir, uSunDir, uSunIrradiance, uSteps, 0.35, 1.0, 0.0);

  /*
   * Aerosol haze near the horizon — the boundary-layer murk that a pure
   * Rayleigh+Mie column misses. Three properties matter and the old flat grey
   * term had none of them:
   *   - it is *lit*, so it has to vanish when the sun goes down (otherwise a
   *     grey band sits on the horizon all night and eats the star field),
   *   - it forward-scatters, so it is much stronger toward the sun's azimuth,
   *   - at low sun the light reaching it has already been reddened, so the band
   *     is warm on the sun side and cool on the anti-sun side.
   */
  float horizon = 1.0 - abs(dir.y);
  float dayGate = smoothstep(-0.10, 0.05, uSunDir.y);
  vec2 azD = normalize(vec2(dir.x, dir.z) + vec2(1e-5));
  vec2 azS = normalize(vec2(uSunDir.x, uSunDir.z) + vec2(1e-5));
  float toSun = max(0.0, dot(azD, azS));
  float lowSun = 1.0 - smoothstep(0.04, 0.42, uSunDir.y);
  vec3 warm = mix(vec3(0.94, 0.96, 1.0), vec3(1.30, 0.92, 0.55), toSun * lowSun);
  vec3 hazeCol = uSunIrradiance * (0.0032 + 0.019 * max(0.0, uSunDir.y)) * dayGate * warm;
  vec3 lum = s.lum + hazeCol * uHaze * pow(horizon, 3.0) * (0.5 + 0.85 * toSun);
  gl_FragColor = vec4(lum, 1.0);
}
`;

/* ------------------------------------------------------------------ */

export interface SkyViewParams {
  sunDir: THREE.Vector3;
  sunIrradiance: THREE.Vector3;
  observerR: number;
  steps: number;
  haze: number;
}

/**
 * Owns the three atmosphere lookup tables. Transmittance and multiple
 * scattering are static (built once); the sky-view panorama is refreshed as the
 * sun moves.
 */
export class AtmosphereLuts {
  readonly transmittance: THREE.WebGLRenderTarget;
  readonly multiScatter: THREE.WebGLRenderTarget;
  /** Sun-lit sky-view panorama. */
  readonly skyView: THREE.WebGLRenderTarget;
  /** Moon-lit sky-view panorama, summed with the above at night. */
  readonly skyViewMoon: THREE.WebGLRenderTarget;

  private readonly transPass: FullScreenPass;
  private readonly msPass: FullScreenPass;
  private readonly skyPass: FullScreenPass;
  private readonly zero: THREE.DataTexture;
  private built = false;

  constructor(skyViewWidth: number, skyViewHeight: number) {
    this.transmittance = makeTarget(ATMO.transW, ATMO.transH, THREE.ClampToEdgeWrapping);
    this.multiScatter = makeTarget(ATMO.msSize, ATMO.msSize, THREE.ClampToEdgeWrapping);
    this.skyView = makeTarget(skyViewWidth, skyViewHeight, THREE.RepeatWrapping);
    this.skyViewMoon = makeTarget(
      Math.max(48, skyViewWidth >> 1),
      Math.max(24, skyViewHeight >> 1),
      THREE.RepeatWrapping,
    );

    this.zero = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this.zero.needsUpdate = true;

    this.transPass = new FullScreenPass(TRANSMITTANCE_FRAG, {});
    this.msPass = new FullScreenPass(MULTISCATTER_FRAG, {
      uTransLut: { value: this.transmittance.texture },
      uZero: { value: this.zero },
    });
    this.skyPass = new FullScreenPass(SKYVIEW_FRAG, {
      uTransLut: { value: this.transmittance.texture },
      uMsLut: { value: this.multiScatter.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunIrradiance: { value: new THREE.Vector3(1, 1, 1) },
      uObserverR: { value: ATMO.groundR + 0.001 },
      uSteps: { value: 32 },
      uHaze: { value: 0 },
    });
  }

  /** Builds the two static LUTs. Cheap enough to run during init. */
  buildStatic(renderer: THREE.WebGLRenderer): void {
    if (this.built) return;
    this.transPass.render(renderer, this.transmittance);
    this.msPass.render(renderer, this.multiScatter);
    this.built = true;
  }

  /** Renders a sky-view panorama for one light source into `target`. */
  updateSkyView(renderer: THREE.WebGLRenderer, p: SkyViewParams, target: THREE.WebGLRenderTarget): void {
    const u = this.skyPass.material.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir);
    (u.uSunIrradiance.value as THREE.Vector3).copy(p.sunIrradiance);
    u.uObserverR.value = p.observerR;
    u.uSteps.value = p.steps;
    u.uHaze.value = p.haze;
    this.skyPass.render(renderer, target);
  }

  dispose(): void {
    this.transPass.dispose();
    this.msPass.dispose();
    this.skyPass.dispose();
    this.transmittance.dispose();
    this.multiScatter.dispose();
    this.skyView.dispose();
    this.skyViewMoon.dispose();
    this.zero.dispose();
  }
}

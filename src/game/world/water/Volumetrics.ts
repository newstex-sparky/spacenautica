import * as THREE from 'three';
import {
  UNDERWATER_CAUSTICS_GLSL,
  UNDERWATER_CAUSTICS_UNIFORMS_GLSL,
  UNDERWATER_FUNCS_GLSL,
  UNDERWATER_UNIFORMS_GLSL,
} from './UnderwaterFog';

/**
 * Underwater volumetrics: raymarched god rays and screen-space caustics.
 *
 * This is participating media, not a radial blur. For every (half-resolution)
 * pixel we march the view ray through the water, and at each step:
 *   - test the sun's shadow map, so geometry genuinely occludes the shaft;
 *   - attenuate the sunlight by the *downwelling* path from the surface to that
 *     depth, per wavelength;
 *   - modulate by the caustics field sampled at the point where that photon
 *     crossed the surface, which is what turns a smooth glow into distinct,
 *     dappled, swaying shafts;
 *   - weight by the Henyey-Greenstein phase toward the sun and by the beam
 *     transmittance back to the eye.
 *
 * Steps are offset by blue noise per pixel per frame and the result is blended
 * with a reprojected history buffer, so 24 steps look like 100.
 *
 * The same pass reconstructs world position from the depth buffer and adds
 * caustics onto every underwater surface in view — shadow-mapped, so a rock
 * overhang keeps the dapple off the floor underneath it.
 */

export interface VolumetricParams {
  camera: THREE.PerspectiveCamera;
  time: number;
  frame: number;
  sunIntensity: number;
  /** Sun shadow map (VSM: .r holds the mean depth) and its world->shadow matrix. */
  shadowMap: THREE.Texture | null;
  shadowMatrix: THREE.Matrix4 | null;
  /** Scene depth from the post stack, if it exposes one. */
  depthTexture: THREE.Texture | null;
  blueNoise: THREE.Texture | null;
  strength: number;
  causticSurface: number;
  /** Furthest the march travels, in metres. */
  maxDist: number;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function frag(maxSteps: number): string {
  return /* glsl */ `
uniform mat4  uInvViewProj;
uniform mat4  uPrevViewProj;
uniform vec3  uCamPos;
uniform vec3  uCamFwd;
uniform float uSunIntensity;
uniform vec2  uNearFar;
uniform sampler2D uDepthTex;
uniform float uUseDepth;
uniform sampler2D uShadowMap;
uniform mat4  uShadowMatrix;
uniform float uUseShadow;
uniform float uShadowBias;
uniform sampler2D uBlueNoise;
uniform vec2  uNoiseScale;
uniform float uFrame;
uniform int   uSteps;
uniform float uMaxDist;
uniform float uStrength;
uniform float uCausticSurface;
uniform sampler2D uPrevTex;
uniform float uHistory;
uniform float uDapple;

varying vec2 vUv;

${UNDERWATER_UNIFORMS_GLSL}
${UNDERWATER_CAUSTICS_UNIFORMS_GLSL}
${UNDERWATER_FUNCS_GLSL}
${UNDERWATER_CAUSTICS_GLSL}

/** Sun visibility at a world point, from the directional light's VSM map. */
float sunShadow(vec3 p) {
  if (uUseShadow < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  sc.xyz /= max(sc.w, 1e-5);
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) return 1.0;
  float mean = texture2D(uShadowMap, sc.xy).x;
  return smoothstep(-0.0035, 0.0035, mean - sc.z + uShadowBias);
}

/** Caustics tile lookup at a world XZ (no normal term — used for shafts). */
vec3 dappleAt(vec2 xz) {
  float tile = max(uwCausticsParams.y, 1.0);
  vec2 p = xz / tile;
  vec2 q = vec2(p.x * 0.7986 - p.y * 0.6018, p.x * 0.6018 + p.y * 0.7986) * 1.73;
  vec3 a = texture2D(uwCausticsMap, p).rgb;
  vec3 b = texture2D(uwCausticsMap, q).rgb;
  return max(a * b - 0.8, 0.0);
}

void main() {
  // Reconstruct the world-space ray for this pixel.
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rayDir = normalize(far.xyz / far.w - uCamPos);

  // How far the ray travels before it hits something.
  float sceneDist = uMaxDist;
  float hitSky = 1.0;
  if (uUseDepth > 0.5) {
    float d = texture2D(uDepthTex, vUv).x;
    if (d < 0.999999) {
      hitSky = 0.0;
      float n = uNearFar.x;
      float f = uNearFar.y;
      float ndc = d * 2.0 - 1.0;
      float viewZ = (2.0 * n * f) / (f + n - ndc * (f - n));
      sceneDist = min(uMaxDist, viewZ / max(dot(rayDir, uCamFwd), 0.05));
    }
  }

  vec3 sunDir = normalize(uwSunDir);
  float phase = 0.0795775 + waterPhaseHG(dot(rayDir, sunDir), 0.72) * 0.92;
  float daylight = smoothstep(-0.03, 0.16, sunDir.y);
  vec3 sunRad = uwSunColor * uSunIntensity * daylight;
  vec3 scatterCoef = uwExtinction * uwDensity * 0.55;
  // Horizontal offset from a point at depth d back up to where its photon
  // pierced the surface.
  vec2 upShift = sunDir.xz / max(sunDir.y, 0.22);

  float jitter = texture2D(uBlueNoise, gl_FragCoord.xy * uNoiseScale + vec2(uFrame * 0.0173, uFrame * 0.0311)).r;

  float t0 = 0.35;
  float span = max(sceneDist - t0, 0.0);
  float dt = span / float(uSteps);
  float t = t0 + jitter * dt;

  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${maxSteps}; i++) {
    if (i >= uSteps) break;
    vec3 p = uCamPos + rayDir * t;
    float depth = uwSurfaceY - p.y;
    if (depth > 0.05) {
      float lit = sunShadow(p);
      vec3 down = waterDownwelling(depth);
      vec3 dap = dappleAt(p.xz + upShift * depth);
      vec3 T = waterTransmittance(t);
      acc += sunRad * lit * down * (1.0 + dap * uDapple) * phase * T * scatterCoef * dt;
    }
    t += dt;
  }
  acc *= uStrength;

  // Screen-space caustics on the receiving surface. Derivatives are taken in
  // uniform control flow so silhouette pixels still get a sane normal.
  vec3 hit = uCamPos + rayDir * sceneDist;
  vec3 hitNrm = cross(dFdx(hit), dFdy(hit));
  float hitNl = length(hitNrm);
  hitNrm = hitNl > 1e-7 ? hitNrm / hitNl : -rayDir;
  if (dot(hitNrm, rayDir) > 0.0) hitNrm = -hitNrm;
  if (uUseDepth > 0.5 && hitSky < 0.5 && uCausticSurface > 0.0 && hit.y < uwSurfaceY) {
    float lit = sunShadow(hit + hitNrm * 0.25);
    vec3 c = waterCaustics(hit, hitNrm) * lit;
    c *= waterDownwelling(uwSurfaceY - hit.y) * waterTransmittance(sceneDist);
    acc += c * sunRad * uCausticSurface;
  }

  // Temporal reprojection: blend against the history buffer.
  vec3 outCol = acc;
  float endNorm = clamp(sceneDist / uMaxDist, 0.0, 1.0);
  if (uHistory > 0.001) {
    vec3 refPos = uCamPos + rayDir * (sceneDist * 0.5);
    vec4 pp = uPrevViewProj * vec4(refPos, 1.0);
    vec2 puv = pp.xy / max(pp.w, 1e-5) * 0.5 + 0.5;
    if (puv.x > 0.002 && puv.x < 0.998 && puv.y > 0.002 && puv.y < 0.998) {
      vec4 prev = texture2D(uPrevTex, puv);
      float reject = step(abs(prev.a - endNorm), 0.06);
      outCol = mix(acc, prev.rgb, uHistory * reject);
    }
  }

  gl_FragColor = vec4(max(outCol, vec3(0.0)), endNorm);
}
`;
}

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uVolume;
uniform float uAmount;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uVolume, vUv).rgb;
  gl_FragColor = vec4(c * uAmount, 1.0);
}
`;

const STEPS: Record<string, number> = { low: 12, medium: 20, high: 32, ultra: 48 };

export class Volumetrics {
  /** Additive full-screen quad; hidden when the post stack composites instead. */
  readonly composite: THREE.Mesh;
  /** True to let `render.post` composite `texture` itself. */
  externalComposite = false;

  private rts: THREE.WebGLRenderTarget[] = [];
  private ping = 0;
  private mat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private prevViewProj = new THREE.Matrix4();
  private scale: number;
  private blank: THREE.DataTexture;
  private ready = false;

  constructor(tier: string, shared: Record<string, THREE.IUniform>) {
    const steps = STEPS[tier] ?? 32;
    this.scale = tier === 'low' ? 0.35 : 0.5;

    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this.blank.needsUpdate = true;

    const own: Record<string, THREE.IUniform> = {
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
      uSunIntensity: { value: 3.2 },
      uNearFar: { value: new THREE.Vector2(0.08, 4000) },
      uDepthTex: { value: this.blank },
      uUseDepth: { value: 0 },
      uShadowMap: { value: this.blank },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uUseShadow: { value: 0 },
      uShadowBias: { value: 0.0012 },
      uBlueNoise: { value: this.blank },
      uNoiseScale: { value: new THREE.Vector2(1 / 128, 1 / 128) },
      uFrame: { value: 0 },
      uSteps: { value: steps },
      uMaxDist: { value: 220 },
      uStrength: { value: 1 },
      uCausticSurface: { value: 1 },
      uPrevTex: { value: this.blank },
      uHistory: { value: 0.82 },
      uDapple: { value: 2.6 },
    };

    this.mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(own, shared),
      vertexShader: VERT,
      fragmentShader: frag(steps),
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: { uVolume: { value: this.blank }, uAmount: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.composite.name = 'water.volumetrics.composite';
    this.composite.frustumCulled = false;
    this.composite.renderOrder = 9000;
    this.composite.visible = false;
  }

  get texture(): THREE.Texture | null {
    return this.ready ? this.rts[this.ping].texture : null;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width * this.scale));
    const h = Math.max(2, Math.floor(height * this.scale));
    if (this.rts.length === 2 && this.rts[0].width === w && this.rts[0].height === h) return;
    for (const rt of this.rts) rt.dispose();
    this.rts = [0, 1].map(() => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
      rt.texture.name = 'water.godrays';
      return rt;
    });
    this.ready = false;
  }

  /** Renders the volumetric buffer. Call before the frame is composited. */
  render(renderer: THREE.WebGLRenderer, p: VolumetricParams): void {
    if (this.rts.length < 2) return;
    const u = this.mat.uniforms;
    const cam = p.camera;

    cam.updateMatrixWorld();
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    (u.uInvViewProj.value as THREE.Matrix4).copy(_vp).invert();
    (u.uPrevViewProj.value as THREE.Matrix4).copy(this.ready ? this.prevViewProj : _vp);
    (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    (u.uCamFwd.value as THREE.Vector3).set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    (u.uNearFar.value as THREE.Vector2).set(cam.near, cam.far);
    u.uSunIntensity.value = p.sunIntensity;
    u.uFrame.value = p.frame % 64;
    u.uStrength.value = p.strength;
    u.uCausticSurface.value = p.causticSurface;
    u.uMaxDist.value = p.maxDist;

    if (p.shadowMap && p.shadowMatrix) {
      u.uShadowMap.value = p.shadowMap;
      (u.uShadowMatrix.value as THREE.Matrix4).copy(p.shadowMatrix);
      u.uUseShadow.value = 1;
    } else {
      u.uUseShadow.value = 0;
    }
    if (p.depthTexture) {
      u.uDepthTex.value = p.depthTexture;
      u.uUseDepth.value = 1;
    } else {
      u.uUseDepth.value = 0;
    }
    if (p.blueNoise) {
      u.uBlueNoise.value = p.blueNoise;
      const img = p.blueNoise.image as { width?: number; height?: number } | undefined;
      (u.uNoiseScale.value as THREE.Vector2).set(1 / (img?.width || 128), 1 / (img?.height || 128));
    }

    const src = this.rts[this.ping];
    const dst = this.rts[1 - this.ping];
    u.uPrevTex.value = this.ready ? src.texture : this.blank;
    u.uHistory.value = this.ready ? 0.82 : 0;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(dst);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prevTarget);

    this.ping = 1 - this.ping;
    this.ready = true;
    this.prevViewProj.copy(_vp);

    this.compositeMat.uniforms.uVolume.value = dst.texture;
    this.composite.visible = !this.externalComposite;
  }

  /** Hides the in-scene composite (used above water, or when disabled). */
  hide(): void {
    this.composite.visible = false;
  }

  setCompositeAmount(a: number): void {
    this.compositeMat.uniforms.uAmount.value = a;
  }

  dispose(): void {
    for (const rt of this.rts) rt.dispose();
    this.rts.length = 0;
    this.mat.dispose();
    this.compositeMat.dispose();
    this.quad.geometry.dispose();
    this.composite.geometry.dispose();
    this.blank.dispose();
  }
}

const _vp = new THREE.Matrix4();

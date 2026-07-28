import * as THREE from 'three';
import { NOISE_GLSL } from '../../core/Noise';
import { UNDERWATER_GLSL } from '../water/UnderwaterFog';
import { ATMO, ATMOSPHERE_GLSL } from './Atmosphere';
import { CELESTIAL_GLSL } from './Celestial';
import { CLOUD_GLSL } from './CloudField';

/**
 * The sky dome: one shader that composites, back to front,
 *
 *   space (stars + milky way + moon + sun disc + aurora)
 *     x atmospheric transmittance
 *     x cloud transmittance
 *   + volumetric cloud in-scattering (raymarched, blue-noise dithered)
 *   + atmospheric in-scattering (sky-view LUT, sun and moon lit)
 *   [ + ocean hemisphere for downward rays, so the IBL probe and any gap
 *       between the water mesh and the true horizon read as sea, not void ]
 *   -> optional underwater extinction so Snell's window is depth-graded
 *
 * The same material instance also draws into a small cube camera for the PMREM
 * environment probe; `setEnvPass()` swaps in the cheap uniform set.
 */

const DOME_VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DOME_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldDir;

uniform sampler2D uTransLut;
uniform sampler2D uSkyView;
uniform sampler2D uSkyViewMoon;
uniform sampler2D uBlueNoise;
uniform vec2  uBlueNoiseSize;
uniform vec3  uSunDir;
uniform vec3  uMoonDir;
uniform float uObserverR;
uniform vec3  uSunCloudRad;
uniform vec3  uAmbTop;
uniform vec3  uAmbBottom;
uniform float uCloudJitter;
uniform vec3  uNightFloor;
uniform vec3  uSeaTint;
uniform float uEnvPass;
uniform float uUnderwater;
uniform float uEyeY;
uniform float uLightning;

${NOISE_GLSL}
${ATMOSPHERE_GLSL}
${CLOUD_GLSL}
${CELESTIAL_GLSL}
${UNDERWATER_GLSL}

vec3 skyLuminance(vec3 dir) {
  vec2 uv = skyViewUv(dir);
  return texture2D(uSkyView, uv).rgb + texture2D(uSkyViewMoon, uv).rgb;
}

void main() {
  vec3 rd = normalize(vWorldDir);
  vec3 ro = vec3(0.0, uObserverR, 0.0);

  // Stable per-pixel blue-noise offset; when TAA is on the host rotates
  // uCloudJitter every frame so the temporal filter resolves extra steps.
  float bn = texture2D(uBlueNoise, gl_FragCoord.xy / uBlueNoiseSize).r;
  float jit = fract(bn + uCloudJitter);

  float seaW = smoothstep(0.0, -0.014, rd.y);

  vec3 color = vec3(0.0);

  if (seaW < 0.998) {
    vec3 skyLum = skyLuminance(rd);
    float horizonLift = 1.0 - abs(rd.y);
    skyLum += uNightFloor * (0.45 + 0.55 * horizonLift * horizonLift * horizonLift);

    vec4 cl = cloudsMarch(ro, rd, uSunDir, uSunCloudRad, uAmbTop, uAmbBottom, jit);

    vec3 space = starField(rd) + moonDisc(rd, uMoonDir, uSunDir) + auroraGlow(rd);
    space += sunDisc(rd, uSunDir) * (1.0 - uEnvPass * 0.965);

    vec3 atmT = atmoTransmittance(uTransLut, uObserverR, rd.y);

    // Roughly 70% of the Rayleigh column sits below the cloud deck, so only
    // that share of the sky glow is occluded by cloud.
    color = space * atmT * cl.a + skyLum * mix(1.0, cl.a, 0.70) + cl.rgb;
    color += vec3(0.86, 0.91, 1.0) * uLightning * (1.0 - cl.a) * 2.6;
  }

  if (seaW > 0.002) {
    vec3 mirror = vec3(rd.x, -rd.y, rd.z);
    vec3 skyRefl = skyLuminance(mirror);
    float ct = max(0.0, -rd.y);
    float f5 = 1.0 - ct;
    f5 = f5 * f5 * f5 * f5 * f5;
    float fres = clamp(0.02 + 0.98 * f5, 0.0, 1.0);
    vec3 sea = mix(uSeaTint, skyRefl, fres);
    float glint = pow(max(0.0, dot(normalize(mirror), uSunDir)), 110.0);
    sea += uSunCloudRad * glint * 0.30;
    // Aerial perspective: grazing sea is tens of kilometres away.
    vec3 horizDir = normalize(vec3(rd.x, 0.004, rd.z));
    vec3 horizSky = skyLuminance(horizDir);
    float aer = exp(-abs(rd.y) * 26.0);
    sea = mix(sea, horizSky, aer * 0.88);
    color = mix(color, sea, seaW);
  }

  if (uUnderwater > 0.5) {
    float path = clamp(uwCameraDepth / max(0.10, abs(rd.y)), 0.0, 480.0);
    color = applyUnderwater(color, path, uEyeY, rd);
  }

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SkyDomeOptions {
  cloudSteps: number;
  cloudLightSteps: number;
  envCubeSize: number;
}

export class SkyDome {
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  /** Scene holding a second mesh with the same material, for the cube probe. */
  readonly envScene = new THREE.Scene();

  private readonly geometry: THREE.SphereGeometry;
  private readonly envMesh: THREE.Mesh;
  private cloudSteps: number;
  private cloudLightSteps: number;
  private pixelAngle = 0.0013;
  private readonly envPixelAngle: number;

  constructor(opts: SkyDomeOptions) {
    this.cloudSteps = opts.cloudSteps;
    this.cloudLightSteps = opts.cloudLightSteps;
    this.envPixelAngle = 2.0 / Math.max(8, opts.envCubeSize);

    this.material = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        // --- atmosphere
        uTransLut: { value: null },
        uSkyView: { value: null },
        uSkyViewMoon: { value: null },
        uBlueNoise: { value: null },
        uBlueNoiseSize: { value: new THREE.Vector2(128, 128) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uObserverR: { value: ATMO.groundR + 0.001 },
        uSunCloudRad: { value: new THREE.Vector3(1, 1, 1) },
        uAmbTop: { value: new THREE.Vector3(0.4, 0.5, 0.7) },
        uAmbBottom: { value: new THREE.Vector3(0.1, 0.13, 0.16) },
        uCloudJitter: { value: 0 },
        uNightFloor: { value: new THREE.Vector3(0.0007, 0.0011, 0.0021) },
        uSeaTint: { value: new THREE.Vector3(0.012, 0.045, 0.062) },
        uEnvPass: { value: 0 },
        uUnderwater: { value: 0 },
        uEyeY: { value: 0 },
        uLightning: { value: 0 },
        // --- clouds
        uCloudTex: { value: null },
        uCloudOffset: { value: new THREE.Vector2(0, 0) },
        uCloudCoverage: { value: 0.36 },
        uCloudBase: { value: 1.45 },
        uCloudTop: { value: 3.6 },
        uCloudDensity: { value: 1.0 },
        uCloudErode: { value: 0.42 },
        uCloudDetail: { value: 1.35 },
        uCloudSigmaE: { value: 26.0 },
        uCloudPowder: { value: 0.7 },
        uCloudSunGain: { value: 2.4 },
        uCloudSteps: { value: this.cloudSteps },
        uCloudLightSteps: { value: this.cloudLightSteps },
        // --- celestial
        uStarRot: { value: new THREE.Matrix3() },
        uGalNormal: { value: new THREE.Vector3(0, 0, 1) },
        uGalCentre: { value: new THREE.Vector3(1, 0, 0) },
        uStarBrightness: { value: 1 },
        uPixelAngle: { value: this.pixelAngle },
        uSunRadius: { value: 0.004654 },
        uSunRadiance: { value: new THREE.Vector3(1, 1, 1) },
        uMoonRadius: { value: 0.0118 },
        uMoonRadiance: { value: new THREE.Vector3(0.02, 0.024, 0.03) },
        uMoonIllum: { value: 1 },
        uAurora: { value: 0 },
        uSkyTime: { value: 0 },
        // --- underwater block (values mirrored from WaterSystem.sharedUniforms)
        uwExtinction: { value: new THREE.Vector3(0.42, 0.09, 0.045) },
        uwInscatter: { value: new THREE.Color(0.06, 0.3, 0.38) },
        uwSurfaceY: { value: 0 },
        uwDensity: { value: 1 },
        uwSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uwSunColor: { value: new THREE.Color(1, 1, 1) },
        uwTime: { value: 0 },
        uwCameraDepth: { value: 0 },
      },
    });

    this.geometry = new THREE.SphereGeometry(1, 48, 32);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'sky.dome';
    this.mesh.scale.setScalar(3000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10000;

    this.envMesh = new THREE.Mesh(this.geometry, this.material);
    this.envMesh.scale.setScalar(100);
    this.envMesh.frustumCulled = false;
    this.envScene.add(this.envMesh);
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  /** Keeps the dome centred on the camera so it can never be walked out of. */
  follow(cameraPosition: THREE.Vector3): void {
    this.mesh.position.copy(cameraPosition);
  }

  setResolution(height: number, fovDeg: number): void {
    const h = Math.max(64, height);
    this.pixelAngle = (2 * Math.tan((fovDeg * Math.PI) / 360)) / h;
    this.material.uniforms.uPixelAngle.value = this.pixelAngle;
  }

  setCloudBudget(steps: number, lightSteps: number): void {
    this.cloudSteps = steps;
    this.cloudLightSteps = lightSteps;
    this.material.uniforms.uCloudSteps.value = steps;
    this.material.uniforms.uCloudLightSteps.value = lightSteps;
  }

  /** Swap between the on-screen budget and the cheap cube-probe budget. */
  setEnvPass(on: boolean): void {
    const u = this.material.uniforms;
    if (on) {
      u.uEnvPass.value = 1;
      u.uCloudSteps.value = Math.min(8, Math.max(4, this.cloudSteps >> 2));
      u.uCloudLightSteps.value = 2;
      u.uPixelAngle.value = this.envPixelAngle;
      u.uUnderwater.value = 0;
    } else {
      u.uEnvPass.value = 0;
      u.uCloudSteps.value = this.cloudSteps;
      u.uCloudLightSteps.value = this.cloudLightSteps;
      u.uPixelAngle.value = this.pixelAngle;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.envScene.clear();
  }
}

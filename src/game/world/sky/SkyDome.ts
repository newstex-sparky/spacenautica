import * as THREE from 'three';
import { NOISE_GLSL } from '../../core/Noise';
import { UNDERWATER_FARFIELD_GLSL, UNDERWATER_GLSL } from '../water/UnderwaterFog';
import { ATMO, ATMOSPHERE_GLSL } from './Atmosphere';
import { CELESTIAL_GLSL } from './Celestial';
import { CLOUD_GLSL } from './CloudField';
import { NOISE_COMPAT_GLSL } from './GlslCompat';

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
uniform float uEquirect;
uniform vec2  uEquirectSize;
uniform float uHorizonDip;

${NOISE_COMPAT_GLSL}
${NOISE_GLSL}
${ATMOSPHERE_GLSL}
${CLOUD_GLSL}
${CELESTIAL_GLSL}
${UNDERWATER_GLSL}
${UNDERWATER_FARFIELD_GLSL}

vec3 skyLuminance(vec3 dir) {
  vec2 uv = skyViewUv(dir);
  return texture2D(uSkyView, uv).rgb + texture2D(uSkyViewMoon, uv).rgb;
}

/**
 * Latitude-longitude direction for the panorama pass. Matches the lookup the
 * water system's reflection shader uses:
 *   u = atan(d.z, d.x) / 2pi + 0.5,  v = acos(d.y) / pi
 * so v = 0 is the zenith and the first row in memory is the zenith row.
 */
vec3 equirectDir(vec2 uv) {
  float az = (uv.x - 0.5) * 2.0 * ATMO_PI;
  float th = uv.y * ATMO_PI;
  float sy = sin(th);
  return normalize(vec3(cos(az) * sy, cos(th), sin(az) * sy));
}

void main() {
  vec3 rd = uEquirect > 0.5
    ? equirectDir(gl_FragCoord.xy / uEquirectSize)
    : normalize(vWorldDir);
  vec3 ro = vec3(0.0, uObserverR, 0.0);

  // Stable per-pixel blue-noise offset; when TAA is on the host rotates
  // uCloudJitter every frame so the temporal filter resolves extra steps.
  float bn = texture2D(uBlueNoise, gl_FragCoord.xy / uBlueNoiseSize).r;
  float jit = fract(bn + uCloudJitter);

  /*
   * Sky / sea split.
   *
   * The true horizon sits uHorizonDip radians *below* eye level (the geometric
   * dip sqrt(2h/R) of the observer's height). Both sides are built from the
   * same near-horizon sky sample and crossed over a band a few times wider than
   * one sky-view texel, which is what stops a one-pixel ridge appearing where
   * the two shading paths meet. Under water there is no horizon at all — the
   * water column is the far field in every direction — so the whole branch is
   * gated off.
   */
  float above = 1.0 - uUnderwater;
  float horizonY = -uHorizonDip;
  float seaW = above * smoothstep(horizonY + 0.0025, horizonY - 0.0075, rd.y);

  vec3 horizDir = normalize(vec3(rd.x, 0.0035, rd.z));
  vec3 horizSky = skyLuminance(horizDir);

  vec3 color = vec3(0.0);

  if (seaW < 0.998) {
    vec3 skyLum = skyLuminance(rd);
    float horizonLift = 1.0 - abs(rd.y);
    skyLum += uNightFloor * (0.45 + 0.55 * horizonLift * horizonLift * horizonLift);

    vec4 cl = cloudsMarch(ro, rd, uSunDir, uSunCloudRad, uAmbTop, uAmbBottom, horizSky, jit);

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
    // Aerial perspective: grazing sea is tens of kilometres away, so it washes
    // into the horizon band. Anchored on the same horizSky the sky side uses.
    float aer = exp(-max(0.0, horizonY - rd.y) * 30.0);
    sea = mix(sea, horizSky, aer * 0.94);
    color = mix(color, sea, seaW);
  }

  if (uUnderwater > 0.5) {
    /*
     * Snell's window, graded exactly the way WaterBackdrop grades the open
     * water column: distance runs to the surface for upward rays and to the
     * far-field cap otherwise, and the depth handed to applyUnderwater is the
     * world Y where the ray *ends*, not the eye's. Evaluating the identical
     * integral is what guarantees the dome and the backdrop cannot disagree
     * along the eye-level line and paint a seam there.
     */
    float camD = max(uwCameraDepth, 0.0);
    float dist = 480.0;
    if (rd.y > 1e-3) dist = min(480.0, camD / rd.y);
    float endY = uwSurfaceY - (camD - rd.y * dist);
    color = applyUnderwater(color, dist, endY, rd);
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
  /** Height of the lat-long panorama handed to the water system. */
  panoHeight: number;
}

export class SkyDome {
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  /** Scene holding a second mesh with the same material, for the cube probe. */
  readonly envScene = new THREE.Scene();
  /** Full-screen quad with the same material, for the lat-long panorama pass. */
  readonly panoScene = new THREE.Scene();
  readonly panoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  private readonly geometry: THREE.SphereGeometry;
  private readonly envMesh: THREE.Mesh;
  private readonly panoGeometry: THREE.PlaneGeometry;
  private readonly panoMesh: THREE.Mesh;
  private cloudSteps: number;
  private cloudLightSteps: number;
  private pixelAngle = 0.0013;
  private readonly envPixelAngle: number;
  private readonly panoPixelAngle: number;

  constructor(opts: SkyDomeOptions) {
    this.cloudSteps = opts.cloudSteps;
    this.cloudLightSteps = opts.cloudLightSteps;
    this.envPixelAngle = 2.0 / Math.max(8, opts.envCubeSize);
    this.panoPixelAngle = Math.PI / Math.max(16, opts.panoHeight);

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
        // Airglow + integrated starlight + zodiacal light: the reason a moonless
        // night sky is a deep navy you can read silhouettes against rather than
        // the pure black a single-scattering solar model returns.
        uNightFloor: { value: new THREE.Vector3(0.0085, 0.0125, 0.0235) },
        uSeaTint: { value: new THREE.Vector3(0.012, 0.045, 0.062) },
        uEnvPass: { value: 0 },
        uUnderwater: { value: 0 },
        uEyeY: { value: 0 },
        uLightning: { value: 0 },
        uEquirect: { value: 0 },
        uEquirectSize: { value: new THREE.Vector2(1, 1) },
        uHorizonDip: { value: 0.0009 },
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
        // The cloud phase function is 4pi-normalised (isotropic == 1), so this
        // gain is ~1/4pi of the old one; the deck brightness is unchanged away
        // from the sun and no longer explodes inside the forward lobe.
        uCloudSunGain: { value: 0.30 },
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

    // Panorama quad. The material is BackSide, so the plane is turned to face
    // away from the camera and we see its back — that way one material (and one
    // compiled program) serves the dome, the cube probe and the panorama.
    this.panoGeometry = new THREE.PlaneGeometry(2, 2);
    this.panoMesh = new THREE.Mesh(this.panoGeometry, this.material);
    this.panoMesh.rotation.y = Math.PI;
    this.panoMesh.frustumCulled = false;
    this.panoScene.add(this.panoMesh);
    this.panoCamera.position.set(0, 0, 1);
    this.panoCamera.lookAt(0, 0, 0);
    this.panoCamera.updateMatrixWorld();
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  /** Keeps the dome centred on the camera so it can never be walked out of. */
  follow(cameraPosition: THREE.Vector3): void {
    this.mesh.position.copy(cameraPosition);
    // Geometric horizon dip for the eye height, radians: sqrt(2h/R). Tiny at
    // swimming height, a couple of tenths of a degree from a cliff, but it is
    // what keeps the sky/sea crossover on the real horizon.
    const h = Math.max(0, cameraPosition.y);
    this.material.uniforms.uHorizonDip.value = Math.sqrt((2 * h) / 6371000) + 0.0006;
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

  /**
   * Switch the material into lat-long panorama mode. Unlike the env pass this
   * keeps the sun disc at full radiance, because the panorama is what the ocean
   * surface reflects and a sea with no sun glitter reads as plastic.
   */
  setPanoPass(on: boolean, width = 1, height = 1): void {
    const u = this.material.uniforms;
    if (on) {
      u.uEquirect.value = 1;
      (u.uEquirectSize.value as THREE.Vector2).set(width, height);
      u.uCloudSteps.value = Math.min(10, Math.max(4, this.cloudSteps >> 1));
      u.uCloudLightSteps.value = Math.max(2, this.cloudLightSteps - 1);
      u.uPixelAngle.value = this.panoPixelAngle;
      u.uUnderwater.value = 0;
    } else {
      u.uEquirect.value = 0;
      u.uCloudSteps.value = this.cloudSteps;
      u.uCloudLightSteps.value = this.cloudLightSteps;
      u.uPixelAngle.value = this.pixelAngle;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.panoGeometry.dispose();
    this.material.dispose();
    this.envScene.clear();
    this.panoScene.clear();
  }
}

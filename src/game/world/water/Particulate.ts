import * as THREE from 'three';
import { UNDERWATER_FUNCS_GLSL, UNDERWATER_UNIFORMS_GLSL } from './UnderwaterFog';

/**
 * Marine snow.
 *
 * Three nested layers of point sprites, each wrapped modulo its own cube around
 * the camera in the *vertex shader*, so the field is infinite, parallaxes
 * correctly and never needs a CPU update. Flakes drift on a per-particle
 * velocity, are lit by the sun through the downwelling column plus up to four
 * nearby lights, and are extinguished by the same Beer-Lambert transmittance as
 * everything else. The innermost layer sits 0.3-1.6 m from the eye and is drawn
 * as a soft out-of-focus mote, which is what gives an underwater frame its
 * sense of an actual medium in front of the lens.
 */

const MAX_LIGHTS = 4;

const VERT = /* glsl */ `
uniform vec3  uCamPos;
uniform float uVolume;        // cube edge in metres
uniform float uSize;          // sprite size in metres
uniform float uPixelScale;    // 0.5 * viewportHeight / tan(fov/2)
uniform float uMaxPixels;
uniform float uNearFade;
uniform float uAmount;
uniform float uDrift;
uniform int   uLightCount;
uniform vec3  uLightPos[${MAX_LIGHTS}];
uniform vec3  uLightColor[${MAX_LIGHTS}];

attribute vec3 aVel;
attribute vec4 aParam;        // size, shapeSeed, flickerPhase, spin

varying vec3  vLit;
varying float vAlpha;
varying float vSeed;
varying float vSpin;

${UNDERWATER_UNIFORMS_GLSL}
${UNDERWATER_FUNCS_GLSL}

void main() {
  // Infinite wrapped field: never repeats visibly because the wrap happens at
  // the volume boundary where alpha is already zero.
  vec3 p = position + aVel * (uwTime * uDrift);
  vec3 rel = mod(p - uCamPos + uVolume * 0.5, uVolume) - uVolume * 0.5;
  vec3 wp = uCamPos + rel;

  float dist = length(rel);
  float depth = uwSurfaceY - wp.y;

  vec3 toEye = -rel / max(dist, 1e-3);
  vec3 sunDir = normalize(uwSunDir);
  float hg = waterPhaseHG(dot(-toEye, sunDir), 0.35);
  vec3 down = waterDownwelling(max(depth, 0.0));

  // Ambient term: the radiance of the water the flake is floating in, evaluated
  // with the same integral the rest of the frame uses. A flake is a diffuse
  // scatterer surrounded by glowing medium, so its base radiance IS the medium's
  // — a flake lit from some independent budget comes out darker than the haze
  // behind it and the whole field reads as black pepper rather than marine snow.
  vec3 medium = applyUnderwater(vec3(0.0), 400.0, wp.y, -toEye);
  vec3 lit = medium * 1.06;
  // Forward-scattered sunlight: the reason a flake sparkles when the sun is
  // behind it.
  lit += uwSunColor * down * (6.0 * hg) * smoothstep(-0.05, 0.15, sunDir.y);

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 d = uLightPos[i] - wp;
    float att = 1.0 / (1.0 + dot(d, d) * 0.18);
    lit += uLightColor[i] * att;
  }
  // Full scattering, not just extinction. A flake alpha-blends over water that
  // already carries the inscatter for the whole path, so attenuating the flake
  // without adding that inscatter back makes every distant flake *darker* than
  // the medium it floats in — which is why round 1 has black pepper sprinkled
  // across the deeper frames instead of marine snow.
  lit = applyUnderwater(lit, dist, wp.y, -toEye);

  // Slow twinkle: flakes tumble and catch the light.
  float tw = 0.55 + 0.45 * sin(uwTime * 1.7 + aParam.z * 6.2831);
  vLit = lit * tw;

  // Fade at the volume shell and right in front of the lens.
  float shell = 1.0 - smoothstep(uVolume * 0.32, uVolume * 0.5, dist);
  float near = smoothstep(uNearFade * 0.35, uNearFade, dist);
  float belowSurface = smoothstep(0.0, 1.5, depth);
  vAlpha = shell * near * uAmount * belowSurface;
  vSeed = aParam.y;
  vSpin = aParam.w;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * aParam.x * uPixelScale / max(dist, 0.05), 1.0, uMaxPixels);
}
`;

const FRAG = /* glsl */ `
uniform float uBokeh;

varying vec3  vLit;
varying float vAlpha;
varying float vSeed;
varying float vSpin;

void main() {
  if (vAlpha <= 0.002) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  float ang = atan(c.y, c.x) + vSpin;

  // Irregular flake outline — no two flakes are the same disc.
  float wob = 0.46
    + 0.10 * sin(ang * 3.0 + vSeed * 21.7)
    + 0.06 * sin(ang * 5.0 - vSeed * 37.1)
    + 0.04 * sin(ang * 8.0 + vSeed * 11.3);

  // Sharp flake, or a soft defocused mote for the near layer.
  float sharp = smoothstep(wob, wob * 0.35, r);
  float soft = smoothstep(0.5, 0.02, r) * (0.55 + 0.45 * smoothstep(0.5, 0.34, r));
  float a = mix(sharp, soft * 0.55, uBokeh);

  gl_FragColor = vec4(vLit, a * vAlpha);
}
`;

interface LayerSpec {
  count: number;
  volume: number;
  size: number;
  maxPixels: number;
  nearFade: number;
  bokeh: number;
  drift: number;
}

const LAYERS: LayerSpec[] = [
  { count: 4200, volume: 64, size: 0.05, maxPixels: 18, nearFade: 2.2, bokeh: 0, drift: 1 },
  { count: 2200, volume: 18, size: 0.035, maxPixels: 34, nearFade: 0.9, bokeh: 0, drift: 1.1 },
  { count: 150, volume: 3.4, size: 0.06, maxPixels: 190, nearFade: 0.32, bokeh: 1, drift: 0.6 },
];

export class Particulate {
  readonly group = new THREE.Group();
  private layers: Array<{ points: THREE.Points; mat: THREE.ShaderMaterial; geo: THREE.BufferGeometry }> = [];
  private lightPos: THREE.Vector3[] = [];
  private lightColor: THREE.Color[] = [];

  constructor(shared: Record<string, THREE.IUniform>, density: number, seed = 1337) {
    this.group.name = 'water.particulate';
    this.group.renderOrder = 2;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      this.lightPos.push(new THREE.Vector3());
      this.lightColor.push(new THREE.Color(0, 0, 0));
    }

    let rndState = seed >>> 0;
    const rnd = () => {
      rndState = (Math.imul(rndState ^ (rndState >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
      return (rndState >>> 8) / 16777216;
    };

    for (const spec of LAYERS) {
      const n = Math.max(16, Math.round(spec.count * density));
      const pos = new Float32Array(n * 3);
      const vel = new Float32Array(n * 3);
      const par = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (rnd() - 0.5) * spec.volume;
        pos[i * 3 + 1] = (rnd() - 0.5) * spec.volume;
        pos[i * 3 + 2] = (rnd() - 0.5) * spec.volume;
        // Mostly-sinking drift with a lateral wander; magnitudes in m/s.
        vel[i * 3] = (rnd() - 0.5) * 0.06;
        vel[i * 3 + 1] = -0.012 - rnd() * 0.03;
        vel[i * 3 + 2] = (rnd() - 0.5) * 0.06;
        // Heavy-tailed size distribution: lots of dust, a few big flakes.
        par[i * 4] = 0.35 + Math.pow(rnd(), 2.4) * 2.6;
        par[i * 4 + 1] = rnd();
        par[i * 4 + 2] = rnd();
        par[i * 4 + 3] = rnd() * 6.2831;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
      geo.setAttribute('aParam', new THREE.BufferAttribute(par, 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), spec.volume);

      const own: Record<string, THREE.IUniform> = {
        uCamPos: { value: new THREE.Vector3() },
        uVolume: { value: spec.volume },
        uSize: { value: spec.size },
        uPixelScale: { value: 540 },
        uMaxPixels: { value: spec.maxPixels },
        uNearFade: { value: spec.nearFade },
        uAmount: { value: 1 },
        uDrift: { value: spec.drift },
        uBokeh: { value: spec.bokeh },
        uLightCount: { value: 0 },
        uLightPos: { value: this.lightPos },
        uLightColor: { value: this.lightColor },
      };

      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign(own, shared),
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
      });

      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.renderOrder = 2;
      this.layers.push({ points, mat, geo });
      this.group.add(points);
    }
  }

  /**
   * @param amount 0..1 global visibility (0 above water)
   * @param pixelScale 0.5 * drawingBufferHeight / tan(fov/2)
   */
  update(camera: THREE.Camera, amount: number, pixelScale: number, turbidity: number): void {
    const visible = amount > 0.004;
    this.group.visible = visible;
    if (!visible) return;
    for (const l of this.layers) {
      const u = l.mat.uniforms;
      (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
      u.uPixelScale.value = pixelScale;
      u.uAmount.value = amount * THREE.MathUtils.clamp(turbidity, 0.25, 2);
    }
  }

  /** Feeds up to four nearby lights so motes catch a flashlight or a flare. */
  setLights(lights: Array<{ position: THREE.Vector3; color: THREE.Color; intensity: number }>): void {
    const n = Math.min(MAX_LIGHTS, lights.length);
    for (let i = 0; i < n; i++) {
      this.lightPos[i].copy(lights[i].position);
      this.lightColor[i].copy(lights[i].color).multiplyScalar(lights[i].intensity * 0.35);
    }
    for (const l of this.layers) l.mat.uniforms.uLightCount.value = n;
  }

  dispose(): void {
    for (const l of this.layers) {
      l.geo.dispose();
      l.mat.dispose();
    }
    this.layers.length = 0;
  }
}

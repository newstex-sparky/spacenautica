import * as THREE from 'three';
import { NOISE_GLSL } from '../../core/Noise';
import { ScreenGrab } from './ScreenGrab';

/**
 * The moment you break the surface.
 *
 * A full-screen quad that draws *last*, grabs the finished frame and re-presents
 * it with:
 *  - water still running on the lens: procedural droplets with derivative-based
 *    lens normals that genuinely refract the grabbed frame, plus a sheeting film
 *    that drains from the top of the view;
 *  - an exposure/colour shift on `water:transition` — the punch of bright air
 *    when you surface, the cold clamp when you go under.
 *
 * It costs one framebuffer copy while active and nothing at all when it is not
 * (the object hides itself).
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uGrab;
uniform float uUse;
uniform float uTime;
uniform float uWet;        // droplet/film coverage 0..1
uniform float uGrade;      // grade strength 0..1
uniform float uExposure;
uniform vec3  uTint;
uniform float uDesat;
uniform float uAspect;
uniform float uBlur;

varying vec2 vUv;

${NOISE_GLSL}

vec3 grab(vec2 uv) {
  return texture2D(uGrab, clamp(uv, vec2(0.0015), vec2(0.9985))).rgb;
}

void main() {
  if (uUse < 0.5) { gl_FragColor = vec4(0.0); return; }

  // --- droplets -------------------------------------------------------
  vec2 duv = vec2(vUv.x * uAspect, vUv.y) * 8.5;
  // Columns trickle downward at slightly different speeds.
  duv.y += uTime * 0.10;
  vec3 vo = voronoi(duv);
  float radius = 0.30 + 0.34 * fract(vo.z * 7.31);
  float d = vo.x / radius;
  float mask = 1.0 - smoothstep(0.72, 1.0, d);
  float dome = sqrt(max(0.0, 1.0 - d * d)) * mask;
  // Lens normal straight from the screen-space derivative of the dome.
  vec2 n = vec2(dFdx(dome), dFdy(dome)) * 38.0;

  // A second, finer spray layer.
  vec3 vo2 = voronoi(duv * 3.1 + 11.7);
  float d2 = vo2.x / 0.26;
  float mask2 = 1.0 - smoothstep(0.6, 1.0, d2);
  float dome2 = sqrt(max(0.0, 1.0 - d2 * d2)) * mask2;
  n += vec2(dFdx(dome2), dFdy(dome2)) * 16.0;

  // Sheeting film draining from the top of the view.
  float film = smoothstep(0.35, 1.0, vUv.y) * smoothstep(0.55, 0.95, uWet);
  float wetMask = clamp(max(mask * 0.95 + mask2 * 0.5, film * 0.8), 0.0, 1.0) * uWet;

  vec2 refracted = vUv - n * 0.028 * uWet;
  vec3 col = grab(refracted);

  // Cheap defocus behind the water film so it reads as a wet lens.
  if (uBlur > 0.001) {
    vec3 b = col;
    b += grab(refracted + vec2(0.0035, 0.0011) * uBlur);
    b += grab(refracted - vec2(0.0031, 0.0022) * uBlur);
    b += grab(refracted + vec2(-0.0018, 0.0034) * uBlur);
    col = mix(col, b * 0.25, clamp(wetMask * 1.3, 0.0, 1.0));
  }

  // Droplet rim catches the light.
  col += vec3(0.9, 0.95, 1.0) * pow(mask, 4.0) * 0.10 * uWet;

  // --- grade ----------------------------------------------------------
  vec3 graded = col * uExposure;
  float lum = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  graded = mix(graded, vec3(lum), uDesat) * uTint;
  col = mix(col, graded, clamp(uGrade, 0.0, 1.0));

  float alpha = clamp(max(uGrade, wetMask), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

export class SurfaceOverlay {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private grab = new ScreenGrab();
  /** Droplet coverage; 1 right after surfacing, decays to 0. */
  private wet = 0;
  /** Grade envelope; driven by `water:transition`. */
  private grade = 0;
  private targetExposure = 1;
  private tint = new THREE.Color(1, 1, 1);

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uGrab: { value: this.grab.texture },
        uUse: { value: 0 },
        uTime: { value: 0 },
        uWet: { value: 0 },
        uGrade: { value: 0 },
        uExposure: { value: 1 },
        uTint: { value: this.tint },
        uDesat: { value: 0 },
        uAspect: { value: 1.777 },
        uBlur: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.name = 'water.overlay';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (renderer) => {
      this.mat.uniforms.uGrab.value = this.grab.texture;
      this.mat.uniforms.uUse.value = this.grab.capture(renderer);
    };
  }

  /** Called on every `water:transition`. */
  trigger(underwater: boolean): void {
    if (underwater) {
      // Going under: brief cold clamp, a wash of water across the lens.
      this.grade = 1;
      this.wet = 0.55;
      this.targetExposure = 0.72;
      this.tint.setRGB(0.72, 0.98, 1.06);
    } else {
      // Surfacing: air is much brighter, and the lens is soaked.
      this.grade = 1;
      this.wet = 1;
      this.targetExposure = 1.45;
      this.tint.setRGB(1.05, 1.0, 0.97);
    }
  }

  update(dt: number, time: number, aspect: number): void {
    // Droplets linger ~2.4 s, the grade recovers in ~0.9 s.
    this.wet = Math.max(0, this.wet - dt / 2.4);
    this.grade = Math.max(0, this.grade - dt / 0.9);

    const u = this.mat.uniforms;
    const active = this.wet > 0.004 || this.grade > 0.004;
    this.mesh.visible = active && this.grab.available;
    if (!active) return;

    const ease = this.grade * this.grade;
    u.uTime.value = time;
    u.uWet.value = this.wet;
    u.uGrade.value = ease;
    u.uExposure.value = 1 + (this.targetExposure - 1) * ease;
    u.uDesat.value = 0.22 * ease;
    u.uAspect.value = aspect;
    u.uBlur.value = this.wet;
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.geometry.dispose();
    this.grab.dispose();
  }
}

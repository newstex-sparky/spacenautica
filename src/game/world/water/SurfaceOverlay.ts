import * as THREE from 'three';
import { WATER_NOISE_GLSL } from './WaterNoise';
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
 *
 * Three rules earn their keep here, because round 1 broke all three and buried a
 * frame at 41 m under dozens of 100 px soap bubbles:
 *
 *  1. Droplets belong to *air*. Diving under does not put water on the lens — it
 *     puts the lens in water. Only the surfacing transition arms them.
 *  2. Even armed, they are hard-gated by depth (`setDepth`). No sequence of
 *     mistimed events, tier rebuilds or teleports can leave beads on the lens
 *     while submerged, because being submerged alone forces the coverage to zero.
 *  3. Droplet radius is in *lens* units — a fixed angular size independent of
 *     resolution and aspect — and the field is sparse, because most of a wet lens
 *     is clear glass with a few beads on it.
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

${WATER_NOISE_GLSL}

vec3 grab(vec2 uv) {
  return texture2D(uGrab, clamp(uv, vec2(0.0015), vec2(0.9985))).rgb;
}

/**
 * One layer of beads. 'cells' is cells across the *height* of the view, so a
 * droplet subtends the same angle at any resolution or aspect ratio. 'keep' is
 * the fraction of cells that actually hold a bead — a wet lens is mostly clear
 * glass. Beads elongate downward and slide, because gravity exists.
 */
float beads(vec2 uv, float cells, float keep, float rad, float slide, out float rim) {
  // Aspect-correct cell grid: square cells, counted across the height.
  vec2 p = vec2(uv.x * uAspect, uv.y) * cells;
  vec3 vo = wnVoronoi(p + vec2(0.0, uTime * slide));
  float id = fract(vo.z * 7.31 + 0.137);
  rim = 0.0;
  // Sparse: most cells are empty.
  if (id > keep) return 0.0;
  float r = rad * (0.45 + 0.85 * fract(id * 43.17));
  float d = vo.x / max(r, 1e-3);
  float mask = 1.0 - smoothstep(0.80, 1.0, d);
  rim = pow(mask, 5.0);
  return sqrt(max(0.0, 1.0 - d * d)) * mask;
}

void main() {
  if (uUse < 0.5 || (uWet < 0.004 && uGrade < 0.004)) { gl_FragColor = vec4(0.0); return; }

  // --- droplets -------------------------------------------------------
  // 26 cells across the height at ~0.5 cell radius => beads of roughly 1/50th of
  // the view height. On a 720p frame that is a 14 px bead, not a 100 px bubble.
  float rimA;
  float rimB;
  float domeA = beads(vUv, 26.0, 0.16, 0.52, 0.055, rimA);
  float domeB = beads(vUv * 1.0 + vec2(7.31, 3.17), 58.0, 0.11, 0.44, 0.020, rimB);

  // Gravity streak: a short tail smeared upward from each bead, so beads read as
  // sliding rather than pasted on.
  float tail = 0.0;
  for (int i = 1; i <= 3; i++) {
    float t = float(i) / 3.0;
    float rt;
    tail += beads(vUv + vec2(0.0, t * 0.022), 26.0, 0.30, 0.52, 0.055, rt) * (1.0 - t) * 0.34;
  }

  float dome = domeA + domeB * 0.55 + tail;
  // Lens normal straight from the screen-space derivative of the dome. Scaled by
  // cell count so the refraction strength does not change with droplet size.
  vec2 n = vec2(dFdx(dome), dFdy(dome)) * 26.0;

  // Sheeting film draining from the top of the view, only in the first instant.
  float film = smoothstep(0.55, 1.0, vUv.y) * smoothstep(0.72, 1.0, uWet);
  float beadMask = clamp(domeA * 1.6 + domeB * 0.9 + tail, 0.0, 1.0);
  float wetMask = clamp(max(beadMask, film * 0.55), 0.0, 1.0) * uWet;

  vec2 refracted = vUv - n * 0.055 * uWet;
  vec3 col = grab(refracted);

  // Defocus *behind the water only*: a bead is a tiny strong lens, so what you
  // see through it is a smeared, magnified fragment of the scene.
  if (uBlur > 0.001) {
    vec3 b = col;
    b += grab(refracted + vec2(0.0035, 0.0011) * uBlur);
    b += grab(refracted - vec2(0.0031, 0.0022) * uBlur);
    b += grab(refracted + vec2(-0.0018, 0.0034) * uBlur);
    col = mix(col, b * 0.25, clamp(wetMask * 1.15, 0.0, 1.0));
  }

  // Bead rims catch a specular highlight.
  col += vec3(0.9, 0.95, 1.0) * (rimA + rimB * 0.6) * 0.09 * uWet;

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

  /** Metres below the surface, fed every frame; hard-gates the droplets. */
  private depth = 0;
  /** Which direction the live grade came from; decides whether depth gates it. */
  private surfacing = false;

  /** Called on every `water:transition`. */
  trigger(underwater: boolean): void {
    this.surfacing = !underwater;
    if (underwater) {
      // Going under: a brief cold clamp on exposure and colour, and nothing on
      // the lens. There is no such thing as a droplet on a submerged lens.
      this.grade = 1;
      this.wet = 0;
      this.targetExposure = 0.78;
      this.tint.setRGB(0.78, 0.99, 1.05);
    } else {
      // Surfacing: air is brighter, and the lens is soaked.
      this.grade = 1;
      this.wet = 1;
      this.targetExposure = 1.28;
      this.tint.setRGB(1.04, 1.0, 0.98);
    }
  }

  /** Current camera depth in metres (0 above water). */
  setDepth(depth: number): void {
    this.depth = Math.max(0, depth);
  }

  update(dt: number, time: number, aspect: number): void {
    // Droplets linger ~2.0 s, the grade recovers in ~0.9 s.
    this.wet = Math.max(0, this.wet - dt / 2.0);
    this.grade = Math.max(0, this.grade - dt / 0.9);

    // The gate. Submerged deeper than a head's height, the lens is *in* water,
    // not wet — coverage is forced to zero regardless of what armed it. This is
    // deliberately not a decay: it is unconditional, so no ordering or timing
    // mistake anywhere else can put beads on a 40 m frame.
    //
    // The *surfacing* grade is gated the same way, and for the same reason. It is
    // a full-screen exposure lift plus a desaturation, so a stray surfacing event
    // while submerged does not merely tint the frame — it washes the water out to
    // pale mint and lifts red, which is the one channel depth-graded water must
    // not have. (Going under is not gated: a cold clamp is legitimate at depth.)
    const air = 1 - THREE.MathUtils.smoothstep(this.depth, 0.15, 0.6);
    const wet = this.wet * air;
    const grade = this.grade * (this.surfacing ? air : 1);

    const u = this.mat.uniforms;
    const active = wet > 0.004 || grade > 0.004;
    this.mesh.visible = active && this.grab.available;
    if (!active) return;

    const ease = grade * grade;
    u.uTime.value = time;
    u.uWet.value = wet;
    u.uGrade.value = ease;
    u.uExposure.value = 1 + (this.targetExposure - 1) * ease;
    u.uDesat.value = 0.22 * ease;
    u.uAspect.value = Math.max(0.2, aspect);
    u.uBlur.value = wet;
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.geometry.dispose();
    this.grab.dispose();
  }
}

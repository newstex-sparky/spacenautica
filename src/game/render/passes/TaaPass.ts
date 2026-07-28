import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { CATMULL_ROM_GLSL, FULLSCREEN_VERT, POST_COMMON } from '../shaders/Common';

/**
 * Temporal anti-aliasing.
 *
 * - Halton(2,3) sub-pixel jitter is applied to the projection matrix by
 *   `PostStack` before the prepass and the scene render, so depth, normals and
 *   colour all agree.
 * - History is fetched with a 5-tap Catmull-Rom filter, not bilinear, so
 *   reprojection does not soften the frame a little more every frame.
 * - History is clipped to the current 3x3 neighbourhood as a YCoCg AABB (variance
 *   clipping, not clamping) which removes ghosting while keeping the sub-pixel
 *   detail that plain clamping destroys.
 * - Motion vectors are dilated by closest depth so silhouettes reproject with the
 *   foreground surface, and confidence collapses on disocclusion, off-screen
 *   history and large motion.
 */

const TAA_FRAG = /* glsl */ `
${POST_COMMON}
${CATMULL_ROM_GLSL}
varying vec2 vUv;

uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tVelocity;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uFeedback;
uniform float uValid;
uniform float uClipScale;
uniform float uSharpen;

vec3 fetch(vec2 uv) {
  return max(vec3(0.0), texture2D(tCurrent, uv).rgb);
}

void main() {
  vec3 centre = fetch(vUv);

  // --- neighbourhood statistics in YCoCg ---
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  vec3 nmin = vec3(1e9);
  vec3 nmax = vec3(-1e9);
  vec3 boxSum = vec3(0.0);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * uTexel;
      vec3 s = fetch(vUv + o);
      boxSum += s;
      vec3 yc = rgb2ycocg(s);
      m1 += yc;
      m2 += yc * yc;
      nmin = min(nmin, yc);
      nmax = max(nmax, yc);
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(vec3(0.0), m2 / 9.0 - mean * mean));
  vec3 lo = max(nmin, mean - sigma * uClipScale);
  vec3 hi = min(nmax, mean + sigma * uClipScale);

  // --- dilate motion vectors toward the closest surface in the neighbourhood ---
  float bestDepth = 1e9;
  vec2 bestUv = vUv;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
      float z = texture2D(tDepth, uv).x;
      if (z < bestDepth) { bestDepth = z; bestUv = uv; }
    }
  }
  vec2 vel = texture2D(tVelocity, bestUv).xy;
  vec2 hUv = vUv - vel;

  float onScreen = (hUv.x > 0.0 && hUv.x < 1.0 && hUv.y > 0.0 && hUv.y < 1.0) ? 1.0 : 0.0;

  vec3 hist = max(vec3(0.0), sampleCatmullRom(tHistory, hUv, uResolution).rgb);
  vec3 histYc = rgb2ycocg(hist);

  // --- AABB clipping: move the history point toward the mean until it is inside
  //     the neighbourhood box, preserving direction (Karis / Salvi).
  vec3 centreYc = (lo + hi) * 0.5;
  vec3 extent = max((hi - lo) * 0.5, vec3(1e-5));
  vec3 offset = histYc - centreYc;
  vec3 unit = offset / extent;
  float maxUnit = max(abs(unit.x), max(abs(unit.y), abs(unit.z)));
  vec3 clipped = maxUnit > 1.0 ? centreYc + offset / maxUnit : histYc;

  // --- confidence ---
  float speedPx = length(vel / uTexel);
  float motionReject = mix(1.0, 0.72, sat(speedPx / 24.0));
  // Disocclusion: a depth discontinuity between where we sampled and where we are.
  float zNow = depthMetres(texture2D(tDepth, vUv).x, uNear, uFar);
  float zWas = depthMetres(texture2D(tDepth, hUv).x, uNear, uFar);
  float zReject = exp2(-abs(zNow - zWas) / max(0.06 * zNow, 0.02));

  float k = uFeedback * uValid * onScreen * motionReject * mix(0.55, 1.0, zReject);

  vec3 resolved = ycocg2rgb(mix(rgb2ycocg(centre), clipped, k));

  // Light unsharp mask against the box mean: recovers the micro-contrast that
  // temporal accumulation shaves off sand grain and rock pores.
  vec3 boxMean = boxSum / 9.0;
  resolved += (resolved - boxMean) * uSharpen * k;

  gl_FragColor = vec4(max(vec3(0.0), resolved), 1.0);
}
`;

/** Halton(2,3) low-discrepancy sequence, in [-0.5, 0.5]. */
export function haltonJitter(index: number, out: THREE.Vector2): THREE.Vector2 {
  out.set(radicalInverse(index, 2) - 0.5, radicalInverse(index, 3) - 0.5);
  return out;
}

function radicalInverse(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

export class TaaPass extends PostPass {
  readonly id = 'taa';

  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private index = 0;
  private readonly material: THREE.ShaderMaterial;
  private valid = false;

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.history = [
      makeTarget(width, height, { name: 'post.taaA' }),
      makeTarget(width, height, { name: 'post.taaB' }),
    ];

    this.material = new THREE.ShaderMaterial({
      name: 'post/taa',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: TAA_FRAG,
      uniforms: {
        tCurrent: { value: null },
        tHistory: { value: null },
        tVelocity: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uResolution: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uFeedback: { value: 0.9 },
        uValid: { value: 0 },
        uClipScale: { value: 1.25 },
        uSharpen: { value: 0.35 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
  }

  /** Number of samples in the jitter cycle; 8 is enough at 60 fps. */
  get sampleCount(): number {
    return 8;
  }

  invalidate(): void {
    this.valid = false;
  }

  override setSize(width: number, height: number): void {
    this.history[0].setSize(width, height);
    this.history[1].setSize(width, height);
    this.valid = false;
  }

  override configure(frame: FrameContext): void {
    this.enabled = frame.settings.taa && frame.prepassValid;
    if (!this.enabled) this.valid = false;
  }

  protected execute(frame: FrameContext): void {
    const dst = this.history[this.index];
    const src = this.history[1 - this.index];

    const u = this.material.uniforms;
    u.tCurrent.value = frame.color;
    u.tHistory.value = src.texture;
    u.tVelocity.value = frame.velocity;
    u.tDepth.value = frame.depth;
    (u.uTexel.value as THREE.Vector2).set(1 / frame.width, 1 / frame.height);
    (u.uResolution.value as THREE.Vector2).set(frame.width, frame.height);
    u.uNear.value = frame.near;
    u.uFar.value = frame.far;
    u.uValid.value = this.valid && frame.historyValid ? 1 : 0;
    // A tighter clip box on ultra (more slices of jitter resolve reliably).
    u.uClipScale.value = frame.settings.tier === 'ultra' ? 1.1 : 1.35;
    u.uFeedback.value = frame.settings.tier === 'ultra' ? 0.93 : 0.88;

    frame.blit.draw(frame.renderer, this.material, dst);

    this.index = 1 - this.index;
    this.valid = true;
    frame.color = dst.texture;
  }

  override dispose(): void {
    this.history[0].dispose();
    this.history[1].dispose();
    this.material.dispose();
  }
}

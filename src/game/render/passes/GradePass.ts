import * as THREE from 'three';
import { PostPass } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, MATH_GLSL, SRGB_GLSL, TONEMAP_GLSL } from '../shaders/Common';
import { buildUnderwaterLuts, selectBands } from '../LutFactory';
import type { LutBand } from '../LutFactory';

/**
 * The single output stage. Everything upstream is linear half float; this is the
 * only place a transfer function is applied, and it happens exactly once.
 *
 * Order (deliberately): screen shake / chromatic aberration on the *sample* uv →
 * exposure → lens vignette (still linear, so it cannot clip) → AgX or ACES
 * tonemap → lift/gamma/gain → sRGB encode → depth-banded 3D LUT → film grain →
 * ordered dither → out.
 */

const GRADE_FRAG = /* glsl */ `
${MATH_GLSL}
${TONEMAP_GLSL}
${SRGB_GLSL}
varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tExposure;
uniform sampler2D tNoise;
uniform sampler3D uLutA;
uniform sampler3D uLutB;

uniform vec2 uResolution;
uniform vec2 uNoiseScale;
uniform vec2 uNoiseOffset;
uniform vec2 uShakeOffset;
uniform float uShakeRotation;
uniform float uShakeZoom;

uniform float uExposureScale;
uniform float uChromatic;
uniform float uVignette;
uniform float uGrain;
uniform float uLutMix;
uniform float uLutSize;
uniform float uLutAmount;
uniform float uTonemapMode;   // 0 = AgX, 1 = ACES
uniform float uSaturation;
uniform float uPunch;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uEdgeTint;

vec3 sampleLut(sampler3D lut, vec3 c) {
  vec3 uvw = (clamp(c, 0.0, 1.0) * (uLutSize - 1.0) + 0.5) / uLutSize;
  return texture(lut, uvw).rgb;
}

void main() {
  // --- screen shake: a real image-space displacement, plus a hair of roll and a
  //     zoom so the rotated frame never samples outside the buffer.
  vec2 p = vUv - 0.5;
  float cs = cos(uShakeRotation);
  float sn = sin(uShakeRotation);
  p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y) * uShakeZoom;
  vec2 baseUv = clamp(p + 0.5 + uShakeOffset, vec2(0.0005), vec2(0.9995));

  vec2 q = baseUv - 0.5;
  float r2 = dot(q, q);

  // --- chromatic aberration: transverse, so it grows with radius. Sampled on the
  //     linear buffer, before exposure, which keeps it achromatic in the centre.
  vec3 color;
  if (uChromatic > 0.0005) {
    vec2 dir = q * (uChromatic * 0.008) * r2;
    color.r = texture2D(tColor, clamp(baseUv - dir, vec2(0.0), vec2(1.0))).r;
    color.g = texture2D(tColor, baseUv).g;
    color.b = texture2D(tColor, clamp(baseUv + dir, vec2(0.0), vec2(1.0))).b;
  } else {
    color = texture2D(tColor, baseUv).rgb;
  }
  color = max(color, vec3(0.0));

  // --- exposure ---
  float exposure = max(texture2D(tExposure, vec2(0.5)).r, 1e-4) * uExposureScale;
  color *= exposure;

  // --- lens vignette (natural falloff), tinted toward the water at the edges ---
  float vig = pow(sat(1.0 - r2 * 1.35), 1.6);
  vig = mix(1.0, vig, uVignette);
  color *= mix(uEdgeTint, vec3(1.0), vig);
  color *= vig;

  // --- tonemap: scene referred -> linear display referred ---
  vec3 display = uTonemapMode < 0.5
    ? tonemapAgX(color, uSaturation, uPunch)
    : tonemapACES(color * 1.05);

  // --- lift / gamma / gain, ASC-CDL style ---
  display = display * uGain + uLift * (1.0 - display);
  display = pow(max(display, vec3(0.0)), uGamma);

  // --- the one and only transfer function ---
  vec3 out_ = srgbOETF(display);

  // --- depth-banded LUT, applied in display space like a .cube file ---
  vec3 graded = mix(sampleLut(uLutA, out_), sampleLut(uLutB, out_), uLutMix);
  out_ = mix(out_, graded, uLutAmount);

  // --- film grain: blue noise, luminance weighted so highlights stay clean.
  //     The pattern only advances every few frames, so it reads as emulsion
  //     rather than the fizzing that per-frame white noise gives.
  float n = texture2D(tNoise, baseUv * uNoiseScale + uNoiseOffset).r - 0.5;
  float l = luma(out_);
  float grainW = uGrain * (0.35 + 0.65 * (1.0 - l)) * (0.25 + 0.75 * sat(l * 6.0));
  out_ += n * grainW;

  // --- ordered dither against 8-bit banding in the deep-water gradients ---
  float d = texture2D(tNoise, baseUv * uNoiseScale * 1.37 + uNoiseOffset.yx).g - 0.5;
  out_ += d * (1.0 / 255.0);

  gl_FragColor = vec4(clamp(out_, 0.0, 1.0), 1.0);
}
`;

export class GradePass extends PostPass {
  readonly id = 'grade';

  private readonly material: THREE.ShaderMaterial;
  private luts: LutBand[];
  private lutSize: number;

  /** 'agx' is the default look; 'aces' is available for comparison. */
  tonemap: 'agx' | 'aces' = 'agx';
  exposureScale = 1;
  lutAmount = 0.9;

  private shakeAmount = 0;
  private shakeTime = 0;
  private shakeDuration = 1;
  private shakeSeed = 0;
  private readonly shakeOffset = new THREE.Vector2();

  constructor(frame: FrameContext, lutSize = 32) {
    super(frame);
    this.lutSize = lutSize;
    this.luts = buildUnderwaterLuts(lutSize);

    this.material = new THREE.ShaderMaterial({
      name: 'post/grade',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GRADE_FRAG,
      uniforms: {
        tColor: { value: null },
        tExposure: { value: null },
        tNoise: { value: null },
        uLutA: { value: this.luts[0].texture },
        uLutB: { value: this.luts[1].texture },
        uResolution: { value: new THREE.Vector2() },
        uNoiseScale: { value: new THREE.Vector2(1, 1) },
        uNoiseOffset: { value: new THREE.Vector2() },
        uShakeOffset: { value: new THREE.Vector2() },
        uShakeRotation: { value: 0 },
        uShakeZoom: { value: 1 },
        uExposureScale: { value: 1 },
        uChromatic: { value: 0.35 },
        uVignette: { value: 0.75 },
        uGrain: { value: 0.02 },
        uLutMix: { value: 0 },
        uLutSize: { value: lutSize },
        uLutAmount: { value: this.lutAmount },
        uTonemapMode: { value: 0 },
        uSaturation: { value: 1.1 },
        uPunch: { value: 1.12 },
        uLift: { value: new THREE.Vector3(0, 0, 0) },
        uGamma: { value: new THREE.Vector3(1, 1, 1) },
        uGain: { value: new THREE.Vector3(1, 1, 1) },
        uEdgeTint: { value: new THREE.Color(0.32, 0.62, 0.72) },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
  }

  /** Image-space kick. Amount is in fractions of the screen height. */
  addScreenShake(amount: number, duration: number): void {
    if (amount <= 0 || duration <= 0) return;
    if (amount >= this.shakeAmount || this.shakeTime <= 0) {
      this.shakeSeed = Math.random() * 1000;
    }
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
  }

  get shaking(): boolean {
    return this.shakeTime > 0;
  }

  /** Rebuilds the LUT cubes at a different resolution (tier change). */
  setLutSize(size: number): void {
    if (size === this.lutSize) return;
    for (const b of this.luts) b.texture.dispose();
    this.lutSize = size;
    this.luts = buildUnderwaterLuts(size);
    this.material.uniforms.uLutSize.value = size;
  }

  override configure(_frame: FrameContext): void {
    this.enabled = true;
  }

  protected execute(frame: FrameContext): void {
    const u = this.material.uniforms;
    const g = frame.settings;

    // --- shake decay: sharp attack, exponential-ish release, damped sine ---
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - frame.dt);
      const t = this.shakeTime / Math.max(this.shakeDuration, 1e-3);
      const env = t * t * this.shakeAmount;
      const time = frame.time * 41 + this.shakeSeed;
      this.shakeOffset.set(
        Math.sin(time * 1.7) * 0.62 + Math.sin(time * 3.9) * 0.38,
        Math.cos(time * 2.3) * 0.58 + Math.cos(time * 5.1) * 0.42,
      );
      this.shakeOffset.multiplyScalar(env * 0.035);
      (u.uShakeOffset.value as THREE.Vector2).copy(this.shakeOffset);
      u.uShakeRotation.value = Math.sin(time * 1.31) * env * 0.012;
      u.uShakeZoom.value = 1 - env * 0.02;
      if (this.shakeTime <= 0) {
        this.shakeAmount = 0;
        this.shakeDuration = 1;
      }
    } else {
      (u.uShakeOffset.value as THREE.Vector2).set(0, 0);
      u.uShakeRotation.value = 0;
      u.uShakeZoom.value = 1;
    }

    u.tColor.value = frame.color;
    u.tExposure.value = frame.exposure;
    u.tNoise.value = frame.noise;
    (u.uResolution.value as THREE.Vector2).set(frame.width, frame.height);

    // Blue noise is a small tiling texture; scale so one texel maps to one pixel.
    const noiseSize = frame.noise.image?.width ?? 128;
    (u.uNoiseScale.value as THREE.Vector2).set(
      frame.width / noiseSize,
      frame.height / noiseSize,
    );
    // Advance the pattern every third frame: animated, but not crawling.
    const step = Math.floor(frame.frame / 3);
    (u.uNoiseOffset.value as THREE.Vector2).set(
      ((step * 37) % 128) / 128,
      ((step * 71) % 128) / 128,
    );

    u.uExposureScale.value = this.exposureScale;
    u.uChromatic.value = g.chromaticAberration;
    u.uGrain.value = g.filmGrain * 0.055;
    u.uTonemapMode.value = this.tonemap === 'aces' ? 1 : 0;
    u.uLutAmount.value = this.lutAmount;

    // Depth band cross-fade.
    const bands = selectBands(this.luts, frame.underwater ? frame.cameraDepth : 0);
    u.uLutA.value = this.luts[bands.a].texture;
    u.uLutB.value = this.luts[bands.b].texture;
    u.uLutMix.value = bands.mix;

    // Vignette tightens and cools with depth; above water it is barely there.
    u.uVignette.value = frame.underwater ? 0.7 + Math.min(0.25, frame.cameraDepth * 0.0015) : 0.45;
    (u.uEdgeTint.value as THREE.Color).copy(frame.waterInscatter).multiplyScalar(1.6);
    if (!frame.underwater) (u.uEdgeTint.value as THREE.Color).setRGB(0.8, 0.85, 0.95);

    // Final blit to the default framebuffer. preserveDrawingBuffer is enabled on
    // the renderer, so the in-game screenshot path can read the canvas after this.
    frame.blit.draw(frame.renderer, this.material, null);
  }

  override dispose(): void {
    for (const b of this.luts) b.texture.dispose();
    this.material.dispose();
  }
}

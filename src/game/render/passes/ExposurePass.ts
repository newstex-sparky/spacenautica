import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, MATH_GLSL } from '../shaders/Common';

/**
 * Histogram-based auto-exposure, entirely on the GPU (no `readRenderTargetPixels`
 * stall anywhere in the frame).
 *
 * 1. The frame is reduced to a fixed 128x72 luminance buffer.
 * 2. 9216 points are scattered into a 64-bin log-luminance histogram with
 *    additive blending, weighted by a centre-biased metering window.
 * 3. A 1x1 pass integrates the histogram between the 45th and 92nd percentile
 *    (throwing away the black water and the specular glints that would otherwise
 *    drag the aperture around), converts that to a target exposure, and adapts
 *    toward it in log space with separate speeds for opening and closing —
 *    clamped hard so swimming into a cave never blows out to white.
 */

const BINS = 64;
const LUMA_W = 128;
const LUMA_H = 72;

const LUMA_FRAG = /* glsl */ `
${MATH_GLSL}
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tColor, vUv + vec2(-0.5, -0.5) * uTexel).rgb
         + texture2D(tColor, vUv + vec2( 0.5, -0.5) * uTexel).rgb
         + texture2D(tColor, vUv + vec2(-0.5,  0.5) * uTexel).rgb
         + texture2D(tColor, vUv + vec2( 0.5,  0.5) * uTexel).rgb;
  gl_FragColor = vec4(max(0.0, luma(c * 0.25)), 0.0, 0.0, 1.0);
}
`;

const HISTOGRAM_VERT = /* glsl */ `
uniform sampler2D tLuma;
uniform vec2 uLumaSize;
uniform float uMinEv;
uniform float uMaxEv;
uniform float uBins;
varying float vWeight;
void main() {
  // position.xy carries the integer texel this vertex meters.
  vec2 uv = (position.xy + 0.5) / uLumaSize;
  float l = texture2D(tLuma, uv).r;
  float ev = clamp(log2(max(l, 1e-7)), uMinEv, uMaxEv);
  float t = (ev - uMinEv) / (uMaxEv - uMinEv);
  float bin = floor(t * (uBins - 1.0) + 0.5);
  float x = (bin + 0.5) / uBins * 2.0 - 1.0;
  vec2 c = uv - 0.5;
  vWeight = exp(-dot(c, c) * 2.2);
  gl_Position = vec4(x, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const HISTOGRAM_FRAG = /* glsl */ `
varying float vWeight;
void main() { gl_FragColor = vec4(vWeight, 1.0, 0.0, 1.0); }
`;

const RESOLVE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tHist;
uniform sampler2D tPrev;
uniform float uBins;
uniform float uMinEv;
uniform float uMaxEv;
uniform float uDt;
uniform float uSpeedUp;
uniform float uSpeedDown;
uniform float uKey;
uniform float uMinExposure;
uniform float uMaxExposure;
uniform float uValid;

#define BIN_COUNT ${BINS}

void main() {
  float total = 0.0;
  for (int i = 0; i < BIN_COUNT; i++) {
    total += texture2D(tHist, vec2((float(i) + 0.5) / uBins, 0.5)).r;
  }

  float lowCut = total * 0.45;
  float highCut = total * 0.92;

  float acc = 0.0;
  float sumEv = 0.0;
  float sumW = 0.0;
  for (int i = 0; i < BIN_COUNT; i++) {
    float w = texture2D(tHist, vec2((float(i) + 0.5) / uBins, 0.5)).r;
    float start = acc;
    acc += w;
    float lo = max(start, lowCut);
    float hi = min(acc, highCut);
    float use = max(0.0, hi - lo);
    float ev = uMinEv + (float(i) + 0.5) / uBins * (uMaxEv - uMinEv);
    sumEv += ev * use;
    sumW += use;
  }

  float avgEv = sumW > 1e-5 ? sumEv / sumW : -2.0;
  float avgLum = exp2(avgEv);
  float target = clamp(uKey / max(avgLum, 1e-5), uMinExposure, uMaxExposure);

  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (uValid < 0.5 || !(prev > 0.0)) prev = target;

  float speed = target > prev ? uSpeedUp : uSpeedDown;
  float f = 1.0 - exp(-max(uDt, 0.0) * speed);
  float cur = exp2(mix(log2(max(prev, 1e-5)), log2(max(target, 1e-5)), f));

  gl_FragColor = vec4(cur, avgLum, target, 1.0);
}
`;

export class ExposurePass extends PostPass {
  readonly id = 'exposure';

  private readonly lumaTarget: THREE.WebGLRenderTarget;
  private readonly histTarget: THREE.WebGLRenderTarget;
  private readonly result: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private index = 0;
  private valid = false;

  private readonly lumaMat: THREE.ShaderMaterial;
  private readonly histMat: THREE.ShaderMaterial;
  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly pointGeometry: THREE.BufferGeometry;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new THREE.Color();

  constructor(frame: FrameContext) {
    super(frame);

    this.lumaTarget = makeTarget(LUMA_W, LUMA_H, { name: 'post.luma' });
    this.histTarget = makeTarget(BINS, 1, { name: 'post.histogram', filter: THREE.NearestFilter });
    this.result = [
      makeTarget(1, 1, { name: 'post.exposureA', filter: THREE.NearestFilter }),
      makeTarget(1, 1, { name: 'post.exposureB', filter: THREE.NearestFilter }),
    ];

    this.lumaMat = new THREE.ShaderMaterial({
      name: 'post/luma',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: LUMA_FRAG,
      uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.histMat = new THREE.ShaderMaterial({
      name: 'post/histogram',
      vertexShader: HISTOGRAM_VERT,
      fragmentShader: HISTOGRAM_FRAG,
      uniforms: {
        tLuma: { value: this.lumaTarget.texture },
        uLumaSize: { value: new THREE.Vector2(LUMA_W, LUMA_H) },
        uMinEv: { value: -10 },
        uMaxEv: { value: 8 },
        uBins: { value: BINS },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });

    const count = LUMA_W * LUMA_H;
    const positions = new Float32Array(count * 3);
    for (let y = 0; y < LUMA_H; y++) {
      for (let x = 0; x < LUMA_W; x++) {
        const i = (y * LUMA_W + x) * 3;
        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = 0;
      }
    }
    this.pointGeometry = new THREE.BufferGeometry();
    this.pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(this.pointGeometry, this.histMat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;

    this.resolveMat = new THREE.ShaderMaterial({
      name: 'post/exposure-resolve',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: RESOLVE_FRAG,
      uniforms: {
        tHist: { value: this.histTarget.texture },
        tPrev: { value: null },
        uBins: { value: BINS },
        uMinEv: { value: -10 },
        uMaxEv: { value: 8 },
        uDt: { value: 1 / 60 },
        uSpeedUp: { value: 1.1 },
        uSpeedDown: { value: 0.55 },
        uKey: { value: 0.2 },
        uMinExposure: { value: 0.35 },
        uMaxExposure: { value: 7 },
        uValid: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
  }

  override configure(_frame: FrameContext): void {
    this.enabled = true;
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;

    this.lumaMat.uniforms.tColor.value = frame.color;
    (this.lumaMat.uniforms.uTexel.value as THREE.Vector2).set(1 / frame.width, 1 / frame.height);
    frame.blit.draw(renderer, this.lumaMat, this.lumaTarget);

    // Scatter into the histogram. Clear first: the additive blend accumulates.
    renderer.getClearColor(this.clearColor);
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.histTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setClearColor(this.clearColor, alpha);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.points, this.camera);
    renderer.autoClear = prevAutoClear;

    const dst = this.result[this.index];
    const src = this.result[1 - this.index];
    const u = this.resolveMat.uniforms;
    u.tPrev.value = src.texture;
    u.uDt.value = Math.min(frame.dt, 0.1);
    u.uValid.value = this.valid ? 1 : 0;
    // Deep water is genuinely dark: let the eye open further down there, but
    // never so far that the grain and the LUT fall apart.
    u.uMaxExposure.value = frame.underwater ? 4 + Math.min(6, frame.cameraDepth * 0.03) : 4;
    u.uKey.value = frame.underwater ? 0.17 : 0.2;
    frame.blit.draw(renderer, this.resolveMat, dst);

    this.index = 1 - this.index;
    this.valid = true;
    frame.exposure = dst.texture;
  }

  invalidate(): void {
    this.valid = false;
  }

  override dispose(): void {
    this.lumaTarget.dispose();
    this.histTarget.dispose();
    this.result[0].dispose();
    this.result[1].dispose();
    this.lumaMat.dispose();
    this.histMat.dispose();
    this.resolveMat.dispose();
    this.pointGeometry.dispose();
  }
}

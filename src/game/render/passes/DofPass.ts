import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, POST_COMMON } from '../shaders/Common';

/**
 * Depth of field with a real bokeh kernel.
 *
 * - Circle of confusion comes from a thin-lens model driven by the camera's own
 *   focal length (derived from the FOV against a 36 mm sensor) and an f-number,
 *   so "aperture" means something and the near/far asymmetry is physical.
 * - The gather is scatter-as-gather over a golden-angle spiral, with the footprint
 *   test done in a *hexagonal* metric — six-bladed bokeh, not a gaussian smudge.
 * - Near and far fields are separated into two MRT attachments so the near field
 *   composites *over* the focal plane with its own coverage, which is what makes
 *   foreground occluders (a kelp blade across the lens) read correctly.
 * - Focus is pulled on the GPU: a 1x1 target tracks what the reticle is over and
 *   eases toward it in log space. `setFocusDistance()` overrides the target.
 */

const COC_GLSL = /* glsl */ `
uniform float uFocalLength;   // metres
uniform float uAperture;      // metres (focalLength / fNumber)
uniform float uSensorWidth;   // metres
uniform float uCocScale;      // half-res pixels per metre of sensor CoC
uniform float uFarScale;
uniform float uNearScale;
uniform float uMaxCoc;

/** Signed circle of confusion in half-res pixels. Positive = behind focus. */
float cocPixels(float z, float focus) {
  float denom = z * max(focus - uFocalLength, 1e-4);
  float cocMetres = uAperture * uFocalLength * (z - focus) / max(denom, 1e-6);
  float px = cocMetres * uCocScale;
  px *= px > 0.0 ? uFarScale : uNearScale;
  return clamp(px, -uMaxCoc, uMaxCoc);
}
`;

const FOCUS_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;
uniform sampler2D tDepth;
uniform sampler2D tPrev;
uniform float uNear;
uniform float uFar;
uniform float uManual;
uniform float uDt;
uniform float uSpeed;
uniform float uValid;

void main() {
  // Sample a small cross at the reticle and take the nearest hit, so the focus
  // locks onto the thing you are pointing at rather than the gap beside it.
  float best = 1e9;
  for (int i = 0; i < 5; i++) {
    vec2 o = vec2(0.0);
    if (i == 1) o = vec2( 0.012, 0.0);
    if (i == 2) o = vec2(-0.012, 0.0);
    if (i == 3) o = vec2(0.0,  0.012);
    if (i == 4) o = vec2(0.0, -0.012);
    float z = depthMetres(texture2D(tDepth, vec2(0.5) + o).x, uNear, uFar);
    best = min(best, z);
  }
  float target = uManual > 0.0 ? uManual : clamp(best, 0.3, 160.0);

  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (uValid < 0.5 || !(prev > 0.0)) prev = target;
  float f = 1.0 - exp(-max(uDt, 0.0) * uSpeed);
  float cur = exp2(mix(log2(max(prev, 0.05)), log2(max(target, 0.05)), f));
  gl_FragColor = vec4(cur, target, 0.0, 1.0);
}
`;

const PREPARE_FRAG = /* glsl */ `
${POST_COMMON}
${COC_GLSL}
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tFocus;
uniform vec2 uFullTexel;
uniform float uNear;
uniform float uFar;

void main() {
  float focus = texture2D(tFocus, vec2(0.5)).r;

  vec3 c = vec3(0.0);
  float coc = 0.0;
  // 4-tap box downsample; CoC takes the tap with the largest magnitude so thin
  // near-field silhouettes survive the halving.
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i == 0 || i == 2 ? -0.5 : 0.5, i < 2 ? -0.5 : 0.5) * uFullTexel;
    vec2 uv = vUv + o;
    c += texture2D(tColor, uv).rgb;
    float z = depthMetres(texture2D(tDepth, uv).x, uNear, uFar);
    float k = cocPixels(z, focus);
    if (abs(k) > abs(coc)) coc = k;
  }
  gl_FragColor = vec4(c * 0.25, coc);
}
`;

const GATHER_FRAG = /* glsl */ `
${POST_COMMON}
layout(location = 0) out vec4 outFar;
layout(location = 1) out vec4 outNear;

varying vec2 vUv;
uniform sampler2D tPrepared;
uniform vec2 uTexel;
uniform float uMaxCoc;
uniform float uFrame;

#ifndef TAPS
#define TAPS 32
#endif

const float GOLDEN = 2.39996323;

/** Hexagonal footprint metric: 1.0 on the boundary of a flat-top hexagon. */
float hexMetric(vec2 p) {
  p = abs(p);
  return max(p.x * 0.8660254 + p.y * 0.5, p.y);
}

void main() {
  vec4 centre = texture2D(tPrepared, vUv);
  float c0 = centre.a;

  // Four stable rotations break the spiral's banding without adding fizz.
  float rot = floor(ign(gl_FragCoord.xy) * 4.0) * (GOLDEN * 0.25);

  vec3 farSum = vec3(0.0);
  float farW = 0.0;
  vec3 nearSum = vec3(0.0);
  float nearW = 0.0;

  // Centre tap seeds the far field so in-focus pixels are never empty.
  float c0far = max(0.0, c0);
  farSum += centre.rgb;
  farW += 1.0;

  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(TAPS));
    float a = fi * GOLDEN + rot;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 off = dir * r * uMaxCoc;
    float d = hexMetric(off);

    vec4 t = texture2D(tPrepared, vUv + off * uTexel);

    // Far field: a tap spreads onto us when its own CoC reaches this far, and
    // only if it is not in front of us (that is the near field's job).
    float tFar = max(0.0, t.a);
    float wf = sat(tFar - d + 1.0) / (0.4 + tFar);
    wf *= step(-1.0, t.a - c0far * 0.55);
    farSum += t.rgb * wf;
    farW += wf;

    // Near field: taps in front of the focal plane spread outward over us.
    float tNear = max(0.0, -t.a);
    float wn = sat(tNear - d + 1.0) / (0.4 + tNear);
    nearSum += t.rgb * wn;
    nearW += wn;
  }

  outFar = vec4(farSum / max(farW, 1e-4), min(1.0, farW));
  outNear = vec4(nearSum / max(nearW, 1e-4), sat(nearW / (float(TAPS) * 0.22)));
}
`;

const COMPOSITE_FRAG = /* glsl */ `
${POST_COMMON}
${COC_GLSL}
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tFar;
uniform sampler2D tNear;
uniform sampler2D tDepth;
uniform sampler2D tFocus;
uniform vec2 uHalfTexel;
uniform float uNear;
uniform float uFar;

/** Bilinear is not enough across a CoC discontinuity; weight by |coc|. */
vec4 upsample(sampler2D tex, vec2 uv) {
  vec4 a = texture2D(tex, uv);
  vec4 b = texture2D(tex, uv + vec2(uHalfTexel.x, 0.0));
  vec4 c = texture2D(tex, uv + vec2(0.0, uHalfTexel.y));
  vec4 d = texture2D(tex, uv + uHalfTexel);
  return (a + b + c + d) * 0.25;
}

void main() {
  vec3 sharp = texture2D(tColor, vUv).rgb;
  float focus = texture2D(tFocus, vec2(0.5)).r;
  float z = depthMetres(texture2D(tDepth, vUv).x, uNear, uFar);
  float coc = cocPixels(z, focus);

  vec4 far = upsample(tFar, vUv);
  vec4 near = upsample(tNear, vUv);

  float farAmt = sat(coc - 0.55) * far.a;
  vec3 c = mix(sharp, far.rgb, sat(farAmt));
  c = mix(c, near.rgb, sat(near.a));

  gl_FragColor = vec4(c, 1.0);
}
`;

export class DofPass extends PostPass {
  readonly id = 'dof';

  private prepared: THREE.WebGLRenderTarget;
  private gathered: THREE.WebGLRenderTarget;
  private focus: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private focusIndex = 0;
  private focusValid = false;

  private readonly focusMat: THREE.ShaderMaterial;
  private readonly prepareMat: THREE.ShaderMaterial;
  private readonly gatherMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;

  private width = 1;
  private height = 1;

  /** Manual focus target in metres; <= 0 means follow the reticle. */
  manualFocus = 0;
  /** f-number. Lower = shallower depth of field. */
  fNumber = 2.6;
  farScale = 0.6;
  nearScale = 1.15;

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.width = width;
    this.height = height;
    const hw = Math.max(1, width >> 1);
    const hh = Math.max(1, height >> 1);
    this.prepared = makeTarget(hw, hh, { name: 'post.dofPrep' });
    this.gathered = makeTarget(hw, hh, { count: 2, name: 'post.dofGather' });
    this.focus = [
      makeTarget(1, 1, { name: 'post.focusA', filter: THREE.NearestFilter }),
      makeTarget(1, 1, { name: 'post.focusB', filter: THREE.NearestFilter }),
    ];

    this.focusMat = new THREE.ShaderMaterial({
      name: 'post/dof-focus',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FOCUS_FRAG,
      uniforms: {
        tDepth: { value: null },
        tPrev: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uManual: { value: 0 },
        uDt: { value: 1 / 60 },
        uSpeed: { value: 4.5 },
        uValid: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    const cocUniforms = () => ({
      uFocalLength: { value: 0.024 },
      uAperture: { value: 0.024 / 2.6 },
      uSensorWidth: { value: 0.036 },
      uCocScale: { value: 1000 },
      uFarScale: { value: this.farScale },
      uNearScale: { value: this.nearScale },
      uMaxCoc: { value: 18 },
    });

    this.prepareMat = new THREE.ShaderMaterial({
      name: 'post/dof-prepare',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: PREPARE_FRAG,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tFocus: { value: null },
        uFullTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        ...cocUniforms(),
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.gatherMat = new THREE.ShaderMaterial({
      name: 'post/dof-gather',
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GATHER_FRAG,
      defines: { TAPS: '32' },
      uniforms: {
        tPrepared: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uMaxCoc: { value: 18 },
        uFrame: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      name: 'post/dof-composite',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tColor: { value: null },
        tFar: { value: null },
        tNear: { value: null },
        tDepth: { value: null },
        tFocus: { value: null },
        uHalfTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        ...cocUniforms(),
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
  }

  override setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const hw = Math.max(1, width >> 1);
    const hh = Math.max(1, height >> 1);
    this.prepared.setSize(hw, hh);
    this.gathered.setSize(hw, hh);
    this.focusValid = false;
  }

  override configure(frame: FrameContext): void {
    this.enabled = frame.settings.dof && frame.prepassValid;
    const taps = frame.settings.tier === 'ultra' ? '48' : frame.settings.tier === 'high' ? '32' : '16';
    if (this.gatherMat.defines.TAPS !== taps) {
      this.gatherMat.defines.TAPS = taps;
      this.gatherMat.needsUpdate = true;
    }
  }

  /** Latest resolved focus distance target in metres (CPU-side estimate only). */
  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;

    // --- focus pull ---
    const fDst = this.focus[this.focusIndex];
    const fSrc = this.focus[1 - this.focusIndex];
    const fu = this.focusMat.uniforms;
    fu.tDepth.value = frame.depth;
    fu.tPrev.value = fSrc.texture;
    fu.uNear.value = frame.near;
    fu.uFar.value = frame.far;
    fu.uManual.value = this.manualFocus;
    fu.uDt.value = Math.min(frame.dt, 0.1);
    fu.uValid.value = this.focusValid ? 1 : 0;
    frame.blit.draw(renderer, this.focusMat, fDst);
    this.focusIndex = 1 - this.focusIndex;
    this.focusValid = true;

    // --- lens parameters from the live camera ---
    // 24 mm sensor height against the camera's vertical FOV keeps the lens model
    // consistent with three's perspective camera.
    const fovRad = (frame.camera.fov * Math.PI) / 180;
    const sensorHeight = 0.024;
    const focalLength = (0.5 * sensorHeight) / Math.tan(fovRad * 0.5);
    const aperture = focalLength / this.fNumber;
    const cocScale = this.prepared.height / sensorHeight;
    const maxCoc = Math.max(4, Math.min(26, this.prepared.height * 0.04));

    for (const mat of [this.prepareMat, this.compositeMat]) {
      const u = mat.uniforms;
      u.uFocalLength.value = focalLength;
      u.uAperture.value = aperture;
      u.uCocScale.value = cocScale;
      u.uFarScale.value = this.farScale;
      u.uNearScale.value = this.nearScale;
      u.uMaxCoc.value = maxCoc;
      u.uNear.value = frame.near;
      u.uFar.value = frame.far;
    }

    // --- prepare (half res colour + CoC) ---
    const pu = this.prepareMat.uniforms;
    pu.tColor.value = frame.color;
    pu.tDepth.value = frame.depth;
    pu.tFocus.value = fDst.texture;
    (pu.uFullTexel.value as THREE.Vector2).set(1 / frame.width, 1 / frame.height);
    frame.blit.draw(renderer, this.prepareMat, this.prepared);

    // --- gather (near + far MRT) ---
    const gu = this.gatherMat.uniforms;
    gu.tPrepared.value = this.prepared.texture;
    (gu.uTexel.value as THREE.Vector2).set(1 / this.prepared.width, 1 / this.prepared.height);
    gu.uMaxCoc.value = maxCoc;
    gu.uFrame.value = frame.frame % 64;
    frame.blit.draw(renderer, this.gatherMat, this.gathered);

    // --- composite ---
    const cu = this.compositeMat.uniforms;
    cu.tColor.value = frame.color;
    cu.tFar.value = this.gathered.textures[0];
    cu.tNear.value = this.gathered.textures[1];
    cu.tDepth.value = frame.depth;
    cu.tFocus.value = fDst.texture;
    (cu.uHalfTexel.value as THREE.Vector2).set(
      1 / this.prepared.width,
      1 / this.prepared.height,
    );

    const out = frame.pool.next(frame.color);
    frame.blit.draw(renderer, this.compositeMat, out);
    frame.color = out.texture;
  }

  override dispose(): void {
    this.prepared.dispose();
    this.gathered.dispose();
    this.focus[0].dispose();
    this.focus[1].dispose();
    this.focusMat.dispose();
    this.prepareMat.dispose();
    this.gatherMat.dispose();
    this.compositeMat.dispose();
  }
}

import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, MATH_GLSL } from '../shaders/Common';

/**
 * Physically-plausible bloom: Jimenez's progressive dual filter.
 *
 * Downsample with the 13-tap "partial Karis average" filter (the first level uses
 * a Karis-weighted average so a single fireflying specular cannot pump the whole
 * chain), then upsample with a 3x3 tent, adding each level back into the one
 * below. The result is *energy conserving*: the composite is
 * `mix(scene, bloom, strength)`, not `scene + bloom`, so bright areas do not gain
 * total energy and the frame never washes out.
 *
 * A separate wide horizontal chain gives the anamorphic streak on very bright
 * speculars (sun glitter on the surface, the torch hitting a wet rock face).
 */

const PREFILTER_FRAG = /* glsl */ `
${MATH_GLSL}
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tExposure;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;

vec3 prefilter(vec3 c) {
  float br = maxc(c);
  // Soft knee: quadratic ramp through the threshold so there is no hard edge
  // where bloom starts.
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-4);
  float w = max(rq, br - uThreshold) / max(br, 1e-4);
  return c * w;
}

void main() {
  float exposure = texture2D(tExposure, vec2(0.5)).r;
  vec3 s = texture2D(tColor, vUv + vec2(-1.0, -1.0) * uTexel).rgb
         + texture2D(tColor, vUv + vec2( 1.0, -1.0) * uTexel).rgb
         + texture2D(tColor, vUv + vec2(-1.0,  1.0) * uTexel).rgb
         + texture2D(tColor, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  vec3 c = s * 0.25 * max(exposure, 1e-3);
  c = min(c, vec3(uClamp));
  gl_FragColor = vec4(prefilter(c), 1.0);
}
`;

const DOWNSAMPLE_FRAG = /* glsl */ `
${MATH_GLSL}
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uKaris;

vec3 fetch(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float karisWeight(vec3 c) { return 1.0 / (1.0 + luma(c)); }

void main() {
  // Jimenez 13-tap: centre, inner box, outer box, corners.
  vec3 a = fetch(vec2(-2.0, 2.0));
  vec3 b = fetch(vec2( 0.0, 2.0));
  vec3 c = fetch(vec2( 2.0, 2.0));
  vec3 d = fetch(vec2(-2.0, 0.0));
  vec3 e = fetch(vec2( 0.0, 0.0));
  vec3 f = fetch(vec2( 2.0, 0.0));
  vec3 g = fetch(vec2(-2.0,-2.0));
  vec3 h = fetch(vec2( 0.0,-2.0));
  vec3 i = fetch(vec2( 2.0,-2.0));
  vec3 j = fetch(vec2(-1.0, 1.0));
  vec3 k = fetch(vec2( 1.0, 1.0));
  vec3 l = fetch(vec2(-1.0,-1.0));
  vec3 m = fetch(vec2( 1.0,-1.0));

  if (uKaris > 0.5) {
    // Partial Karis average over the five 4-tap groups: kills fireflies.
    vec3 g0 = (a + b + d + e) * 0.25;
    vec3 g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25;
    vec3 g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = karisWeight(g0) * 0.125;
    float w1 = karisWeight(g1) * 0.125;
    float w2 = karisWeight(g2) * 0.125;
    float w3 = karisWeight(g3) * 0.125;
    float w4 = karisWeight(g4) * 0.5;
    float wsum = w0 + w1 + w2 + w3 + w4;
    gl_FragColor = vec4((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(wsum, 1e-5), 1.0);
  } else {
    vec3 sum = e * 0.125;
    sum += (a + c + g + i) * 0.03125;
    sum += (b + d + f + h) * 0.0625;
    sum += (j + k + l + m) * 0.125;
    gl_FragColor = vec4(sum, 1.0);
  }
}
`;

const UPSAMPLE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;

void main() {
  vec2 o = uTexel * uRadius;
  vec3 sum = texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb * 1.0;
  sum += texture2D(tSrc, vUv + vec2( 0.0,  o.y)).rgb * 2.0;
  sum += texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb * 1.0;
  sum += texture2D(tSrc, vUv + vec2(-o.x,  0.0)).rgb * 2.0;
  sum += texture2D(tSrc, vUv                   ).rgb * 4.0;
  sum += texture2D(tSrc, vUv + vec2( o.x,  0.0)).rgb * 2.0;
  sum += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 1.0;
  sum += texture2D(tSrc, vUv + vec2( 0.0, -o.y)).rgb * 2.0;
  sum += texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb * 1.0;
  gl_FragColor = vec4(sum / 16.0, 1.0);
}
`;

const STREAK_FRAG = /* glsl */ `
${MATH_GLSL}
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uStride;
uniform float uThreshold;
uniform float uFirst;

void main() {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float fi = float(i);
    vec3 s = texture2D(tSrc, vUv + vec2(fi * uStride * uTexel.x, 0.0)).rgb;
    if (uFirst > 0.5) s = max(vec3(0.0), s - vec3(uThreshold));
    float w = exp(-fi * fi * 0.09);
    sum += s * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
${MATH_GLSL}
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tStreak;
uniform sampler2D tVeil;
uniform sampler2D tExposure;
uniform float uStrength;
uniform float uVeil;
uniform float uStreak;
uniform float uNorm;
uniform vec3 uStreakTint;

void main() {
  vec3 base = texture2D(tColor, vUv).rgb;
  float exposure = max(texture2D(tExposure, vec2(0.5)).r, 1e-3);

  // Bloom was computed on exposed values; bring it back to scene-referred so the
  // grade's exposure stage stays the single source of truth. uNorm undoes the
  // additive upsample's level count so mix() below really is energy neutral.
  vec3 bloom = texture2D(tBloom, vUv).rgb * uNorm / exposure;
  vec3 veil = texture2D(tVeil, vUv).rgb / exposure;
  vec3 streak = texture2D(tStreak, vUv).rgb / exposure * uStreakTint;

  // Energy conserving: bloom redistributes light, it does not create it.
  vec3 c = mix(base, bloom, uStrength);
  c = mix(c, veil, uVeil);
  c += streak * uStreak;
  gl_FragColor = vec4(c, 1.0);
}
`;

const MIP_COUNT = 6;

export class BloomPass extends PostPass {
  readonly id = 'bloom';

  private mips: THREE.WebGLRenderTarget[] = [];
  private streakA: THREE.WebGLRenderTarget;
  private streakB: THREE.WebGLRenderTarget;
  private readonly prefilterMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly streakMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  private levels = MIP_COUNT;

  strength = 0.055;
  veil = 0.03;
  streakStrength = 0.16;

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.width = width;
    this.height = height;
    for (let i = 0; i < MIP_COUNT; i++) {
      const s = 2 << i;
      this.mips.push(
        makeTarget(Math.max(1, Math.floor(width / s)), Math.max(1, Math.floor(height / s)), {
          name: `post.bloom${i}`,
        }),
      );
    }
    this.streakA = makeTarget(Math.max(1, width >> 2), Math.max(1, height >> 2), {
      name: 'post.streakA',
    });
    this.streakB = makeTarget(Math.max(1, width >> 2), Math.max(1, height >> 2), {
      name: 'post.streakB',
    });

    this.prefilterMat = new THREE.ShaderMaterial({
      name: 'post/bloom-prefilter',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: PREFILTER_FRAG,
      uniforms: {
        tColor: { value: null },
        tExposure: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: 1.0 },
        uKnee: { value: 0.6 },
        uClamp: { value: 90 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.downMat = new THREE.ShaderMaterial({
      name: 'post/bloom-down',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: DOWNSAMPLE_FRAG,
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uKaris: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.upMat = new THREE.ShaderMaterial({
      name: 'post/bloom-up',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: UPSAMPLE_FRAG,
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 1.0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      // Additive: each upsampled level is added back into the level below, which
      // is what gives the dual filter its smooth, wide falloff.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });

    this.streakMat = new THREE.ShaderMaterial({
      name: 'post/bloom-streak',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uStride: { value: 2 },
        uThreshold: { value: 1.6 },
        uFirst: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      name: 'post/bloom-composite',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tColor: { value: null },
        tBloom: { value: null },
        tStreak: { value: null },
        tVeil: { value: null },
        tExposure: { value: null },
        uStrength: { value: this.strength },
        uVeil: { value: this.veil },
        uStreak: { value: this.streakStrength },
        uNorm: { value: 1 / MIP_COUNT },
        uStreakTint: { value: new THREE.Color(0.55, 0.78, 1.0) },
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
    for (let i = 0; i < MIP_COUNT; i++) {
      const s = 2 << i;
      this.mips[i].setSize(
        Math.max(1, Math.floor(width / s)),
        Math.max(1, Math.floor(height / s)),
      );
    }
    this.streakA.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    this.streakB.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
  }

  override configure(frame: FrameContext): void {
    this.enabled = frame.settings.bloom;
    this.levels = frame.settings.tier === 'low' ? 4 : MIP_COUNT;
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;
    const blit = frame.blit;

    // --- prefilter into mip 0 (half res) ---
    const pu = this.prefilterMat.uniforms;
    pu.tColor.value = frame.color;
    pu.tExposure.value = frame.exposure;
    (pu.uTexel.value as THREE.Vector2).set(1 / frame.width, 1 / frame.height);
    blit.draw(renderer, this.prefilterMat, this.mips[0]);

    // --- downsample chain ---
    for (let i = 1; i < this.levels; i++) {
      const src = this.mips[i - 1];
      this.downMat.uniforms.tSrc.value = src.texture;
      (this.downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.downMat.uniforms.uKaris.value = i === 1 ? 1 : 0;
      blit.draw(renderer, this.downMat, this.mips[i]);
    }

    // --- the widest level doubles as the soft veil ---
    const veilTexture = this.mips[this.levels - 1].texture;

    // --- upsample chain, additive ---
    for (let i = this.levels - 1; i > 0; i--) {
      const src = this.mips[i];
      this.upMat.uniforms.tSrc.value = src.texture;
      (this.upMat.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.upMat.uniforms.uRadius.value = 1.0;
      blit.draw(renderer, this.upMat, this.mips[i - 1]);
    }

    // --- anamorphic streak: two wide horizontal passes on the bright tail ---
    this.streakMat.uniforms.tSrc.value = this.mips[1].texture;
    (this.streakMat.uniforms.uTexel.value as THREE.Vector2).set(
      1 / this.streakA.width,
      1 / this.streakA.height,
    );
    this.streakMat.uniforms.uStride.value = 2;
    this.streakMat.uniforms.uFirst.value = 1;
    blit.draw(renderer, this.streakMat, this.streakA);

    this.streakMat.uniforms.tSrc.value = this.streakA.texture;
    this.streakMat.uniforms.uStride.value = 14;
    this.streakMat.uniforms.uFirst.value = 0;
    blit.draw(renderer, this.streakMat, this.streakB);

    // --- composite ---
    const cu = this.compositeMat.uniforms;
    cu.tColor.value = frame.color;
    cu.tBloom.value = this.mips[0].texture;
    cu.tVeil.value = veilTexture;
    cu.tStreak.value = this.streakB.texture;
    cu.tExposure.value = frame.exposure;
    cu.uStrength.value = this.strength;
    cu.uVeil.value = this.veil;
    cu.uNorm.value = 1 / this.levels;
    // Streaks are a surface/above-water phenomenon; underwater they read as haze.
    cu.uStreak.value = this.streakStrength * (frame.underwater ? 0.55 : 1);

    const out = frame.pool.next(frame.color);
    blit.draw(renderer, this.compositeMat, out);
    frame.color = out.texture;
  }

  override dispose(): void {
    for (const m of this.mips) m.dispose();
    this.streakA.dispose();
    this.streakB.dispose();
    this.prefilterMat.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.streakMat.dispose();
    this.compositeMat.dispose();
  }
}

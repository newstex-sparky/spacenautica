import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, POST_COMMON } from '../shaders/Common';

/**
 * Volumetric composite slot.
 *
 * The water system owns the physically-motivated light shafts (it knows the
 * surface geometry, the caustic phase and the extinction profile). When it
 * publishes a buffer through `PostStack.setVolumetric()` this pass simply
 * composites it, tinted by the sun colour and modulated by the Henyey-Greenstein
 * phase function so shafts brighten when you look toward the sun.
 *
 * Until/unless that buffer exists, a self-contained screen-space fallback keeps
 * the frame alive: open-water pixels (no geometry in the prepass mask) act as the
 * emissive source and are radially smeared toward the sun's screen position, so
 * shafts are occluded by terrain and props for free.
 */

const SHAFT_MASK_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uFarFade;

void main() {
  float mask = texture2D(tNormal, vUv).w;
  float z = depthMetres(texture2D(tDepth, vUv).x, uNear, uFar);
  // Open water (no geometry) is the light source; distant geometry contributes a
  // little so the shafts do not hard-stop at a reef edge.
  float openness = mask < 0.5 ? 1.0 : sat((z - uFarFade) / max(uFarFade, 1.0)) * 0.35;
  vec3 c = texture2D(tColor, vUv).rgb;
  float e = luma(c);
  gl_FragColor = vec4(vec3(e) * openness, openness);
}
`;

const SHAFT_BLUR_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tSrc;
uniform vec2 uSunUv;
uniform float uDensity;
uniform float uDecay;
uniform float uWeight;
uniform float uJitter;
uniform float uAspect;

#ifndef SHAFT_SAMPLES
#define SHAFT_SAMPLES 24
#endif

void main() {
  vec2 delta = (uSunUv - vUv) * (uDensity / float(SHAFT_SAMPLES));
  float dither = ign(gl_FragCoord.xy + uJitter * 3.77);
  vec2 uv = vUv + delta * dither;
  float illum = 1.0;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    vec4 s = texture2D(tSrc, clamp(uv, vec2(0.0), vec2(1.0)));
    acc += s * illum;
    illum *= uDecay;
    uv += delta;
  }
  gl_FragColor = acc * (uWeight / float(SHAFT_SAMPLES));
}
`;

const VOLUMETRIC_COMPOSITE_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tShafts;
uniform sampler2D tExternal;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec2 uShaftTexel;
uniform vec3 uSunDirWorld;
uniform vec3 uSunColor;
uniform vec3 uInscatter;
uniform float uFallbackStrength;
uniform float uExternalStrength;
uniform float uHasExternal;

/** Henyey-Greenstein phase, matched to the water system's g = 0.55. */
float hg(float cosT, float g) {
  float gg = g * g;
  return (1.0 - gg) / (12.5663706 * pow(max(1.0 + gg - 2.0 * g * cosT, 1e-4), 1.5));
}

void main() {
  vec3 color = texture2D(tColor, vUv).rgb;

  vec3 rayView = viewRay(vUv, uProjInv);
  vec3 rayWorld = normalize((uViewInv * vec4(rayView, 0.0)).xyz);
  float phase = hg(dot(rayWorld, normalize(uSunDirWorld)), 0.55);
  float aniso = 0.35 + 6.0 * phase;

  // 3x3 tent upsample: the shaft buffer is quarter/half res and would otherwise
  // show blocky steps against the terrain silhouette.
  vec4 shafts = vec4(0.0);
  float wsum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      shafts += texture2D(tShafts, vUv + vec2(float(x), float(y)) * uShaftTexel) * w;
      wsum += w;
    }
  }
  shafts /= wsum;

  vec3 tint = uSunColor * uInscatter * 3.0 + uInscatter * 0.35;
  vec3 add = shafts.rgb * tint * (uFallbackStrength * aniso);

  vec3 ext = texture2D(tExternal, vUv).rgb;
  add += ext * uSunColor * (uExternalStrength * aniso) * uHasExternal;

  gl_FragColor = vec4(color + add, 1.0);
}
`;

const _sunNdc = new THREE.Vector3();

export class VolumetricPass extends PostPass {
  readonly id = 'volumetric';

  private maskTarget: THREE.WebGLRenderTarget;
  private shaftTarget: THREE.WebGLRenderTarget;
  private readonly maskMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly blank: THREE.DataTexture;
  private width = 1;
  private height = 1;
  private scale = 0.5;

  /** Buffer published by the water system, composited in place of the fallback. */
  external: THREE.Texture | null = null;
  externalStrength = 1;

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.width = width;
    this.height = height;
    const w = Math.max(1, Math.floor(width * this.scale));
    const h = Math.max(1, Math.floor(height * this.scale));
    this.maskTarget = makeTarget(w, h, { name: 'post.shaftMask' });
    this.shaftTarget = makeTarget(w, h, { name: 'post.shafts' });

    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.blank.needsUpdate = true;

    this.maskMat = new THREE.ShaderMaterial({
      name: 'post/shaft-mask',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SHAFT_MASK_FRAG,
      uniforms: {
        tColor: { value: null },
        tNormal: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uFarFade: { value: 120 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.blurMat = new THREE.ShaderMaterial({
      name: 'post/shaft-blur',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SHAFT_BLUR_FRAG,
      defines: { SHAFT_SAMPLES: '24' },
      uniforms: {
        tSrc: { value: null },
        uSunUv: { value: new THREE.Vector2(0.5, 0.9) },
        uDensity: { value: 0.85 },
        uDecay: { value: 0.965 },
        uWeight: { value: 5.5 },
        uJitter: { value: 0 },
        uAspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      name: 'post/volumetric-composite',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: VOLUMETRIC_COMPOSITE_FRAG,
      uniforms: {
        tColor: { value: null },
        tShafts: { value: null },
        tExternal: { value: this.blank },
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uShaftTexel: { value: new THREE.Vector2() },
        uSunDirWorld: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uInscatter: { value: new THREE.Color(0.1, 0.3, 0.4) },
        uFallbackStrength: { value: 1 },
        uExternalStrength: { value: 1 },
        uHasExternal: { value: 0 },
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
    const w = Math.max(1, Math.floor(width * this.scale));
    const h = Math.max(1, Math.floor(height * this.scale));
    this.maskTarget.setSize(w, h);
    this.shaftTarget.setSize(w, h);
  }

  override configure(frame: FrameContext): void {
    this.enabled = frame.settings.godRays && (frame.prepassValid || this.external !== null);
    const samples = frame.settings.tier === 'ultra' ? '32' : frame.settings.tier === 'high' ? '24' : '16';
    if (this.blurMat.defines.SHAFT_SAMPLES !== samples) {
      this.blurMat.defines.SHAFT_SAMPLES = samples;
      this.blurMat.needsUpdate = true;
    }
    const wantScale = frame.settings.tier === 'ultra' ? 0.6 : 0.4;
    if (wantScale !== this.scale) {
      this.scale = wantScale;
      this.setSize(this.width, this.height);
    }
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;

    // Fade the screen-space fallback out as the sun leaves the frame — a radial
    // smear toward an off-screen origin degenerates into streaks.
    let fallback = 0;
    if (frame.prepassValid && frame.sunScreen.z > 0.5) {
      _sunNdc.set(frame.sunScreen.x, frame.sunScreen.y, 0);
      const dx = Math.max(0, Math.abs(_sunNdc.x - 0.5) - 0.5);
      const dy = Math.max(0, Math.abs(_sunNdc.y - 0.5) - 0.5);
      const outside = Math.sqrt(dx * dx + dy * dy);
      fallback = Math.max(0, 1 - outside / 0.45);
    }
    if (this.external) fallback *= 0.25;

    if (fallback > 0.001) {
      const mu = this.maskMat.uniforms;
      mu.tColor.value = frame.color;
      mu.tNormal.value = frame.normal;
      mu.tDepth.value = frame.depth;
      mu.uNear.value = frame.near;
      mu.uFar.value = frame.far;
      mu.uFarFade.value = Math.max(40, frame.settings.viewDistance * 0.35);
      frame.blit.draw(renderer, this.maskMat, this.maskTarget);

      const bu = this.blurMat.uniforms;
      bu.tSrc.value = this.maskTarget.texture;
      (bu.uSunUv.value as THREE.Vector2).set(frame.sunScreen.x, frame.sunScreen.y);
      bu.uJitter.value = frame.frame % 32;
      bu.uAspect.value = frame.width / Math.max(1, frame.height);
      // Underwater shafts are tighter and brighter than atmospheric ones.
      bu.uDensity.value = frame.underwater ? 0.75 : 0.95;
      bu.uWeight.value = frame.underwater ? 6.5 : 3.5;
      frame.blit.draw(renderer, this.blurMat, this.shaftTarget);
    }

    const cu = this.compositeMat.uniforms;
    cu.tColor.value = frame.color;
    cu.tShafts.value = this.shaftTarget.texture;
    cu.tExternal.value = this.external ?? this.blank;
    cu.tDepth.value = frame.depth;
    (cu.uProjInv.value as THREE.Matrix4).copy(frame.projInv);
    (cu.uViewInv.value as THREE.Matrix4).copy(frame.viewInv);
    (cu.uShaftTexel.value as THREE.Vector2).set(
      1 / this.shaftTarget.width,
      1 / this.shaftTarget.height,
    );
    (cu.uSunDirWorld.value as THREE.Vector3).copy(frame.sunDirection);
    (cu.uSunColor.value as THREE.Color).copy(frame.sunColor);
    (cu.uInscatter.value as THREE.Color).copy(frame.waterInscatter);
    // Deep water swallows shafts; the surface band is where they read.
    const depthFade = 1 / (1 + frame.cameraDepth * 0.012);
    cu.uFallbackStrength.value = fallback * depthFade;
    cu.uExternalStrength.value = this.externalStrength;
    cu.uHasExternal.value = this.external ? 1 : 0;

    if (fallback <= 0.001 && !this.external) return;

    const out = frame.pool.next(frame.color);
    frame.blit.draw(renderer, this.compositeMat, out);
    frame.color = out.texture;
  }

  override dispose(): void {
    this.maskTarget.dispose();
    this.shaftTarget.dispose();
    this.blank.dispose();
    this.maskMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }
}

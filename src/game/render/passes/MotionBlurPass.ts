import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, POST_COMMON } from '../shaders/Common';

/**
 * Camera + per-object motion blur, McGuire-style reconstruction.
 *
 * A tile-max pass (8x8) followed by a 3x3 neighbour-max gives every pixel the
 * dominant motion of its neighbourhood, so a fast-moving object smears *over* the
 * static background instead of being clipped to its own silhouette. Taps are
 * weighted by depth ordering and by whether the tap's own velocity could have
 * carried it here, which is what stops the background bleeding through the middle
 * of a moving creature.
 *
 * Shutter length scales with real frame time so the blur amount is stable
 * whether the game is running at 30 or 144 fps.
 */

const TILE_MAX_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;
uniform sampler2D tVelocity;
uniform vec2 uTexel;
uniform vec2 uDirection;
uniform float uSteps;

void main() {
  vec2 best = vec2(0.0);
  float bestLen = -1.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uSteps) break;
    vec2 uv = vUv + uDirection * (float(i) - uSteps * 0.5 + 0.5) * uTexel;
    vec2 v = texture2D(tVelocity, uv).xy;
    float l = dot(v, v);
    if (l > bestLen) { bestLen = l; best = v; }
  }
  gl_FragColor = vec4(best, 0.0, 1.0);
}
`;

const NEIGHBOUR_MAX_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;
uniform sampler2D tTile;
uniform vec2 uTexel;

void main() {
  vec2 best = vec2(0.0);
  float bestLen = -1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 v = texture2D(tTile, vUv + vec2(float(x), float(y)) * uTexel).xy;
      float l = dot(v, v);
      if (l > bestLen) { bestLen = l; best = v; }
    }
  }
  gl_FragColor = vec4(best, 0.0, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tVelocity;
uniform sampler2D tNeighbourMax;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uShutter;
uniform float uMaxPixels;
uniform float uJitter;

#ifndef MB_TAPS
#define MB_TAPS 12
#endif

float softDepthCompare(float za, float zb) {
  return sat(1.0 - (za - zb) / max(0.02 * min(za, zb), 0.01));
}

void main() {
  vec3 centre = texture2D(tColor, vUv).rgb;

  vec2 vMax = texture2D(tNeighbourMax, vUv).xy * uShutter;
  float vMaxPx = length(vMax / uTexel);
  if (vMaxPx < 1.0) {
    gl_FragColor = vec4(centre, 1.0);
    return;
  }
  // Clamp the smear length so a fast spin does not turn the frame into streaks.
  if (vMaxPx > uMaxPixels) vMax *= uMaxPixels / vMaxPx;

  vec2 vCentre = texture2D(tVelocity, vUv).xy * uShutter;
  float zCentre = depthMetres(texture2D(tDepth, vUv).x, uNear, uFar);

  float dither = ign(gl_FragCoord.xy + uJitter * 11.13) - 0.5;

  vec3 sum = centre;
  float wsum = 1.0;

  for (int i = 1; i <= MB_TAPS; i++) {
    float t = (float(i) + dither) / float(MB_TAPS);
    // Alternate sides so the smear is centred on the pixel.
    float s = (mod(float(i), 2.0) < 0.5) ? t : -t;
    vec2 uv = vUv + vMax * s * 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

    float zTap = depthMetres(texture2D(tDepth, uv).x, uNear, uFar);
    vec2 vTap = texture2D(tVelocity, uv).xy * uShutter;

    float distPx = abs(s) * length(vMax / uTexel) * 0.5;

    // Foreground bleeding onto us, or background we are smearing over.
    float fg = softDepthCompare(zCentre, zTap);
    float bg = softDepthCompare(zTap, zCentre);
    float wA = fg * sat(1.0 - distPx / max(length(vTap / uTexel), 1e-3));
    float wB = bg * sat(1.0 - distPx / max(length(vCentre / uTexel), 1e-3));
    float w = wA + wB;

    sum += texture2D(tColor, uv).rgb * w;
    wsum += w;
  }

  gl_FragColor = vec4(sum / max(wsum, 1e-4), 1.0);
}
`;

const TILE = 8;

export class MotionBlurPass extends PostPass {
  readonly id = 'motionBlur';

  private tileA: THREE.WebGLRenderTarget;
  private tileB: THREE.WebGLRenderTarget;
  private neighbour: THREE.WebGLRenderTarget;
  private readonly tileMat: THREE.ShaderMaterial;
  private readonly neighbourMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  /** Fraction of the frame interval the shutter is open. */
  shutter = 0.65;

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.width = width;
    this.height = height;
    const tw = Math.max(1, Math.ceil(width / TILE));
    const th = Math.max(1, Math.ceil(height / TILE));
    this.tileA = makeTarget(tw, height, { name: 'post.mbTileA', filter: THREE.NearestFilter });
    this.tileB = makeTarget(tw, th, { name: 'post.mbTileB', filter: THREE.NearestFilter });
    this.neighbour = makeTarget(tw, th, { name: 'post.mbNeighbour', filter: THREE.NearestFilter });

    this.tileMat = new THREE.ShaderMaterial({
      name: 'post/mb-tile',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: TILE_MAX_FRAG,
      uniforms: {
        tVelocity: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uSteps: { value: TILE },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.neighbourMat = new THREE.ShaderMaterial({
      name: 'post/mb-neighbour',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: NEIGHBOUR_MAX_FRAG,
      uniforms: { tTile: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.blurMat = new THREE.ShaderMaterial({
      name: 'post/mb-blur',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      defines: { MB_TAPS: '12' },
      uniforms: {
        tColor: { value: null },
        tVelocity: { value: null },
        tNeighbourMax: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uShutter: { value: 1 },
        uMaxPixels: { value: 48 },
        uJitter: { value: 0 },
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
    const tw = Math.max(1, Math.ceil(width / TILE));
    const th = Math.max(1, Math.ceil(height / TILE));
    this.tileA.setSize(tw, height);
    this.tileB.setSize(tw, th);
    this.neighbour.setSize(tw, th);
  }

  override configure(frame: FrameContext): void {
    this.enabled = frame.settings.motionBlur && frame.prepassValid;
    const taps = frame.settings.tier === 'ultra' ? '16' : '12';
    if (this.blurMat.defines.MB_TAPS !== taps) {
      this.blurMat.defines.MB_TAPS = taps;
      this.blurMat.needsUpdate = true;
    }
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;

    // Separable tile max: horizontal into a tall intermediate, then vertical.
    const tu = this.tileMat.uniforms;
    tu.tVelocity.value = frame.velocity;
    (tu.uTexel.value as THREE.Vector2).set(1 / frame.width, 1 / frame.height);
    (tu.uDirection.value as THREE.Vector2).set(1, 0);
    frame.blit.draw(renderer, this.tileMat, this.tileA);

    tu.tVelocity.value = this.tileA.texture;
    (tu.uTexel.value as THREE.Vector2).set(1 / this.tileA.width, 1 / this.tileA.height);
    (tu.uDirection.value as THREE.Vector2).set(0, 1);
    frame.blit.draw(renderer, this.tileMat, this.tileB);

    const nu = this.neighbourMat.uniforms;
    nu.tTile.value = this.tileB.texture;
    (nu.uTexel.value as THREE.Vector2).set(1 / this.tileB.width, 1 / this.tileB.height);
    frame.blit.draw(renderer, this.neighbourMat, this.neighbour);

    const bu = this.blurMat.uniforms;
    bu.tColor.value = frame.color;
    bu.tVelocity.value = frame.velocity;
    bu.tNeighbourMax.value = this.neighbour.texture;
    bu.tDepth.value = frame.depth;
    (bu.uTexel.value as THREE.Vector2).set(1 / frame.width, 1 / frame.height);
    bu.uNear.value = frame.near;
    bu.uFar.value = frame.far;
    // Velocity already spans exactly one frame, so the shutter fraction is the
    // whole story — the smear stays physically consistent at any frame rate, and
    // `uMaxPixels` caps the pathological case of a fast spin at low fps.
    bu.uShutter.value = this.shutter;
    bu.uMaxPixels.value = Math.max(16, frame.height * 0.05);
    bu.uJitter.value = frame.frame % 32;

    const out = frame.pool.next(frame.color);
    frame.blit.draw(renderer, this.blurMat, out);
    frame.color = out.texture;
  }

  override dispose(): void {
    this.tileA.dispose();
    this.tileB.dispose();
    this.neighbour.dispose();
    this.tileMat.dispose();
    this.neighbourMat.dispose();
    this.blurMat.dispose();
  }
}

import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, POST_COMMON } from '../shaders/Common';

/**
 * Ground-truth-style ambient occlusion: horizon search per slice, the GTAO arc
 * integral for visibility, plus a bent normal. Denoised with a depth-aware
 * cross-bilateral filter *and* a velocity-reprojected temporal accumulation, so
 * the 2-3 slices per frame resolve into something smooth without the ring of
 * haloing that plain SSAO leaves around every silhouette.
 *
 * Occlusion is applied as a tinted multiply (water-coloured, not black) which is
 * what keeps it from reading as dirt in the corners.
 */

const GTAO_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform mat4 uProjInv;
uniform mat4 uView;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uRadius;
uniform float uThickness;
uniform float uProjScale;
uniform float uFrameJitter;

#ifndef SLICES
#define SLICES 2
#endif
#ifndef STEPS
#define STEPS 6
#endif

vec3 loadViewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return viewPosFromDepth(uv, d, uProjInv);
}

void main() {
  vec4 nm = texture2D(tNormal, vUv);
  if (nm.w < 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);   // sky: fully visible
    return;
  }

  float d = texture2D(tDepth, vUv).x;
  vec3 P = viewPosFromDepth(vUv, d, uProjInv);
  vec3 N = normalize((uView * vec4(normalize(nm.xyz), 0.0)).xyz);
  vec3 V = normalize(-P);

  // Radius in pixels shrinks with distance so AO stays world-space sized.
  float radiusPix = clamp(uRadius * uProjScale / max(0.05, -P.z), 3.0, 128.0);
  float stepPix = radiusPix / float(STEPS);

  // Per-pixel rotation + per-step offset: cheap, and the temporal filter below
  // turns the resulting noise into detail rather than fizz.
  float rot = ign(gl_FragCoord.xy + uFrameJitter * 5.588238);
  float off = fract(rot * 3.14159 + uFrameJitter * 0.618034);

  float visibility = 0.0;
  vec3 bent = vec3(0.0);
  float weightSum = 0.0;

  for (int s = 0; s < SLICES; s++) {
    float phi = (float(s) + rot) * (PI / float(SLICES));
    vec2 dir = vec2(cos(phi), sin(phi));
    vec3 sliceDir = vec3(dir, 0.0);

    vec3 axis = normalize(cross(sliceDir, V));
    vec3 projN = N - axis * dot(N, axis);
    float projLen = length(projN);
    if (projLen < 1e-4) continue;
    vec3 projNn = projN / projLen;

    vec3 orthoDir = normalize(sliceDir - V * dot(sliceDir, V));
    float sgn = sign(dot(orthoDir, projNn));
    float cosN = clamp(dot(projNn, V), -1.0, 1.0);
    float n = sgn * acos(cosN);

    float best0 = -1.0;   // +dir horizon cosine
    float best1 = -1.0;   // -dir horizon cosine

    for (int j = 0; j < STEPS; j++) {
      float t = (float(j) + off) * stepPix;
      vec2 duv = dir * t * uTexel;

      vec2 uv0 = vUv + duv;
      vec2 uv1 = vUv - duv;

      vec3 s0 = loadViewPos(uv0) - P;
      vec3 s1 = loadViewPos(uv1) - P;

      float l0 = length(s0);
      float l1 = length(s1);

      float c0 = l0 > 1e-5 ? dot(s0 / l0, V) : -1.0;
      float c1 = l1 > 1e-5 ? dot(s1 / l1, V) : -1.0;

      // Distance falloff + a thin-occluder allowance so thin kelp blades do not
      // cast a full-strength shadow across the whole radius.
      float w0 = sat((uRadius - l0) / max(uRadius * uThickness, 1e-3));
      float w1 = sat((uRadius - l1) / max(uRadius * uThickness, 1e-3));
      c0 = mix(-1.0, c0, w0);
      c1 = mix(-1.0, c1, w1);

      // Reject samples on the wrong side of the tangent plane (self occlusion).
      if (dot(s0, N) < 0.0) c0 = -1.0;
      if (dot(s1, N) < 0.0) c1 = -1.0;

      best0 = max(best0, c0);
      best1 = max(best1, c1);
    }

    float h0 = -acos(clamp(best1, -1.0, 1.0));
    float h1 = acos(clamp(best0, -1.0, 1.0));
    h0 = n + max(h0 - n, -1.5707963);
    h1 = n + min(h1 - n, 1.5707963);

    float iarc0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
    float iarc1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
    visibility += projLen * (iarc0 + iarc1);

    float mid = (h0 + h1) * 0.5;
    bent += projLen * normalize(V * cos(mid) + orthoDir * sin(mid));
    weightSum += projLen;
  }

  if (weightSum < 1e-4) {
    gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  float ao = sat(visibility / weightSum);
  vec3 bentN = normalize(bent / weightSum);
  gl_FragColor = vec4(bentN * 0.5 + 0.5, ao);
}
`;

const GTAO_DENOISE_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tAo;
uniform sampler2D tHistory;
uniform sampler2D tVelocity;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uBlend;
uniform float uValid;

void main() {
  float centreZ = depthMetres(texture2D(tDepth, vUv).x, uNear, uFar);

  // Cross bilateral: the spatial half of the denoiser. Depth weighting is what
  // stops occlusion bleeding across silhouettes into a halo.
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 o = vec2(float(x), float(y)) * uTexel;
      vec4 s = texture2D(tAo, vUv + o);
      float z = depthMetres(texture2D(tDepth, vUv + o).x, uNear, uFar);
      float wz = exp2(-abs(z - centreZ) * 4.0);
      float wr = exp2(-float(x * x + y * y) * 0.35);
      float w = wz * wr;
      sum += s * w;
      wsum += w;
    }
  }
  vec4 spatial = sum / max(wsum, 1e-4);

  // Temporal half: reproject, reject on depth mismatch, exponential blend.
  vec2 vel = texture2D(tVelocity, vUv).xy;
  vec2 hUv = vUv - vel;
  float inside = (hUv.x > 0.0 && hUv.x < 1.0 && hUv.y > 0.0 && hUv.y < 1.0) ? 1.0 : 0.0;
  vec4 hist = texture2D(tHistory, hUv);
  float histZ = depthMetres(texture2D(tDepth, hUv).x, uNear, uFar);
  float zOk = exp2(-abs(histZ - centreZ) * 1.5);
  float k = uBlend * inside * uValid * zOk;

  gl_FragColor = mix(spatial, hist, k);
}
`;

const GTAO_APPLY_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 uAoTexel;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uIntensity;
uniform float uPower;
uniform vec3 uOcclusionTint;
uniform vec3 uSunDirView;

/** Depth-aware upsample of the half-res AO buffer. */
vec4 upsampleAo(vec2 uv, float centreZ) {
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int y = 0; y <= 1; y++) {
    for (int x = 0; x <= 1; x++) {
      vec2 o = (vec2(float(x), float(y)) - 0.5) * uAoTexel;
      vec4 s = texture2D(tAo, uv + o);
      float z = depthMetres(texture2D(tDepth, uv + o).x, uNear, uFar);
      float w = exp2(-abs(z - centreZ) * 3.0) + 1e-3;
      sum += s * w;
      wsum += w;
    }
  }
  return sum / wsum;
}

void main() {
  vec3 color = texture2D(tColor, vUv).rgb;
  float mask = texture2D(tNormal, vUv).w;
  if (mask < 0.5) {
    gl_FragColor = vec4(color, 1.0);
    return;
  }
  float centreZ = depthMetres(texture2D(tDepth, vUv).x, uNear, uFar);
  vec4 aoData = upsampleAo(vUv, centreZ);
  float ao = pow(sat(aoData.w), uPower);
  vec3 bent = normalize(aoData.xyz * 2.0 - 1.0);

  // Bent normal term: surfaces whose unoccluded cone points away from the light
  // lose a little more, which is what gives crevices their directionality.
  float bentTerm = mix(1.0, sat(dot(bent, uSunDirView) * 0.5 + 0.5), 0.35);

  float occ = 1.0 - (1.0 - ao * bentTerm) * uIntensity;
  vec3 tint = mix(uOcclusionTint, vec3(1.0), occ);
  gl_FragColor = vec4(color * occ * tint, 1.0);
}
`;

/** Hoisted so the per-frame tint blend never allocates. */
const NEUTRAL_OCCLUSION = new THREE.Color(0.35, 0.45, 0.5);

export class GtaoPass extends PostPass {
  readonly id = 'gtao';

  private aoTarget: THREE.WebGLRenderTarget;
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private historyIndex = 0;
  private readonly computeMat: THREE.ShaderMaterial;
  private readonly denoiseMat: THREE.ShaderMaterial;
  private readonly applyMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  private scale = 0.5;
  private historyValid = false;
  private readonly sunView = new THREE.Vector3();

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.width = width;
    this.height = height;
    const aw = Math.max(1, Math.floor(width * this.scale));
    const ah = Math.max(1, Math.floor(height * this.scale));

    this.aoTarget = makeTarget(aw, ah, { name: 'post.ao' });
    this.history = [
      makeTarget(aw, ah, { name: 'post.aoHistA' }),
      makeTarget(aw, ah, { name: 'post.aoHistB' }),
    ];

    this.computeMat = new THREE.ShaderMaterial({
      name: 'post/gtao',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GTAO_FRAG,
      defines: { SLICES: '2', STEPS: '6' },
      uniforms: {
        tDepth: { value: null },
        tNormal: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() },
        uResolution: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uRadius: { value: 1.7 },
        uThickness: { value: 0.45 },
        uProjScale: { value: 500 },
        uFrameJitter: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.denoiseMat = new THREE.ShaderMaterial({
      name: 'post/gtao-denoise',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GTAO_DENOISE_FRAG,
      uniforms: {
        tAo: { value: null },
        tHistory: { value: null },
        tVelocity: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uBlend: { value: 0.87 },
        uValid: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.applyMat = new THREE.ShaderMaterial({
      name: 'post/gtao-apply',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GTAO_APPLY_FRAG,
      uniforms: {
        tColor: { value: null },
        tAo: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        uAoTexel: { value: new THREE.Vector2() },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uIntensity: { value: 0.85 },
        uPower: { value: 1.35 },
        uOcclusionTint: { value: new THREE.Color(0.28, 0.52, 0.62) },
        uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
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
    this.resizeAo();
  }

  private resizeAo(): void {
    const aw = Math.max(1, Math.floor(this.width * this.scale));
    const ah = Math.max(1, Math.floor(this.height * this.scale));
    this.aoTarget.setSize(aw, ah);
    this.history[0].setSize(aw, ah);
    this.history[1].setSize(aw, ah);
    this.historyValid = false;
  }

  override configure(frame: FrameContext): void {
    this.enabled = frame.settings.gtao && frame.prepassValid;
    const wantScale = frame.settings.tier === 'ultra' ? 1 : 0.5;
    if (wantScale !== this.scale) {
      this.scale = wantScale;
      this.resizeAo();
    }
    const slices = frame.settings.tier === 'ultra' ? '3' : '2';
    const steps = frame.settings.tier === 'ultra' ? '10' : '6';
    if (this.computeMat.defines.SLICES !== slices || this.computeMat.defines.STEPS !== steps) {
      this.computeMat.defines.SLICES = slices;
      this.computeMat.defines.STEPS = steps;
      this.computeMat.needsUpdate = true;
    }
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;
    const aw = this.aoTarget.width;
    const ah = this.aoTarget.height;

    const cu = this.computeMat.uniforms;
    cu.tDepth.value = frame.depth;
    cu.tNormal.value = frame.normal;
    (cu.uProjInv.value as THREE.Matrix4).copy(frame.projInv);
    (cu.uView.value as THREE.Matrix4).copy(frame.view);
    (cu.uTexel.value as THREE.Vector2).set(1 / aw, 1 / ah);
    (cu.uResolution.value as THREE.Vector2).set(aw, ah);
    cu.uNear.value = frame.near;
    cu.uFar.value = frame.far;
    cu.uProjScale.value = 0.5 * ah * frame.proj.elements[5];
    cu.uFrameJitter.value = frame.frame % 8;
    frame.blit.draw(renderer, this.computeMat, this.aoTarget);

    // Denoise into the free history slot, then use it as this frame's AO.
    const dst = this.history[this.historyIndex];
    const src = this.history[1 - this.historyIndex];
    const du = this.denoiseMat.uniforms;
    du.tAo.value = this.aoTarget.texture;
    du.tHistory.value = src.texture;
    du.tVelocity.value = frame.velocity;
    du.tDepth.value = frame.depth;
    (du.uTexel.value as THREE.Vector2).set(1 / aw, 1 / ah);
    du.uNear.value = frame.near;
    du.uFar.value = frame.far;
    du.uValid.value = this.historyValid && frame.historyValid ? 1 : 0;
    frame.blit.draw(renderer, this.denoiseMat, dst);
    this.historyIndex = 1 - this.historyIndex;
    this.historyValid = true;

    frame.ao = dst.texture;

    // Composite onto the frame.
    this.sunView.copy(frame.sunDirection).transformDirection(frame.view);
    const au = this.applyMat.uniforms;
    au.tColor.value = frame.color;
    au.tAo.value = dst.texture;
    au.tDepth.value = frame.depth;
    au.tNormal.value = frame.normal;
    (au.uAoTexel.value as THREE.Vector2).set(1 / aw, 1 / ah);
    (au.uTexel.value as THREE.Vector2).set(1 / frame.width, 1 / frame.height);
    au.uNear.value = frame.near;
    au.uFar.value = frame.far;
    (au.uSunDirView.value as THREE.Vector3).copy(this.sunView);
    // Occlusion is tinted toward the surrounding water so contact shadows read
    // as shadowed water, not as grime.
    (au.uOcclusionTint.value as THREE.Color).copy(frame.waterInscatter).lerp(NEUTRAL_OCCLUSION, 0.4);
    au.uIntensity.value = frame.underwater ? 0.9 : 0.75;

    const out = frame.pool.next(frame.color);
    frame.blit.draw(renderer, this.applyMat, out);
    frame.color = out.texture;
  }

  override dispose(): void {
    this.aoTarget.dispose();
    this.history[0].dispose();
    this.history[1].dispose();
    this.computeMat.dispose();
    this.denoiseMat.dispose();
    this.applyMat.dispose();
  }
}

import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { FULLSCREEN_VERT, POST_COMMON } from '../shaders/Common';

/**
 * Screen-space reflections for the water interface and wet surfaces.
 *
 * March: coarse linear steps in *screen space* (so step size is uniform in
 * pixels regardless of depth), then five binary refinement iterations on the
 * bracketing interval. Hits are shaded from a small mip pyramid of the incoming
 * colour so the reflection cone widens with roughness instead of staying a
 * mirror. Rays fade out on: screen-edge proximity, ray miss, exceeding the
 * thickness test, and grazing/steep reflectivity.
 *
 * Reflectivity is derived from surface orientation and depth rather than a
 * material roughness channel (the prepass is material-agnostic): up-facing
 * surfaces get the strongest response, which is exactly the water plane and the
 * flat wet rock/sand that should be reflecting.
 */

const SSR_TRACE_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform mat4 uView;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uMaxDistance;
uniform float uThickness;
uniform float uStride;
uniform float uJitter;
uniform float uRoughness;
uniform float uMaxMip;

#ifndef SSR_STEPS
#define SSR_STEPS 20
#endif
#define SSR_REFINE 5

/** Project a view-space point to screen uv + window depth. */
vec3 toScreen(vec3 viewPos) {
  vec4 clip = uProj * vec4(viewPos, 1.0);
  vec3 ndc = clip.xyz / clip.w;
  return vec3(ndc.xy * 0.5 + 0.5, ndc.z * 0.5 + 0.5);
}

void main() {
  vec4 nm = texture2D(tNormal, vUv);
  if (nm.w < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float d = texture2D(tDepth, vUv).x;
  vec3 P = viewPosFromDepth(vUv, d, uProjInv);
  vec3 Nw = normalize(nm.xyz);
  vec3 N = normalize((uView * vec4(Nw, 0.0)).xyz);
  vec3 V = normalize(-P);

  // How reflective is this surface? Up-facing = water/wet flats.
  float upness = sat(Nw.y * 0.5 + 0.5);
  upness = pow(upness, 3.0);
  float fresnel = pow(1.0 - sat(dot(N, V)), 4.0);
  float reflectivity = sat(upness * (0.10 + 0.90 * fresnel) * 2.2);
  if (reflectivity < 0.006) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 R = normalize(reflect(-V, N));

  float rayLen = uMaxDistance;
  // Clip the ray to the near plane so the screen-space end point stays valid.
  if (R.z > 1e-4) {
    float lim = (-uNear - P.z) / R.z;
    if (lim <= 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }
    rayLen = min(rayLen, lim);
  }

  vec3 startV = P + N * 0.02;
  vec3 endV = P + R * rayLen;

  vec3 s0 = toScreen(startV);
  vec3 s1 = toScreen(endV);

  vec2 pixelDelta = (s1.xy - s0.xy) / uTexel;
  float pixels = max(abs(pixelDelta.x), abs(pixelDelta.y));
  float steps = min(float(SSR_STEPS), max(4.0, pixels / uStride));
  float dt = 1.0 / steps;

  float jitter = ign(gl_FragCoord.xy + uJitter * 7.31) * dt;

  float tPrev = 0.0;
  float t = jitter;
  float hitT = -1.0;

  for (int i = 0; i < SSR_STEPS; i++) {
    if (float(i) >= steps) break;
    t = min(1.0, jitter + (float(i) + 1.0) * dt);
    vec3 s = mix(s0, s1, t);
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) break;

    // Compare in metres: perspective-correct because both come from the same
    // depth reconstruction.
    float sceneZ = depthMetres(texture2D(tDepth, s.xy).x, uNear, uFar);
    float rayZ = -mix(startV, endV, t).z;
    float diff = rayZ - sceneZ;

    if (diff > 0.0) {
      if (diff < uThickness + rayZ * 0.02) {
        hitT = t;
        break;
      }
      // Went behind a foreground object: give up rather than smear.
      break;
    }
    tPrev = t;
  }

  if (hitT < 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Binary refinement between the last miss and the hit.
  float lo = tPrev;
  float hi = hitT;
  for (int i = 0; i < SSR_REFINE; i++) {
    float mid = (lo + hi) * 0.5;
    vec3 s = mix(s0, s1, mid);
    float sceneZ = depthMetres(texture2D(tDepth, s.xy).x, uNear, uFar);
    float rayZ = -mix(startV, endV, mid).z;
    if (rayZ - sceneZ > 0.0) hi = mid; else lo = mid;
  }

  vec3 hit = mix(s0, s1, hi);
  vec3 hitView = mix(startV, endV, hi);

  // Reject reflections off surfaces facing away from the ray (backfaces).
  vec3 hitN = normalize((uView * vec4(normalize(texture2D(tNormal, hit.xy).xyz), 0.0)).xyz);
  float backface = sat(-dot(hitN, R));
  if (backface <= 0.02) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Roughness-aware cone: longer rays sample a blurrier mip.
  float travel = length(hitView - startV);
  float cone = uRoughness * travel * 4.0;
  float mip = clamp(log2(max(1.0, cone)), 0.0, uMaxMip);
  vec3 refl = textureLod(tColor, hit.xy, mip).rgb;

  // Fades: screen border, ray length, grazing angle.
  vec2 edge = min(hit.xy, 1.0 - hit.xy);
  float edgeFade = sat(min(edge.x, edge.y) / 0.08);
  edgeFade *= sat((1.0 - hi) * 4.0 + 0.15);
  float distFade = 1.0 - sat(travel / uMaxDistance);

  float weight = reflectivity * edgeFade * distFade * backface;
  gl_FragColor = vec4(refl * weight, weight);
}
`;

const SSR_RESOLVE_FRAG = /* glsl */ `
${POST_COMMON}
varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tSsr;
uniform sampler2D tDepth;
uniform vec2 uSsrTexel;
uniform float uNear;
uniform float uFar;
uniform float uIntensity;

void main() {
  vec3 base = texture2D(tColor, vUv).rgb;

  // 3x3 tent upsample of the half-res reflection buffer: cheap, and the
  // pre-multiplied weight makes it behave correctly across misses.
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      acc += texture2D(tSsr, vUv + vec2(float(x), float(y)) * uSsrTexel) * w;
      wsum += w;
    }
  }
  acc /= wsum;

  gl_FragColor = vec4(base + acc.rgb * uIntensity, 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }
`;

const MIP_LEVELS = 4;

export class SsrPass extends PostPass {
  readonly id = 'ssr';

  private traceTarget: THREE.WebGLRenderTarget;
  /** Half-res mip-mapped copy of the incoming colour, for the reflection cone. */
  private coneTarget: THREE.WebGLRenderTarget;
  private readonly traceMat: THREE.ShaderMaterial;
  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.width = width;
    this.height = height;
    this.traceTarget = makeTarget(width >> 1, height >> 1, { name: 'post.ssr' });
    this.coneTarget = makeTarget(width >> 1, height >> 1, {
      name: 'post.ssrCone',
      generateMipmaps: true,
    });

    this.traceMat = new THREE.ShaderMaterial({
      name: 'post/ssr-trace',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SSR_TRACE_FRAG,
      defines: { SSR_STEPS: '20' },
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uMaxDistance: { value: 55 },
        uThickness: { value: 0.5 },
        uStride: { value: 10 },
        uJitter: { value: 0 },
        uRoughness: { value: 0.055 },
        uMaxMip: { value: MIP_LEVELS - 1 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.resolveMat = new THREE.ShaderMaterial({
      name: 'post/ssr-resolve',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SSR_RESOLVE_FRAG,
      uniforms: {
        tColor: { value: null },
        tSsr: { value: null },
        tDepth: { value: null },
        uSsrTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uIntensity: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.copyMat = new THREE.ShaderMaterial({
      name: 'post/ssr-cone-copy',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COPY_FRAG,
      uniforms: { tSrc: { value: null } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
  }

  override setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.traceTarget.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    this.coneTarget.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
  }

  override configure(frame: FrameContext): void {
    this.enabled = frame.settings.ssr && frame.prepassValid;
    const steps = frame.settings.tier === 'ultra' ? '32' : '20';
    if (this.traceMat.defines.SSR_STEPS !== steps) {
      this.traceMat.defines.SSR_STEPS = steps;
      this.traceMat.needsUpdate = true;
    }
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;

    // Half-res mip-mapped copy of the incoming colour. three regenerates the
    // mip chain automatically after rendering into a generateMipmaps target,
    // which is what makes the roughness cone (`textureLod`) work.
    this.copyMat.uniforms.tSrc.value = frame.color;
    frame.blit.draw(renderer, this.copyMat, this.coneTarget);

    const tu = this.traceMat.uniforms;
    tu.tColor.value = this.coneTarget.texture;
    tu.tDepth.value = frame.depth;
    tu.tNormal.value = frame.normal;
    (tu.uProj.value as THREE.Matrix4).copy(frame.proj);
    (tu.uProjInv.value as THREE.Matrix4).copy(frame.projInv);
    (tu.uView.value as THREE.Matrix4).copy(frame.view);
    (tu.uTexel.value as THREE.Vector2).set(1 / this.traceTarget.width, 1 / this.traceTarget.height);
    tu.uNear.value = frame.near;
    tu.uFar.value = frame.far;
    tu.uJitter.value = frame.frame % 16;
    tu.uMaxDistance.value = frame.underwater ? 40 : 90;
    frame.blit.draw(renderer, this.traceMat, this.traceTarget);

    const ru = this.resolveMat.uniforms;
    ru.tColor.value = frame.color;
    ru.tSsr.value = this.traceTarget.texture;
    ru.tDepth.value = frame.depth;
    (ru.uSsrTexel.value as THREE.Vector2).set(
      1 / this.traceTarget.width,
      1 / this.traceTarget.height,
    );
    ru.uNear.value = frame.near;
    ru.uFar.value = frame.far;
    ru.uIntensity.value = frame.underwater ? 0.85 : 1.15;

    const out = frame.pool.next(frame.color);
    frame.blit.draw(renderer, this.resolveMat, out);
    frame.color = out.texture;
  }

  override dispose(): void {
    this.traceTarget.dispose();
    this.coneTarget.dispose();
    this.traceMat.dispose();
    this.resolveMat.dispose();
    this.copyMat.dispose();
  }
}

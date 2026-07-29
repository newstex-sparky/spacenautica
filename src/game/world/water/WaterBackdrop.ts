import * as THREE from 'three';
import { WATER_NOISE_GLSL } from './WaterNoise';
import {
  UNDERWATER_FARFIELD_GLSL,
  UNDERWATER_FUNCS_GLSL,
  UNDERWATER_UNIFORMS_GLSL,
} from './UnderwaterFog';

/**
 * The underwater far field.
 *
 * Everything solid gets `applyUnderwater()` applied to it, so a distant rock
 * converges to the open-water radiance for its direction. Whatever fills the
 * pixels where *no* geometry was drawn has to converge to the same value, or the
 * silhouette of the last thing that did draw becomes a visible edge. That is
 * exactly what went wrong in round 1: the ocean surface, seen from below, spans
 * the upper hemisphere and terminates in a mathematically hard line at the
 * eye-level horizon, and the sky dome behind it was shaded by a different path.
 * The result was a razor-sharp horizontal seam across the full width of every
 * submerged frame, sitting at whatever screen height the eye-level horizon
 * happened to be.
 *
 * So the water owns its own background. This is a full-screen quad drawn
 * immediately after the sky dome and before all scene geometry, evaluating
 * `waterFarField()` — literally `applyUnderwater(black, ...)` for a ray that runs
 * to infinity. Continuity at the horizon is then structural, not tuned: both
 * sides call the same function with the same arguments in the limit.
 *
 * It is also what gives a submerged frame its sense of volume. Because the
 * integral carries the ray's depth gradient, the far field brightens toward the
 * surface and falls away below with the correct per-wavelength separation — red
 * gone in metres, blue carrying to the horizon — instead of being one flat tint.
 */

const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform mat4  uInvViewProj;
uniform vec3  uCamPos;
uniform float uMaxDist;
uniform vec2  uResolution;
uniform float uMurk;

varying vec2 vNdc;

${UNDERWATER_UNIFORMS_GLSL}
${WATER_NOISE_GLSL}
${UNDERWATER_FUNCS_GLSL}
${UNDERWATER_FARFIELD_GLSL}

void main() {
  vec4 far = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(far.xyz / far.w - uCamPos);

  vec3 col = waterFarField(rd, uMaxDist);

  // Very low-frequency drifting murk. Open water is never perfectly uniform;
  // a few percent of large-scale variation is the difference between "distance"
  // and "flat fill", and it also breaks up gradient banding.
  //
  // Faded out at the horizontal, where the far ocean surface's own silhouette
  // meets the backdrop. Solid geometry carries no murk, so leaving it switched
  // on across that boundary would reintroduce a (soft, but still horizontal and
  // still frame-wide) seam — the exact artifact this file exists to remove.
  vec2 mp = vec2(atan(rd.z, rd.x) * 1.4, rd.y * 2.6) + vec2(uwTime * 0.011, uwTime * -0.006);
  float m = wnFbm(mp, 3);
  col *= 1.0 + m * uMurk * smoothstep(0.0, 0.24, abs(rd.y));

  // Ordered dither at roughly one 8-bit step: the gradient spans a very small
  // luminance range over hundreds of pixels, which bands badly otherwise.
  vec2 px = gl_FragCoord.xy;
  float dith = fract(dot(px, vec2(0.7548776662, 0.5698402909))) - 0.5;
  col += dith * 0.0016;

  bvec3 bad = notEqual(col, col);
  col = mix(col, uwInscatter, vec3(bad));
  gl_FragColor = vec4(min(max(col, vec3(0.0)), vec3(96.0)), 1.0);
}
`;

export class WaterBackdrop {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(shared: Record<string, THREE.IUniform>) {
    const own: Record<string, THREE.IUniform> = {
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uMaxDist: { value: 3000 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uMurk: { value: 0.05 },
    };

    this.mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(own, shared),
      vertexShader: VERT,
      fragmentShader: FRAG,
      // Opaque on purpose. Transparent objects are drawn *after* the opaque
      // list, which would put the background on top of the world; as an opaque
      // draw with renderOrder below everything else it lands exactly where a
      // background belongs. depthWrite:false also keeps it out of the geometry
      // prepass (see PrepassMaterialCache.includes), so depth-based passes and
      // the god-ray march still see real scene depth.
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    // Never swap this for a prepass material even if the heuristics change.
    this.mat.userData.prepass = false;
    this.mat.userData.waterAware = true;

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.name = 'water.backdrop';
    this.mesh.frustumCulled = false;
    // The sky dome sits at -10000; this must come after it and before the world.
    this.mesh.renderOrder = -9990;
    this.mesh.visible = false;
    this.mesh.userData.prepass = false;
  }

  /**
   * @param cameraDepth metres below the surface, 0 when the eye is in air. The
   *   last few centimetres are handed back to the sky, which is both cheaper and
   *   correct while the eye is straddling the interface.
   */
  update(camera: THREE.PerspectiveCamera, cameraDepth: number, turbidity: number): void {
    this.mesh.visible = cameraDepth > 0.04;
    if (!this.mesh.visible) return;
    const u = this.mat.uniforms;
    camera.updateMatrixWorld();
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    (u.uInvViewProj.value as THREE.Matrix4).copy(_vp).invert();
    (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    u.uMurk.value = 0.035 + 0.05 * THREE.MathUtils.clamp(turbidity, 0, 2);
  }

  setResolution(w: number, h: number): void {
    (this.mat.uniforms.uResolution.value as THREE.Vector2).set(Math.max(1, w), Math.max(1, h));
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}

const _vp = new THREE.Matrix4();

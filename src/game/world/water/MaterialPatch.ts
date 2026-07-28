import * as THREE from 'three';
import {
  UNDERWATER_CAUSTICS_GLSL,
  UNDERWATER_CAUSTICS_UNIFORMS_GLSL,
  UNDERWATER_FUNCS_GLSL,
  UNDERWATER_UNIFORMS_GLSL,
} from './UnderwaterFog';

/**
 * Retrofits wavelength-dependent underwater scattering onto a stock
 * `MeshStandardMaterial`/`MeshPhysicalMaterial`/`MeshLambertMaterial`.
 *
 * `CONTRACTS.md` requires every material that draws geometry below the surface
 * to mix in `WaterSystem.sharedUniforms` and the fog chunk. Materials authored
 * with that in mind do it themselves; this exists so that anything which has not
 * (yet) been upgraded still renders in the correct water instead of falling back
 * to a flat `THREE.Fog`. It is additive only — it never touches lighting — and it
 * chains any `onBeforeCompile` already installed rather than replacing it.
 *
 * Materials are skipped when they look water-aware already (see `isWaterAware`).
 */

const PATCH_FLAG = '__uwPatched';

type Patchable = THREE.Material & {
  onBeforeCompile: THREE.Material['onBeforeCompile'];
  fog?: boolean;
  userData: Record<string, unknown>;
};

/** True when the material already handles underwater scattering itself. */
export function isWaterAware(mat: THREE.Material): boolean {
  const ud = mat.userData as Record<string, unknown>;
  if (ud.underwater === true || ud.waterAware === true) return true;
  if ((mat as unknown as { isShaderMaterial?: boolean }).isShaderMaterial) return true;
  // A custom onBeforeCompile that mentions applyUnderwater is doing this already.
  const src = String(mat.onBeforeCompile);
  return src.includes('applyUnderwater') || src.includes('uwExtinction');
}

function supported(mat: THREE.Material): boolean {
  const m = mat as unknown as {
    isMeshStandardMaterial?: boolean;
    isMeshPhysicalMaterial?: boolean;
    isMeshLambertMaterial?: boolean;
    isMeshPhongMaterial?: boolean;
  };
  return Boolean(
    m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial,
  );
}

/**
 * Injects the scattering chunks into `mat`. Returns true when the material was
 * patched by this call.
 */
export function patchUnderwater(mat: THREE.Material, uniforms: Record<string, THREE.IUniform>): boolean {
  const m = mat as Patchable;
  if (m.userData[PATCH_FLAG]) return false;
  if (!supported(mat) || isWaterAware(mat)) {
    m.userData[PATCH_FLAG] = 'skipped';
    return false;
  }

  const previous = m.onBeforeCompile;
  m.userData[PATCH_FLAG] = true;
  // The stock fog would double up with our scattering.
  if ('fog' in m) m.fog = false;

  m.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vUwWorld;
varying vec3 vUwNormalW;
void main() {`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `vec4 uwWP = vec4(transformed, 1.0);
mat3 uwNM = mat3(modelMatrix);
#ifdef USE_BATCHING
  uwWP = batchingMatrix * uwWP;
  uwNM = uwNM * mat3(batchingMatrix);
#endif
#ifdef USE_INSTANCING
  uwWP = instanceMatrix * uwWP;
  uwNM = uwNM * mat3(instanceMatrix);
#endif
uwWP = modelMatrix * uwWP;
vUwWorld = uwWP.xyz;
vUwNormalW = normalize(uwNM * objectNormal);
#include <worldpos_vertex>`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vUwWorld;
varying vec3 vUwNormalW;
${UNDERWATER_UNIFORMS_GLSL}
${UNDERWATER_CAUSTICS_UNIFORMS_GLSL}
${UNDERWATER_FUNCS_GLSL}
${UNDERWATER_CAUSTICS_GLSL}
void main() {`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        `{
  vec3 uwToPoint = vUwWorld - cameraPosition;
  float uwDist = length(uwToPoint);
  vec3 uwDir = uwToPoint / max(uwDist, 1e-4);
  // Only shade what is actually under water.
  if (vUwWorld.y < uwSurfaceY) {
    // Caustics in-material are a fallback for when no depth buffer is exposed
    // for the screen-space pass (uwCausticsParams.w selects).
    if (uwCausticsParams.w > 0.5) {
      vec3 c = waterCaustics(vUwWorld, normalize(vUwNormalW));
      gl_FragColor.rgb += c * uwSunColor * waterDownwelling(uwSurfaceY - vUwWorld.y);
    }
    gl_FragColor.rgb = applyUnderwater(gl_FragColor.rgb, uwDist, vUwWorld.y, uwDir);
  }
}
#include <tonemapping_fragment>`,
      );
  };

  mat.needsUpdate = true;
  return true;
}

/**
 * Walks a scene graph and patches every eligible material once.
 * `skip` lets the water system exclude its own objects.
 */
export function patchScene(
  root: THREE.Object3D,
  uniforms: Record<string, THREE.IUniform>,
  skip: (obj: THREE.Object3D) => boolean,
): number {
  let n = 0;
  const walk = (obj: THREE.Object3D): void => {
    if (skip(obj)) return; // prune the whole subtree
    const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      if (Array.isArray(mat)) {
        for (const m of mat) if (patchUnderwater(m, uniforms)) n++;
      } else if (patchUnderwater(mat, uniforms)) {
        n++;
      }
    }
    for (const child of obj.children) walk(child);
  };
  walk(root);
  return n;
}

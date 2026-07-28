import * as THREE from 'three';

/**
 * Material factory for the geometry prepass.
 *
 * The prepass cannot use `scene.overrideMaterial`, because that would throw away
 * alpha testing (every kelp blade becomes a solid quad in the depth buffer) and
 * the per-material `side`. Instead each source material gets a matching
 * `ShaderMaterial` that keeps `map` / `alphaMap` / `alphaTest` / `side`, and the
 * mesh's material reference is swapped for the duration of the prepass draw and
 * restored immediately afterwards.
 *
 * Instancing, batching, skinning and morph targets all come for free because the
 * shader uses three's standard vertex chunks; world-space position and normal are
 * derived from view space with the camera's `matrixWorld`, so no extra per-object
 * uniforms are needed for static geometry.
 */

const PREPASS_VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

uniform mat4 uViewInv;
uniform mat4 uCurViewProj;
uniform mat4 uPrevViewProj;
uniform mat3 uMapTransform;
#ifdef DYNAMIC_VELOCITY
uniform mat4 uPrevModel;
#endif

varying vec3 vWorldNormal;
varying vec2 vMapUvP;
varying vec4 vCurClip;
varying vec4 vPrevClip;

void main() {
  vMapUvP = (uMapTransform * vec3(uv, 1.0)).xy;

  #include <morphinstance_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vec4 worldPos = uViewInv * mvPosition;
  vWorldNormal = mat3(uViewInv) * transformedNormal;

  vCurClip = uCurViewProj * worldPos;
  #ifdef DYNAMIC_VELOCITY
    vPrevClip = uPrevViewProj * (uPrevModel * vec4(transformed, 1.0));
  #else
    vPrevClip = uPrevViewProj * worldPos;
  #endif
}
`;

const PREPASS_FRAG = /* glsl */ `
layout(location = 0) out vec4 outNormal;
layout(location = 1) out vec4 outVelocity;

varying vec3 vWorldNormal;
varying vec2 vMapUvP;
varying vec4 vCurClip;
varying vec4 vPrevClip;

#ifdef USE_MAP
uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
uniform sampler2D alphaMap;
#endif
#ifdef USE_ALPHATEST
uniform float alphaTest;
#endif

void main() {
  float a = 1.0;
  #ifdef USE_MAP
    a *= texture2D(map, vMapUvP).a;
  #endif
  #ifdef USE_ALPHAMAP
    a *= texture2D(alphaMap, vMapUvP).g;
  #endif
  #ifdef USE_ALPHATEST
    if (a < alphaTest) discard;
  #endif

  vec3 n = normalize(vWorldNormal);
  #ifdef DOUBLE_SIDED
    n *= gl_FrontFacing ? 1.0 : -1.0;
  #endif

  vec2 curUv = vCurClip.xy / vCurClip.w * 0.5 + 0.5;
  vec2 prevUv = vPrevClip.xy / vPrevClip.w * 0.5 + 0.5;

  outNormal = vec4(n, 1.0);
  outVelocity = vec4(curUv - prevUv, 0.0, 1.0);
}
`;

/** Uniform objects shared by reference across every cached prepass material. */
export interface PrepassShared {
  uViewInv: { value: THREE.Matrix4 };
  uCurViewProj: { value: THREE.Matrix4 };
  uPrevViewProj: { value: THREE.Matrix4 };
}

const IDENTITY3 = new THREE.Matrix3();

type SourceMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
};

export class PrepassMaterialCache {
  readonly shared: PrepassShared = {
    uViewInv: { value: new THREE.Matrix4() },
    uCurViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
  };

  /** One prepass material per source material (static geometry). */
  private readonly statics = new Map<THREE.Material, THREE.ShaderMaterial>();
  /** One prepass material per registered dynamic object. */
  private readonly dynamics = new Map<THREE.Object3D, THREE.ShaderMaterial>();

  /**
   * True when this object/material combination should contribute to the
   * depth/normal/velocity buffers. Transparent and non-depth-writing draws are
   * excluded by default (they would punch holes in AO/SSR/DOF); anything can
   * opt in or out explicitly with `userData.prepass`.
   */
  static includes(object: THREE.Object3D, material: THREE.Material): boolean {
    const objOpt = (object.userData as { prepass?: boolean }).prepass;
    if (objOpt !== undefined) return objOpt;
    const matOpt = (material.userData as { prepass?: boolean }).prepass;
    if (matOpt !== undefined) return matOpt;
    if (material.transparent) return false;
    if (material.depthWrite === false) return false;
    return true;
  }

  private build(src: SourceMaterial, dynamic: boolean): THREE.ShaderMaterial {
    const mapTransform = new THREE.Matrix3();
    const tex = src.map ?? src.alphaMap ?? null;
    if (tex) {
      tex.updateMatrix();
      mapTransform.copy(tex.matrix);
    } else {
      mapTransform.copy(IDENTITY3);
    }

    const mat = new THREE.ShaderMaterial({
      name: `prepass:${src.name || src.type}`,
      glslVersion: THREE.GLSL3,
      vertexShader: PREPASS_VERT,
      fragmentShader: PREPASS_FRAG,
      uniforms: {
        uViewInv: this.shared.uViewInv,
        uCurViewProj: this.shared.uCurViewProj,
        uPrevViewProj: this.shared.uPrevViewProj,
        uMapTransform: { value: mapTransform },
        uPrevModel: { value: new THREE.Matrix4() },
        map: { value: src.map ?? null },
        alphaMap: { value: src.alphaMap ?? null },
        alphaTest: { value: src.alphaTest },
      },
      defines: dynamic ? { DYNAMIC_VELOCITY: '' } : {},
      side: src.side,
      toneMapped: false,
      fog: false,
      lights: false,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
    });
    // Drives three's USE_MAP / USE_ALPHAMAP / USE_ALPHATEST defines.
    (mat as SourceMaterial).map = src.map ?? null;
    (mat as SourceMaterial).alphaMap = src.alphaMap ?? null;
    mat.alphaTest = src.alphaTest;
    return mat;
  }

  /** Prepass material for static geometry, keyed on the source material. */
  forMaterial(src: THREE.Material): THREE.ShaderMaterial {
    let mat = this.statics.get(src);
    if (!mat) {
      mat = this.build(src as SourceMaterial, false);
      this.statics.set(src, mat);
    }
    return mat;
  }

  /**
   * Prepass material for an object registered as dynamic. Carries its own
   * previous object->world matrix so per-object motion lands in the velocity
   * buffer instead of only camera motion.
   */
  forDynamic(object: THREE.Object3D, src: THREE.Material, prev: THREE.Matrix4): THREE.ShaderMaterial {
    let mat = this.dynamics.get(object);
    if (!mat) {
      mat = this.build(src as SourceMaterial, true);
      this.dynamics.set(object, mat);
    }
    (mat.uniforms.uPrevModel.value as THREE.Matrix4).copy(prev);
    return mat;
  }

  dropDynamic(object: THREE.Object3D): void {
    const mat = this.dynamics.get(object);
    if (mat) {
      mat.dispose();
      this.dynamics.delete(object);
    }
  }

  /** Drops cache entries whose source material has been disposed elsewhere. */
  prune(live: Set<THREE.Material>): void {
    for (const [src, mat] of this.statics) {
      if (!live.has(src)) {
        mat.dispose();
        this.statics.delete(src);
      }
    }
  }

  dispose(): void {
    for (const m of this.statics.values()) m.dispose();
    for (const m of this.dynamics.values()) m.dispose();
    this.statics.clear();
    this.dynamics.clear();
  }
}

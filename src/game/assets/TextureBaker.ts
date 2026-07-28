/**
 * GPU texture baker.
 *
 * One draw call per material produces every map at once: a full-screen quad is
 * rendered into a multiple-render-target FBO whose attachments are albedo,
 * normal+height and packed ORM (plus an optional displacement/aux target).
 * Nothing is built in a JS loop, so a 512x512 four-map material set costs a
 * fraction of a millisecond of CPU time and a fraction of a millisecond of GPU
 * time instead of stalling boot for seconds.
 *
 * There is exactly one shader program per material *family*, not per material,
 * so the whole library costs at most six shader compiles.
 */
import * as THREE from 'three';
import { BAKE_NOISE_GLSL } from './BakeNoise';
import { BAKE_EPILOGUE, BAKE_PROLOGUE, BAKE_VERTEX } from './shaders/BakeCore';
import { SEDIMENT_GLSL } from './shaders/Sediment';
import { ROCK_GLSL } from './shaders/Rock';
import { ORGANIC_GLSL } from './shaders/Organic';
import { MANMADE_GLSL } from './shaders/Manmade';
import { SKIN_GLSL } from './shaders/Skin';
import { UTILITY_GLSL } from './shaders/Utility';
import { linearColor } from './MaterialDefs';
import type { MaterialDef, MaterialFamily, Vec4 } from './MaterialDefs';

const FAMILY_GLSL: Record<MaterialFamily, string> = {
  sediment: SEDIMENT_GLSL,
  rock: ROCK_GLSL,
  organic: ORGANIC_GLSL,
  manmade: MANMADE_GLSL,
  skin: SKIN_GLSL,
  utility: UTILITY_GLSL,
};

export interface BakeResult {
  target: THREE.WebGLRenderTarget;
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** Packed ORM: r = AO, g = roughness, b = metalness, a = family aux. */
  orm: THREE.Texture;
  /** r = height, g = curvature, b = flow, a = sparkle. Only when requested. */
  aux: THREE.Texture | null;
  /** GPU + CPU wall-clock cost of this bake. */
  ms: number;
  bytes: number;
}

export interface BakeOptions {
  size: number;
  anisotropy: number;
  /** Ring taps used for curvature + AO. 4 on low tiers, 8 from medium up. */
  aoTaps: number;
}

/* Scratch, hoisted so baking never allocates per material beyond the target. */
const scratchP: THREE.Vector4[] = [];
for (let i = 0; i < 10; i++) scratchP.push(new THREE.Vector4());

export class TextureBaker {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly mesh: THREE.Mesh;
  private readonly programs = new Map<string, THREE.ShaderMaterial>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.mesh = new THREE.Mesh(this.geometry);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Compiles (once) and returns the program for a family. */
  private program(family: MaterialFamily, displace: boolean): THREE.ShaderMaterial {
    const key = `${family}${displace ? '+d' : ''}`;
    let mat = this.programs.get(key);
    if (mat) return mat;

    const uniforms: Record<string, THREE.IUniform> = {
      uP: { value: scratchP },
      uColA: { value: new THREE.Color(1, 1, 1) },
      uColB: { value: new THREE.Color(1, 1, 1) },
      uColC: { value: new THREE.Color(1, 1, 1) },
      uColD: { value: new THREE.Color(1, 1, 1) },
      uSub: { value: 0 },
      uAoTaps: { value: 8 },
      uSeed: { value: 0 },
    };

    mat = new THREE.ShaderMaterial({
      name: `bake:${key}`,
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: BAKE_VERTEX,
      fragmentShader: [
        BAKE_PROLOGUE,
        BAKE_NOISE_GLSL,
        FAMILY_GLSL[family],
        BAKE_EPILOGUE,
      ].join('\n'),
      defines: displace ? { WANT_DISPLACEMENT: '' } : {},
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.programs.set(key, mat);
    return mat;
  }

  bake(id: string, def: MaterialDef, opts: BakeOptions): BakeResult {
    const t0 = now();
    const size = opts.size;
    const displace = def.displace === true;
    const count = displace ? 4 : 3;

    const target = new THREE.WebGLRenderTarget(size, size, {
      count,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      anisotropy: opts.anisotropy,
    });

    const names = ['albedo', 'normal', 'orm', 'aux'];
    for (let i = 0; i < count; i++) {
      const t = target.textures[i];
      t.name = `${id}:${names[i]}`;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = opts.anisotropy;
      // Only the albedo attachment carries colour. Making it SRGB8_ALPHA8 gets
      // the hardware to encode on write and decode on sample, which both buys
      // ~2 bits of precision in the darks and keeps three's shaders correct
      // with no manual conversion anywhere. Data maps stay linear.
      t.colorSpace = i === 0 && !def.dataAlbedo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    }

    const mat = this.program(def.family, displace);
    const u = mat.uniforms;
    setVec4(scratchP[0], def.macro);
    setVec4(scratchP[1], def.mid);
    setVec4(scratchP[2], def.micro);
    setVec4(scratchP[3], def.a);
    setVec4(scratchP[4], def.b);
    setVec4(scratchP[5], def.c);
    setVec4(scratchP[6], def.surf);
    setVec4(scratchP[7], def.vary);
    setVec4(scratchP[8], def.aniso);
    // uP[9] = texel size, bump strength, AO strength, curvature gain.
    scratchP[9].set(1 / size, def.relief[0], def.relief[1], def.relief[2]);
    u.uP.value = scratchP;
    (u.uColA.value as THREE.Color).copy(linearColor(def.colA));
    (u.uColB.value as THREE.Color).copy(linearColor(def.colB));
    (u.uColC.value as THREE.Color).copy(linearColor(def.colC));
    (u.uColD.value as THREE.Color).copy(linearColor(def.colD));
    u.uSub.value = def.sub;
    u.uAoTaps.value = opts.aoTaps;
    u.uSeed.value = def.seed * 0.618034;

    this.mesh.material = mat;

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;

    // 4 bytes/px per attachment, +1/3 for the mip chain.
    const bytes = Math.round(size * size * 4 * count * 1.34);
    return {
      target,
      albedo: target.textures[0],
      normal: target.textures[1],
      orm: target.textures[2],
      aux: displace ? target.textures[3] : null,
      ms: now() - t0,
      bytes,
    };
  }

  dispose(): void {
    for (const m of this.programs.values()) m.dispose();
    this.programs.clear();
    this.geometry.dispose();
    this.scene.remove(this.mesh);
  }
}

function setVec4(v: THREE.Vector4, p: Vec4): void {
  v.set(p[0], p[1], p[2], p[3]);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

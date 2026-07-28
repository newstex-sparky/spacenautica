import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';
import { PrepassMaterialCache } from '../PrepassMaterials';

interface Swap {
  mesh: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
}

interface DynamicRecord {
  object: THREE.Object3D;
  prev: THREE.Matrix4;
  seeded: boolean;
}

const _scratchMask: number[] = [];

/**
 * Depth + world-normal + screen-velocity prepass.
 *
 * Runs before the main scene render so that:
 *  - the water/god-ray shaders can sample this frame's depth while shading,
 *  - GTAO and SSR have a normal buffer that is not reconstructed from depth
 *    derivatives (which bands badly on the sand dunes),
 *  - TAA and motion blur have real motion vectors.
 *
 * Attachment layout (both RGBA16F):
 *   0: rgb = world normal, a = coverage mask (1 geometry / 0 sky)
 *   1: rg  = screen-space motion vector (current uv - previous uv)
 */
export class GeometryPrepass extends PostPass {
  readonly id = 'prepass';

  target: THREE.WebGLRenderTarget;
  depthTexture: THREE.DepthTexture;

  private readonly cache = new PrepassMaterialCache();
  private readonly swaps: Swap[] = [];
  private readonly masked: THREE.Object3D[] = [];
  private readonly candidates: THREE.Object3D[] = [];
  private readonly dynamics = new Map<THREE.Object3D, DynamicRecord>();
  private readonly liveMaterials = new Set<THREE.Material>();
  private cleared = false;
  private pruneCountdown = 240;
  private readonly clearColor = new THREE.Color();

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.depthTexture = new THREE.DepthTexture(width, height);
    this.depthTexture.type = THREE.FloatType;
    this.depthTexture.format = THREE.DepthFormat;
    this.depthTexture.minFilter = THREE.NearestFilter;
    this.depthTexture.magFilter = THREE.NearestFilter;
    this.depthTexture.name = 'post.depth';

    this.target = makeTarget(width, height, {
      count: 2,
      depthBuffer: true,
      filter: THREE.NearestFilter,
      name: 'post.gbuffer',
    });
    this.target.depthTexture = this.depthTexture;
  }

  get normalTexture(): THREE.Texture {
    return this.target.textures[0];
  }

  get velocityTexture(): THREE.Texture {
    return this.target.textures[1];
  }

  /**
   * Opt an object into per-object motion vectors. Rigid transforms only —
   * vertex-animated or instanced geometry still reports camera-only motion.
   */
  registerDynamic(object: THREE.Object3D): void {
    if (this.dynamics.has(object)) return;
    this.dynamics.set(object, { object, prev: object.matrixWorld.clone(), seeded: false });
  }

  unregisterDynamic(object: THREE.Object3D): void {
    if (!this.dynamics.delete(object)) return;
    this.cache.dropDynamic(object);
  }

  override setSize(width: number, height: number): void {
    // three resizes the attached depth texture itself when the FBO is rebuilt.
    this.target.setSize(width, height);
    this.cleared = false;
  }

  override configure(frame: FrameContext): void {
    const g = frame.settings;
    // The prepass only pays for itself when something downstream samples it.
    this.enabled = g.taa || g.gtao || g.ssr || g.dof || g.motionBlur || g.godRays;
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;

    frame.normal = this.normalTexture;
    frame.velocity = this.velocityTexture;
    frame.depth = this.depthTexture;

    if (!this.enabled) {
      // Other systems still sample these textures, so make sure they are valid.
      if (!this.cleared) {
        this.clearTarget(renderer);
        this.cleared = true;
      }
      frame.prepassValid = false;
      return;
    }
    this.cleared = false;

    const shared = this.cache.shared;
    shared.uViewInv.value.copy(frame.viewInv);
    shared.uCurViewProj.value.copy(frame.viewProj);
    shared.uPrevViewProj.value.copy(frame.historyValid ? frame.prevViewProj : frame.viewProj);

    const scene = frame.scene;
    const prevBackground = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    scene.background = null;
    scene.overrideMaterial = null;
    // Shadow maps are re-rendered by the main scene pass; do not pay twice.
    renderer.shadowMap.autoUpdate = false;

    this.collect(scene);
    this.applySwaps(frame);

    this.clearTarget(renderer);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, frame.camera);
    renderer.autoClear = prevAutoClear;

    this.restoreSwaps();
    scene.background = prevBackground;
    scene.overrideMaterial = prevOverride;
    renderer.shadowMap.autoUpdate = prevShadowAuto;

    // Remember this frame's transforms for the next velocity pass.
    for (const rec of this.dynamics.values()) {
      rec.prev.copy(rec.object.matrixWorld);
      rec.seeded = true;
    }

    if (--this.pruneCountdown <= 0) {
      this.pruneCountdown = 240;
      this.cache.prune(this.liveMaterials);
    }

    frame.prepassValid = true;
  }

  private clearTarget(renderer: THREE.WebGLRenderer): void {
    renderer.getClearColor(this.clearColor);
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.setClearColor(this.clearColor, alpha);
  }

  private collect(scene: THREE.Scene): void {
    this.candidates.length = 0;
    const stack: THREE.Object3D[] = [scene];
    while (stack.length) {
      const o = stack.pop()!;
      if (!o.visible) continue;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) this.candidates.push(o);
      const children = o.children;
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
  }

  private applySwaps(frame: FrameContext): void {
    this.liveMaterials.clear();
    for (let i = 0; i < this.candidates.length; i++) {
      const mesh = this.candidates[i] as THREE.Mesh;
      const src = mesh.material;
      const first = Array.isArray(src) ? src[0] : src;
      if (!first) continue;

      if (!PrepassMaterialCache.includes(mesh, first)) {
        _scratchMask.push(mesh.layers.mask);
        this.masked.push(mesh);
        // Zero mask fails every camera layer test without touching children.
        mesh.layers.mask = 0;
        continue;
      }

      const rec = this.dynamics.get(mesh);
      let replacement: THREE.Material | THREE.Material[];
      if (rec && !Array.isArray(src)) {
        replacement = this.cache.forDynamic(
          mesh,
          src,
          rec.seeded && frame.historyValid ? rec.prev : mesh.matrixWorld,
        );
        this.liveMaterials.add(src);
      } else if (Array.isArray(src)) {
        const arr: THREE.Material[] = [];
        for (let k = 0; k < src.length; k++) {
          arr.push(this.cache.forMaterial(src[k]));
          this.liveMaterials.add(src[k]);
        }
        replacement = arr;
      } else {
        replacement = this.cache.forMaterial(src);
        this.liveMaterials.add(src);
      }

      this.swaps.push({ mesh, material: src });
      mesh.material = replacement;
    }
  }

  private restoreSwaps(): void {
    for (let i = 0; i < this.swaps.length; i++) {
      this.swaps[i].mesh.material = this.swaps[i].material;
    }
    this.swaps.length = 0;
    for (let i = 0; i < this.masked.length; i++) {
      this.masked[i].layers.mask = _scratchMask[i];
    }
    this.masked.length = 0;
    _scratchMask.length = 0;
  }

  override dispose(): void {
    this.target.dispose();
    this.depthTexture.dispose();
    this.cache.dispose();
    this.dynamics.clear();
  }
}

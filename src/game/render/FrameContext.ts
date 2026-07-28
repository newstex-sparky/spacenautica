import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { GraphicsSettings } from '../core/Settings';

/**
 * Per-frame state threaded through every pass. `PostStack` owns it and refreshes
 * the fields once per frame; passes read it and rewrite `color` (and `ao`) as
 * they hand the frame down the chain.
 *
 * `color` is always a **linear half-float** texture. Nothing in the chain writes
 * display-referred values until `GradePass`.
 */
export interface FrameContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;

  settings: GraphicsSettings;
  /** Extra multiplier applied on top of settings for user-facing sliders. */
  time: number;
  dt: number;
  frame: number;

  /** Current HDR colour of the frame, linear. */
  color: THREE.Texture;
  /** Depth attachment of the geometry prepass (window z). */
  depth: THREE.DepthTexture;
  /** RGBA16F: rgb = world normal, a = coverage mask. */
  normal: THREE.Texture;
  /** RG16F-ish: screen-space motion vector, current uv minus previous uv. */
  velocity: THREE.Texture;
  /** Denoised AO + bent normal, or null when GTAO is off. */
  ao: THREE.Texture | null;
  /** 1x1 R = linear exposure multiplier. */
  exposure: THREE.Texture | null;

  /** False when the prepass was skipped this frame (low tier). */
  prepassValid: boolean;
  /** False on the first frame after a resize/teleport — kills temporal reuse. */
  historyValid: boolean;

  /** Sub-pixel jitter applied to the projection this frame, in pixels. */
  jitter: THREE.Vector2;

  /** Jittered projection actually used for the depth buffer. */
  proj: THREE.Matrix4;
  projInv: THREE.Matrix4;
  view: THREE.Matrix4;
  viewInv: THREE.Matrix4;
  /** Un-jittered view-projection, this frame and last, for reprojection. */
  viewProj: THREE.Matrix4;
  prevViewProj: THREE.Matrix4;

  near: number;
  far: number;

  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  /** xy = screen uv of the sun, z = 1 when in front of the camera. */
  sunScreen: THREE.Vector3;
  /** Linear inscatter colour of the surrounding water, for volumetrics/grade. */
  waterInscatter: THREE.Color;
  /** Per-metre extinction of the surrounding water. */
  waterExtinction: THREE.Vector3;

  underwater: boolean;
  /** Metres below the sea surface, >= 0. */
  cameraDepth: number;

  blit: Blitter;
  /** Two full-res half-float scratch targets shared by every read-modify pass. */
  pool: ColorPool;
  /** Tiling blue noise (from the texture library when available). */
  noise: THREE.Texture;
}

/**
 * Two interchangeable full-resolution HDR targets. Passes that read the current
 * colour and write a new one ask for `next(frame.color)`, which always hands back
 * the buffer that is *not* currently being read — so the whole chain costs two
 * targets instead of one per pass.
 */
export class ColorPool {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;

  constructor(width: number, height: number) {
    this.a = makeTarget(width, height, { name: 'post.poolA' });
    this.b = makeTarget(width, height, { name: 'post.poolB' });
  }

  next(current: THREE.Texture): THREE.WebGLRenderTarget {
    return current === this.a.texture ? this.b : this.a;
  }

  setSize(width: number, height: number): void {
    this.a.setSize(Math.max(1, width), Math.max(1, height));
    this.b.setSize(Math.max(1, width), Math.max(1, height));
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
  }
}

const QUAD_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * Fullscreen-triangle blitter. Deliberately *not* three's `FullScreenQuad`,
 * whose `dispose()` frees a module-level shared geometry and would tear down
 * every other pass in the process.
 */
export class Blitter {
  private readonly geometry: THREE.BufferGeometry;
  private readonly mesh: THREE.Mesh;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
    );
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    this.mesh = new THREE.Mesh(this.geometry, undefined);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * Draws `material` over `target` (null = default framebuffer).
   * Never clears unless asked; passes that fully cover their target do not need it.
   */
  draw(
    renderer: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
    clear = false,
  ): void {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = clear;
    renderer.setRenderTarget(target);
    this.mesh.material = material;
    renderer.render(this.mesh, QUAD_CAMERA);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** Half-float colour target with sane post-processing defaults. */
export function makeTarget(
  w: number,
  h: number,
  opts: {
    type?: THREE.TextureDataType;
    format?: THREE.PixelFormat;
    filter?: THREE.MagnificationTextureFilter;
    name?: string;
    count?: number;
    depthBuffer?: boolean;
    generateMipmaps?: boolean;
  } = {},
): THREE.WebGLRenderTarget {
  const filter = opts.filter ?? THREE.LinearFilter;
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: opts.type ?? THREE.HalfFloatType,
    format: opts.format ?? THREE.RGBAFormat,
    magFilter: filter,
    minFilter: opts.generateMipmaps ? THREE.LinearMipmapLinearFilter : filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: opts.depthBuffer ?? false,
    stencilBuffer: false,
    generateMipmaps: opts.generateMipmaps ?? false,
    count: opts.count ?? 1,
    samples: 0,
  });
  for (let i = 0; i < rt.textures.length; i++) {
    rt.textures[i].name = `${opts.name ?? 'post'}[${i}]`;
    rt.textures[i].colorSpace = THREE.NoColorSpace;
  }
  return rt;
}

/**
 * Shared base for every pass in the stack.
 *
 * Extends three's `Pass` so the stack is driven by a real `EffectComposer`
 * (the documented `PostStack.composer`), but every pass declares
 * `needsSwap = false` and owns its own render targets: the frame is threaded
 * through the shared {@link FrameContext} rather than through the composer's
 * ping-pong buffers, which a multi-target chain like this cannot express.
 */
export abstract class PostPass extends Pass {
  /** Short id used in debug listings. */
  abstract readonly id: string;
  protected readonly frame: FrameContext;

  constructor(frame: FrameContext) {
    super();
    this.frame = frame;
    this.needsSwap = false;
  }

  /** `Pass` entry point — the composer calls this. */
  render(): void {
    this.execute(this.frame);
  }

  /** Decide `enabled` from settings; called once per frame before the composer runs. */
  configure(_frame: FrameContext): void {}

  /** Do the work. Implementations must leave `frame.color` pointing at a valid texture. */
  protected abstract execute(frame: FrameContext): void;

  override setSize(_width: number, _height: number): void {}
  override dispose(): void {}
}

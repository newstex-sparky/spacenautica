import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import type { Engine } from '../core/Engine';
import { Blitter, ColorPool, makeTarget } from './FrameContext';
import type { FrameContext } from './FrameContext';
import type { PostPass } from './FrameContext';
import { GeometryPrepass } from './passes/GeometryPrepass';
import { ScenePass } from './passes/ScenePass';
import { GtaoPass } from './passes/GtaoPass';
import { SsrPass } from './passes/SsrPass';
import { VolumetricPass } from './passes/VolumetricPass';
import { TaaPass, haltonJitter } from './passes/TaaPass';
import { ExposurePass } from './passes/ExposurePass';
import { DofPass } from './passes/DofPass';
import { MotionBlurPass } from './passes/MotionBlurPass';
import { BloomPass } from './passes/BloomPass';
import { GradePass } from './passes/GradePass';

/** Minimal duck-typed views of the systems this stack reads. */
interface SkyLike {
  sunDirection?: THREE.Vector3;
  sunColor?: THREE.Color;
  sunIntensity?: number;
}
interface WaterLike {
  underwater?: boolean;
  cameraDepth?: number;
  sharedUniforms?: Record<string, THREE.IUniform>;
  /** Optional: volumetric light-shaft buffer for the composite slot. */
  volumetricTexture?: THREE.Texture | null;
  volumetricIntensity?: number;
}
interface TextureLibraryLike {
  blueNoise?: THREE.Texture;
}

const _size = new THREE.Vector2();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const DEFAULT_SUN = new THREE.Vector3(0.3, 0.85, 0.42).normalize();

/**
 * Post-processing stack. Owns the frame: the engine delegates rendering here via
 * `renderOverride`.
 *
 * The chain, in order, each individually gated on `ctx.settings.graphics`:
 *
 * | # | pass          | resolution | setting        |
 * |---|---------------|------------|----------------|
 * | 1 | depth/normal/velocity prepass | full | implicit (any consumer) |
 * | 2 | scene render (HDR, linear)    | full | always |
 * | 3 | GTAO + bent normal, denoised  | half (full on ultra) | `gtao` |
 * | 4 | SSR, hi-frequency cone        | half | `ssr` |
 * | 5 | volumetric composite slot     | 0.4x | `godRays` |
 * | 6 | TAA (Halton, YCoCg clip)      | full | `taa` |
 * | 7 | histogram auto-exposure       | 128x72 -> 1x1 | always |
 * | 8 | DOF (hex bokeh, near+far)     | half | `dof` |
 * | 9 | motion blur (tile max)        | full | `motionBlur` |
 * |10 | bloom (Jimenez dual filter)   | mip chain | `bloom` |
 * |11 | grade: tonemap, LUT, CA, vignette, grain, shake | full -> screen | always |
 *
 * Everything between (2) and (11) is linear half float. The sRGB transfer
 * function is applied exactly once, in the grade pass, which is also the only
 * pass that writes to the default framebuffer.
 */
export class PostStack implements GameSystem {
  readonly name = 'render.post';
  readonly phase = Phase.PreRender;

  composer!: EffectComposer;

  private ctx!: GameContext;
  private frame!: FrameContext;
  private blitter!: Blitter;
  private pool!: ColorPool;
  private dummyTarget!: THREE.WebGLRenderTarget;

  private prepass!: GeometryPrepass;
  private scenePass!: ScenePass;
  private gtao!: GtaoPass;
  private ssr!: SsrPass;
  private volumetric!: VolumetricPass;
  private taa!: TaaPass;
  private exposure!: ExposurePass;
  private dof!: DofPass;
  private motionBlur!: MotionBlurPass;
  private bloom!: BloomPass;
  private grade!: GradePass;
  private passes: PostPass[] = [];

  private placeholderColor!: THREE.DataTexture;
  private placeholderDepth!: THREE.DepthTexture;
  private ownNoise: THREE.DataTexture | null = null;

  private readonly baseProj = new THREE.Matrix4();
  private readonly jitter = new THREE.Vector2();
  private jitterIndex = 0;
  private readonly lastCameraPos = new THREE.Vector3();
  private lastTier = '';
  private booted = false;

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const renderer = ctx.renderer;
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.floor(_size.x));
    const h = Math.max(1, Math.floor(_size.y));

    this.blitter = new Blitter();
    this.pool = new ColorPool(w, h);

    this.placeholderColor = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.placeholderColor.needsUpdate = true;
    this.placeholderDepth = new THREE.DepthTexture(1, 1);

    this.frame = {
      renderer,
      scene: ctx.scene,
      camera: ctx.camera,
      width: w,
      height: h,
      settings: ctx.settings.graphics,
      time: 0,
      dt: 1 / 60,
      frame: 0,
      color: this.placeholderColor,
      depth: this.placeholderDepth,
      normal: this.placeholderColor,
      velocity: this.placeholderColor,
      ao: null,
      exposure: null,
      prepassValid: false,
      historyValid: false,
      jitter: new THREE.Vector2(),
      proj: new THREE.Matrix4(),
      projInv: new THREE.Matrix4(),
      view: new THREE.Matrix4(),
      viewInv: new THREE.Matrix4(),
      viewProj: new THREE.Matrix4(),
      prevViewProj: new THREE.Matrix4(),
      near: ctx.camera.near,
      far: ctx.camera.far,
      sunDirection: DEFAULT_SUN.clone(),
      sunColor: new THREE.Color(1, 0.97, 0.9),
      sunScreen: new THREE.Vector3(0.5, 0.8, 0),
      waterInscatter: new THREE.Color(0.06, 0.24, 0.32),
      waterExtinction: new THREE.Vector3(0.45, 0.075, 0.032),
      underwater: true,
      cameraDepth: 0,
      blit: this.blitter,
      pool: this.pool,
      noise: this.resolveNoise(ctx),
    };

    const lutSize = ctx.settings.at('high') ? 32 : 16;

    this.prepass = new GeometryPrepass(this.frame, w, h);
    this.scenePass = new ScenePass(this.frame, w, h);
    this.gtao = new GtaoPass(this.frame, w, h);
    this.ssr = new SsrPass(this.frame, w, h);
    this.volumetric = new VolumetricPass(this.frame, w, h);
    this.taa = new TaaPass(this.frame, w, h);
    this.exposure = new ExposurePass(this.frame);
    this.dof = new DofPass(this.frame, w, h);
    this.motionBlur = new MotionBlurPass(this.frame, w, h);
    this.bloom = new BloomPass(this.frame, w, h);
    this.grade = new GradePass(this.frame, lutSize);

    this.frame.depth = this.prepass.depthTexture;
    this.frame.normal = this.prepass.normalTexture;
    this.frame.velocity = this.prepass.velocityTexture;

    this.passes = [
      this.prepass,
      this.scenePass,
      this.gtao,
      this.ssr,
      this.volumetric,
      this.taa,
      this.exposure,
      this.dof,
      this.motionBlur,
      this.bloom,
      this.grade,
    ];

    // The composer drives the chain. Its own ping-pong buffers are unused (each
    // pass owns its targets and threads the frame through FrameContext), so it is
    // handed a 1x1 dummy instead of two full-resolution buffers nothing reads.
    this.dummyTarget = makeTarget(1, 1, { name: 'post.composerDummy' });
    this.composer = new EffectComposer(renderer, this.dummyTarget);
    this.composer.renderToScreen = true;
    for (const p of this.passes) this.composer.addPass(p);

    this.applySize(w, h);
    this.lastTier = ctx.settings.graphics.tier;
    this.lastCameraPos.copy(ctx.camera.position);

    (ctx as unknown as Engine).renderOverride = (dt: number) => this.renderFrame(dt);
    this.booted = true;
  }

  private resolveNoise(ctx: GameContext): THREE.Texture {
    const lib = ctx.tryGet<GameSystem & TextureLibraryLike>('assets.textures');
    if (lib?.blueNoise) return lib.blueNoise;
    // Own fallback: a small void-and-cluster-ish blue noise built from a
    // dart-throwing pass over a 64x64 grid. Never fetched, always available.
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    const best = new Float32Array(size * size);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let c = 0; c < 4; c++) {
      best.fill(0);
      // Ranked dither: repeatedly place the sample furthest from existing ones.
      const order: number[] = [];
      const taken = new Uint8Array(size * size);
      for (let n = 0; n < size * size; n++) {
        let bi = -1;
        let bv = -1;
        for (let tries = 0; tries < 24; tries++) {
          const i = Math.floor(rnd() * size * size);
          if (taken[i]) continue;
          const x = i % size;
          const y = (i / size) | 0;
          let minD = 1e9;
          for (let k = Math.max(0, order.length - 48); k < order.length; k++) {
            const j = order[k];
            let dx = Math.abs((j % size) - x);
            let dy = Math.abs(((j / size) | 0) - y);
            if (dx > size / 2) dx = size - dx;
            if (dy > size / 2) dy = size - dy;
            minD = Math.min(minD, dx * dx + dy * dy);
          }
          if (minD > bv) {
            bv = minD;
            bi = i;
          }
        }
        if (bi < 0) {
          for (let i = 0; i < size * size; i++) {
            if (!taken[i]) {
              bi = i;
              break;
            }
          }
        }
        taken[bi] = 1;
        order.push(bi);
      }
      for (let n = 0; n < order.length; n++) {
        data[order[n] * 4 + c] = Math.round((n / (order.length - 1)) * 255);
      }
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.ownNoise = tex;
    return tex;
  }

  /* ------------------------------------------------------------------ *
   * Public API (see CONTRACTS.md -> render.post)
   * ------------------------------------------------------------------ */

  /** Depth attachment of the geometry prepass. Stable across resizes. */
  get depthTexture(): THREE.DepthTexture {
    return this.prepass.depthTexture;
  }

  /** RGBA16F: `rgb` = world-space normal, `a` = coverage mask (1 geometry / 0 sky). */
  get normalTexture(): THREE.Texture {
    return this.prepass.normalTexture;
  }

  /** RG: screen-space motion vector in uv units (current uv - previous uv). */
  get velocityTexture(): THREE.Texture {
    return this.prepass.velocityTexture;
  }

  /** Denoised AO + bent normal (rgb = bent normal, a = visibility), or null. */
  get aoTexture(): THREE.Texture | null {
    return this.frame?.ao ?? null;
  }

  /** Metres. Pass <= 0 to return to reticle-driven auto focus. */
  setFocusDistance(d: number): void {
    this.dof.manualFocus = d;
  }

  /** Image-space kick. `amount` is roughly in screen heights. */
  addScreenShake(amount: number, duration: number): void {
    const scale = this.ctx?.settings.gameplay.cameraShake ?? 1;
    this.grade.addScreenShake(amount * scale, duration);
  }

  /**
   * Publish a volumetric light-shaft buffer for the composite slot. Pass null to
   * fall back to the stack's own screen-space shafts.
   */
  setVolumetric(texture: THREE.Texture | null, intensity = 1): void {
    this.volumetric.external = texture;
    this.volumetric.externalStrength = intensity;
  }

  /** Opt an object into per-object motion vectors (rigid transforms). */
  registerDynamic(object: THREE.Object3D): void {
    this.prepass.registerDynamic(object);
  }

  unregisterDynamic(object: THREE.Object3D): void {
    this.prepass.unregisterDynamic(object);
  }

  /** Drop every temporal history — call after a teleport or a cut. */
  invalidateHistory(): void {
    this.taa.invalidate();
    this.exposure.invalidate();
    this.frame.historyValid = false;
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */

  update(_dt: number, ctx: GameContext): void {
    // Tier changes rebuild the LUT resolution; everything else is read per frame.
    const tier = ctx.settings.graphics.tier;
    if (tier !== this.lastTier) {
      this.lastTier = tier;
      this.grade.setLutSize(ctx.settings.at('high') ? 32 : 16);
    }
  }

  private renderFrame(dt: number): void {
    if (!this.booted) return;
    const ctx = this.ctx;
    const cam = ctx.camera;
    const frame = this.frame;
    const renderer = ctx.renderer;

    // The engine may have resized the drawing buffer without a resize callback
    // (adaptive resolution changes pixelRatio); keep our targets in step.
    renderer.getDrawingBufferSize(_size);
    if (Math.floor(_size.x) !== frame.width || Math.floor(_size.y) !== frame.height) {
      this.applySize(Math.max(1, Math.floor(_size.x)), Math.max(1, Math.floor(_size.y)));
    }

    frame.settings = ctx.settings.graphics;
    frame.time = ctx.time;
    frame.dt = Math.min(Math.max(dt, 1 / 480), 0.1);
    frame.frame = ctx.frame;
    frame.near = cam.near;
    frame.far = cam.far;

    // --- camera matrices (unjittered) ---
    cam.updateMatrixWorld();
    this.baseProj.copy(cam.projectionMatrix);
    frame.prevViewProj.copy(frame.viewProj);
    frame.view.copy(cam.matrixWorldInverse);
    frame.viewInv.copy(cam.matrixWorld);
    frame.viewProj.multiplyMatrices(this.baseProj, frame.view);

    // A teleport must not be reprojected — it would drag a smear of the old
    // location across the first frame at the new one.
    const jump = this.lastCameraPos.distanceToSquared(cam.position);
    if (jump > 100) this.invalidateHistory();
    this.lastCameraPos.copy(cam.position);

    // --- environment reads ---
    this.readEnvironment(ctx);

    // --- sub-pixel jitter ---
    const useTaa = frame.settings.taa;
    if (useTaa) {
      this.jitterIndex = (this.jitterIndex % this.taa.sampleCount) + 1;
      haltonJitter(this.jitterIndex, this.jitter);
      cam.projectionMatrix.elements[8] += (2 * this.jitter.x) / frame.width;
      cam.projectionMatrix.elements[9] += (2 * this.jitter.y) / frame.height;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      frame.jitter.copy(this.jitter);
    } else {
      frame.jitter.set(0, 0);
    }
    frame.proj.copy(cam.projectionMatrix);
    frame.projInv.copy(cam.projectionMatrixInverse);

    // --- configure, then let the composer walk the chain ---
    frame.ao = null;
    for (const p of this.passes) p.configure(frame);

    try {
      this.composer.render(frame.dt);
    } finally {
      // Always restore the camera, even if a pass threw: gameplay raycasts and
      // the HUD unproject against this matrix.
      if (useTaa) {
        cam.projectionMatrix.copy(this.baseProj);
        cam.projectionMatrixInverse.copy(this.baseProj).invert();
      }
      renderer.setRenderTarget(null);
    }

    frame.historyValid = true;
  }

  private readEnvironment(ctx: GameContext): void {
    const frame = this.frame;

    const sky = ctx.tryGet<GameSystem & SkyLike>('world.sky');
    if (sky?.sunDirection) frame.sunDirection.copy(sky.sunDirection).normalize();
    if (sky?.sunColor) frame.sunColor.copy(sky.sunColor);

    const water = ctx.tryGet<GameSystem & WaterLike>('world.water');
    if (water) {
      if (typeof water.underwater === 'boolean') frame.underwater = water.underwater;
      if (typeof water.cameraDepth === 'number') frame.cameraDepth = Math.max(0, water.cameraDepth);
      const su = water.sharedUniforms;
      const inscatter = su?.uwInscatter?.value as THREE.Color | undefined;
      if (inscatter && (inscatter as THREE.Color).isColor) frame.waterInscatter.copy(inscatter);
      const ext = su?.uwExtinction?.value as THREE.Vector3 | undefined;
      if (ext && (ext as THREE.Vector3).isVector3) frame.waterExtinction.copy(ext);
      if (water.volumetricTexture !== undefined) {
        this.volumetric.external = water.volumetricTexture;
        this.volumetric.externalStrength = water.volumetricIntensity ?? 1;
      }
    } else {
      frame.underwater = ctx.camera.position.y < 0;
      frame.cameraDepth = Math.max(0, -ctx.camera.position.y);
    }

    // Sun screen position for the fallback shafts, computed before jitter.
    const cam = ctx.camera;
    _dir.copy(frame.sunDirection).transformDirection(cam.matrixWorldInverse);
    const inFront = _dir.z < -0.02;
    _v3.copy(cam.position).addScaledVector(frame.sunDirection, 5000).project(cam);
    frame.sunScreen.set(_v3.x * 0.5 + 0.5, _v3.y * 0.5 + 0.5, inFront ? 1 : 0);
  }

  /* ------------------------------------------------------------------ *
   * Sizing / teardown
   * ------------------------------------------------------------------ */

  resize(_w: number, _h: number, ctx: GameContext): void {
    if (!this.booted) return;
    ctx.renderer.getDrawingBufferSize(_size);
    this.applySize(Math.max(1, Math.floor(_size.x)), Math.max(1, Math.floor(_size.y)));
  }

  private applySize(w: number, h: number): void {
    this.frame.width = w;
    this.frame.height = h;
    this.pool.setSize(w, h);
    for (const p of this.passes) p.setSize(w, h);
    this.frame.historyValid = false;
    this.frame.depth = this.prepass.depthTexture;
    this.frame.normal = this.prepass.normalTexture;
    this.frame.velocity = this.prepass.velocityTexture;
  }

  dispose(): void {
    const engine = this.ctx as unknown as Engine | undefined;
    if (engine && engine.renderOverride) engine.renderOverride = null;
    for (const p of this.passes) p.dispose();
    this.passes.length = 0;
    this.composer?.dispose();
    this.dummyTarget?.dispose();
    this.pool?.dispose();
    this.blitter?.dispose();
    this.placeholderColor?.dispose();
    this.placeholderDepth?.dispose();
    this.ownNoise?.dispose();
    this.booted = false;
  }
}

import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem, QualityTier } from '../core/Types';
import type { TextureId } from './TextureIds';
import { CORE_PREWARM, TUNED_IDS, materialDef } from './MaterialDefs';
import { TextureBaker } from './TextureBaker';
import { makeBlueNoiseTexture } from './BlueNoise';

/**
 * A generated PBR map set.
 *
 * `roughnessMap` and `aoMap` are deliberately the *same* texture: it is packed
 * ORM (r = AO, g = roughness, b = metalness, a = aux) and three's shaders read
 * `.r` for aoMap, `.g` for roughnessMap and `.b` for metalnessMap, so one
 * texture fetch serves all three. Height lives in `normalMap.a`.
 *
 * The four original fields are unchanged; everything added is optional.
 */
export interface PbrMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
  displacementMap?: THREE.Texture;
  /** Same packed ORM texture; `.b` is metalness. */
  metalnessMap?: THREE.Texture;
  /** Explicit alias for the packed ORM texture, for custom shaders. */
  ormMap?: THREE.Texture;
  /** Edge length of the generated maps, in pixels. */
  size?: number;
}

interface CacheEntry {
  maps: PbrMaps;
  target: THREE.WebGLRenderTarget;
}

const TIER_SCALE: Record<QualityTier, number> = {
  low: 0.5,
  medium: 0.75,
  high: 1,
  ultra: 1.5,
};

/**
 * Runtime-generated PBR texture library. Every map in the game comes from here;
 * nothing is loaded from disk or network.
 *
 * Generation is GPU-side (see {@link TextureBaker}) and lazy: `get()` bakes on
 * first request and caches. `prewarm()` lets a system pull its materials forward
 * within a time budget; anything that does not fit is finished in the background
 * a few materials per frame.
 */
export class TextureLibrary implements GameSystem {
  readonly name = 'assets.textures';
  readonly phase = Phase.PreUpdate;

  white!: THREE.Texture;
  flatNormal!: THREE.Texture;
  blueNoise!: THREE.Texture;

  /** Generation telemetry. Handy in the HUD and in the boot log. */
  readonly stats = {
    generated: 0,
    totalMs: 0,
    blueNoiseMs: 0,
    bytes: 0,
    slowest: '',
    slowestMs: 0,
    queued: 0,
  };

  protected cache = new Map<string, CacheEntry>();
  protected anisotropy = 4;

  private baker: TextureBaker | null = null;
  private fallback: PbrMaps | null = null;
  private queue: TextureId[] = [];
  private tierScale = 1;
  private aoTaps = 8;
  private maxSize = 1024;
  private softwareGpu = false;
  private failed = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    const g = ctx.settings.graphics;
    this.anisotropy = Math.max(
      1,
      Math.min(g.anisotropy, ctx.renderer.capabilities.getMaxAnisotropy()),
    );
    this.softwareGpu = detectSoftwareRenderer(ctx.renderer);
    this.applyTier(ctx);
    this.maxSize = Math.min(1024, ctx.renderer.capabilities.maxTextureSize);
    if (this.softwareGpu) this.maxSize = Math.min(this.maxSize, 256);

    this.white = solid(255, 255, 255);
    this.flatNormal = solid(128, 128, 255);
    this.fallback = {
      map: this.white,
      normalMap: this.flatNormal,
      roughnessMap: this.white,
      aoMap: this.white,
      size: 1,
    };

    // Blue noise is CPU work (void-and-cluster is inherently sequential), so it
    // is the one thing here with a real boot cost. One solver run at low/medium,
    // two independent runs from high up; the other channels are toroidal shifts.
    const bn = makeBlueNoiseTexture(128, ctx.settings.at('high') ? 2 : 1);
    this.blueNoise = bn.texture;
    this.stats.blueNoiseMs = bn.ms;

    this.baker = new TextureBaker(ctx.renderer);

    // Bake what the very first frame is guaranteed to need; queue the rest.
    this.prewarm(CORE_PREWARM, this.softwareGpu ? 2000 : 700);

    this.unsubscribe = ctx.settings.onChange(() => this.applyTier(ctx));

    if (typeof console !== 'undefined') {
      console.info(
        `[assets.textures] boot bake ${this.stats.generated} materials in ` +
          `${this.stats.totalMs.toFixed(0)} ms (blue noise ${this.stats.blueNoiseMs.toFixed(0)} ms), ` +
          `${(this.stats.bytes / 1048576).toFixed(1)} MB, ${this.queue.length} queued, ` +
          `tier=${ctx.settings.graphics.tier} size=${this.sizeFor(512)}` +
          (this.softwareGpu ? ' [software GPU: reduced]' : ''),
      );
    }
  }

  /**
   * Bakes materials in the background so a stall never lands on a frame that is
   * already busy. Budget is deliberately small; the queue drains in a second or
   * two of gameplay and every `get()` is still correct immediately.
   */
  update(_dt: number, _ctx: GameContext): void {
    if (this.queue.length === 0) return;
    const budget = this.softwareGpu ? 12 : 3;
    const t0 = now();
    while (this.queue.length > 0 && now() - t0 < budget) {
      const id = this.queue.shift() as TextureId;
      this.get(id);
    }
    this.stats.queued = this.queue.length;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const entry of this.cache.values()) entry.target.dispose();
    this.cache.clear();
    this.queue.length = 0;
    this.baker?.dispose();
    this.baker = null;
    this.white?.dispose();
    this.flatNormal?.dispose();
    this.blueNoise?.dispose();
  }

  /* ---------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------- */

  /**
   * Returns a cached procedural PBR map set, generating on first request.
   * `size` is the *requested* base resolution; the quality tier scales it.
   */
  get(id: TextureId, size = 512): PbrMaps {
    const px = this.sizeFor(size);
    const key = `${id}@${px}`;
    const hit = this.cache.get(key);
    if (hit) return hit.maps;
    const maps = this.generate(id, px);
    return maps;
  }

  /**
   * Pull a set of materials forward. Generates synchronously until `budgetMs` is
   * spent, then hands the remainder to the background queue. Safe to call from
   * any system's `init` — duplicate ids are free.
   */
  prewarm(ids: readonly TextureId[], budgetMs = 400, size = 512): void {
    const t0 = now();
    for (const id of ids) {
      const key = `${id}@${this.sizeFor(size)}`;
      if (this.cache.has(key) || this.failed.has(key)) continue;
      if (now() - t0 > budgetMs) {
        if (!this.queue.includes(id)) this.queue.push(id);
        continue;
      }
      this.get(id, size);
    }
    this.stats.queued = this.queue.length;
  }

  /** Queue every hand-tuned material for background generation. */
  prewarmAll(): void {
    for (const id of TUNED_IDS) {
      if (!this.cache.has(`${id}@${this.sizeFor(512)}`) && !this.queue.includes(id)) {
        this.queue.push(id);
      }
    }
    this.stats.queued = this.queue.length;
  }

  /** How many materials are still waiting on the background queue. */
  get pending(): number {
    return this.queue.length;
  }

  /* ---------------------------------------------------------------- *
   * Generation
   * ---------------------------------------------------------------- */

  protected generate(id: TextureId, size: number): PbrMaps {
    const key = `${id}@${size}`;
    if (!this.baker || this.failed.has(key)) return this.fallbackMaps();
    try {
      const def = materialDef(id);
      const result = this.baker.bake(id, def, {
        size,
        anisotropy: this.anisotropy,
        aoTaps: this.aoTaps,
      });
      const maps: PbrMaps = {
        map: result.albedo,
        normalMap: result.normal,
        roughnessMap: result.orm,
        aoMap: result.orm,
        metalnessMap: result.orm,
        ormMap: result.orm,
        displacementMap: result.aux ?? undefined,
        size,
      };
      this.cache.set(key, { maps, target: result.target });
      this.stats.generated++;
      this.stats.totalMs += result.ms;
      this.stats.bytes += result.bytes;
      if (result.ms > this.stats.slowestMs) {
        this.stats.slowestMs = result.ms;
        this.stats.slowest = id;
      }
      return maps;
    } catch (err) {
      // A material must never take the frame loop down with it.
      this.failed.add(key);
      console.error(`[assets.textures] failed to bake "${id}"`, err);
      return this.fallbackMaps();
    }
  }

  private fallbackMaps(): PbrMaps {
    return (
      this.fallback ?? {
        map: this.white,
        normalMap: this.flatNormal,
        roughnessMap: this.white,
        aoMap: this.white,
      }
    );
  }

  /* ---------------------------------------------------------------- *
   * Quality scaling
   * ---------------------------------------------------------------- */

  private applyTier(ctx: GameContext): void {
    const tier = ctx.settings.graphics.tier;
    this.tierScale = TIER_SCALE[tier] ?? 1;
    this.aoTaps = ctx.settings.at('medium') && !this.softwareGpu ? 8 : 4;
    if (this.softwareGpu) this.tierScale = Math.min(this.tierScale, 0.5);
    this.anisotropy = Math.max(
      1,
      Math.min(ctx.settings.graphics.anisotropy, ctx.renderer.capabilities.getMaxAnisotropy()),
    );
  }

  /**
   * Effective resolution for a requested size. Rounded to a multiple of 64 so
   * mip chains stay clean; NPOT is fine on WebGL2.
   *
   * Note: already-generated maps are *not* re-baked when the tier changes —
   * live materials keep the textures they were handed. Only new requests pick up
   * the new resolution.
   */
  private sizeFor(requested: number): number {
    const raw = requested * this.tierScale;
    const snapped = Math.round(raw / 64) * 64;
    return Math.max(64, Math.min(this.maxSize, snapped));
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Assigns a generated set onto a standard material, including the ORM channels
 * three would otherwise leave unwired. Call this instead of spreading `maps`
 * into the constructor if you want metalness and AO to actually take effect.
 *
 * TILING: do **not** set `texture.repeat` on these textures. They are render
 * target textures shared by every material that asked for the same id, and they
 * cannot be cloned (a clone has no GPU image to upload from). Scale your UVs in
 * the geometry, or multiply `vUv` in `onBeforeCompile` — and prefer
 * `mx_hexSample` from `MaterialGlsl.ts` over a plain high repeat count, which is
 * what makes tiling visible in the first place.
 */
export function applyPbrMaps(
  material: THREE.MeshStandardMaterial,
  maps: PbrMaps,
  opts: { normalScale?: number; aoIntensity?: number; displacementScale?: number } = {},
): void {
  material.map = maps.map;
  material.normalMap = maps.normalMap;
  material.roughnessMap = maps.roughnessMap;
  material.aoMap = maps.aoMap;
  if (maps.metalnessMap) material.metalnessMap = maps.metalnessMap;
  material.roughness = 1;
  material.metalness = 1;
  material.aoMapIntensity = opts.aoIntensity ?? 1;
  material.normalScale.setScalar(opts.normalScale ?? 1);
  if (maps.displacementMap && opts.displacementScale) {
    material.displacementMap = maps.displacementMap;
    material.displacementScale = opts.displacementScale;
  }
  material.needsUpdate = true;
}

function solid(r: number, g: number, b: number): THREE.Texture {
  const data = new Uint8Array([r, g, b, 255]);
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function detectSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return false;
    const s = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    // Deliberately narrow: matching something like "ANGLE (Google, ...)" would
    // false-positive on real mobile GPUs and halve their texture budget.
    return /swiftshader|softwarerasterizer|llvmpipe|basic render|mesa offscreen/.test(s);
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

import * as THREE from 'three';
import { EventBus } from './EventBus';
import { Input } from './Input';
import { Settings } from './Settings';
import { Phase } from './Types';
import type { GameContext, GameSystem, WorldQuery } from './Types';

/** Fallback world query used before the terrain system installs the real one. */
const FLAT_WORLD: WorldQuery = {
  heightAt: () => -60,
  normalAt: (_x, _z, out) => out.set(0, 1, 0),
  biomeAt: () => ({ id: 'shallows', weight: 1, weights: { shallows: 1 } }),
  isSolid: (_x, y) => y < -60,
  waterHeightAt: () => 0,
  currentAt: (_x, _y, _z, _t, out) => out.set(0, 0, 0),
};

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  settings?: Settings;
}

/**
 * The frame loop. Owns the renderer, camera, scene and the ordered list of
 * systems. Rendering itself is delegated to whichever system registers as the
 * `render` provider (the post-processing stack); if none does, the engine falls
 * back to a direct `renderer.render` call so the game is always visible.
 */
export class Engine implements GameContext {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly bus = new EventBus();
  readonly inputImpl = new Input();
  readonly settings: Settings;

  time = 0;
  /**
   * Frames presented since boot. The capture harness waits on this rather than on
   * wall-clock time: under software rendering a single frame can exceed a second,
   * so a millisecond wait may span only one frame and catch every smoothed or
   * streamed system — biome crossfades, HUD easing, terrain LOD, background
   * texture bakes, temporal accumulation — mid-transition.
   */
  frame = 0;
  width = 1;
  height = 1;
  pixelRatio = 1;
  world: WorldQuery = FLAT_WORLD;
  paused = false;

  /** Set by the post stack; when present the engine calls it instead of render(). */
  renderOverride: ((dt: number) => void) | null = null;

  /**
   * Unclamped seconds since the previous frame.
   *
   * `dt` handed to systems is clamped so a long stall cannot teleport the player,
   * which is right for simulation and wrong for anything presenting to a human: a
   * HUD easing on clamped dt ages at wall-clock speed only while frames are fast.
   * Under software GL, where a frame can take 1.4 s, interface timers driven by
   * `dt` ran roughly 21x slow — a depth readout eased 132 m in a single frame and
   * five-second toasts needed 105 s to expire. Presentation timing should use
   * this; simulation should not.
   */
  rawDt = 1 / 60;

  /** Smoothed frame time in ms, used by adaptive resolution + the HUD. */
  frameMs = 16.7;
  /** Current adaptive-resolution scalar, multiplied into renderScale. */
  adaptiveScale = 1;

  private systems: GameSystem[] = [];
  private byName = new Map<string, GameSystem>();
  private clock = new THREE.Clock();
  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private booted = false;
  private lastAdaptCheck = 0;

  get input() {
    return this.inputImpl;
  }

  constructor(opts: EngineOptions) {
    this.settings = opts.settings ?? Settings.load();

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false, // handled by TAA/SMAA in the post stack
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // needed for the in-game screenshot key
    });
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 1);

    this.camera = new THREE.PerspectiveCamera(this.settings.graphics.fov, 1, 0.08, 4000);
    this.camera.position.set(0, -12, 0);
    this.scene.add(this.camera);

    this.inputImpl.attach(opts.canvas);
    this.inputImpl.sensitivity = this.settings.gameplay.mouseSensitivity;
    this.inputImpl.invertY = this.settings.gameplay.invertY;

    this.settings.onChange((s) => {
      this.inputImpl.sensitivity = s.gameplay.mouseSensitivity;
      this.inputImpl.invertY = s.gameplay.invertY;
      if (this.camera.fov !== s.graphics.fov) {
        this.camera.fov = s.graphics.fov;
        this.camera.updateProjectionMatrix();
      }
      this.applySize();
    });

    this.observeSize(opts.canvas);
  }

  /* ---------------------------------------------------------------- *
   * System registry
   * ---------------------------------------------------------------- */

  register(system: GameSystem): void {
    if (this.byName.has(system.name)) {
      throw new Error(`[Engine] duplicate system name "${system.name}"`);
    }
    this.byName.set(system.name, system);
    this.systems.push(system);
    this.systems.sort((a, b) => a.phase - b.phase);
    if (this.booted) void system.init?.(this);
  }

  get<T extends GameSystem>(name: string): T {
    const s = this.byName.get(name);
    if (!s) throw new Error(`[Engine] no system named "${name}"`);
    return s as T;
  }

  tryGet<T extends GameSystem>(name: string): T | undefined {
    return this.byName.get(name) as T | undefined;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  async boot(onProgress?: (fraction: number, label: string) => void): Promise<void> {
    this.applySize();
    const list = [...this.systems].sort((a, b) => a.phase - b.phase);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      onProgress?.(i / list.length, s.name);
      // Yield so the loading screen can paint between heavy inits.
      await new Promise((r) => requestAnimationFrame(r));
      try {
        await s.init?.(this);
      } catch (err) {
        console.error(`[Engine] system "${s.name}" failed to init`, err);
      }
    }
    onProgress?.(1, 'ready');
    this.booted = true;
    for (const s of this.systems) s.resize?.(this.width, this.height, this);
  }

  start(): void {
    this.clock.start();
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.tick();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  private tick(): void {
    const t0 = performance.now();
    const raw = this.clock.getDelta();
    // Clamp so a tab-switch or a long GC pause cannot teleport the player.
    const dt = Math.min(raw, 1 / 15);

    this.rawDt = raw;
    this.inputImpl.beginFrame();
    if (!this.paused) this.time += dt;
    this.frame++;

    for (const s of this.systems) {
      if (!s.update) continue;
      // Gameplay/simulation phases freeze while paused; render phases keep
      // running so the pause menu still shows a live, post-processed scene.
      if (this.paused && s.phase >= Phase.World && s.phase <= Phase.Gameplay) continue;
      try {
        s.update(dt, this);
      } catch (err) {
        console.error(`[Engine] system "${s.name}" update threw`, err);
        s.update = undefined; // stop the spam; keep the game running
      }
    }

    if (this.renderOverride) this.renderOverride(dt);
    else this.renderer.render(this.scene, this.camera);

    this.inputImpl.endFrame();

    const ms = performance.now() - t0;
    this.frameMs += (ms - this.frameMs) * 0.06;
    this.updateAdaptiveResolution();
  }

  /* ---------------------------------------------------------------- *
   * Sizing + adaptive resolution
   * ---------------------------------------------------------------- */

  private observeSize(canvas: HTMLCanvasElement): void {
    const parent = canvas.parentElement ?? document.body;
    this.resizeObserver = new ResizeObserver(() => this.applySize());
    this.resizeObserver.observe(parent);
    window.addEventListener('resize', () => this.applySize());
  }

  applySize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement ?? document.body;
    const w = Math.max(1, parent.clientWidth || window.innerWidth);
    const h = Math.max(1, parent.clientHeight || window.innerHeight);
    const g = this.settings.graphics;
    const dpr = Math.min(window.devicePixelRatio || 1, g.maxPixelRatio);
    const scale = g.renderScale * this.adaptiveScale;

    this.width = w;
    this.height = h;
    this.pixelRatio = dpr * scale;

    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (this.booted) for (const s of this.systems) s.resize?.(w, h, this);
  }

  /**
   * Nudges internal resolution to hold the target frame time. Moves in small
   * steps at most twice a second so it never visibly pumps.
   */
  private updateAdaptiveResolution(): void {
    const target = this.settings.graphics.targetFrameMs;
    if (target <= 0) return;
    if (this.time - this.lastAdaptCheck < 0.5) return;
    this.lastAdaptCheck = this.time;

    const prev = this.adaptiveScale;
    if (this.frameMs > target * 1.25) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.06);
    else if (this.frameMs < target * 0.78) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.03);

    if (Math.abs(this.adaptiveScale - prev) > 1e-3) this.applySize();
  }

  dispose(): void {
    this.stop();
    for (const s of this.systems) s.dispose?.();
    this.systems.length = 0;
    this.byName.clear();
    this.inputImpl.dispose();
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    this.bus.clear();
  }
}

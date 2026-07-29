/**
 * `ui.hud` — the DOM interface system.
 *
 * Owns the HUD, the PDA, the menus, the fabricator and the habitat-builder HUD,
 * plus the single keyboard router that decides who gets a key. Reads other
 * systems through guarded structural interfaces and communicates outward only
 * through the event bus, with two documented exceptions (pointer-lock control
 * and death recovery) that are listed in the integration notes.
 */
import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import {
  Anim,
  applyPrefs,
  clamp01,
  installUiTextures,
  loadPrefs,
  savePrefs,
  setClass,
  WallClock,
} from './UiKit';
import type { UiPrefs } from './UiKit';
import { HudLayer } from './HudLayer';
import type { HudState, PromptSpec } from './HudLayer';
import { PdaOverlay } from './PdaOverlay';
import type { PdaTab } from './PdaOverlay';
import { MenuLayer } from './MenuLayer';
import { CraftBuildLayer } from './CraftBuildLayer';
import { IconFactory } from './IconFactory';
import { DEPTH_BANDS, depthBand, itemDef } from './ItemDatabase';
import { gameState } from './GameStateBridge';

/* Scratch — module scope so update() never allocates. */
const _fwd = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _right = new THREE.Vector3();
const _hit = new THREE.Vector3();

interface PlayerLike {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  depth: number;
  swimming: boolean;
  vitals: { oxygen: number; maxOxygen: number; health: number; food: number; water: number };
  teleport?(p: THREE.Vector3): void;
  respawn?(): void;
}

interface InputControl {
  uiCapture: boolean;
  requestLock?(): void;
  releaseLock?(): void;
}

interface EngineLike {
  paused: boolean;
  frameMs: number;
  adaptiveScale: number;
}

const MINE_RANGE = 4.2;

/**
 * Boot quiet window, in milliseconds.
 *
 * Systems flush their initial state on their first few updates: the tech tree
 * evaluates its depth triggers, the quest tracker seeds objectives, equipment
 * reconciles. Those are journal entries, not alerts the player needs thrown at
 * them before they have touched a key. Inside this window `info` notifications
 * are written to the PDA log only. Warnings, dangers and successes always toast —
 * if something is genuinely wrong at second zero the player must see it.
 */
const BOOT_QUIET_MS = 1800;

/**
 * A depth delta larger than this between two region polls is a teleport, not a
 * descent, so the depth-band announcement is suppressed for it.
 */
const BAND_TELEPORT_M = 25;

export class HudSystem implements GameSystem {
  readonly name = 'ui.hud';
  readonly phase = Phase.UI;

  private anim = new Anim();
  private prefs: UiPrefs = loadPrefs();
  private icons = new IconFactory();

  private host!: HTMLElement;
  private hud!: HudLayer;
  private pda!: PdaOverlay;
  private menus!: MenuLayer;
  private craft!: CraftBuildLayer;

  private ctx: GameContext | null = null;
  private player: PlayerLike | null = null;
  private offs: Array<() => void> = [];
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;

  private lastBiome = '';
  private lastBand = '';
  private lastPollDepth = 0;
  private bootAt = 0;
  /** Drives UI tweens in real time — see WallClock in UiKit. */
  private uiClock = new WallClock();
  private elapsed = 0;
  private maxDepth = 0;
  private deaths = 0;
  private criticalAt: Record<string, number> = {};
  private onboardTimer = 22;
  private automated = false;
  private savedMode: string | null = null;
  private wasModal = false;
  private scanOverride = -1;
  private promptOverride: PromptSpec[] | null = null;

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.bootAt = performance.now();
    installUiTextures();
    applyPrefs(this.prefs);

    this.host = (document.getElementById('ui-root') as HTMLElement | null) ?? document.body;
    setClass(document.documentElement, 'ui-ready', true);

    // Icon quality follows the graphics tier: the 3-D pass is skipped on low.
    this.icons.allow3d = ctx.settings.at('medium');
    this.icons.budgetPerFrame = ctx.settings.at('high') ? 3 : 1;

    this.hud = new HudLayer(this.host, this.anim, this.prefs);
    this.pda = new PdaOverlay(this.host, this.anim, this.prefs, this.icons);
    this.pda.loadLayout();
    this.craft = new CraftBuildLayer(this.host, this.anim, this.prefs, this.icons);
    this.menus = new MenuLayer(this.host, this.anim, this.prefs, {
      onResume: () => this.closeMenus(true),
      onNewGame: () => this.newGame(),
      onSave: () => this.save(),
      onLoad: () => this.load(),
      onQuitToMenu: () => this.toMainMenu(),
      onRespawn: () => this.respawn(),
      onPrefsChanged: (p) => this.applyPrefsEverywhere(p),
    });

    this.player = ctx.tryGet('player') as unknown as PlayerLike | undefined ?? null;
    this.hud.setSubtitlesEnabled(ctx.settings.gameplay.subtitles);

    this.bindBus(ctx);
    this.bindKeys(ctx);

    // Automated capture must see the game, not a menu.
    this.automated =
      (navigator as unknown as { webdriver?: boolean }).webdriver === true ||
      /[?&](capture|nomenu)=1/.test(location.search);

    if (!this.automated) {
      this.menus.show('main', ctx);
      this.freezeSurvival(ctx);
    } else {
      // Capture runs teleport the camera around for ~20 s. Suspend the survival
      // drains (never persisted) so a drowning death screen cannot land on top
      // of another agent's reference frames, and drop the onboarding prompt.
      this.freezeSurvival(ctx);
      this.onboardTimer = 0;
    }

    // Expose a small handle for debugging and e2e without touching main.ts.
    (window as unknown as { __UI__?: unknown }).__UI__ = {
      hud: this.hud,
      pda: this.pda,
      menus: this.menus,
      craft: this.craft,
      notify: (t: string) => this.hud.notify(t),
      open: (screen: string) => this.openScreen(screen, true),
    };
  }

  /* ------------------------------------------------------------------ *
   * Public API for other systems
   * ------------------------------------------------------------------ */

  notify(text: string, kind: 'info' | 'warn' | 'danger' | 'success' = 'info', ttl = 4.2): void {
    this.hud.notify(text, kind, ttl);
  }

  voice(text: string, speaker = 'PDA', ttl = 5.5): void {
    this.hud.voice(text, speaker, ttl);
  }

  /** Contextual prompt override. Pass null to hand control back to the HUD. */
  prompt(list: PromptSpec[] | null): void {
    this.promptOverride = list;
  }

  /** 0..1 scan ring around the reticle. Negative hands control back. */
  setScanProgress(v: number): void {
    this.scanOverride = v;
  }

  openScreen(screen: string, open: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tabs: PdaTab[] = ['inventory', 'blueprints', 'databank', 'journal', 'capsule'];
    if (tabs.includes(screen as PdaTab)) {
      if (open) this.pda.show(ctx, screen as PdaTab);
      else this.pda.hide();
      return;
    }
    switch (screen) {
      case 'pda':
        if (open) this.pda.show(ctx, 'inventory');
        else this.pda.hide();
        break;
      case 'fabricator':
        if (open) this.craft.openFabricator(ctx);
        else this.craft.closeFabricator();
        break;
      case 'builder':
        if (open !== this.craft.buildMode) this.craft.toggleBuild(ctx);
        break;
      case 'pause':
        if (open) this.menus.show('pause', ctx);
        else this.closeMenus(true);
        break;
      case 'settings':
        if (open) this.menus.show('settings', ctx);
        else this.closeMenus(true);
        break;
      case 'main':
        if (open) this.toMainMenu();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ *
   * Bus wiring
   * ------------------------------------------------------------------ */

  /**
   * The single entry point to the toast rail. Applies the boot quiet window: a
   * non-urgent message raised while systems are still flushing their initial
   * state is dropped from the rail (it is still in the PDA log). Warnings and
   * dangers are never suppressed.
   */
  private toast(text: string, kind: 'info' | 'warn' | 'danger' | 'success' = 'info', ttl = 4.2): void {
    if (kind !== 'warn' && kind !== 'danger' && performance.now() - this.bootAt < BOOT_QUIET_MS) return;
    this.hud.notify(text, kind, ttl);
  }

  private bindBus(ctx: GameContext): void {
    const bus = ctx.bus;
    const on = <K extends Parameters<typeof bus.on>[0]>(k: K, fn: Parameters<typeof bus.on<K>>[1]) => {
      this.offs.push(bus.on(k, fn));
    };

    on('ui:notify', (p) => {
      const kind = p.kind ?? 'info';
      // The log always gets it; the toast rail applies the boot quiet window.
      this.toast(p.text, kind, p.ttl ?? 4.2);
      this.pda.pushLog(p.text, kind, this.timeOfDay());
    });

    on('ui:voice', (p) => {
      if (ctx.settings.gameplay.subtitles) this.hud.voice(p.text, p.speaker, p.ttl ?? 5.5);
      this.pda.pushLog(`${p.speaker ?? 'PDA'}: ${p.text}`, 'voice', this.timeOfDay());
    });

    on('ui:screen', (p) => this.openScreen(p.screen, p.open));

    on('biome:entered', (p) => {
      this.hud.announceBiome(p.name);
      this.pda.pushLog(`Entered ${p.name}`, 'biome', this.timeOfDay());
    });

    on('player:damage', (p) => {
      let angle: number | null = null;
      if (p.direction && this.ctx) {
        // Project the incoming direction onto the camera basis for a directional hit.
        const cam = this.ctx.camera;
        cam.getWorldDirection(_fwd);
        _right.set(_fwd.z, 0, -_fwd.x).normalize();
        _probe.set(p.direction[0], p.direction[1], p.direction[2]);
        if (_probe.lengthSq() > 1e-6) {
          _probe.normalize();
          angle = Math.atan2(_probe.dot(_right), -_probe.dot(_fwd));
        }
      }
      this.hud.damage(p.amount, angle);
      const rig = this.ctx?.tryGet('player.camera') as unknown as { addTrauma?(a: number): void } | undefined;
      rig?.addTrauma?.(clamp01(p.amount / 40) * 0.5);
    });

    on('player:died', (p) => {
      this.deaths++;
      this.pda.pushLog(`Died: ${p.cause}`, 'danger', this.timeOfDay());
      if (this.automated) return;
      if (this.ctx) this.menus.show('dead', this.ctx, this.causeText(p.cause));
    });

    on('vitals:critical', (p) => {
      const now = this.elapsed;
      if ((this.criticalAt[p.kind] ?? -99) > now - 6) return;
      this.criticalAt[p.kind] = now;
      const text =
        p.kind === 'oxygen'
          ? `Oxygen critical — ${Math.ceil(p.value)} seconds remaining.`
          : p.kind === 'health'
            ? 'Vital signs critical. Seek immediate medical attention.'
            : p.kind === 'food'
              ? 'Caloric reserves depleted.'
              : 'Hydration critical.';
      this.toast(text, p.kind === 'oxygen' ? 'danger' : 'warn', 5);
    });

    on('inventory:changed', (p) => {
      this.pda.markDirty();
      if (p.delta > 0) {
        this.toast(`${itemDef(p.id).name} ×${p.delta}`, 'info', 2.6);
      }
    });

    on('craft:completed', (p) => {
      this.pda.markDirty();
      this.pda.pushLog(`Fabricated ${itemDef(p.id).name} ×${p.count}`, 'success', this.timeOfDay());
    });

    on('scan:completed', (p) => {
      this.toast(`Scan complete — ${itemDef(p.id).name}`, 'success', 3.6);
      this.pda.pushLog(`Scanned ${p.id} (${p.category})`, 'success', this.timeOfDay());
      this.pda.markDirty();
      this.scanOverride = -1;
    });

    on('databank:unlocked', (p) => {
      this.pda.unlockDatabank(p.id);
      this.toast('New databank entry.', 'success', 3.4);
    });

    on('tech:unlocked', (p) => {
      this.toast(`Blueprint unlocked — ${itemDef(p.id).name}`, 'success', 4);
      this.pda.markDirty();
    });

    on('quest:updated', (p) => {
      this.pda.markDirty();
      this.pda.pushLog(`Objective ${p.state}: ${p.objective ?? p.id}`, 'quest', this.timeOfDay());
    });

    on('water:transition', (p) => {
      if (!p.underwater) this.pda.pushLog('Surfaced', 'log', this.timeOfDay());
    });

    on('creature:aggro', (p) => {
      this.toast(`${p.species} — aggressive at ${Math.round(p.distance)} m`, 'danger', 3.4);
    });

    on('save:written', (p) => this.toast(`Saved to slot "${p.slot}".`, 'success', 2.8));
    on('save:loaded', (p) => this.toast(`Loaded slot "${p.slot}".`, 'success', 2.8));

    on('settings:quality', () => {
      this.icons.allow3d = ctx.settings.at('medium');
      this.icons.budgetPerFrame = ctx.settings.at('high') ? 3 : 1;
    });

    this.offs.push(
      ctx.settings.onChange((s) => {
        this.hud.setSubtitlesEnabled(s.gameplay.subtitles);
      }),
    );
  }

  private causeText(cause: string): string {
    switch (cause) {
      case 'drowning':
        return 'Asphyxiation — oxygen supply exhausted';
      case 'starvation':
        return 'Systemic failure — no food or water';
      default:
        return `Killed by ${cause}`;
    }
  }

  /* ------------------------------------------------------------------ *
   * Keyboard routing
   * ------------------------------------------------------------------ */

  private bindKeys(ctx: GameContext): void {
    const isTextEntry = (t: EventTarget | null): boolean => {
      const e = t as HTMLElement | null;
      if (!e) return false;
      const tag = e.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable === true;
    };

    const handler = (ev: KeyboardEvent) => {
      // While a field has focus, keep the game's input sampler out of it. The
      // browser still performs the default text insertion.
      if (isTextEntry(ev.target)) {
        if (ev.code === 'Escape') {
          (ev.target as HTMLElement).blur();
          ev.preventDefault();
        }
        ev.stopPropagation();
        return;
      }
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;

      let consumed = true;
      switch (ev.code) {
        case 'Escape':
          this.onEscape(ctx);
          break;
        case 'Tab':
        case 'KeyI':
          this.togglePda(ctx, 'inventory');
          break;
        case 'KeyP':
          this.togglePda(ctx, 'databank');
          break;
        case 'KeyJ':
          this.togglePda(ctx, 'journal');
          break;
        case 'KeyB':
          if (!this.pda.open && !this.menus.open) this.craft.toggleBuild(ctx);
          break;
        case 'F1':
          this.prefs.perfOverlay = !this.prefs.perfOverlay;
          this.applyPrefsEverywhere(this.prefs);
          break;
        default:
          consumed = false;
          if (this.craft.buildMode && /^Digit[1-9]$/.test(ev.code)) {
            consumed = this.craft.selectHotbar(Number(ev.code.slice(5)), ctx);
          }
          if (!consumed) consumed = this.pda.handleKey(ev.code);
          if (!consumed) consumed = this.craft.handleKey(ev.code, ctx);
          break;
      }
      if (consumed) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };

    this.keyHandler = handler;
    window.addEventListener('keydown', handler, { capture: true });
  }

  private togglePda(ctx: GameContext, tab: PdaTab): void {
    if (this.menus.open) return;
    if (this.craft.fabricatorOpen) this.craft.closeFabricator();
    this.pda.toggle(ctx, tab);
    if (!this.pda.open) this.relock(ctx);
  }

  private onEscape(ctx: GameContext): void {
    if (this.pda.open) {
      this.pda.hide();
      this.relock(ctx);
      return;
    }
    if (this.craft.fabricatorOpen) {
      this.craft.closeFabricator();
      this.relock(ctx);
      return;
    }
    if (this.craft.buildMode) {
      this.craft.toggleBuild(ctx);
      return;
    }
    if (this.menus.screen === 'settings' || this.menus.screen === 'credits') {
      this.menus.show(this.menus.screen === 'settings' ? 'pause' : 'main', ctx);
      return;
    }
    if (this.menus.screen === 'pause') {
      this.closeMenus(true);
      return;
    }
    if (this.menus.screen === 'main' || this.menus.screen === 'dead') return;
    this.menus.show('pause', ctx);
  }

  private relock(ctx: GameContext): void {
    // Called from inside a key handler, so this still counts as a user gesture.
    if (this.menus.open || this.pda.open || this.craft.fabricatorOpen) return;
    (ctx.input as unknown as InputControl).requestLock?.();
  }

  /* ------------------------------------------------------------------ *
   * Menu actions
   * ------------------------------------------------------------------ */

  private applyPrefsEverywhere(p: UiPrefs): void {
    this.prefs = p;
    applyPrefs(p);
    savePrefs(p);
    this.hud.setPrefs(p);
    this.pda.setPrefs(p);
    this.menus.setPrefs(p);
    this.craft.setPrefs(p);
  }

  /** Suspends survival drains while the main menu is up, without persisting. */
  private freezeSurvival(ctx: GameContext): void {
    if (this.savedMode !== null) return;
    this.savedMode = ctx.settings.gameplay.mode;
    ctx.settings.gameplay.mode = 'creative';
  }

  private thawSurvival(ctx: GameContext): void {
    if (this.savedMode === null) return;
    ctx.settings.gameplay.mode = this.savedMode as typeof ctx.settings.gameplay.mode;
    this.savedMode = null;
  }

  private closeMenus(relock: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.menus.hide();
    this.thawSurvival(ctx);
    if (relock) (ctx.input as unknown as InputControl).requestLock?.();
  }

  private newGame(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.elapsed = 0;
    this.maxDepth = 0;
    this.closeMenus(true);
    this.hud.notify('Lifepod 5 has landed. Hull integrity nominal.', 'success', 5);
    this.hud.voice(
      'Emergency deployment successful. All systems nominal. You are advised to secure a source of drinking water immediately.',
      'PDA',
      7,
    );
    this.hud.voice('Detecting multiple leviathan-class lifeforms in the region. Are you sure whatever you are doing is worth it?', 'PDA', 7);
    ctx.bus.emit('quest:updated', { id: 'q_survive', state: 'started', objective: 'Fabricate a survival knife' });
  }

  private save(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = gameState(ctx);
    if (st?.save) {
      st.save('auto');
      ctx.bus.emit('save:written', { slot: 'auto' });
    } else {
      this.hud.notify('Saving is unavailable in this build.', 'warn', 3);
    }
  }

  private load(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = gameState(ctx);
    const ok = st?.load?.('auto') ?? false;
    if (ok) {
      ctx.bus.emit('save:loaded', { slot: 'auto' });
      this.pda.markDirty();
      this.closeMenus(true);
    } else {
      // No save yet — treat "Continue" as a fresh descent rather than failing.
      this.newGame();
    }
  }

  private toMainMenu(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.pda.hide();
    this.craft.closeFabricator();
    if (this.craft.buildMode) this.craft.toggleBuild(ctx);
    this.menus.show('main', ctx);
    this.freezeSurvival(ctx);
    (ctx.input as unknown as InputControl).releaseLock?.();
  }

  private respawn(): void {
    const ctx = this.ctx;
    const p = this.player;
    if (!ctx || !p) return;
    if (p.respawn) {
      p.respawn();
    } else {
      // Fallback until the player agent exposes respawn(): restore vitals and
      // return to the pod. Listed under INTEGRATION REQUESTS.
      p.vitals.health = 100;
      p.vitals.oxygen = p.vitals.maxOxygen;
      p.vitals.food = Math.max(p.vitals.food, 45);
      p.vitals.water = Math.max(p.vitals.water, 45);
      _hit.set(0, ctx.world.heightAt(0, 0) + 6, 0);
      p.teleport?.(_hit);
    }
    this.closeMenus(true);
    this.hud.notify('Respawned at Lifepod 5. Equipment lost at depth.', 'warn', 4.5);
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */

  update(dt: number, ctx: GameContext): void {
    this.ctx = ctx;
    if (!this.player) this.player = (ctx.tryGet('player') as unknown as PlayerLike | undefined) ?? null;

    const engine = ctx as unknown as EngineLike;
    const modal = this.menus.open || this.pda.open || this.craft.fabricatorOpen;

    /* input capture + pause authority (overrides main.ts's Escape toggle) */
    (ctx.input as unknown as InputControl).uiCapture = modal;
    engine.paused = this.menus.pausing;
    if (modal && !this.wasModal) (ctx.input as unknown as InputControl).releaseLock?.();
    this.wasModal = modal;

    setClass(document.documentElement, 'ui-modal', modal);
    setClass(this.hud.root, 'hidden', this.pda.open || this.menus.open);

    if (!engine.paused) this.elapsed += dt;

    /* tick animation + icon upgrades — tweens are presentation, so they run on
       the wall clock rather than the clamped simulation dt. */
    const uiDt = engine.paused ? (this.uiClock.hold(), 0) : this.uiClock.tick();
    this.anim.update(uiDt);
    if (this.pda.open || this.craft.fabricatorOpen || this.craft.buildMode) this.icons.update();

    /* gather state */
    const p = this.player;
    const vit = p?.vitals;
    const depth = p?.depth ?? 0;
    if (depth > this.maxDepth) this.maxDepth = depth;
    const heading = p ? ((-(p.yaw * 180) / Math.PI) % 360 + 360) % 360 : 0;

    const water = ctx.tryGet('world.water') as unknown as { underwater?: boolean } | undefined;
    const sky = ctx.tryGet('world.sky') as unknown as { timeOfDay?: number } | undefined;

    let podBearing: number | null = null;
    let podDistance = 0;
    if (p) {
      const dx = -p.position.x;
      const dz = -p.position.z;
      podDistance = Math.hypot(dx, dz);
      if (podDistance > 2) podBearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    }

    const state: HudState = {
      depth,
      oxygen: vit?.oxygen ?? 0,
      maxOxygen: vit?.maxOxygen ?? 45,
      health: vit?.health ?? 100,
      food: vit?.food ?? 100,
      water: vit?.water ?? 100,
      heading,
      biomeName: this.lastBiome,
      underwater: water?.underwater ?? p?.swimming ?? true,
      timeOfDay: sky?.timeOfDay ?? 12,
      frameMs: engine.frameMs ?? 16.7,
      renderScale: (engine.adaptiveScale ?? 1) * ctx.settings.graphics.renderScale,
      podBearing,
      podDistance,
      elapsed: this.elapsed,
      mode: ctx.settings.gameplay.mode,
      paused: engine.paused,
    };

    /* biome + depth band transitions (throttled — these poll the world) */
    if (p && ctx.frame % 12 === 0) this.pollRegion(ctx, p, depth);

    /* prompts — the onboarding hint is a real-time dwell, so it uses uiDt */
    this.updatePrompts(uiDt, ctx, p);

    /* scan ring */
    if (this.scanOverride >= 0) this.hud.setScanProgress(this.scanOverride);
    else {
      const prog = gameState(ctx)?.scanner?.progress;
      let best = 0;
      if (prog) for (const v of prog.values()) if (v > best && v < 1) best = v;
      this.hud.setScanProgress(best);
    }

    // Every layer below is presentation: refresh throttles, progress bars and
    // dwell timers all want real seconds. Only `elapsed` (the survival clock,
    // accumulated above) is simulation-timed.
    this.hud.update(uiDt, state);
    this.pda.update(uiDt, ctx);
    this.craft.update(uiDt, ctx);
    this.menus.setStats(this.elapsed, this.maxDepth, this.deaths);
    this.menus.update(uiDt);
  }

  private pollRegion(ctx: GameContext, p: PlayerLike, depth: number): void {
    try {
      const b = ctx.world.biomeAt(p.position.x, p.position.z);
      if (b.id !== this.lastBiome) {
        this.lastBiome = b.id;
        const terrain = ctx.tryGet('world.terrain') as unknown as
          | { biomes?: ReadonlyMap<string, { name: string }> }
          | undefined;
        const name = terrain?.biomes?.get(b.id)?.name ?? this.prettify(b.id);
        ctx.bus.emit('biome:entered', { id: b.id, name });
      }
    } catch {
      /* world not installed yet */
    }
    // A teleport crosses several bands in one step. The event still fires (other
    // systems want to know where the player *is*), but the announcement does not:
    // "Deep Zone — Hull stress" is a thing you earn by descending, not something
    // a load or a respawn should shout at you.
    const jumped = Math.abs(depth - this.lastPollDepth) > BAND_TELEPORT_M;
    this.lastPollDepth = depth;

    const band = depthBand(depth);
    if (band.id !== this.lastBand) {
      const previous = this.lastBand;
      this.lastBand = band.id;
      ctx.bus.emit('depth:band', { band: band.id, depth });
      // Only announce descents past a meaningful threshold.
      const idx = DEPTH_BANDS.findIndex((x) => x.id === band.id);
      const prevIdx = DEPTH_BANDS.findIndex((x) => x.id === previous);
      if (previous && !jumped && idx > prevIdx && band.note) {
        this.toast(`${band.label} — ${band.note}`, idx >= 4 ? 'warn' : 'info', 4);
      }
    }
  }

  private prettify(id: string): string {
    return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Contextual prompts. An explicit override from another system always wins;
   * otherwise the HUD derives an honest prompt from what is actually in front of
   * the camera using the world heightfield.
   */
  private updatePrompts(dt: number, ctx: GameContext, p: PlayerLike | null): void {
    if (this.promptOverride) {
      this.hud.setPrompt(this.promptOverride);
      return;
    }
    if (this.craft.buildMode || this.pda.open || this.menus.open) {
      this.hud.setPrompt(null);
      return;
    }
    if (this.onboardTimer > 0) {
      this.onboardTimer -= dt;
      if (this.onboardTimer > 0) {
        this.hud.setPrompt([
          { key: 'Tab', label: 'Open PDA' },
          { key: 'B', label: 'Habitat builder' },
        ]);
        return;
      }
    }
    if (!p || ctx.frame % 6 !== 0) return;

    ctx.camera.getWorldDirection(_fwd);
    let hitDist = -1;
    for (let d = 0.8; d <= MINE_RANGE; d += 0.45) {
      _probe.copy(ctx.camera.position).addScaledVector(_fwd, d);
      if (_probe.y <= ctx.world.heightAt(_probe.x, _probe.z)) {
        hitDist = d;
        break;
      }
    }
    if (hitDist < 0) {
      this.hud.setPrompt(null);
      return;
    }
    this.hud.setPrompt([
      { key: 'LMB', label: 'Mine deposit' },
      { key: 'Q', label: 'Scan' },
    ]);
  }

  private timeOfDay(): number {
    const sky = this.ctx?.tryGet('world.sky') as unknown as { timeOfDay?: number } | undefined;
    return sky?.timeOfDay ?? 12;
  }

  /* ------------------------------------------------------------------ *
   * Teardown
   * ------------------------------------------------------------------ */

  resize(_w: number, _h: number, _ctx: GameContext): void {
    /* layout is pure CSS; nothing to recompute */
  }

  dispose(): void {
    for (const off of this.offs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.offs.length = 0;
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler, { capture: true });
    this.keyHandler = null;
    this.anim.clear();
    this.hud?.dispose();
    this.pda?.dispose();
    this.menus?.dispose();
    this.craft?.dispose();
    this.icons.dispose();
    setClass(document.documentElement, 'ui-ready', false);
    setClass(document.documentElement, 'ui-modal', false);
    delete (window as unknown as { __UI__?: unknown }).__UI__;
  }
}

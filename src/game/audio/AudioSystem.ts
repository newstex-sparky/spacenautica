/**
 * SPACENAUTICA audio — 100% synthesised at runtime. There are no audio files in
 * this project and none may be added; every sound you hear is oscillators,
 * procedurally-filled noise buffers and procedurally-generated impulse
 * responses, assembled by the modules in this directory.
 *
 * Layout:
 *   Dsp.ts              synthesis primitives, noise bank, IR generator, Voice
 *   Mixer.ts            master/bus graph + limiter
 *   UnderwaterChain.ts  depth low-pass + dual convolution reverb (open/enclosed)
 *   Spatial.ts          PannerNodes + camera-slaved listener
 *   Ambience.ts         per-biome layered beds and sparse event generators
 *   Foley.ts            player strokes, breathing, heartbeat, impacts
 *   Sfx.ts              tools + UI cue registry and sustained tool loops
 *   Creatures.ts        aggro vocalisations with distance filtering
 *   Music.ts            generative ambient score
 *
 * The AudioContext is created only inside a user-gesture handler and every
 * entry point is guarded, so an autoplay-blocked or WebAudio-less browser gets a
 * silent game rather than an exception.
 */
import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem, QualityTier } from '../core/Types';
import { Ambience } from './Ambience';
import { Creatures } from './Creatures';
import { childRng, clamp } from './Dsp';
import { AudioEnv } from './Env';
import type { PlayerLike, WaterLike } from './Env';
import { Foley } from './Foley';
import { Music } from './Music';
import { normaliseCue, Sfx } from './Sfx';
import type { Vec3Like } from './Spatial';

/** Module-scope scratch: no per-frame allocation. */
const _pos = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _cue = new THREE.Vector3();

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Enclosure targets for the `env.*` cue family. */
const ENCLOSURE: Record<string, number> = {
  'env.open': 0,
  'env.water': 0,
  'env.exit': 0,
  'env.cave': 0.85,
  'env.wreck': 1,
  'env.base': 0.9,
  'env.interior': 0.95,
  'env.enclosed': 1,
  'env.vehicle': 0.7,
};

export class AudioSystem implements GameSystem {
  readonly name = 'audio';
  readonly phase = Phase.UI;

  /** True once the context exists and the graph is live. */
  get ready(): boolean {
    return this.env !== null;
  }

  private ctxAudio: AudioContext | null = null;
  private env: AudioEnv | null = null;
  private ambience: Ambience | null = null;
  private foley: Foley | null = null;
  private sfx: Sfx | null = null;
  private creatures: Creatures | null = null;
  private music: Music | null = null;

  private unsubs: Array<() => void> = [];
  private gestureCleanup: Array<() => void> = [];
  private disposed = false;
  private failed = false;

  private biomeId = '';
  private enclosureTarget = 0;
  private lastAlarm = 0;
  private lastPickup = 0;
  private biomeCheck = 0;
  private settingsRevision = -1;
  private pendingBiome = 'shallows';
  private hasPrev = false;

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.wireEvents(ctx);

    // WebAudio may only be started from a user gesture. Until then the whole
    // module is inert — every handler above no-ops.
    const unlock = () => {
      this.unlock(ctx);
      if (this.ctxAudio && this.ctxAudio.state === 'running') this.clearGestureHooks();
    };
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'keydown'] as const) {
      window.addEventListener(type, unlock, { passive: true });
      this.gestureCleanup.push(() => window.removeEventListener(type, unlock));
    }
  }

  private clearGestureHooks(): void {
    for (const fn of this.gestureCleanup) fn();
    this.gestureCleanup.length = 0;
  }

  private unlock(ctx: GameContext): void {
    if (this.disposed || this.failed) return;
    if (!this.ctxAudio) {
      const Ctor = audioContextCtor();
      if (!Ctor) {
        this.failed = true; // No WebAudio at all: run silent, never throw.
        return;
      }
      try {
        this.ctxAudio = new Ctor({ latencyHint: 'interactive' });
      } catch {
        this.failed = true;
        return;
      }
    }

    // Autoplay policy: resume can reject; that is fine, the next gesture retries.
    void this.ctxAudio.resume().catch(() => undefined);
    if (!this.env && this.ctxAudio.state !== 'closed') {
      try {
        this.build(ctx, this.ctxAudio);
      } catch (err) {
        console.warn('[audio] graph construction failed; running silent', err);
        this.failed = true;
        this.teardownModules();
      }
    }
  }

  private build(ctx: GameContext, ac: AudioContext): void {
    const tier = ctx.settings.graphics.tier;
    const env = new AudioEnv(ac, tier, childRng(0x5ea51de ^ Math.floor(ctx.time * 1000)));
    this.env = env;
    env.mixer.apply(ctx.settings.audio);
    this.settingsRevision = ctx.settings.revision;

    this.sampleWorld(0, ctx, env);
    env.uw.hardSwitch(env.state);

    this.ambience = new Ambience(env);
    this.foley = new Foley(env);
    this.sfx = new Sfx(env);
    this.creatures = new Creatures(env);
    this.music = new Music(env);

    const biome = env.state.biome || this.pendingBiome;
    this.biomeId = biome;
    this.ambience.start(biome);
    this.music.start(biome);
  }

  /* ---------------------------------------------------------------- *
   * Event wiring — the contract with the rest of the game
   * ---------------------------------------------------------------- */

  private wireEvents(ctx: GameContext): void {
    const bus = ctx.bus;
    const on = <K extends Parameters<typeof bus.on>[0]>(type: K, fn: Parameters<typeof bus.on<K>>[1]) => {
      this.unsubs.push(bus.on(type, fn));
    };

    on('audio:cue', (p) => this.cue(p.id, p.position, p.gain));

    on('water:transition', (p) => {
      const env = this.env;
      if (!env) return;
      env.state.underwater = p.underwater;
      if (!p.underwater) env.state.depth = 0;
      // Hard, un-ramped filter switch: crossing the surface is instantaneous.
      env.uw.hardSwitch(env.state);
      if (p.underwater) this.foley?.plunge();
      else this.foley?.surfaceGasp();
    });

    on('biome:entered', (p) => {
      this.pendingBiome = p.id;
      if (!this.env || p.id === this.biomeId) return;
      this.biomeId = p.id;
      this.ambience?.setBiome(p.id);
      this.music?.setBiome(p.id);
    });

    on('depth:band', () => {
      // A soft pressure cue on every band change; the HUD does the rest.
      this.cue('alarm.depth', undefined, 0.5);
    });

    on('creature:aggro', (p) => {
      const env = this.env;
      if (!env) return;
      const dist = Math.max(1, p.distance);
      this.creatures?.aggro(p.species, dist);
      const closeness = clamp(1 - dist / 70, 0.15, 1);
      env.state.threat = Math.max(env.state.threat, closeness);
      // Big things get the score out of the way.
      if (/leviathan|reaper|ghost/i.test(p.species) && dist < 90) this.music?.duck(0.55, 2.4);
    });

    on('player:damage', (p) => {
      this.foley?.impact(p.amount, p.source);
      const env = this.env;
      if (env) env.state.threat = Math.max(env.state.threat, clamp(p.amount / 30, 0.2, 0.9));
    });

    on('player:died', () => {
      this.foley?.death();
      this.music?.duck(0.75, 6);
      if (this.env) this.env.state.threat = 0;
    });

    on('vitals:critical', (p) => {
      const now = this.env?.now() ?? 0;
      if (now - this.lastAlarm < 1.7) return;
      this.lastAlarm = now;
      this.cue(p.kind === 'oxygen' ? 'alarm.oxygen' : 'alarm.damage', undefined, 0.9);
    });

    on('inventory:changed', (p) => {
      const now = this.env?.now() ?? 0;
      if (now - this.lastPickup < 0.08) return;
      this.lastPickup = now;
      this.cue(p.delta >= 0 ? 'item.pickup' : 'item.drop');
    });

    on('craft:completed', () => this.cue('craft.done'));
    on('scan:completed', () => this.cue('tool.scanner.complete'));
    on('databank:unlocked', () => this.cue('ui.unlock'));
    on('tech:unlocked', () => this.cue('ui.unlock'));
    on('quest:updated', () => this.cue('ui.notify'));
    on('save:written', () => this.cue('save.done', undefined, 0.6));
    on('build:placed', (p) => this.cue('build.place', p.position));
    on('ui:screen', (p) => this.cue(p.open ? 'ui.open' : 'ui.close'));
    on('ui:notify', (p) => this.cue(p.kind === 'danger' ? 'alarm.damage' : 'ui.notify', undefined, 0.8));
    on('ui:voice', () => this.cue('pda.voice'));
    on('settings:quality', (p) => this.setTier(p.tier as QualityTier));
  }

  /* ---------------------------------------------------------------- *
   * Public API for other systems (ctx.get<AudioSystem>('audio'))
   * ---------------------------------------------------------------- */

  /**
   * Fire a cue. Accepts `ui:click`, `ui.click`, `click`, … plus the special
   * families `env.*` (acoustic environment), `loop.*[.start|.stop]` (sustained
   * tools), `creature.<species>` and `music.tension`.
   */
  cue(rawId: string, position?: readonly number[] | Vec3Like, level = 1): boolean {
    const env = this.env;
    if (!env || !this.sfx) return false;
    const id = normaliseCue(rawId);

    if (id.startsWith('env.')) {
      const target = ENCLOSURE[id];
      this.enclosureTarget = target !== undefined ? target : clamp(level, 0, 1);
      return true;
    }
    if (id.startsWith('loop.')) {
      const stop = id.endsWith('.stop') || id.endsWith('.off') || id.endsWith('.end');
      const base = id.replace(/\.(start|stop|on|off|end|begin)$/, '');
      return this.sfx.toggleLoop(base, !stop);
    }
    if (id.startsWith('creature.')) {
      const species = id.slice('creature.'.length).replace(/\.(call|roar|aggro)$/, '');
      const pos = this.toVec(position);
      const dist = pos ? env.spatial.distanceTo(pos) : 40;
      this.creatures?.roar(species, dist, pos ?? undefined);
      return true;
    }
    if (id === 'music.tension') {
      this.music?.setTension(clamp(level, 0, 1));
      return true;
    }
    if (id === 'bubbles') {
      const pos = this.toVec(position) ?? env.state.position;
      this.ambience?.bubblesAt(pos, level);
      return true;
    }

    return this.sfx.play(id, this.toVec(position) ?? undefined, level);
  }

  /** 0 = open water, 1 = fully enclosed. Wrecks/bases/caves should set this. */
  setEnclosure(amount: number): void {
    this.enclosureTarget = clamp(amount, 0, 1);
  }

  /** Start/stop a sustained tool loop: `loop.drill`, `loop.welder`, `loop.scanner`. */
  toggleLoop(id: string, on: boolean): boolean {
    return this.sfx?.toggleLoop(id, on) ?? false;
  }

  setTier(tier: QualityTier): void {
    this.env?.setTier(tier);
    this.music?.setTier(tier);
  }

  private toVec(p?: readonly number[] | Vec3Like): THREE.Vector3 | null {
    if (!p) return null;
    if (p instanceof THREE.Vector3) return _cue.copy(p);
    const a = p as readonly number[];
    if (a.length < 3) return null;
    return _cue.set(a[0], a[1], a[2]);
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    const env = this.env;
    if (!env) return;
    if (this.ctxAudio && this.ctxAudio.state === 'suspended') {
      // Tab was backgrounded, or the policy re-suspended us. Ask nicely; if the
      // browser says no we simply stay silent this frame.
      void this.ctxAudio.resume().catch(() => undefined);
      return;
    }

    if (ctx.settings.revision !== this.settingsRevision) {
      this.settingsRevision = ctx.settings.revision;
      env.mixer.apply(ctx.settings.audio);
      if (ctx.settings.graphics.tier !== env.tier) this.setTier(ctx.settings.graphics.tier);
    }

    this.sampleWorld(dt, ctx, env);

    env.spatial.updateListener(ctx.camera);
    env.uw.update(dt, env.state);
    this.ambience?.update(dt);
    this.foley?.update(dt);
    this.sfx?.update(dt);
    this.music?.update(dt);
  }

  /** Pulls the authoritative world state into `env.state` once per frame. */
  private sampleWorld(dt: number, ctx: GameContext, env: AudioEnv): void {
    const s = env.state;
    const player = ctx.tryGet<GameSystem & PlayerLike>('player');
    const water = ctx.tryGet<GameSystem & WaterLike>('world.water');

    ctx.camera.getWorldPosition(_pos);
    s.position.copy(_pos);

    if (player) {
      s.velocity.copy(player.velocity);
      s.speed = player.velocity.length();
      s.swimming = player.swimming;
      s.sprinting = player.sprinting;
      s.grounded = player.grounded;
      s.inVehicle = player.inVehicle;
      const v = player.vitals;
      s.oxygen = v.maxOxygen > 0 ? clamp(v.oxygen / v.maxOxygen, 0, 1) : 1;
      s.health = clamp(v.health / 100, 0, 1);
    } else if (dt > 0) {
      // No player system (editor/capture harness): derive speed from the camera.
      if (this.hasPrev) {
        _vel.copy(_pos).sub(_prev).divideScalar(Math.max(1e-4, dt));
        s.velocity.copy(_vel);
        s.speed = _vel.length();
      }
      _prev.copy(_pos);
      this.hasPrev = true;
    }

    if (water) {
      s.underwater = water.underwater;
      s.depth = Math.max(0, water.cameraDepth);
    } else {
      s.underwater = _pos.y < 0;
      s.depth = Math.max(0, -_pos.y);
    }

    // Enclosure: whatever a cue last told us, or an automatic hint when the sea
    // floor is *above* the camera — i.e. we are inside a cave or overhang.
    let hint = 0;
    try {
      const floor = ctx.world.heightAt(_pos.x, _pos.z);
      if (floor > _pos.y + 1.5) hint = clamp((floor - _pos.y - 1.5) / 8, 0, 1);
    } catch {
      /* world query not ready */
    }
    const target = Math.max(this.enclosureTarget, hint);
    s.enclosure += (target - s.enclosure) * Math.min(1, dt * 3.5);

    // Biome sampling is cheap but not free; 5 Hz is plenty for a crossfade.
    if (dt > 0 && ctx.frame - this.biomeCheck > 12) {
      this.biomeCheck = ctx.frame;
      try {
        const b = ctx.world.biomeAt(_pos.x, _pos.z);
        if (b && b.id) {
          s.biome = b.id;
          if (b.id !== this.biomeId) {
            this.biomeId = b.id;
            this.ambience?.setBiome(b.id);
            this.music?.setBiome(b.id);
          }
        }
      } catch {
        /* world query not ready */
      }
    }
    if (!s.biome) s.biome = this.pendingBiome;

    // Threat decays over ~15 s unless something re-arms it.
    if (dt > 0) s.threat = Math.max(0, s.threat - dt * 0.065);
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  private teardownModules(): void {
    this.ambience?.dispose();
    this.foley = null;
    this.sfx?.dispose();
    this.creatures?.dispose();
    this.music?.dispose();
    this.env?.dispose();
    this.ambience = null;
    this.sfx = null;
    this.creatures = null;
    this.music = null;
    this.env = null;
  }

  dispose(): void {
    this.disposed = true;
    this.clearGestureHooks();
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.teardownModules();
    const ac = this.ctxAudio;
    this.ctxAudio = null;
    if (ac && ac.state !== 'closed') void ac.close().catch(() => undefined);
  }
}

/**
 * Main menu, pause menu, the full settings screen, credits and the death
 * screen. All of them sit over the live rendered scene — the engine keeps
 * drawing while paused, so the ocean is still moving behind every panel.
 *
 * Every control writes straight into `core/Settings` (or the UI prefs) and calls
 * `touch()`, which both applies and persists. Nothing is buffered behind an
 * "Apply" button.
 */
import type { GameContext, QualityTier } from '../core/Types';
import type { Settings } from '../core/Settings';
import {
  Anim,
  add,
  applyPrefs,
  brackets,
  button,
  clamp,
  clear,
  div,
  el,
  fmtDuration,
  savePrefs,
  setClass,
  setProp,
  setText,
} from './UiKit';
import type { ColorVision, UiPrefs } from './UiKit';

export type MenuScreen = 'none' | 'main' | 'pause' | 'settings' | 'credits' | 'dead';

type SettingsTab = 'graphics' | 'audio' | 'gameplay' | 'access' | 'controls';

export interface MenuCallbacks {
  onResume(): void;
  onNewGame(): void;
  onSave(): void;
  onLoad(): void;
  onQuitToMenu(): void;
  onRespawn(): void;
  onPrefsChanged(p: UiPrefs): void;
}

export class MenuLayer {
  readonly root: HTMLDivElement;
  screen: MenuScreen = 'none';

  private anim: Anim;
  private prefs: UiPrefs;
  private cb: MenuCallbacks;
  private panel: HTMLElement;
  private ambience: HTMLElement;
  private ctx: GameContext | null = null;
  private settingsTab: SettingsTab = 'graphics';
  private returnTo: MenuScreen = 'main';
  private deathCause = '';
  private stats = { elapsed: 0, maxDepth: 0, deaths: 0 };

  constructor(host: HTMLElement, anim: Anim, prefs: UiPrefs, cb: MenuCallbacks) {
    this.anim = anim;
    this.prefs = prefs;
    this.cb = cb;

    const root = div('menu');
    this.root = root;
    add(root, div('menu-scrim'));
    this.ambience = add(root, div('menu-ambience'));
    // Drifting particulate: a dozen CSS-animated motes so the menu is never dead.
    for (let i = 0; i < 14; i++) {
      const m = add(this.ambience, div('menu-mote'));
      m.style.left = `${(i * 7.3 + 3) % 100}%`;
      m.style.setProperty('--d', `${9 + (i % 5) * 3.4}s`);
      m.style.setProperty('--delay', `${-i * 1.7}s`);
      m.style.setProperty('--sz', `${1 + (i % 4) * 0.8}px`);
    }
    add(root, div('menu-sweep'));
    this.panel = add(root, div('menu-body'));
    host.appendChild(root);
  }

  setPrefs(p: UiPrefs): void {
    this.prefs = p;
  }

  setStats(elapsed: number, maxDepth: number, deaths: number): void {
    this.stats = { elapsed, maxDepth, deaths };
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  show(screen: MenuScreen, ctx: GameContext, cause?: string): void {
    this.ctx = ctx;
    if (cause !== undefined) this.deathCause = cause;
    if (screen === 'settings' && this.screen !== 'settings') this.returnTo = this.screen === 'none' ? 'main' : this.screen;
    this.screen = screen;
    setClass(this.root, 'on', screen !== 'none');
    setClass(this.root, 'menu-main', screen === 'main');
    setClass(this.root, 'menu-dead', screen === 'dead');
    if (screen === 'none') {
      clear(this.panel);
      return;
    }
    this.build();
    if (!this.prefs.reducedMotion) {
      this.anim.tween(
        0.34,
        (k) => {
          setProp(this.root, '--menu-in', k.toFixed(3));
        },
        (t) => 1 - Math.pow(1 - t, 3),
      );
    } else {
      setProp(this.root, '--menu-in', '1');
    }
  }

  hide(): void {
    this.screen = 'none';
    setClass(this.root, 'on', false);
    clear(this.panel);
  }

  get open(): boolean {
    return this.screen !== 'none';
  }

  /** True when the world simulation should be frozen. */
  get pausing(): boolean {
    return this.screen === 'main' || this.screen === 'pause' || this.screen === 'settings' || this.screen === 'dead';
  }

  /* ------------------------------------------------------------------ *
   * Screens
   * ------------------------------------------------------------------ */

  private build(): void {
    clear(this.panel);
    switch (this.screen) {
      case 'main':
        this.buildMain();
        break;
      case 'pause':
        this.buildPause();
        break;
      case 'settings':
        this.buildSettings();
        break;
      case 'credits':
        this.buildCredits();
        break;
      case 'dead':
        this.buildDeath();
        break;
      default:
        break;
    }
  }

  private hasSave(): boolean {
    try {
      return localStorage.getItem('spacenautica.save.auto') !== null;
    } catch {
      return false;
    }
  }

  private buildMain(): void {
    const wrap = add(this.panel, div('mm'));
    const brand = add(wrap, div('mm-brand'));
    add(brand, el('h1', 'mm-title', 'SPACENAUTICA'));
    add(brand, div('mm-rule'));
    add(brand, el('span', 'mm-tagline', 'Planet 4546B · Descent survey · Lifepod 5'));

    const nav = add(wrap, div('mm-nav'));
    const mk = (label: string, fn: () => void, cls = '') => {
      const b = add(nav, button(label, cls));
      b.addEventListener('click', fn);
      return b;
    };
    if (this.hasSave()) mk('Continue', () => this.cb.onLoad(), 'ui-btn-primary');
    mk('New Descent', () => this.cb.onNewGame(), this.hasSave() ? '' : 'ui-btn-primary');
    mk('Settings', () => this.ctx && this.show('settings', this.ctx));
    mk('Credits', () => this.ctx && this.show('credits', this.ctx));

    const side = add(wrap, div('mm-side'));
    add(side, el('span', 'mm-side-label', 'DEPTH RATING'));
    const ruler = add(side, div('mm-ruler'));
    for (const [d, label] of [
      [0, 'SURFACE'],
      [100, '100 m'],
      [200, '200 m'],
      [450, '450 m'],
      [900, 'CRUSH'],
    ] as Array<[number, string]>) {
      const row = add(ruler, div('mm-ruler-row'));
      setProp(row, 'top', `${(Math.sqrt(d / 900) * 100).toFixed(1)}%`);
      add(row, div('mm-ruler-tick'));
      add(row, el('span', undefined, label));
    }

    const foot = add(wrap, div('mm-foot'));
    add(foot, el('span', undefined, 'Fully procedural · zero external assets'));
    add(foot, el('span', 'mm-build', 'build 1.0.0'));
  }

  private buildPause(): void {
    const wrap = add(this.panel, div('pm'));
    brackets(wrap);
    add(wrap, div('pm-scan'));
    add(wrap, el('h1', 'pm-title', 'Suspended'));
    add(wrap, el('span', 'pm-sub', 'Life support nominal · simulation frozen'));

    const grid = add(wrap, div('pm-stats'));
    const stat = (label: string, value: string) => {
      const c = add(grid, div('pm-stat'));
      add(c, el('span', 'pm-stat-label', label));
      add(c, el('b', 'pm-stat-value', value));
    };
    stat('Time survived', fmtDuration(this.stats.elapsed));
    stat('Max depth', `${Math.round(this.stats.maxDepth)} m`);
    const fps = this.ctx ? 1000 / Math.max(1, (this.ctx as unknown as { frameMs?: number }).frameMs ?? 16.7) : 60;
    stat('Frame rate', `${fps.toFixed(0)} fps`);
    stat('Quality', (this.ctx?.settings.graphics.tier ?? 'high').toUpperCase());

    const nav = add(wrap, div('pm-nav'));
    const mk = (label: string, fn: () => void, cls = '') => {
      const b = add(nav, button(label, cls));
      b.addEventListener('click', fn);
    };
    mk('Resume', () => this.cb.onResume(), 'ui-btn-primary');
    mk('Settings', () => this.ctx && this.show('settings', this.ctx));
    mk('Save', () => this.cb.onSave());
    mk('Load', () => this.cb.onLoad());
    mk('Abandon dive', () => this.cb.onQuitToMenu(), 'ui-btn-danger');
  }

  private buildDeath(): void {
    const wrap = add(this.panel, div('dm'));
    add(wrap, el('h1', 'dm-title', 'You Died'));
    add(wrap, el('span', 'dm-cause', this.deathCause || 'Cause unknown'));
    const grid = add(wrap, div('pm-stats'));
    const stat = (label: string, value: string) => {
      const c = add(grid, div('pm-stat'));
      add(c, el('span', 'pm-stat-label', label));
      add(c, el('b', 'pm-stat-value', value));
    };
    stat('Time survived', fmtDuration(this.stats.elapsed));
    stat('Max depth', `${Math.round(this.stats.maxDepth)} m`);
    const nav = add(wrap, div('pm-nav'));
    const respawn = add(nav, button('Respawn at Lifepod 5', 'ui-btn-primary'));
    respawn.addEventListener('click', () => this.cb.onRespawn());
    const load = add(nav, button('Load last save'));
    load.addEventListener('click', () => this.cb.onLoad());
    const quit = add(nav, button('Main menu', 'ui-btn-ghost'));
    quit.addEventListener('click', () => this.cb.onQuitToMenu());
  }

  private buildCredits(): void {
    const wrap = add(this.panel, div('cr'));
    brackets(wrap);
    add(wrap, el('h1', 'pm-title', 'Credits'));
    const body = add(wrap, div('cr-body'));
    const section = (title: string, lines: string[]) => {
      add(body, el('h3', 'cr-h', title));
      for (const l of lines) add(body, el('p', 'cr-p', l));
    };
    section('Spacenautica', [
      'A first-person underwater survival RPG built in Three.js.',
      'Every texture, mesh, animation, icon and sound in this build is generated in code at runtime. There are no image, model, font or audio files.',
    ]);
    section('Systems', [
      'Procedural PBR texture library · chunked LOD terrain with biome blending',
      'Wavelength-dependent underwater scattering · caustics · god rays',
      'Instanced flora on a current field · boid fauna with predator states',
      'Swim controller with buoyancy and added-mass inertia',
      'Diegetic HUD, PDA and habitat builder interface',
    ]);
    section('Reference', ['Visual target: Subnautica (2018) and Subnautica: Below Zero at maximum settings.']);
    const back = add(wrap, button('Back', 'ui-btn-ghost'));
    back.addEventListener('click', () => this.ctx && this.show(this.returnTo === 'none' ? 'main' : 'main', this.ctx));
  }

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */

  private buildSettings(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const wrap = add(this.panel, div('st'));
    brackets(wrap);

    const head = add(wrap, div('st-head'));
    add(head, el('h1', 'pm-title', 'Settings'));
    const tabs = add(head, div('st-tabs'));
    const tabDefs: Array<[SettingsTab, string]> = [
      ['graphics', 'Graphics'],
      ['audio', 'Audio'],
      ['gameplay', 'Gameplay'],
      ['access', 'Accessibility'],
      ['controls', 'Controls'],
    ];
    for (const [id, label] of tabDefs) {
      const b = add(tabs, el('button', 'st-tab'));
      b.type = 'button';
      setText(b, label);
      setClass(b, 'on', this.settingsTab === id);
      b.addEventListener('click', () => {
        this.settingsTab = id;
        this.build();
      });
    }

    const body = add(wrap, div('st-body'));
    switch (this.settingsTab) {
      case 'graphics':
        this.buildGraphics(body, ctx.settings);
        break;
      case 'audio':
        this.buildAudio(body, ctx.settings);
        break;
      case 'gameplay':
        this.buildGameplay(body, ctx.settings);
        break;
      case 'access':
        this.buildAccess(body);
        break;
      case 'controls':
        this.buildControls(body, ctx);
        break;
    }

    const foot = add(wrap, div('st-foot'));
    const back = add(foot, button('Back', 'ui-btn-primary'));
    back.addEventListener('click', () => {
      if (!this.ctx) return;
      this.show(this.returnTo === 'settings' ? 'main' : this.returnTo, this.ctx);
    });
    const reset = add(foot, button('Restore defaults', 'ui-btn-ghost'));
    reset.addEventListener('click', () => {
      ctx.settings.applyPreset('high');
      ctx.settings.graphics.fov = 70;
      ctx.settings.gameplay.mouseSensitivity = 1;
      ctx.settings.gameplay.headBob = 1;
      ctx.settings.touch();
      this.build();
    });
  }

  /* ---- control primitives ---- */

  private group(host: HTMLElement, title: string, note?: string): HTMLElement {
    const g = add(host, div('st-group'));
    const h = add(g, div('st-group-head'));
    add(h, el('h3', undefined, title));
    if (note) add(h, el('span', 'st-note', note));
    return add(g, div('st-rows'));
  }

  private row(host: HTMLElement, label: string, hint?: string): HTMLElement {
    const r = add(host, div('st-row'));
    const l = add(r, div('st-row-label'));
    add(l, el('span', undefined, label));
    if (hint) add(l, el('small', undefined, hint));
    return add(r, div('st-row-control'));
  }

  private slider(
    host: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    fmt: (v: number) => string = (v) => v.toFixed(2),
    hint?: string,
  ): void {
    const control = this.row(host, label, hint);
    const input = add(control, el('input', 'ui-range'));
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const out = add(control, el('b', 'ui-range-value', fmt(get())));
    const paint = () => {
      const v = Number(input.value);
      setProp(input, '--fill', `${(((v - min) / (max - min)) * 100).toFixed(1)}%`);
      setText(out, fmt(v));
    };
    paint();
    input.addEventListener('input', () => {
      set(Number(input.value));
      paint();
    });
  }

  private toggle(host: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void, hint?: string): void {
    const control = this.row(host, label, hint);
    const b = add(control, el('button', 'ui-toggle'));
    b.type = 'button';
    add(b, div('ui-toggle-knob'));
    const on = add(b, el('span', 'ui-toggle-text', get() ? 'ON' : 'OFF'));
    setClass(b, 'on', get());
    b.addEventListener('click', () => {
      const v = !get();
      set(v);
      setClass(b, 'on', v);
      setText(on, v ? 'ON' : 'OFF');
    });
  }

  private segmented<T extends string>(
    host: HTMLElement,
    label: string,
    options: Array<[T, string]>,
    get: () => T,
    set: (v: T) => void,
    hint?: string,
  ): void {
    const control = this.row(host, label, hint);
    const seg = add(control, div('ui-seg'));
    const buttons: Array<[T, HTMLElement]> = [];
    for (const [value, text] of options) {
      const b = add(seg, el('button', 'ui-seg-btn'));
      b.type = 'button';
      setText(b, text);
      setClass(b, 'on', get() === value);
      buttons.push([value, b]);
      b.addEventListener('click', () => {
        set(value);
        for (const [v, node] of buttons) setClass(node, 'on', v === value);
      });
    }
  }

  /* ---- tabs ---- */

  private buildGraphics(host: HTMLElement, s: Settings): void {
    const g = s.graphics;
    const commit = () => s.touch();

    const preset = this.group(host, 'Quality', 'Presets rewrite every value below');
    this.segmented<QualityTier>(
      preset,
      'Preset',
      [
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
        ['ultra', 'Ultra'],
      ],
      () => g.tier,
      (v) => {
        s.applyPreset(v);
        this.ctx?.bus.emit('settings:quality', { tier: v });
        this.build();
      },
    );

    const res = this.group(host, 'Resolution');
    this.slider(res, 'Render scale', 0.5, 1.4, 0.02, () => g.renderScale, (v) => {
      g.renderScale = v;
      commit();
    }, (v) => `${Math.round(v * 100)}%`, 'Internal resolution multiplier');
    this.slider(res, 'Max pixel ratio', 0.75, 2, 0.25, () => g.maxPixelRatio, (v) => {
      g.maxPixelRatio = v;
      commit();
    }, (v) => `×${v.toFixed(2)}`);
    this.slider(res, 'Adaptive target', 0, 33, 1, () => g.targetFrameMs, (v) => {
      g.targetFrameMs = v;
      commit();
    }, (v) => (v <= 0 ? 'Off' : `${v.toFixed(0)} ms`), 'Auto-adjusts resolution to hold this frame time');
    this.slider(res, 'Field of view', 55, 105, 1, () => g.fov, (v) => {
      g.fov = v;
      commit();
    }, (v) => `${v.toFixed(0)}°`);

    const world = this.group(host, 'World detail');
    this.slider(world, 'View distance', 200, 1400, 20, () => g.viewDistance, (v) => {
      g.viewDistance = v;
      commit();
    }, (v) => `${v.toFixed(0)} m`);
    this.slider(world, 'Foliage density', 0.2, 1.6, 0.05, () => g.foliageDensity, (v) => {
      g.foliageDensity = v;
      commit();
    }, (v) => `×${v.toFixed(2)}`);
    this.slider(world, 'Fauna budget', 40, 500, 10, () => g.faunaBudget, (v) => {
      g.faunaBudget = v;
      commit();
    }, (v) => `${v.toFixed(0)} agents`);
    this.slider(world, 'Marine snow', 0, 1.6, 0.05, () => g.particulate, (v) => {
      g.particulate = v;
      commit();
    }, (v) => (v <= 0 ? 'Off' : `×${v.toFixed(2)}`));
    this.slider(world, 'Anisotropic filtering', 1, 16, 1, () => g.anisotropy, (v) => {
      g.anisotropy = v;
      commit();
    }, (v) => `×${v.toFixed(0)}`);

    const shadow = this.group(host, 'Shadows');
    this.segmented<string>(
      shadow,
      'Shadow resolution',
      [
        ['1024', '1k'],
        ['1536', '1.5k'],
        ['2048', '2k'],
        ['3072', '3k'],
        ['4096', '4k'],
      ],
      () => String(g.shadowMapSize),
      (v) => {
        g.shadowMapSize = Number(v);
        commit();
      },
    );
    this.slider(shadow, 'Cascades', 1, 4, 1, () => g.shadowCascades, (v) => {
      g.shadowCascades = v;
      commit();
    }, (v) => v.toFixed(0));

    const post = this.group(host, 'Post-processing');
    const flag = (label: string, key: 'taa' | 'gtao' | 'ssr' | 'godRays' | 'bloom' | 'dof' | 'motionBlur', hint?: string) =>
      this.toggle(post, label, () => g[key], (v) => {
        g[key] = v;
        commit();
      }, hint);
    flag('Temporal AA', 'taa', 'Removes crawling specular on the surface');
    flag('Ambient occlusion', 'gtao');
    flag('Screen-space reflections', 'ssr', 'Water surface and wet materials');
    flag('God rays', 'godRays', 'Volumetric shafts through the water column');
    flag('Bloom', 'bloom');
    flag('Depth of field', 'dof');
    flag('Motion blur', 'motionBlur');
    this.slider(post, 'Chromatic aberration', 0, 1.5, 0.05, () => g.chromaticAberration, (v) => {
      g.chromaticAberration = v;
      commit();
    }, (v) => (v <= 0 ? 'Off' : v.toFixed(2)));
    this.slider(post, 'Film grain', 0, 1.5, 0.05, () => g.filmGrain, (v) => {
      g.filmGrain = v;
      commit();
    }, (v) => (v <= 0 ? 'Off' : v.toFixed(2)));
  }

  private buildAudio(host: HTMLElement, s: Settings): void {
    const a = s.audio;
    const commit = () => s.touch();
    const mix = this.group(host, 'Mixer', 'Applied immediately');
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    this.slider(mix, 'Master', 0, 1, 0.01, () => a.master, (v) => {
      a.master = v;
      commit();
    }, pct);
    this.slider(mix, 'Music', 0, 1, 0.01, () => a.music, (v) => {
      a.music = v;
      commit();
    }, pct);
    this.slider(mix, 'Effects', 0, 1, 0.01, () => a.sfx, (v) => {
      a.sfx = v;
      commit();
    }, pct);
    this.slider(mix, 'Ambience', 0, 1, 0.01, () => a.ambience, (v) => {
      a.ambience = v;
      commit();
    }, pct);
    this.slider(mix, 'Voice', 0, 1, 0.01, () => a.voice, (v) => {
      a.voice = v;
      commit();
    }, pct);

    const test = this.group(host, 'Test');
    const control = this.row(test, 'Play a cue', 'Confirms the mixer is wired');
    const b = add(control, button('Sonar ping', 'ui-btn-ghost'));
    b.addEventListener('click', () => this.ctx?.bus.emit('audio:cue', { id: 'ui.ping', gain: 1 }));
  }

  private buildGameplay(host: HTMLElement, s: Settings): void {
    const p = s.gameplay;
    const commit = () => s.touch();

    const look = this.group(host, 'Look');
    this.slider(look, 'Mouse sensitivity', 0.2, 3, 0.05, () => p.mouseSensitivity, (v) => {
      p.mouseSensitivity = v;
      commit();
    }, (v) => `×${v.toFixed(2)}`);
    this.toggle(look, 'Invert Y axis', () => p.invertY, (v) => {
      p.invertY = v;
      commit();
    });

    const cam = this.group(host, 'Camera');
    this.slider(cam, 'Head bob', 0, 1.5, 0.05, () => p.headBob, (v) => {
      p.headBob = v;
      commit();
    }, (v) => (v <= 0 ? 'Off' : `×${v.toFixed(2)}`), 'Set to Off if motion is uncomfortable');
    this.slider(cam, 'Camera shake', 0, 1.5, 0.05, () => p.cameraShake, (v) => {
      p.cameraShake = v;
      commit();
    }, (v) => (v <= 0 ? 'Off' : `×${v.toFixed(2)}`));

    const rules = this.group(host, 'Rules', 'Changing mode mid-dive takes effect immediately');
    this.segmented<'survival' | 'freedom' | 'creative' | 'hardcore'>(
      rules,
      'Mode',
      [
        ['survival', 'Survival'],
        ['freedom', 'Freedom'],
        ['creative', 'Creative'],
        ['hardcore', 'Hardcore'],
      ],
      () => p.mode,
      (v) => {
        p.mode = v;
        commit();
      },
      'Freedom drops hunger and thirst · Creative drops all drains',
    );
    this.toggle(rules, 'Subtitles', () => p.subtitles, (v) => {
      p.subtitles = v;
      commit();
    });
  }

  private buildAccess(host: HTMLElement): void {
    const p = this.prefs;
    const commit = () => {
      applyPrefs(p);
      savePrefs(p);
      this.cb.onPrefsChanged(p);
    };

    const size = this.group(host, 'Readability');
    this.slider(size, 'Interface scale', 0.75, 1.6, 0.05, () => p.scale, (v) => {
      p.scale = v;
      commit();
    }, (v) => `${Math.round(v * 100)}%`);
    this.slider(size, 'HUD opacity', 0.35, 1, 0.05, () => p.opacity, (v) => {
      p.opacity = v;
      commit();
    }, (v) => `${Math.round(v * 100)}%`);
    this.slider(size, 'Subtitle size', 0.8, 1.8, 0.05, () => p.subtitleScale, (v) => {
      p.subtitleScale = v;
      commit();
    }, (v) => `${Math.round(v * 100)}%`);
    this.toggle(size, 'High contrast panels', () => p.highContrast, (v) => {
      p.highContrast = v;
      commit();
    }, 'Opaque backings and stronger hairlines');

    const motion = this.group(host, 'Motion');
    this.toggle(motion, 'Reduced motion', () => p.reducedMotion, (v) => {
      p.reducedMotion = v;
      commit();
    }, 'Disables pulses, sweeps, type-on and slide transitions');

    const colour = this.group(host, 'Colour vision', 'Warnings also change shape and hatch direction');
    this.segmented<ColorVision>(
      colour,
      'Palette',
      [
        ['off', 'Standard'],
        ['deuteranopia', 'Deuter.'],
        ['protanopia', 'Protan.'],
        ['tritanopia', 'Tritan.'],
      ],
      () => p.colorVision,
      (v) => {
        p.colorVision = v;
        commit();
      },
    );

    const hud = this.group(host, 'HUD elements');
    this.toggle(hud, 'Compass ribbon', () => p.compass, (v) => {
      p.compass = v;
      commit();
    });
    this.toggle(hud, 'Performance readout', () => p.perfOverlay, (v) => {
      p.perfOverlay = v;
      commit();
    });
  }

  private buildControls(host: HTMLElement, ctx: GameContext): void {
    const bindings = (ctx.input as unknown as { getBindings?(): Record<string, string[]> }).getBindings?.() ?? {};
    const rows = this.group(host, 'Bindings', 'Rebinding is not exposed yet — see integration notes');
    const pretty = (code: string): string =>
      code
        .replace(/^Key/, '')
        .replace(/^Digit/, '')
        .replace(/^Mouse0$/, 'LMB')
        .replace(/^Mouse1$/, 'MMB')
        .replace(/^Mouse2$/, 'RMB')
        .replace(/^Arrow/, '')
        .replace(/^ControlLeft$/, 'Ctrl')
        .replace(/^ShiftLeft$/, 'Shift');
    const label = (action: string): string =>
      action.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    for (const action of Object.keys(bindings)) {
      const control = this.row(rows, label(action));
      for (const code of bindings[action]) add(control, el('span', 'ui-key', pretty(code)));
    }
    if (Object.keys(bindings).length === 0) {
      add(rows, el('p', 'st-note', 'Input bindings are unavailable in this build.'));
    }
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */

  update(dt: number): void {
    if (this.screen === 'none') return;
    void dt;
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Clamp helper re-exported so the settings sliders can be reused elsewhere. */
export { clamp as clampSetting };

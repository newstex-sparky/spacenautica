/**
 * The always-on HUD: oxygen gauge, vitals, depth instrument, compass ribbon,
 * biome banner, reticle + interaction prompts, damage vignette, toasts and
 * subtitles.
 *
 * Every value is damped rather than assigned, every DOM write is dirty-checked,
 * and every warning state is signalled by shape *and* colour so it survives
 * colour-vision deficiency and the reduced-motion path.
 */
import {
  Anim,
  COMPASS_PX_PER_DEG,
  Disposables,
  add,
  brackets,
  cardinal,
  clamp,
  clamp01,
  damp,
  div,
  el,
  fmtClock,
  fmtInt,
  keycap,
  makeRing,
  pad,
  setClass,
  setProp,
  setText,
  smoothstep,
  wrapDeg,
} from './UiKit';
import type { Ring, UiPrefs } from './UiKit';
import { depthBand } from './ItemDatabase';

export interface HudState {
  depth: number;
  oxygen: number;
  maxOxygen: number;
  health: number;
  food: number;
  water: number;
  /** Heading in degrees, 0 = north, increasing clockwise. */
  heading: number;
  biomeName: string;
  underwater: boolean;
  /** 0..24 in-game hours. */
  timeOfDay: number;
  frameMs: number;
  /** Smoothed render scale from the engine, for the perf readout. */
  renderScale: number;
  /** World-space bearing to the lifepod in degrees, or null. */
  podBearing: number | null;
  podDistance: number;
  /** Survival clock in seconds. */
  elapsed: number;
  /** Gameplay mode string for the mode chip. */
  mode: string;
}

export interface PromptSpec {
  key: string;
  label: string
}

interface Toast {
  root: HTMLElement;
  life: number;
  ttl: number;
}

const O2_WARN = 0.34;
const O2_DANGER = 0.14;

export class HudLayer {
  readonly root: HTMLDivElement;

  private anim: Anim;
  private prefs: UiPrefs;
  private dis = new Disposables();

  /* instruments */
  private o2Ring: Ring;
  private o2Value: HTMLElement;
  private o2Sub: HTMLElement;
  private o2Alert: HTMLElement;
  private o2Pips: HTMLElement;
  private o2PipCount = -1;

  private bars: Record<'health' | 'food' | 'water', { fill: HTMLElement; value: HTMLElement; row: HTMLElement }>;

  private depthValue: HTMLElement;
  private depthBandEl: HTMLElement;
  private depthNote: HTMLElement;
  private gaugeFill: HTMLElement;
  private gaugeNeedle: HTMLElement;
  private gaugeCrush: HTMLElement;

  private compassMarks: HTMLElement;
  private headingValue: HTMLElement;
  private headingCard: HTMLElement;
  private podPip: HTMLElement;
  private podPipLabel: HTMLElement;
  private northPip: HTMLElement;
  private biomeTimer = 0;

  private biomeEl: HTMLElement;
  private biomeName: HTMLElement;

  private reticle: HTMLElement;
  private scanRing: Ring;
  private promptEl: HTMLElement;
  private promptSig = '';

  private vignette: HTMLElement;
  private vignetteDir: HTMLElement;
  private breath: HTMLElement;

  private toastHost: HTMLElement;
  private toasts: Toast[] = [];

  private subHost: HTMLElement;
  private subText: HTMLElement;
  private subSpeaker: HTMLElement;
  private subQueue: Array<{ text: string; speaker?: string; ttl: number }> = [];
  private subLife = 0;

  private perfEl: HTMLElement;
  private clockEl: HTMLElement;
  private modeEl: HTMLElement;

  /* damped display values */
  private dOxy = 1;
  private dHealth = 1;
  private dFood = 1;
  private dWater = 1;
  private dDepth = 0;
  private dHeading = 0;
  private dVignette = 0;
  private dScan = 0;
  private scanTarget = 0;
  private vignetteHold = 0;
  private o2Blink = 0;

  constructor(host: HTMLElement, anim: Anim, prefs: UiPrefs) {
    this.anim = anim;
    this.prefs = prefs;

    const root = div('hud');
    this.root = root;

    /* ---------------- full-screen effect layers ---------------- */
    this.vignette = add(root, div('hud-vignette'));
    this.vignetteDir = add(this.vignette, div('hud-vignette-dir'));
    this.breath = add(root, div('hud-breath'));

    /* ---------------- compass ---------------- */
    const top = add(root, div('hud-top'));
    const compass = add(top, div('hud-compass'));
    brackets(compass);
    this.compassMarks = add(compass, div('hud-compass-marks'));
    add(compass, div('hud-compass-fade'));
    this.northPip = add(compass, div('hud-pip hud-pip-north'));
    add(this.northPip, div('hud-pip-tick'));
    add(this.northPip, el('span', 'hud-pip-label', 'N'));
    this.podPip = add(compass, div('hud-pip hud-pip-pod'));
    add(this.podPip, div('hud-pip-tick'));
    this.podPipLabel = add(this.podPip, el('span', 'hud-pip-label', 'POD'));
    add(compass, div('hud-compass-needle'));
    const readout = add(top, div('hud-compass-readout'));
    this.headingValue = add(readout, el('b', undefined, '000'));
    add(readout, el('span', 'hud-deg', '°'));
    this.headingCard = add(readout, el('span', 'hud-card', 'N'));

    /* ---------------- biome banner ---------------- */
    this.biomeEl = add(root, div('hud-biome'));
    add(this.biomeEl, div('hud-biome-rule'));
    this.biomeName = add(this.biomeEl, el('span', 'hud-biome-name', ''));
    add(this.biomeEl, div('hud-biome-rule'));

    /* ---------------- centre: reticle + prompts ---------------- */
    const centre = add(root, div('hud-centre'));
    this.reticle = add(centre, div('hud-reticle'));
    for (const c of ['t', 'r', 'b', 'l']) add(this.reticle, div(`hud-ret-bracket hud-ret-${c}`));
    add(this.reticle, div('hud-ret-dot'));
    this.scanRing = makeRing({ size: 64, radius: 26, width: 2.5, sweep: 1, rotate: -90, cls: 'hud-scan-ring' });
    add(this.reticle, this.scanRing.root);
    this.promptEl = add(centre, div('hud-prompt'));

    /* ---------------- vitals ---------------- */
    const left = add(root, div('hud-left'));

    const o2 = add(left, div('hud-o2'));
    this.o2Ring = makeRing({ size: 132, radius: 54, width: 8, sweep: 0.75, rotate: 135, ticks: 30, cls: 'hud-o2-ring' });
    add(o2, this.o2Ring.root);
    const o2Inner = add(o2, div('hud-o2-inner'));
    this.o2Value = add(o2Inner, el('b', 'hud-o2-value', '45'));
    this.o2Sub = add(o2Inner, el('span', 'hud-o2-sub', 'O₂ SEC'));
    this.o2Alert = add(o2, div('hud-o2-alert'));
    this.o2Alert.appendChild(this.warnGlyph());
    this.o2Pips = add(o2, div('hud-o2-pips'));

    const barHost = add(left, div('hud-bars'));
    this.bars = {
      health: this.makeBar(barHost, 'health', 'HEALTH', 'hp'),
      food: this.makeBar(barHost, 'food', 'FOOD', 'kcal'),
      water: this.makeBar(barHost, 'water', 'H₂O', 'ml'),
    };

    /* ---------------- depth instrument ---------------- */
    const right = add(root, div('hud-right'));
    const gauge = add(right, div('hud-gauge'));
    const track = add(gauge, div('hud-gauge-track'));
    this.gaugeFill = add(track, div('hud-gauge-fill'));
    this.gaugeCrush = add(track, div('hud-gauge-crush'));
    this.gaugeNeedle = add(track, div('hud-gauge-needle'));
    for (let i = 0; i <= 8; i++) {
      const t = add(gauge, div('hud-gauge-tick'));
      t.style.top = `${(i / 8) * 100}%`;
      if (i % 2 === 0) t.classList.add('major');
    }
    const depthBox = add(right, div('hud-depth'));
    const dl = add(depthBox, div('hud-depth-line'));
    this.depthValue = add(dl, el('b', 'hud-depth-value', '0'));
    add(dl, el('span', 'hud-depth-unit', 'm'));
    this.depthBandEl = add(depthBox, el('span', 'hud-depth-band', 'Surface'));
    this.depthNote = add(depthBox, el('span', 'hud-depth-note', ''));

    /* ---------------- status strip ---------------- */
    const status = add(root, div('hud-status'));
    this.clockEl = add(status, el('span', 'hud-clock', '12:00'));
    this.modeEl = add(status, el('span', 'hud-chip', 'SURVIVAL'));
    this.perfEl = add(status, el('span', 'hud-perf', ''));

    /* ---------------- toasts + subtitles ---------------- */
    this.toastHost = add(root, div('hud-toasts'));
    this.subHost = add(root, div('hud-subs'));
    const subPanel = add(this.subHost, div('hud-sub-panel'));
    this.subSpeaker = add(subPanel, el('span', 'hud-sub-speaker', 'PDA'));
    this.subText = add(subPanel, el('span', 'hud-sub-text', ''));

    host.appendChild(root);
  }

  /* ------------------------------------------------------------------ *
   * Construction helpers
   * ------------------------------------------------------------------ */

  private warnGlyph(): SVGSVGElement {
    // A triangle + exclamation: the warning is readable without any colour.
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'hud-warn-glyph');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M12 2.5 22.5 21H1.5Z');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-width', '2');
    s.appendChild(p);
    const b = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    b.setAttribute('d', 'M12 8.5v6.2M12 17.4v.2');
    b.setAttribute('stroke-width', '2.4');
    b.setAttribute('stroke-linecap', 'round');
    s.appendChild(b);
    return s;
  }

  private makeBar(
    host: HTMLElement,
    kind: string,
    label: string,
    unit: string,
  ): { fill: HTMLElement; value: HTMLElement; row: HTMLElement } {
    const row = add(host, div(`hud-bar hud-bar-${kind}`));
    const head = add(row, div('hud-bar-head'));
    add(head, el('span', 'hud-bar-label', label));
    const value = add(head, el('b', 'hud-bar-value', '100'));
    add(head, el('span', 'hud-bar-unit', unit));
    const track = add(row, div('hud-bar-track'));
    const fill = add(track, div('hud-bar-fill'));
    add(track, div('hud-bar-hatch'));
    // Segment ticks: reading a bar to the nearest 10% without a number.
    for (let i = 1; i < 10; i++) {
      const t = add(track, div('hud-bar-tick'));
      t.style.left = `${i * 10}%`;
    }
    return { fill, value, row };
  }

  /* ------------------------------------------------------------------ *
   * Public commands
   * ------------------------------------------------------------------ */

  notify(text: string, kind: 'info' | 'warn' | 'danger' | 'success' = 'info', ttl = 4.2): void {
    const root = div(`hud-toast hud-toast-${kind}`);
    add(root, div('hud-toast-accent'));
    const body = add(root, div('hud-toast-body'));
    add(body, el('span', 'hud-toast-kind', kind === 'info' ? 'LOG' : kind.toUpperCase()));
    add(body, el('span', 'hud-toast-text', text));
    brackets(root);
    this.toastHost.appendChild(root);
    const t: Toast = { root, life: 0, ttl };
    this.toasts.push(t);
    while (this.toasts.length > 5) {
      const old = this.toasts.shift();
      old?.root.remove();
    }
    if (this.prefs.reducedMotion) {
      root.style.opacity = '1';
      root.style.transform = 'none';
    } else {
      this.anim.tween(0.42, (k) => {
        root.style.opacity = String(k);
        root.style.transform = `translateX(${(1 - k) * 34}px)`;
      });
    }
  }

  voice(text: string, speaker = 'PDA', ttl = 5.5): void {
    this.subQueue.push({ text, speaker, ttl });
  }

  /** `angle` is the screen-relative bearing of the hit in radians, 0 = ahead. */
  damage(amount: number, angle: number | null): void {
    const k = clamp01(amount / 26);
    this.dVignette = Math.min(1, this.dVignette + 0.35 + k * 0.65);
    this.vignetteHold = 0.16 + k * 0.3;
    if (angle !== null) {
      setProp(this.vignetteDir, '--dmg-rot', `${(angle * 180) / Math.PI}deg`);
      setProp(this.vignetteDir, 'opacity', '1');
    } else {
      setProp(this.vignetteDir, 'opacity', '0');
    }
  }

  setPrompt(list: PromptSpec[] | null): void {
    const sig = list && list.length ? list.map((p) => `${p.key}|${p.label}`).join(',') : '';
    if (sig === this.promptSig) return;
    this.promptSig = sig;
    while (this.promptEl.firstChild) this.promptEl.removeChild(this.promptEl.firstChild);
    setClass(this.promptEl, 'on', sig !== '');
    setClass(this.reticle, 'targeting', sig !== '');
    if (!list) return;
    for (const p of list) {
      const row = add(this.promptEl, div('hud-prompt-row'));
      add(row, keycap(p.key));
      add(row, el('span', 'hud-prompt-label', p.label));
    }
    if (!this.prefs.reducedMotion) {
      this.anim.tween(0.22, (k) => {
        this.promptEl.style.opacity = String(k);
        this.promptEl.style.transform = `translateY(${(1 - k) * 8}px)`;
      });
    }
  }

  setScanProgress(v: number): void {
    this.scanTarget = clamp01(v);
  }

  /** Called on biome:entered. Fades the banner in, holds, fades out. */
  announceBiome(name: string): void {
    setText(this.biomeName, name);
    const rm = this.prefs.reducedMotion;
    this.biomeEl.classList.remove('show');
    // Force a reflow so the CSS transition retriggers.
    void this.biomeEl.offsetWidth;
    this.biomeEl.classList.add('show');
    this.biomeTimer = 5.2;
    if (rm) return;
    // Letter-spacing settle: reads as a system announcing itself.
    this.anim.tween(
      1.1,
      (k) => {
        setProp(this.biomeName, 'letter-spacing', `${(0.62 - 0.34 * k).toFixed(3)}em`);
      },
      (t) => 1 - Math.pow(1 - t, 4),
    );
    this.biomeTimer = 5.2;
  }

  /* ------------------------------------------------------------------ *
   * Frame update
   * ------------------------------------------------------------------ */

  update(dt: number, s: HudState): void {
    /* ---- biome banner hold ---- */
    if (this.biomeTimer > 0) {
      this.biomeTimer -= dt;
      if (this.biomeTimer <= 0) this.biomeEl.classList.remove('show');
    }

    /* ---- oxygen ---- */
    const oxyFrac = s.maxOxygen > 0 ? clamp01(s.oxygen / s.maxOxygen) : 0;
    this.dOxy = damp(this.dOxy, oxyFrac, 14, dt);
    this.o2Ring.set(this.dOxy);
    setText(this.o2Value, fmtInt(Math.max(0, s.oxygen)));
    setText(this.o2Sub, s.underwater ? 'O₂ SEC' : 'O₂ FULL');
    const warn = oxyFrac <= O2_WARN;
    const danger = oxyFrac <= O2_DANGER;
    setClass(this.root, 'o2-warn', warn && !danger);
    setClass(this.root, 'o2-danger', danger);
    setClass(this.o2Alert, 'on', warn);

    // Audible-free urgency: the ring blinks faster as the margin shrinks.
    if (danger) {
      this.o2Blink += dt * (this.prefs.reducedMotion ? 0 : 5.2 + (1 - oxyFrac / O2_DANGER) * 4);
      setProp(this.o2Alert, 'opacity', (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.o2Blink * 6.283))).toFixed(3));
    } else if (warn) {
      this.o2Blink += dt * (this.prefs.reducedMotion ? 0 : 1.6);
      setProp(this.o2Alert, 'opacity', (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.o2Blink * 6.283))).toFixed(3));
    } else {
      setProp(this.o2Alert, 'opacity', '0');
    }

    const tanks = Math.max(1, Math.round(s.maxOxygen / 45));
    if (tanks !== this.o2PipCount) {
      this.o2PipCount = tanks;
      while (this.o2Pips.firstChild) this.o2Pips.removeChild(this.o2Pips.firstChild);
      for (let i = 0; i < tanks; i++) add(this.o2Pips, div('hud-o2-pip'));
    }
    const perTank = 1 / tanks;
    for (let i = 0; i < this.o2Pips.children.length; i++) {
      const child = this.o2Pips.children[i] as HTMLElement;
      const fill = clamp01((this.dOxy - i * perTank) / perTank);
      setProp(child, '--pip', fill.toFixed(3));
    }

    /* ---- bars ---- */
    this.dHealth = damp(this.dHealth, clamp01(s.health / 100), 10, dt);
    this.dFood = damp(this.dFood, clamp01(s.food / 100), 8, dt);
    this.dWater = damp(this.dWater, clamp01(s.water / 100), 8, dt);
    this.applyBar('health', this.dHealth, s.health);
    this.applyBar('food', this.dFood, s.food);
    this.applyBar('water', this.dWater, s.water);

    /* ---- depth ---- */
    this.dDepth = damp(this.dDepth, s.depth, 9, dt);
    setText(this.depthValue, fmtInt(this.dDepth));
    const band = depthBand(s.depth);
    setText(this.depthBandEl, band.label);
    setText(this.depthNote, band.note ?? '');
    setProp(this.depthValue, 'color', band.color);
    setProp(this.root, '--depth-accent', band.color);
    // Square-root mapping: fine resolution in the shallows, still shows 1200 m.
    const gz = clamp01(Math.sqrt(Math.max(0, this.dDepth) / 1200));
    setProp(this.gaugeFill, 'height', `${(gz * 100).toFixed(2)}%`);
    setProp(this.gaugeNeedle, 'top', `${(gz * 100).toFixed(2)}%`);
    setProp(this.gaugeCrush, 'top', `${(Math.sqrt(200 / 1200) * 100).toFixed(2)}%`);

    /* ---- compass ---- */
    if (this.prefs.compass) {
      // Shortest-path damping so crossing north does not spin the ribbon.
      this.dHeading += wrapDeg(s.heading - this.dHeading) * (1 - Math.exp(-16 * dt));
      const h = ((this.dHeading % 360) + 360) % 360;
      setProp(this.compassMarks, 'background-position-x', `${(-h * COMPASS_PX_PER_DEG).toFixed(1)}px`);
      setText(this.headingValue, pad(h, 3));
      setText(this.headingCard, cardinal(h));
      this.placePip(this.northPip, wrapDeg(0 - h));
      if (s.podBearing !== null) {
        setProp(this.podPip, 'display', '');
        this.placePip(this.podPip, wrapDeg(s.podBearing - h));
        setText(this.podPipLabel, s.podDistance > 999 ? `POD ${(s.podDistance / 1000).toFixed(1)}km` : `POD ${fmtInt(s.podDistance)}m`);
      } else {
        setProp(this.podPip, 'display', 'none');
      }
    }

    /* ---- reticle scan ring ---- */
    this.dScan = damp(this.dScan, this.scanTarget, 12, dt);
    this.scanRing.set(this.dScan);
    setClass(this.reticle, 'scanning', this.dScan > 0.01);

    /* ---- vignette + breath ---- */
    if (this.vignetteHold > 0) this.vignetteHold -= dt;
    else this.dVignette = Math.max(0, this.dVignette - dt * 1.35);
    setProp(this.vignette, 'opacity', this.dVignette.toFixed(3));
    // Low health drives a permanent low-level pulse; low oxygen darkens the edges.
    const hpEdge = 1 - smoothstep(0.15, 0.55, this.dHealth);
    const o2Edge = 1 - smoothstep(O2_DANGER, O2_WARN * 1.6, oxyFrac);
    const pulse = this.prefs.reducedMotion ? 0.55 : 0.5 + 0.5 * Math.sin(performance.now() * 0.0042);
    setProp(this.breath, 'opacity', (Math.max(hpEdge * 0.55, o2Edge * 0.7) * (0.55 + 0.45 * pulse)).toFixed(3));

    /* ---- toasts ---- */
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.life += dt;
      if (t.life > t.ttl) {
        const root = t.root;
        this.toasts.splice(i, 1);
        if (this.prefs.reducedMotion) root.remove();
        else {
          this.anim.tween(0.32, (k) => {
            root.style.opacity = String(1 - k);
            root.style.transform = `translateX(${k * 26}px)`;
            if (k >= 1) root.remove();
          });
        }
      }
    }

    /* ---- subtitles ---- */
    this.updateSubs(dt);

    /* ---- status strip ---- */
    setText(this.clockEl, fmtClock(s.timeOfDay));
    setText(this.modeEl, s.mode.toUpperCase());
    if (this.prefs.perfOverlay) {
      setProp(this.perfEl, 'display', '');
      const fps = s.frameMs > 0 ? 1000 / s.frameMs : 0;
      setText(this.perfEl, `${fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms · ×${s.renderScale.toFixed(2)}`);
    } else {
      setProp(this.perfEl, 'display', 'none');
    }
  }

  private placePip(pip: HTMLElement, delta: number): void {
    const px = delta * COMPASS_PX_PER_DEG;
    setProp(pip, 'transform', `translateX(calc(-50% + ${px.toFixed(1)}px))`);
    setProp(pip, 'opacity', (1 - smoothstep(60, 96, Math.abs(delta))).toFixed(3));
  }

  private applyBar(kind: 'health' | 'food' | 'water', frac: number, raw: number): void {
    const b = this.bars[kind];
    setProp(b.fill, 'width', `${(frac * 100).toFixed(2)}%`);
    setText(b.value, fmtInt(Math.max(0, raw)));
    setClass(b.row, 'warn', frac < 0.34 && frac >= 0.15);
    setClass(b.row, 'danger', frac < 0.15);
  }

  private updateSubs(dt: number): void {
    if (this.subLife > 0) {
      this.subLife -= dt;
      if (this.subLife <= 0) setClass(this.subHost, 'on', false);
      return;
    }
    const next = this.subQueue.shift();
    if (!next) return;
    if (!this.prefs.reducedMotion) {
      // Type-on reveal, capped so a long line never outlasts its ttl.
      const full = next.text;
      let shown = 0;
      const speed = Math.max(28, full.length / Math.max(0.6, next.ttl * 0.45));
      this.anim.add((d) => {
        shown += speed * d;
        setText(this.subText, full.slice(0, Math.min(full.length, Math.floor(shown))));
        return shown < full.length;
      });
    } else {
      setText(this.subText, next.text);
    }
    setText(this.subSpeaker, (next.speaker ?? 'PDA').toUpperCase());
    setClass(this.subHost, 'on', true);
    this.subLife = next.ttl;
  }

  setSubtitlesEnabled(on: boolean): void {
    setClass(this.subHost, 'off', !on);
  }

  setPrefs(p: UiPrefs): void {
    this.prefs = p;
  }

  dispose(): void {
    this.dis.dispose();
    this.root.remove();
  }
}

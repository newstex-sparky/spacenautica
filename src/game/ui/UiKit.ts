/**
 * UI kit — the only DOM/animation primitives the interface layers use.
 *
 * Everything here is procedural: panel grain, scanlines, hatch patterns and the
 * compass ribbon are all rasterised into canvases at runtime and handed to CSS
 * as data URLs. There are no image, font or icon files anywhere in the UI.
 */

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function div(cls?: string, text?: string): HTMLDivElement {
  return el('div', cls, text);
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
  return n;
}

/** Append and return the child, so trees can be built as expressions. */
export function add<T extends Node>(parent: Node, child: T): T {
  parent.appendChild(child);
  return child;
}

export function addAll(parent: Node, ...children: Node[]): void {
  for (const c of children) parent.appendChild(c);
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ------------------------------------------------------------------ *
 * Dirty-checked writes. The HUD updates every frame; blindly assigning
 * textContent/style invalidates layout even when the value is unchanged.
 * ------------------------------------------------------------------ */

const textCache = new WeakMap<Node, string>();
const propCache = new WeakMap<Element, Map<string, string>>();
const classCache = new WeakMap<Element, Map<string, boolean>>();

export function setText(node: Node, value: string): void {
  if (textCache.get(node) === value) return;
  textCache.set(node, value);
  node.textContent = value;
}

/** Works for both regular properties (`width`) and custom properties (`--x`). */
export function setProp(node: HTMLElement | SVGElement, prop: string, value: string): void {
  let m = propCache.get(node);
  if (!m) {
    m = new Map();
    propCache.set(node, m);
  }
  if (m.get(prop) === value) return;
  m.set(prop, value);
  (node as HTMLElement).style.setProperty(prop, value);
}

export function setAttr(node: Element, name: string, value: string | number): void {
  const v = String(value);
  let m = propCache.get(node);
  if (!m) {
    m = new Map();
    propCache.set(node, m);
  }
  const key = `@${name}`;
  if (m.get(key) === v) return;
  m.set(key, v);
  node.setAttribute(name, v);
}

export function setClass(node: Element, cls: string, on: boolean): void {
  let m = classCache.get(node);
  if (!m) {
    m = new Map();
    classCache.set(node, m);
  }
  if (m.get(cls) === on) return;
  m.set(cls, on);
  node.classList.toggle(cls, on);
}

/* ------------------------------------------------------------------ *
 * Math / easing
 * ------------------------------------------------------------------ */

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential approach. `lambda` is 1/e-per-second. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
export const easeOutBack = (t: number): number => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/** Wrap an angle in degrees into (-180, 180]. */
export function wrapDeg(d: number): number {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/** Deterministic hash → 0..1. Used so every generated icon differs. */
export function hash01(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Tiny deterministic PRNG so procedural art is stable across reloads. */
export function makeRng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function fmtInt(v: number): string {
  return String(Math.round(v));
}

/** 3 → "003" for instrument readouts. */
export function pad(v: number, width: number): string {
  const s = String(Math.max(0, Math.round(v)));
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

/** 13.75 → "13:45". */
export function fmtClock(hours: number): string {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function cardinal(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return CARDINALS[Math.round(d / 45) % 8];
}

/* ------------------------------------------------------------------ *
 * Procedural CSS textures
 * ------------------------------------------------------------------ */

function canvas2d(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  return { c, g };
}

/** Fine film/sensor grain used at very low alpha behind every panel. */
export function grainDataUrl(size = 128, amount = 16): string {
  const cc = canvas2d(size, size);
  if (!cc) return '';
  const { c, g } = cc;
  const img = g.createImageData(size, size);
  const rng = makeRng(0x51ac3);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rng();
    // Slightly blue-tinted grain reads as CRT phosphor rather than TV static.
    img.data[i] = 140 + v * 90;
    img.data[i + 1] = 190 + v * 60;
    img.data[i + 2] = 210 + v * 45;
    img.data[i + 3] = v * v * amount;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** Horizontal scanlines with a soft 3-line beat, like a CRT shadow mask. */
export function scanlineDataUrl(period = 3, strength = 26): string {
  const cc = canvas2d(4, period * 2);
  if (!cc) return '';
  const { c, g } = cc;
  g.clearRect(0, 0, 4, period * 2);
  for (let y = 0; y < period * 2; y++) {
    const a = (y % period === 0 ? strength : y % period === 1 ? strength * 0.35 : 0) / 255;
    if (a <= 0) continue;
    g.fillStyle = `rgba(0, 14, 20, ${a.toFixed(3)})`;
    g.fillRect(0, y, 4, 1);
  }
  return c.toDataURL();
}

/**
 * 45° hatch. Warning states use hatch direction *as well as* colour so they are
 * legible with any form of colour vision deficiency.
 */
export function hatchDataUrl(dir: 1 | -1 = 1, gap = 6, alpha = 0.22): string {
  const s = gap * 2;
  const cc = canvas2d(s, s);
  if (!cc) return '';
  const { c, g } = cc;
  g.strokeStyle = `rgba(255,255,255,${alpha})`;
  g.lineWidth = 1.4;
  for (let i = -s; i < s * 2; i += gap) {
    g.beginPath();
    if (dir > 0) {
      g.moveTo(i, -2);
      g.lineTo(i + s + 2, s + 2);
    } else {
      g.moveTo(i, s + 2);
      g.lineTo(i + s + 2, -2);
    }
    g.stroke();
  }
  return c.toDataURL();
}

/** Faint hex mesh, the "sensor glass" layer on PDA panels. */
export function hexMeshDataUrl(r = 13, alpha = 0.09): string {
  const w = Math.round(r * 3);
  const h = Math.round(r * Math.sqrt(3));
  const cc = canvas2d(w, h);
  if (!cc) return '';
  const { c, g } = cc;
  g.strokeStyle = `rgba(150, 235, 255, ${alpha})`;
  g.lineWidth = 1;
  const hexAt = (cx: number, cy: number) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
  };
  for (let i = -1; i <= 2; i++) {
    hexAt(i * r * 3, 0);
    hexAt(i * r * 3, h);
    hexAt(i * r * 3 + r * 1.5, h / 2);
    hexAt(i * r * 3 - r * 1.5, h / 2);
  }
  return c.toDataURL();
}

/**
 * The compass ribbon: one full 360° turn rasterised once, then scrolled with
 * `background-position-x`. `PX_PER_DEG` px of texture per degree of heading.
 */
export const COMPASS_PX_PER_DEG = 4;

export function compassStripDataUrl(height = 42): string {
  const w = 360 * COMPASS_PX_PER_DEG;
  const cc = canvas2d(w, height);
  if (!cc) return '';
  const { c, g } = cc;
  g.clearRect(0, 0, w, height);
  const base = height - 9;
  for (let deg = 0; deg < 360; deg++) {
    const x = Math.round(deg * COMPASS_PX_PER_DEG) + 0.5;
    const major = deg % 45 === 0;
    const mid = deg % 15 === 0;
    if (!major && !mid && deg % 5 !== 0) continue;
    const len = major ? 15 : mid ? 9 : 5;
    g.strokeStyle = major
      ? 'rgba(190, 245, 255, 0.92)'
      : mid
        ? 'rgba(150, 225, 245, 0.55)'
        : 'rgba(140, 210, 235, 0.3)';
    g.lineWidth = major ? 1.6 : 1;
    g.beginPath();
    g.moveTo(x, base - len);
    g.lineTo(x, base);
    g.stroke();
  }
  g.font = '600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (let i = 0; i < 8; i++) {
    const deg = i * 45;
    const label = CARDINALS[i];
    const x = deg * COMPASS_PX_PER_DEG;
    const primary = deg % 90 === 0;
    g.fillStyle = primary ? 'rgba(214, 250, 255, 0.98)' : 'rgba(160, 225, 245, 0.62)';
    g.shadowColor = 'rgba(0, 20, 30, 0.9)';
    g.shadowBlur = 4;
    g.fillText(label, x, 2);
    // Wrap the label that straddles the seam so scrolling never shows a gap.
    if (x < 40) g.fillText(label, x + w, 2);
    if (x > w - 40) g.fillText(label, x - w, 2);
  }
  g.shadowBlur = 0;
  return c.toDataURL();
}

let texturesInstalled = false;

/** Publishes the generated textures as CSS custom properties on :root. */
export function installUiTextures(): void {
  if (texturesInstalled) return;
  texturesInstalled = true;
  const r = document.documentElement.style;
  r.setProperty('--ui-grain', `url("${grainDataUrl(128, 15)}")`);
  r.setProperty('--ui-scan', `url("${scanlineDataUrl(3, 30)}")`);
  r.setProperty('--ui-scan-fine', `url("${scanlineDataUrl(2, 16)}")`);
  r.setProperty('--ui-hatch', `url("${hatchDataUrl(1, 6, 0.2)}")`);
  r.setProperty('--ui-hatch-alt', `url("${hatchDataUrl(-1, 5, 0.24)}")`);
  r.setProperty('--ui-hex', `url("${hexMeshDataUrl(14, 0.085)}")`);
  r.setProperty('--ui-compass', `url("${compassStripDataUrl(42)}")`);
}

/* ------------------------------------------------------------------ *
 * SVG progress ring
 * ------------------------------------------------------------------ */

export interface Ring {
  readonly root: SVGSVGElement;
  /** 0..1 */
  set(v: number): void;
}

/**
 * Builds a dashed-arc progress ring with procedural tick marks. `sweep` is the
 * fraction of the circle the gauge covers (0.75 → a 270° gauge).
 */
export function makeRing(opts: {
  size: number;
  radius: number;
  width: number;
  sweep?: number;
  rotate?: number;
  ticks?: number;
  cls?: string;
}): Ring {
  const { size, radius, width } = opts;
  const sweep = opts.sweep ?? 1;
  const rotate = opts.rotate ?? -90;
  const root = svgEl('svg', {
    class: `ui-ring ${opts.cls ?? ''}`,
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    'aria-hidden': 'true',
  });
  const c = size / 2;
  const circ = 2 * Math.PI * radius;
  const arc = circ * sweep;

  const g = add(root, svgEl('g', { transform: `rotate(${rotate} ${c} ${c})` }));

  add(
    g,
    svgEl('circle', {
      class: 'ui-ring-track',
      cx: c,
      cy: c,
      r: radius,
      fill: 'none',
      'stroke-width': width,
      'stroke-dasharray': `${arc.toFixed(2)} ${(circ - arc + 1).toFixed(2)}`,
      'stroke-linecap': 'round',
    }),
  );

  const value = add(
    g,
    svgEl('circle', {
      class: 'ui-ring-value',
      cx: c,
      cy: c,
      r: radius,
      fill: 'none',
      'stroke-width': width,
      'stroke-dasharray': `0 ${circ.toFixed(2)}`,
      'stroke-linecap': 'round',
    }),
  );

  const nTicks = opts.ticks ?? 0;
  if (nTicks > 0) {
    const tg = add(g, svgEl('g', { class: 'ui-ring-ticks' }));
    for (let i = 0; i <= nTicks; i++) {
      const t = (i / nTicks) * sweep * Math.PI * 2;
      const inner = radius - width * 0.72;
      const outer = radius + width * (i % 5 === 0 ? 0.95 : 0.6);
      add(
        tg,
        svgEl('line', {
          x1: c + Math.cos(t) * inner,
          y1: c + Math.sin(t) * inner,
          x2: c + Math.cos(t) * outer,
          y2: c + Math.sin(t) * outer,
          'stroke-width': i % 5 === 0 ? 1.5 : 0.8,
          opacity: i % 5 === 0 ? 0.6 : 0.28,
        }),
      );
    }
  }

  return {
    root,
    set(v: number) {
      const f = clamp01(v) * arc;
      setAttr(value, 'stroke-dasharray', `${f.toFixed(2)} ${(circ - f + 1).toFixed(2)}`);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Small widgets
 * ------------------------------------------------------------------ */

/** `[E]` style key chip. */
export function keycap(label: string): HTMLSpanElement {
  const s = el('span', 'ui-key', label);
  return s;
}

/** Corner-bracket frame used on panels — four absolutely positioned hairlines. */
export function brackets(host: HTMLElement): void {
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    host.appendChild(div(`ui-bracket ui-bracket-${corner}`));
  }
}

export function button(label: string, cls = ''): HTMLButtonElement {
  const b = el('button', `ui-btn ${cls}`.trim());
  b.type = 'button';
  b.appendChild(el('span', 'ui-btn-label', label));
  b.appendChild(div('ui-btn-sheen'));
  return b;
}

/* ------------------------------------------------------------------ *
 * Animation runner — one place for all UI tweens, ticked by HudSystem.
 * ------------------------------------------------------------------ */

type TickFn = (dt: number) => boolean;

export class Anim {
  private fns: TickFn[] = [];
  private swap: TickFn[] = [];

  add(fn: TickFn): void {
    this.fns.push(fn);
  }

  /** Runs a normalised 0..1 tween over `duration` seconds. */
  tween(duration: number, fn: (t: number) => void, ease: (t: number) => number = easeOutCubic): void {
    let acc = 0;
    this.add((dt) => {
      acc += dt;
      const t = clamp01(acc / duration);
      fn(ease(t));
      return t < 1;
    });
  }

  update(dt: number): void {
    if (this.fns.length === 0) return;
    this.swap.length = 0;
    for (const fn of this.fns) {
      let keep = false;
      try {
        keep = fn(dt);
      } catch (err) {
        console.error('[ui] anim threw', err);
      }
      if (keep) this.swap.push(fn);
    }
    const tmp = this.fns;
    this.fns = this.swap;
    this.swap = tmp;
    this.swap.length = 0;
  }

  clear(): void {
    this.fns.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Disposal
 * ------------------------------------------------------------------ */

export class Disposables {
  private list: Array<() => void> = [];

  add(fn: () => void): void {
    this.list.push(fn);
  }

  /** Adds a DOM listener and remembers how to remove it. */
  listen<T extends EventTarget>(
    target: T,
    type: string,
    fn: (ev: Event) => void,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn, opts);
    this.list.push(() => target.removeEventListener(type, fn, opts));
  }

  dispose(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      try {
        this.list[i]();
      } catch {
        /* keep tearing down */
      }
    }
    this.list.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Accessibility preferences. These live outside core/Settings (which the UI
 * agent must not modify) and are persisted separately.
 * ------------------------------------------------------------------ */

export type ColorVision = 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia';

export interface UiPrefs {
  /** Multiplies the UI root font size, 0.75 .. 1.6. */
  scale: number;
  /** Overall HUD opacity, 0.35 .. 1. */
  opacity: number;
  /** Disables all non-essential motion. */
  reducedMotion: boolean;
  /** Remaps warning colours and enables shape/hatch redundancy. */
  colorVision: ColorVision;
  /** High-contrast panels (opaque backgrounds, stronger hairlines). */
  highContrast: boolean;
  /** Subtitle text size multiplier. */
  subtitleScale: number;
  /** Show the compass ribbon. */
  compass: boolean;
  /** Show the numeric performance readout. */
  perfOverlay: boolean;
}

const PREFS_KEY = 'spacenautica.ui.v1';

const PREF_DEFAULTS: UiPrefs = {
  scale: 1,
  opacity: 1,
  reducedMotion: false,
  colorVision: 'off',
  highContrast: false,
  subtitleScale: 1,
  compass: true,
  perfOverlay: false,
};

export function loadPrefs(): UiPrefs {
  let p: UiPrefs = { ...PREF_DEFAULTS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) p = { ...p, ...(JSON.parse(raw) as Partial<UiPrefs>) };
  } catch {
    /* corrupt storage — defaults */
  }
  // Honour the OS-level preference on first run.
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) p.reducedMotion = true;
  } catch {
    /* no matchMedia */
  }
  return p;
}

export function savePrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** Reflects prefs onto the document root so CSS can react to all of them. */
export function applyPrefs(p: UiPrefs): void {
  const r = document.documentElement;
  r.style.setProperty('--ui-scale', p.scale.toFixed(3));
  r.style.setProperty('--hud-alpha', p.opacity.toFixed(3));
  r.style.setProperty('--sub-scale', p.subtitleScale.toFixed(3));
  setClass(r, 'ui-reduced-motion', p.reducedMotion);
  setClass(r, 'ui-high-contrast', p.highContrast);
  setClass(r, 'ui-cv-deuter', p.colorVision === 'deuteranopia');
  setClass(r, 'ui-cv-prot', p.colorVision === 'protanopia');
  setClass(r, 'ui-cv-trit', p.colorVision === 'tritanopia');
  setClass(r, 'ui-no-compass', !p.compass);
}

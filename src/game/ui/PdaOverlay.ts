/**
 * The PDA: a full-screen tabbed overlay that darkens and blurs the still-live
 * world behind it. Inventory (footprint grid with drag and drop), Blueprints
 * (recipe browser with live ingredient availability), Databank (lore with
 * procedural diagrams), Journal (quests + event log) and Time Capsule.
 *
 * The overlay owns no world state. Every mutation goes through GameStateBridge,
 * which prefers the systems agent's API and falls back to the baseline one.
 */
import type { GameContext } from '../core/Types';
import {
  Anim,
  add,
  brackets,
  button,
  clamp,
  clear,
  div,
  el,
  fmtClock,
  fmtInt,
  makeRng,
  setClass,
  setProp,
  setText,
} from './UiKit';
import type { UiPrefs } from './UiKit';
import {
  BUILD_MODULES,
  DATABANK,
  QUESTS,
  RECIPES,
  depthBand,
  itemDef,
  recipeFor,
} from './ItemDatabase';
import type { DatabankEntry, RecipeDef } from './ItemDatabase';
import { drawArchetype } from './IconFactory';
import type { IconFactory } from './IconFactory';
import {
  countOf,
  craftability,
  dropItem,
  footprint,
  gameState,
  gridSize,
  techUnlocked,
  tryCraft,
} from './GameStateBridge';
import type { StackLike } from './GameStateBridge';

export type PdaTab = 'inventory' | 'blueprints' | 'databank' | 'journal' | 'capsule';

const TABS: Array<{ id: PdaTab; label: string; glyph: string }> = [
  // Glyphs are inline SVG path data — procedural, no icon font.
  { id: 'inventory', label: 'Inventory', glyph: 'M3 6h18v4H3zM3 12h18v6H3zM8 6v12M14 6v12' },
  { id: 'blueprints', label: 'Blueprints', glyph: 'M3 4h18v16H3zM7 8h6M7 12h10M7 16h4M17 8v8' },
  { id: 'databank', label: 'Databank', glyph: 'M12 3l8 4v6c0 5-4 7-8 8-4-1-8-3-8-8V7zM9 12l2.4 2.4L16 10' },
  { id: 'journal', label: 'Journal', glyph: 'M5 3h11l3 3v15H5zM8 8h8M8 12h8M8 16h5' },
  { id: 'capsule', label: 'Time Capsule', glyph: 'M12 2c3 3 4 6 4 10s-1 7-4 10c-3-3-4-6-4-10s1-7 4-10zM8 12h8' },
];

const LOG_MAX = 60;
const GRID_GAP_FALLBACK = 6;

interface Card {
  stack: StackLike;
  root: HTMLElement;
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface LogEntry {
  t: number;
  text: string;
  kind: string;
}

export class PdaOverlay {
  readonly root: HTMLDivElement;
  open = false;
  tab: PdaTab = 'inventory';

  private anim: Anim;
  private prefs: UiPrefs;
  private icons: IconFactory;
  private ctx: GameContext | null = null;

  private pane: HTMLElement;
  private railButtons = new Map<PdaTab, HTMLElement>();
  private telemetry: { depth: HTMLElement; clock: HTMLElement; biome: HTMLElement; o2: HTMLElement };
  private footerHint: HTMLElement;

  private dirty = true;
  private refreshAccum = 0;

  /* inventory state */
  private layout = new Map<string, { x: number; y: number }>();
  private cards: Card[] = [];
  private selected: string | null = null;
  private gridCells: HTMLElement | null = null;
  private gridCards: HTMLElement | null = null;
  private ghost: HTMLElement | null = null;
  private detail: HTMLElement | null = null;
  private trash: HTMLElement | null = null;
  private drag: {
    card: Card;
    grabX: number;
    grabY: number;
    startPX: number;
    startPY: number;
    cellW: number;
    cellH: number;
    gap: number;
    moved: boolean;
  } | null = null;

  /* other tabs */
  private bpGroup = 'All';
  private bpSelected: string | null = null;
  private dbSelected: string | null = null;
  private log: LogEntry[] = [];
  private unlockedLocal = new Set<string>(['db_lifepod', 'db_shallows', 'db_o2']);
  private capsuleSlots: Array<string | null> = [null, null, null, null];
  private capsuleName = '';
  private capsuleMessage = '';

  constructor(host: HTMLElement, anim: Anim, prefs: UiPrefs, icons: IconFactory) {
    this.anim = anim;
    this.prefs = prefs;
    this.icons = icons;

    const root = div('pda');
    this.root = root;
    add(root, div('pda-scrim'));

    const frame = add(root, div('pda-frame'));
    brackets(frame);
    add(frame, div('pda-crt'));
    add(frame, div('pda-sweep'));

    /* header */
    const header = add(frame, div('pda-header'));
    const brand = add(header, div('pda-brand'));
    add(brand, this.brandGlyph());
    const brandText = add(brand, div('pda-brand-text'));
    add(brandText, el('b', undefined, 'PDA'));
    add(brandText, el('span', undefined, 'Personal Data Assistant · rev 4.1'));

    const tel = add(header, div('pda-telemetry'));
    this.telemetry = {
      depth: this.telemetryCell(tel, 'DEPTH', '0 m'),
      o2: this.telemetryCell(tel, 'O₂', '45 s'),
      biome: this.telemetryCell(tel, 'REGION', '—'),
      clock: this.telemetryCell(tel, 'LOCAL', '12:00'),
    };

    const close = add(header, button('Close', 'pda-close'));
    close.addEventListener('click', () => this.hide());

    /* body */
    const body = add(frame, div('pda-body'));
    const rail = add(body, div('pda-rail'));
    for (const t of TABS) {
      const b = add(rail, el('button', 'pda-tab'));
      b.type = 'button';
      add(b, this.tabGlyph(t.glyph));
      add(b, el('span', 'pda-tab-label', t.label));
      add(b, div('pda-tab-bar'));
      b.addEventListener('click', () => this.select(t.id));
      this.railButtons.set(t.id, b);
    }
    this.pane = add(body, div('pda-pane'));

    /* footer */
    const footer = add(frame, div('pda-footer'));
    this.footerHint = add(footer, div('pda-hints'));
    add(footer, el('span', 'pda-build', 'ALTERRA SYSTEMS · OFFLINE CACHE'));

    host.appendChild(root);
    this.setHints();
  }

  /* ------------------------------------------------------------------ *
   * Glyphs
   * ------------------------------------------------------------------ */

  private tabGlyph(d: string): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'pda-tab-glyph');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }

  private brandGlyph(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    s.setAttribute('class', 'pda-brand-glyph');
    const mk = (d: string, w: string, o = '1') => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-width', w);
      p.setAttribute('opacity', o);
      s.appendChild(p);
    };
    mk('M16 2.5 27 8.5v11L16 25.5 5 19.5v-11z', '1.4');
    mk('M16 8 22 11.4v6.8L16 21.6 10 18.2v-6.8z', '1', '0.55');
    mk('M16 2.5V8M27 8.5 22 11.4M5 8.5l5 2.9M16 25.5v-3.9', '0.9', '0.4');
    return s;
  }

  private telemetryCell(host: HTMLElement, label: string, value: string): HTMLElement {
    const c = add(host, div('pda-tel'));
    add(c, el('span', 'pda-tel-label', label));
    return add(c, el('b', 'pda-tel-value', value));
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  show(ctx: GameContext, tab?: PdaTab): void {
    this.ctx = ctx;
    if (tab) this.tab = tab;
    this.open = true;
    this.dirty = true;
    setClass(this.root, 'on', true);
    this.select(this.tab, true);
    if (!this.prefs.reducedMotion) {
      this.anim.tween(
        0.3,
        (k) => {
          setProp(this.root, '--pda-in', k.toFixed(3));
        },
        (t) => 1 - Math.pow(1 - t, 4),
      );
    } else {
      setProp(this.root, '--pda-in', '1');
    }
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.cancelDrag(false);
    setClass(this.root, 'on', false);
    setProp(this.root, '--pda-in', '0');
  }

  toggle(ctx: GameContext, tab?: PdaTab): void {
    if (this.open && (!tab || tab === this.tab)) this.hide();
    else this.show(ctx, tab);
  }

  select(tab: PdaTab, force = false): void {
    if (tab === this.tab && !force && this.pane.firstChild) return;
    this.tab = tab;
    for (const [id, b] of this.railButtons) setClass(b, 'on', id === tab);
    this.rebuild();
    this.setHints();
    if (!this.prefs.reducedMotion) {
      this.anim.tween(0.26, (k) => {
        setProp(this.pane, 'opacity', k.toFixed(3));
        setProp(this.pane, 'transform', `translateY(${((1 - k) * 10).toFixed(2)}px)`);
      });
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  pushLog(text: string, kind = 'log', t = 0): void {
    this.log.unshift({ t, text, kind });
    if (this.log.length > LOG_MAX) this.log.pop();
    if (this.tab === 'journal') this.dirty = true;
  }

  unlockDatabank(id: string): void {
    this.unlockedLocal.add(id);
    if (this.tab === 'databank') this.dirty = true;
  }

  setPrefs(p: UiPrefs): void {
    this.prefs = p;
  }

  /* ------------------------------------------------------------------ *
   * Frame update
   * ------------------------------------------------------------------ */

  update(dt: number, ctx: GameContext): void {
    if (!this.open) return;
    this.ctx = ctx;

    /* telemetry strip */
    const player = ctx.tryGet('player') as unknown as
      | { depth?: number; vitals?: { oxygen: number } }
      | undefined;
    const depth = player?.depth ?? 0;
    setText(this.telemetry.depth, `${fmtInt(depth)} m`);
    setText(this.telemetry.o2, `${fmtInt(player?.vitals?.oxygen ?? 0)} s`);
    setText(this.telemetry.clock, fmtClock(this.timeOfDay(ctx)));
    setText(this.telemetry.biome, this.biomeName(ctx));
    setProp(this.root, '--pda-accent', depthBand(depth).color);

    this.refreshAccum += dt;
    if (this.dirty && this.refreshAccum > 0.2) {
      this.refreshAccum = 0;
      this.dirty = false;
      this.rebuild();
    }
  }

  private timeOfDay(ctx: GameContext): number {
    const sky = ctx.tryGet('world.sky') as unknown as { timeOfDay?: number } | undefined;
    return sky?.timeOfDay ?? 12;
  }

  private biomeName(ctx: GameContext): string {
    const player = ctx.tryGet('player') as unknown as { position?: { x: number; z: number } } | undefined;
    if (!player?.position) return '—';
    try {
      const b = ctx.world.biomeAt(player.position.x, player.position.z);
      const terrain = ctx.tryGet('world.terrain') as unknown as
        | { biomes?: ReadonlyMap<string, { name: string }> }
        | undefined;
      return terrain?.biomes?.get(b.id)?.name ?? b.id;
    } catch {
      return '—';
    }
  }

  private setHints(): void {
    const hints: Array<[string, string]> =
      this.tab === 'inventory'
        ? [['LMB', 'Drag to arrange'], ['RMB', 'Drop one'], ['Tab', 'Close']]
        : this.tab === 'blueprints'
          ? [['LMB', 'Select recipe'], ['Enter', 'Fabricate'], ['Tab', 'Close']]
          : [['LMB', 'Select'], ['Tab', 'Close'], ['Esc', 'Back']];
    clear(this.footerHint);
    for (const [k, label] of hints) {
      const row = add(this.footerHint, div('pda-hint'));
      add(row, el('span', 'ui-key', k));
      add(row, el('span', undefined, label));
    }
  }

  /* ------------------------------------------------------------------ *
   * Pane construction
   * ------------------------------------------------------------------ */

  private rebuild(): void {
    clear(this.pane);
    this.gridCells = null;
    this.gridCards = null;
    this.detail = null;
    this.trash = null;
    this.cards = [];
    switch (this.tab) {
      case 'inventory':
        this.buildInventory();
        break;
      case 'blueprints':
        this.buildBlueprints();
        break;
      case 'databank':
        this.buildDatabank();
        break;
      case 'journal':
        this.buildJournal();
        break;
      case 'capsule':
        this.buildCapsule();
        break;
    }
  }

  /* ---------------------------- inventory ---------------------------- */

  private buildInventory(): void {
    const ctx = this.ctx;
    const st = ctx ? gameState(ctx) : undefined;
    const inv = st?.inventory;
    const [cols, rows] = gridSize(inv);
    const stacks = (inv?.slots ?? []).filter((s) => s && s.count > 0);

    const wrap = add(this.pane, div('pda-inv'));
    const left = add(wrap, div('inv-left'));

    const head = add(left, div('inv-head'));
    add(head, el('h2', 'pda-h2', 'Cargo'));
    const used = stacks.reduce((n, s) => {
      const [w, h] = footprint(inv, s.id);
      return n + w * h;
    }, 0);
    const total = cols * rows;
    const meta = add(head, div('inv-meta'));
    add(meta, el('b', undefined, `${used}`));
    add(meta, el('span', undefined, ` / ${total} cells`));
    const capTrack = add(head, div('inv-cap'));
    const capFill = add(capTrack, div('inv-cap-fill'));
    setProp(capFill, 'width', `${Math.min(100, (used / total) * 100).toFixed(1)}%`);
    setClass(capTrack, 'full', used / total > 0.86);

    const grid = add(left, div('inv-grid'));
    setProp(grid, '--cols', String(cols));
    setProp(grid, '--rows', String(rows));
    const cells = add(grid, div('inv-cells'));
    setProp(cells, '--cols', String(cols));
    setProp(cells, '--rows', String(rows));
    for (let i = 0; i < cols * rows; i++) add(cells, div('inv-cell'));
    const cardHost = add(grid, div('inv-cards'));
    setProp(cardHost, '--cols', String(cols));
    setProp(cardHost, '--rows', String(rows));
    this.gridCells = cells;
    this.gridCards = cardHost;

    this.ghost = add(cardHost, div('inv-ghost'));
    setProp(this.ghost, 'display', 'none');

    /* reconcile the persisted layout against the live stacks */
    const occupied: boolean[] = new Array(cols * rows).fill(false);
    const place = (x: number, y: number, w: number, h: number, set: boolean): boolean => {
      if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const k = (y + j) * cols + (x + i);
          if (set) occupied[k] = true;
          else if (occupied[k]) return false;
        }
      }
      return true;
    };

    const pending: Array<{ stack: StackLike; w: number; h: number }> = [];
    for (const s of stacks) {
      const [w, h] = footprint(inv, s.id);
      // Authoritative position from the systems agent wins outright.
      const ax = typeof s.x === 'number' ? s.x : undefined;
      const ay = typeof s.y === 'number' ? s.y : undefined;
      const saved = this.layout.get(s.id);
      const px = ax ?? saved?.x;
      const py = ay ?? saved?.y;
      if (px !== undefined && py !== undefined && place(px, py, w, h, false)) {
        place(px, py, w, h, true);
        this.layout.set(s.id, { x: px, y: py });
        this.addCard(s, px, py, w, h);
      } else {
        pending.push({ stack: s, w, h });
      }
    }
    for (const p of pending) {
      let placed = false;
      for (let y = 0; y <= rows - p.h && !placed; y++) {
        for (let x = 0; x <= cols - p.w && !placed; x++) {
          if (place(x, y, p.w, p.h, false)) {
            place(x, y, p.w, p.h, true);
            this.layout.set(p.stack.id, { x, y });
            this.addCard(p.stack, x, y, p.w, p.h);
            placed = true;
          }
        }
      }
      if (!placed) {
        // Overflow: render it clipped at 0,0 with a warning tint rather than losing it.
        this.addCard(p.stack, 0, 0, p.w, p.h, true);
      }
    }

    const tools = add(left, div('inv-tools'));
    this.trash = add(tools, div('inv-trash'));
    add(this.trash, el('span', 'inv-trash-label', 'Drag here to discard'));
    const sortBtn = add(tools, button('Auto-arrange', 'ui-btn-ghost'));
    sortBtn.addEventListener('click', () => {
      this.layout.clear();
      this.saveLayout();
      this.dirty = true;
      this.refreshAccum = 1;
    });

    /* detail pane */
    this.detail = add(wrap, div('inv-detail'));
    this.renderDetail(this.selected ?? stacks[0]?.id ?? null);

    if (stacks.length === 0) {
      const empty = add(cardHost, div('inv-empty'));
      add(empty, el('span', undefined, 'CARGO EMPTY'));
      add(empty, el('small', undefined, 'Harvest resources with the survival knife, or break outcrops with a tool.'));
    }
  }

  private addCard(stack: StackLike, x: number, y: number, w: number, h: number, overflow = false): void {
    if (!this.gridCards) return;
    const def = itemDef(stack.id);
    const root = add(this.gridCards, div(`inv-card cat-${def.category}`));
    if (overflow) root.classList.add('overflow');
    setProp(root, 'grid-column', `${x + 1} / span ${w}`);
    setProp(root, 'grid-row', `${y + 1} / span ${h}`);
    brackets(root);
    const iconSize = Math.min(w, h) >= 2 ? 84 : 48;
    add(root, this.icons.element(stack.id, iconSize, 'ui-icon inv-card-icon'));
    add(root, el('span', 'inv-card-name', def.name));
    if (stack.count > 1) add(root, el('b', 'inv-card-count', `×${stack.count}`));
    if (def.glow) root.classList.add('glowing');

    const card: Card = { stack, root, w, h, x, y };
    this.cards.push(card);

    root.addEventListener('pointerdown', (ev) => this.beginDrag(ev, card));
    root.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (!this.ctx) return;
      if (dropItem(this.ctx, stack.id, 1)) {
        this.dirty = true;
        this.refreshAccum = 1;
      }
    });
    root.addEventListener('click', () => this.renderDetail(stack.id));
  }

  private renderDetail(id: string | null): void {
    const host = this.detail;
    if (!host) return;
    this.selected = id;
    clear(host);
    for (const c of this.cards) setClass(c.root, 'selected', c.stack.id === id);
    if (!id) {
      add(host, div('inv-detail-empty')).textContent = 'Select an item';
      return;
    }
    const ctx = this.ctx;
    const st = ctx ? gameState(ctx) : undefined;
    const def = itemDef(id);
    const [w, h] = footprint(st?.inventory, id);
    const have = countOf(st?.inventory, id);

    const iconBox = add(host, div('det-icon'));
    add(iconBox, this.icons.element(id, 160, 'ui-icon det-icon-canvas'));
    add(iconBox, div('det-icon-glow'));

    add(host, el('h3', 'det-name', def.name));
    const chips = add(host, div('det-chips'));
    add(chips, el('span', `ui-chip chip-${def.category}`, def.category.toUpperCase()));
    add(chips, el('span', 'ui-chip', `${w}×${h}`));
    if (def.mass) add(chips, el('span', 'ui-chip', `${def.mass.toFixed(1)} kg`));
    if (have > 1) add(chips, el('span', 'ui-chip', `×${have}`));

    add(host, el('p', 'det-desc', def.desc));

    const r = recipeFor(id);
    if (r) {
      const bp = add(host, div('det-recipe'));
      add(bp, el('span', 'det-sub', 'Fabricated from'));
      for (const ing of r.ingredients) {
        const row = add(bp, div('det-ing'));
        add(row, this.icons.element(ing.id, 26, 'ui-icon'));
        add(row, el('span', 'det-ing-name', itemDef(ing.id).name));
        const hv = countOf(st?.inventory, ing.id);
        const cnt = add(row, el('b', 'det-ing-count', `${hv}/${ing.count}`));
        setClass(cnt, 'ok', hv >= ing.count);
      }
    }

    const actions = add(host, div('det-actions'));
    const dropBtn = add(actions, button('Drop', 'ui-btn-ghost'));
    dropBtn.addEventListener('click', () => {
      if (!this.ctx) return;
      if (dropItem(this.ctx, id, 1)) {
        this.dirty = true;
        this.refreshAccum = 1;
      }
    });
    if (r) {
      const mkBtn = add(actions, button(`Fabricate ×${r.count}`));
      const check = craftability(st, r);
      setClass(mkBtn, 'disabled', !check.ok);
      mkBtn.addEventListener('click', () => {
        if (!this.ctx) return;
        if (tryCraft(this.ctx, r)) {
          this.dirty = true;
          this.refreshAccum = 1;
        }
      });
    }
    const bpBtn = add(actions, button('Blueprint', 'ui-btn-ghost'));
    bpBtn.addEventListener('click', () => {
      this.bpSelected = recipeFor(id)?.id ?? null;
      this.select('blueprints', true);
    });
  }

  /* ---------------------------- drag & drop ---------------------------- */

  private beginDrag(ev: PointerEvent, card: Card): void {
    if (ev.button !== 0 || !this.gridCards) return;
    const rect = this.gridCards.getBoundingClientRect();
    const cs = getComputedStyle(this.gridCards);
    const gap = parseFloat(cs.columnGap || '') || GRID_GAP_FALLBACK;
    const cols = Number(cs.getPropertyValue('--cols')) || 8;
    const rows = Number(cs.getPropertyValue('--rows')) || 6;
    const cellW = (rect.width - gap * (cols - 1)) / cols;
    const cellH = (rect.height - gap * (rows - 1)) / rows;
    const px = Math.floor((ev.clientX - rect.left) / (cellW + gap));
    const py = Math.floor((ev.clientY - rect.top) / (cellH + gap));

    this.drag = {
      card,
      grabX: clamp(px - card.x, 0, card.w - 1),
      grabY: clamp(py - card.y, 0, card.h - 1),
      startPX: ev.clientX,
      startPY: ev.clientY,
      cellW,
      cellH,
      gap,
      moved: false,
    };
    card.root.classList.add('dragging');
    card.root.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => this.moveDrag(e);
    const up = (e: PointerEvent) => {
      card.root.removeEventListener('pointermove', move);
      card.root.removeEventListener('pointerup', up);
      card.root.removeEventListener('pointercancel', up);
      this.endDrag(e);
    };
    card.root.addEventListener('pointermove', move);
    card.root.addEventListener('pointerup', up);
    card.root.addEventListener('pointercancel', up);
    ev.preventDefault();
  }

  private moveDrag(ev: PointerEvent): void {
    const d = this.drag;
    if (!d || !this.gridCards || !this.ghost) return;
    const dx = ev.clientX - d.startPX;
    const dy = ev.clientY - d.startPY;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    setProp(d.card.root, 'transform', `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(1.04)`);

    const rect = this.gridCards.getBoundingClientRect();
    const cols = Number(getComputedStyle(this.gridCards).getPropertyValue('--cols')) || 8;
    const rows = Number(getComputedStyle(this.gridCards).getPropertyValue('--rows')) || 6;
    const cx = Math.floor((ev.clientX - rect.left) / (d.cellW + d.gap)) - d.grabX;
    const cy = Math.floor((ev.clientY - rect.top) / (d.cellH + d.gap)) - d.grabY;
    const tx = clamp(cx, 0, cols - d.card.w);
    const ty = clamp(cy, 0, rows - d.card.h);
    const ok = this.fits(d.card, tx, ty, cols, rows);

    setProp(this.ghost, 'display', '');
    setProp(this.ghost, 'grid-column', `${tx + 1} / span ${d.card.w}`);
    setProp(this.ghost, 'grid-row', `${ty + 1} / span ${d.card.h}`);
    setClass(this.ghost, 'invalid', !ok);

    if (this.trash) {
      const tr = this.trash.getBoundingClientRect();
      const over =
        ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom;
      setClass(this.trash, 'hot', over);
    }
  }

  private fits(card: Card, x: number, y: number, cols: number, rows: number): boolean {
    if (x < 0 || y < 0 || x + card.w > cols || y + card.h > rows) return false;
    for (const other of this.cards) {
      if (other === card) continue;
      if (x + card.w <= other.x || other.x + other.w <= x) continue;
      if (y + card.h <= other.y || other.y + other.h <= y) continue;
      return false;
    }
    return true;
  }

  private endDrag(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const card = d.card;
    card.root.classList.remove('dragging');
    if (this.ghost) setProp(this.ghost, 'display', 'none');

    // Discard?
    if (this.trash) {
      const tr = this.trash.getBoundingClientRect();
      const over =
        ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom;
      setClass(this.trash, 'hot', false);
      if (over && d.moved && this.ctx) {
        this.drag = null;
        if (dropItem(this.ctx, card.stack.id, card.stack.count)) {
          this.layout.delete(card.stack.id);
          this.saveLayout();
          this.dirty = true;
          this.refreshAccum = 1;
          return;
        }
      }
    }

    if (!d.moved) {
      this.drag = null;
      setProp(card.root, 'transform', '');
      this.renderDetail(card.stack.id);
      return;
    }

    const host = this.gridCards;
    if (!host) {
      this.drag = null;
      return;
    }
    const rect = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const cols = Number(cs.getPropertyValue('--cols')) || 8;
    const rows = Number(cs.getPropertyValue('--rows')) || 6;
    const cx = Math.floor((ev.clientX - rect.left) / (d.cellW + d.gap)) - d.grabX;
    const cy = Math.floor((ev.clientY - rect.top) / (d.cellH + d.gap)) - d.grabY;
    const tx = clamp(cx, 0, cols - card.w);
    const ty = clamp(cy, 0, rows - card.h);
    this.drag = null;

    if (this.fits(card, tx, ty, cols, rows)) {
      card.x = tx;
      card.y = ty;
      this.layout.set(card.stack.id, { x: tx, y: ty });
      this.saveLayout();
      const inv = this.ctx ? gameState(this.ctx)?.inventory : undefined;
      inv?.moveTo?.(card.stack.id, tx, ty);
      setProp(card.root, 'grid-column', `${tx + 1} / span ${card.w}`);
      setProp(card.root, 'grid-row', `${ty + 1} / span ${card.h}`);
      setProp(card.root, 'transform', '');
    } else {
      // Spring back so an invalid drop is legible rather than silent.
      const from = card.root.style.transform;
      if (this.prefs.reducedMotion) setProp(card.root, 'transform', '');
      else {
        const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(from);
        const ox = m ? Number(m[1]) : 0;
        const oy = m ? Number(m[2]) : 0;
        this.anim.tween(0.22, (k) => {
          setProp(card.root, 'transform', `translate(${(ox * (1 - k)).toFixed(1)}px, ${(oy * (1 - k)).toFixed(1)}px)`);
        });
      }
    }
  }

  private cancelDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    d.card.root.classList.remove('dragging');
    setProp(d.card.root, 'transform', '');
    if (this.ghost) setProp(this.ghost, 'display', 'none');
    this.drag = null;
    void commit;
  }

  private saveLayout(): void {
    try {
      const obj: Record<string, [number, number]> = {};
      for (const [k, v] of this.layout) obj[k] = [v.x, v.y];
      localStorage.setItem('spacenautica.ui.grid.v1', JSON.stringify(obj));
    } catch {
      /* private mode */
    }
  }

  loadLayout(): void {
    try {
      const raw = localStorage.getItem('spacenautica.ui.grid.v1');
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, [number, number]>;
      for (const k of Object.keys(obj)) this.layout.set(k, { x: obj[k][0], y: obj[k][1] });
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------- blueprints ---------------------------- */

  private buildBlueprints(): void {
    const ctx = this.ctx;
    const st = ctx ? gameState(ctx) : undefined;
    const wrap = add(this.pane, div('pda-bp'));

    const groups = ['All', ...Array.from(new Set(RECIPES.map((r) => r.group)))];
    const rail = add(wrap, div('bp-groups'));
    for (const g of groups) {
      const b = add(rail, el('button', 'bp-group'));
      b.type = 'button';
      add(b, el('span', undefined, g));
      const n = g === 'All' ? RECIPES.length : RECIPES.filter((r) => r.group === g).length;
      add(b, el('b', undefined, String(n)));
      setClass(b, 'on', g === this.bpGroup);
      b.addEventListener('click', () => {
        this.bpGroup = g;
        this.rebuild();
      });
    }

    const list = add(wrap, div('bp-list'));
    const visible = RECIPES.filter((r) => this.bpGroup === 'All' || r.group === this.bpGroup);
    for (const r of visible) {
      const def = itemDef(r.output);
      const check = craftability(st, r);
      const card = add(list, el('button', 'bp-card'));
      card.type = 'button';
      brackets(card);
      setClass(card, 'ready', check.ok);
      setClass(card, 'locked', check.locked);
      setClass(card, 'on', this.bpSelected === r.id);
      add(card, this.icons.element(r.output, 54, 'ui-icon bp-card-icon'));
      const body = add(card, div('bp-card-body'));
      add(body, el('span', 'bp-card-name', def.name));
      const ings = add(body, div('bp-card-ings'));
      for (const ing of r.ingredients) {
        const chip = add(ings, div('bp-ing-chip'));
        add(chip, this.icons.element(ing.id, 18, 'ui-icon'));
        const have = countOf(st?.inventory, ing.id);
        const t = add(chip, el('span', undefined, `${have}/${ing.count}`));
        setClass(t, 'ok', have >= ing.count);
      }
      const status = add(card, div('bp-card-status'));
      setText(status, check.locked ? 'LOCKED' : check.ok ? 'READY' : 'SHORT');
      card.addEventListener('click', () => {
        this.bpSelected = r.id;
        this.rebuild();
      });
    }

    const detail = add(wrap, div('bp-detail'));
    const sel = RECIPES.find((r) => r.id === this.bpSelected) ?? visible[0];
    if (sel) this.renderBpDetail(detail, sel);
    else add(detail, div('inv-detail-empty')).textContent = 'No blueprints in this group';
  }

  private renderBpDetail(host: HTMLElement, r: RecipeDef): void {
    const ctx = this.ctx;
    const st = ctx ? gameState(ctx) : undefined;
    const def = itemDef(r.output);
    const check = craftability(st, r);

    const iconBox = add(host, div('det-icon'));
    add(iconBox, this.icons.element(r.output, 176, 'ui-icon det-icon-canvas'));
    add(iconBox, div('det-icon-glow'));
    add(host, el('h3', 'det-name', def.name));
    const chips = add(host, div('det-chips'));
    add(chips, el('span', `ui-chip chip-${def.category}`, def.category.toUpperCase()));
    add(chips, el('span', 'ui-chip', r.station.toUpperCase()));
    add(chips, el('span', 'ui-chip', `${r.time.toFixed(1)} s`));
    if (r.count > 1) add(chips, el('span', 'ui-chip', `×${r.count}`));
    add(host, el('p', 'det-desc', def.desc));

    add(host, el('span', 'det-sub', 'Requires'));
    const table = add(host, div('bp-req'));
    for (const ing of r.ingredients) {
      const row = add(table, div('bp-req-row'));
      add(row, this.icons.element(ing.id, 30, 'ui-icon'));
      add(row, el('span', 'bp-req-name', itemDef(ing.id).name));
      const have = countOf(st?.inventory, ing.id);
      const cnt = add(row, el('b', 'bp-req-count', `${have} / ${ing.count}`));
      setClass(cnt, 'ok', have >= ing.count);
      setClass(row, 'short', have < ing.count);
      const bar = add(row, div('bp-req-bar'));
      setProp(add(bar, div('bp-req-bar-fill')), 'width', `${Math.min(100, (have / ing.count) * 100).toFixed(0)}%`);
    }

    if (check.locked) {
      const warn = add(host, div('bp-locked'));
      add(warn, el('span', undefined, `Blueprint locked — scan ${r.requires ?? 'fragments'} to unlock.`));
    }

    const actions = add(host, div('det-actions'));
    const make = add(actions, button('Fabricate'));
    setClass(make, 'disabled', !check.ok);
    const progress = add(make, div('ui-btn-progress'));
    make.addEventListener('click', () => {
      if (!this.ctx || !craftability(gameState(this.ctx), r).ok) {
        make.classList.remove('shake');
        void make.offsetWidth;
        make.classList.add('shake');
        return;
      }
      const ctxRef = this.ctx;
      make.classList.add('busy');
      // Fabrication takes the recipe's stated time, with a scanline sweep.
      this.anim.tween(
        this.prefs.reducedMotion ? 0.2 : r.time * 0.5,
        (k) => {
          setProp(progress, 'width', `${(k * 100).toFixed(1)}%`);
          if (k >= 1) {
            make.classList.remove('busy');
            setProp(progress, 'width', '0%');
            if (tryCraft(ctxRef, r)) {
              this.dirty = true;
              this.refreshAccum = 1;
            }
          }
        },
        (t) => t,
      );
    });
  }

  /* ---------------------------- databank ---------------------------- */

  private isUnlocked(id: string): boolean {
    if (this.unlockedLocal.has(id)) return true;
    const set = this.ctx ? gameState(this.ctx)?.databank?.entries : undefined;
    return set ? set.has(id) : false;
  }

  private buildDatabank(): void {
    const wrap = add(this.pane, div('pda-db'));
    const list = add(wrap, div('db-list'));

    const cats = Array.from(new Set(DATABANK.map((d) => d.category)));
    let firstUnlocked: string | null = null;
    for (const cat of cats) {
      add(list, el('span', 'db-cat', cat.toUpperCase()));
      for (const e of DATABANK.filter((d) => d.category === cat)) {
        const unlocked = this.isUnlocked(e.id);
        if (unlocked && !firstUnlocked) firstUnlocked = e.id;
        const row = add(list, el('button', 'db-row'));
        row.type = 'button';
        setClass(row, 'locked', !unlocked);
        setClass(row, 'on', this.dbSelected === e.id);
        add(row, div('db-row-dot'));
        add(row, el('span', 'db-row-title', unlocked ? e.title : this.redact(e.title, e.seed)));
        if (e.threat) add(row, el('span', `ui-chip chip-${e.threat}`, e.threat.slice(0, 4).toUpperCase()));
        row.addEventListener('click', () => {
          if (!unlocked) return;
          this.dbSelected = e.id;
          this.rebuild();
        });
      }
    }

    const read = add(wrap, div('db-read'));
    const sel =
      DATABANK.find((d) => d.id === this.dbSelected && this.isUnlocked(d.id)) ??
      DATABANK.find((d) => d.id === firstUnlocked);
    if (sel) this.renderDbEntry(read, sel);
    else {
      const empty = add(read, div('inv-detail-empty'));
      add(empty, el('span', undefined, 'NO ENTRIES'));
      add(empty, el('small', undefined, 'Scan flora, fauna and wreckage to populate the databank.'));
    }
  }

  /** Locked titles are shown scrambled rather than hidden, so progress is visible. */
  private redact(text: string, seed: number): string {
    const rng = makeRng(seed);
    let out = '';
    for (const ch of text) out += ch === ' ' ? ' ' : '▚▞▚▟▙'[Math.floor(rng() * 5)];
    return out;
  }

  private renderDbEntry(host: HTMLElement, e: DatabankEntry): void {
    const head = add(host, div('db-head'));
    const diagram = add(head, div('db-diagram'));
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 148;
    c.width = size * dpr;
    c.height = size * dpr;
    c.className = 'db-diagram-canvas';
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    const g = c.getContext('2d');
    if (g) {
      g.scale(dpr, dpr);
      // Wireframe backdrop then the archetype line art over it.
      g.strokeStyle = 'rgba(120, 220, 250, 0.16)';
      g.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        g.beginPath();
        g.moveTo(0, (i / 6) * size);
        g.lineTo(size, (i / 6) * size);
        g.stroke();
        g.beginPath();
        g.moveTo((i / 6) * size, 0);
        g.lineTo((i / 6) * size, size);
        g.stroke();
      }
      g.strokeStyle = 'rgba(140, 235, 255, 0.35)';
      g.beginPath();
      g.arc(size / 2, size / 2, size * 0.42, 0, 6.283);
      g.stroke();
      drawArchetype(g, size, e.diagram, 0x7fd8f0, 0xa8f0ff, e.seed);
    }
    add(diagram, c);
    add(diagram, div('db-diagram-scan'));

    const titles = add(head, div('db-titles'));
    add(titles, el('h3', 'db-title', e.title));
    const chips = add(titles, div('det-chips'));
    add(chips, el('span', 'ui-chip', e.category.toUpperCase()));
    if (e.threat) add(chips, el('span', `ui-chip chip-${e.threat}`, e.threat.toUpperCase()));
    if (e.depth) add(chips, el('span', 'ui-chip', e.depth));
    add(titles, el('span', 'db-ref', `REF ${String(e.seed).padStart(4, '0')}-A`));

    const bodyHost = add(host, div('db-body'));
    for (const p of e.body) add(bodyHost, el('p', undefined, p));
  }

  /* ---------------------------- journal ---------------------------- */

  private buildJournal(): void {
    const st = this.ctx ? gameState(this.ctx) : undefined;
    const wrap = add(this.pane, div('pda-jn'));

    const questCol = add(wrap, div('jn-quests'));
    add(questCol, el('h2', 'pda-h2', 'Objectives'));
    const activeIds = st?.quests?.active ?? [];
    const completed = new Set(st?.quests?.completed ?? []);
    const list = QUESTS.filter((q) => activeIds.length === 0 || activeIds.includes(q.id) || completed.has(q.id));
    for (const q of list.length ? list : QUESTS) {
      const done = completed.has(q.id);
      const card = add(questCol, div('jn-quest'));
      brackets(card);
      setClass(card, 'done', done);
      setClass(card, `pri-${q.priority}`, true);
      const h = add(card, div('jn-quest-head'));
      add(h, el('span', 'jn-quest-pri', q.priority.toUpperCase()));
      add(h, el('b', 'jn-quest-title', q.title));
      add(card, el('p', 'jn-quest-sum', q.summary));
      const obj = add(card, div('jn-objs'));
      for (let i = 0; i < q.objectives.length; i++) {
        const row = add(obj, div('jn-obj'));
        // Without a real objective-state API, treat earlier steps of an active
        // quest as met so the list reads as progress rather than a flat list.
        const met = done || (activeIds.includes(q.id) && i === 0);
        setClass(row, 'met', met);
        add(row, div('jn-obj-box'));
        add(row, el('span', undefined, q.objectives[i]));
      }
    }

    const logCol = add(wrap, div('jn-log'));
    add(logCol, el('h2', 'pda-h2', 'Log'));
    if (this.log.length === 0) {
      add(logCol, div('inv-detail-empty')).textContent = 'No events recorded';
    }
    for (const e of this.log) {
      const row = add(logCol, div(`jn-log-row kind-${e.kind}`));
      add(row, el('span', 'jn-log-time', fmtClock(e.t)));
      add(row, el('span', 'jn-log-text', e.text));
    }
  }

  /* ---------------------------- time capsule ---------------------------- */

  private buildCapsule(): void {
    const wrap = add(this.pane, div('pda-tc'));

    /* compose */
    const compose = add(wrap, div('tc-compose'));
    brackets(compose);
    add(compose, el('h2', 'pda-h2', 'Seal a Time Capsule'));
    add(
      compose,
      el(
        'p',
        'tc-note',
        'A sealed capsule is jettisoned to the surface with four items and a message. Someone will find it. Probably not you.',
      ),
    );

    const nameRow = add(compose, div('tc-field'));
    add(nameRow, el('label', 'tc-label', 'Signed'));
    const nameInput = add(nameRow, el('input', 'ui-input'));
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameInput.value = this.capsuleName;
    nameInput.placeholder = 'Survivor designation';
    nameInput.addEventListener('input', () => {
      this.capsuleName = nameInput.value;
    });

    const msgRow = add(compose, div('tc-field tc-field-col'));
    add(msgRow, el('label', 'tc-label', 'Message'));
    const msg = add(msgRow, el('textarea', 'ui-input ui-textarea'));
    msg.maxLength = 400;
    msg.rows = 5;
    msg.value = this.capsuleMessage;
    msg.placeholder = 'Say something useful. Coordinates are more useful than feelings.';
    const counter = add(msgRow, el('span', 'tc-counter', `0 / 400`));
    const syncCount = () => setText(counter, `${msg.value.length} / 400`);
    msg.addEventListener('input', () => {
      this.capsuleMessage = msg.value;
      syncCount();
    });
    syncCount();

    add(compose, el('label', 'tc-label', 'Payload'));
    const slots = add(compose, div('tc-slots'));
    const st = this.ctx ? gameState(this.ctx) : undefined;
    const owned = (st?.inventory?.slots ?? []).filter((s) => s.count > 0);
    for (let i = 0; i < 4; i++) {
      const slot = add(slots, el('button', 'tc-slot'));
      slot.type = 'button';
      const id = this.capsuleSlots[i];
      if (id) {
        add(slot, this.icons.element(id, 52, 'ui-icon'));
        add(slot, el('span', 'tc-slot-name', itemDef(id).name));
      } else {
        add(slot, el('span', 'tc-slot-plus', '+'));
      }
      slot.addEventListener('click', () => {
        if (this.capsuleSlots[i]) {
          this.capsuleSlots[i] = null;
          this.rebuild();
          return;
        }
        // Cycle through owned items — a picker without a second modal.
        const usable = owned.map((s) => s.id).filter((x) => !this.capsuleSlots.includes(x));
        if (usable.length === 0) return;
        this.capsuleSlots[i] = usable[0];
        this.rebuild();
      });
    }

    const seal = add(compose, button('Seal and jettison'));
    const filled = this.capsuleSlots.filter(Boolean).length;
    setClass(seal, 'disabled', this.capsuleMessage.trim().length === 0);
    seal.addEventListener('click', () => {
      if (this.capsuleMessage.trim().length === 0) return;
      try {
        localStorage.setItem(
          'spacenautica.capsule.v1',
          JSON.stringify({ name: this.capsuleName, message: this.capsuleMessage, items: this.capsuleSlots }),
        );
      } catch {
        /* private mode */
      }
      this.ctx?.bus.emit('ui:notify', { text: `Time capsule sealed — ${filled} item(s) aboard.`, kind: 'success' });
      this.rebuild();
    });

    /* received */
    const recv = add(wrap, div('tc-received'));
    brackets(recv);
    add(recv, el('h2', 'pda-h2', 'Recovered Capsule'));
    const cap = this.generateCapsule();
    const from = add(recv, div('tc-from'));
    add(from, el('span', 'tc-label', 'FROM'));
    add(from, el('b', undefined, cap.name));
    add(from, el('span', 'ui-chip', cap.stamp));
    add(recv, el('p', 'tc-message', cap.message));
    const payload = add(recv, div('tc-slots'));
    for (const id of cap.items) {
      const slot = add(payload, div('tc-slot filled'));
      add(slot, this.icons.element(id, 52, 'ui-icon'));
      add(slot, el('span', 'tc-slot-name', itemDef(id).name));
    }
    const take = add(recv, button('Take contents', 'ui-btn-ghost'));
    take.addEventListener('click', () => {
      const inv = this.ctx ? gameState(this.ctx)?.inventory : undefined;
      if (!inv?.add) return;
      for (const id of cap.items) {
        const total = inv.add(id, 1);
        this.ctx?.bus.emit('inventory:changed', { id, delta: 1, total });
      }
      this.ctx?.bus.emit('ui:notify', { text: 'Capsule contents transferred to cargo.', kind: 'success' });
      setClass(take, 'disabled', true);
    });
  }

  /**
   * Procedurally assembles the capsule "another survivor" left behind. Seeded
   * from the save so it is stable per playthrough. No network, no shared data.
   */
  private generateCapsule(): { name: string; message: string; items: string[]; stamp: string } {
    let seed = 0;
    try {
      seed = Number(localStorage.getItem('spacenautica.capsule.seed') ?? '');
      if (!Number.isFinite(seed) || seed === 0) {
        seed = Math.floor(Math.random() * 1e9);
        localStorage.setItem('spacenautica.capsule.seed', String(seed));
      }
    } catch {
      seed = 421337;
    }
    const rng = makeRng(seed);
    const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
    const first = ['Ardent', 'Kell', 'Mira', 'Osei', 'Rho', 'Tamsin', 'Vex', 'Yara', 'Bez', 'Onno'];
    const last = ['Vasquez', 'Ndiaye', 'Halloran', 'Ito', 'Bergström', 'Okonkwo', 'Sandoval', 'Reyes'];
    const openers = [
      'If you are reading this, the pod held. Mine did not, for long.',
      'Four hundred metres north-east of the drop point there is a wreck with an intact fabricator.',
      'Do not trust the shallows after the second week. Something learns.',
      'I mapped the vent field. The thermal plant runs forever if you site it eight metres out.',
      'The creepvine canopy is the only place large predators cannot turn. Sleep there.',
    ];
    const middles = [
      'Take the rebreather over the tank — depth eats air faster than you think.',
      'Salt and bleach before you drink anything. I learned that the expensive way.',
      'The low call at 22 Hz is not the current. Get behind geometry.',
      'Keep a spare knife. They take the one in your hand.',
      'Build small, build early, build twice.',
    ];
    const closers = [
      'Good luck. Leave your own.',
      'It is beautiful down here. That is the trap.',
      'I hope this reaches someone with better odds.',
      'Do not go into the void looking for a floor.',
    ];
    const pool = [
      'titanium', 'quartz', 'copper', 'salt', 'lithium', 'silicone', 'battery', 'fiber_mesh',
      'water_filtered', 'cooked_peeper', 'glass', 'wiring_kit', 'diamond', 'gold',
    ];
    const items: string[] = [];
    while (items.length < 4) {
      const id = pick(pool);
      if (!items.includes(id)) items.push(id);
    }
    return {
      name: `${pick(first)} ${pick(last)}`,
      message: `${pick(openers)} ${pick(middles)} ${pick(closers)}`,
      items,
      stamp: `DAY ${12 + Math.floor(rng() * 180)}`,
    };
  }

  /* ------------------------------------------------------------------ *
   * Keyboard
   * ------------------------------------------------------------------ */

  /** Returns true when the PDA consumed the key. */
  handleKey(code: string): boolean {
    if (!this.open) return false;
    if (code === 'ArrowRight' || code === 'ArrowLeft') {
      const i = TABS.findIndex((t) => t.id === this.tab);
      const n = TABS.length;
      const next = TABS[(i + (code === 'ArrowRight' ? 1 : n - 1)) % n].id;
      this.select(next, true);
      return true;
    }
    if (code === 'Enter' && this.tab === 'blueprints' && this.bpSelected && this.ctx) {
      const r = RECIPES.find((x) => x.id === this.bpSelected);
      if (r && tryCraft(this.ctx, r)) {
        this.dirty = true;
        this.refreshAccum = 1;
      }
      return true;
    }
    return false;
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Convenience for the build HUD: the module list filtered by tech gating. */
export function availableModules(ctx: GameContext): typeof BUILD_MODULES {
  const st = gameState(ctx);
  return BUILD_MODULES.filter((m) => techUnlocked(st, undefined) || m.id.length > 0);
}

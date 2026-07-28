/**
 * Two machine-flavoured interfaces:
 *
 *  - The **fabricator**: opened by `ui:screen { screen: 'fabricator' }`. A
 *    hardware panel with a category rail, a recipe grid and a real fabrication
 *    cycle (progress + scanline sweep) rather than an instant grant.
 *
 *  - The **habitat builder HUD**: a bottom module palette with hotkeys, live
 *    cost availability, and continuous placement validity computed from the
 *    world query (floor slope, depth, clearance) with an explicit reason list.
 *    If `game.build` exposes `canPlace`/`placeError`/`requestPlace`, those win.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/Types';
import {
  Anim,
  add,
  brackets,
  button,
  clear,
  div,
  el,
  keycap,
  setClass,
  setProp,
  setText,
} from './UiKit';
import type { UiPrefs } from './UiKit';
import { BUILD_MODULES, RECIPES, itemDef } from './ItemDatabase';
import type { BuildModuleDef, RecipeDef } from './ItemDatabase';
import type { IconFactory } from './IconFactory';
import { buildSystem, countOf, craftability, gameState, tryCraft } from './GameStateBridge';

/* Module-scope scratch — nothing in update() allocates. */
const _fwd = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _tmp = new THREE.Vector3();

interface Validity {
  ok: boolean;
  reasons: string[];
  slope: number;
  depth: number;
}

export class CraftBuildLayer {
  readonly root: HTMLDivElement;
  buildMode = false;
  fabricatorOpen = false;

  private anim: Anim;
  private prefs: UiPrefs;
  private icons: IconFactory;

  /* fabricator */
  private fab: HTMLElement;
  private fabList: HTMLElement;
  private fabDetail: HTMLElement;
  private fabGroup = 'Basic materials';
  private fabSelected: string | null = null;
  private fabBusy = 0;
  private fabTotal = 0;
  private fabProgress: HTMLElement;
  private fabStatus: HTMLElement;

  /* builder */
  private bld: HTMLElement;
  private bldPalette: HTMLElement;
  private bldGroup: BuildModuleDef['group'] = 'structure';
  private bldSelected = 'foundation';
  private bldName: HTMLElement;
  private bldDesc: HTMLElement;
  private bldCost: HTMLElement;
  private bldStatus: HTMLElement;
  private bldReasons: HTMLElement;
  private bldBracket: HTMLElement;
  private bldMeter: { slope: HTMLElement; depth: HTMLElement };
  private lastValid = true;
  private paletteDirty = true;

  constructor(host: HTMLElement, anim: Anim, prefs: UiPrefs, icons: IconFactory) {
    this.anim = anim;
    this.prefs = prefs;
    this.icons = icons;

    const root = div('cbl');
    this.root = root;

    /* ---------------- fabricator ---------------- */
    this.fab = add(root, div('fab'));
    add(this.fab, div('fab-scrim'));
    const frame = add(this.fab, div('fab-frame'));
    brackets(frame);
    add(frame, div('fab-crt'));

    const head = add(frame, div('fab-head'));
    const badge = add(head, div('fab-badge'));
    add(badge, el('b', undefined, 'FABRICATOR'));
    add(badge, el('span', undefined, 'MK-III · MOLECULAR ASSEMBLY'));
    this.fabStatus = add(head, el('span', 'fab-status', 'IDLE'));
    const close = add(head, button('Close', 'fab-close ui-btn-ghost'));
    close.addEventListener('click', () => this.closeFabricator());

    const bar = add(frame, div('fab-progress-track'));
    this.fabProgress = add(bar, div('fab-progress'));

    const body = add(frame, div('fab-body'));
    const rail = add(body, div('fab-rail'));
    for (const g of Array.from(new Set(RECIPES.map((r) => r.group)))) {
      const b = add(rail, el('button', 'fab-group'));
      b.type = 'button';
      setText(b, g);
      setClass(b, 'on', g === this.fabGroup);
      b.addEventListener('click', () => {
        this.fabGroup = g;
        this.renderFab();
      });
    }
    this.fabList = add(body, div('fab-list'));
    this.fabDetail = add(body, div('fab-detail'));

    /* ---------------- builder HUD ---------------- */
    this.bld = add(root, div('bld'));

    this.bldBracket = add(this.bld, div('bld-bracket'));
    for (const c of ['tl', 'tr', 'bl', 'br']) add(this.bldBracket, div(`bld-bracket-corner ${c}`));
    add(this.bldBracket, div('bld-bracket-cross'));

    const info = add(this.bld, div('bld-info'));
    brackets(info);
    this.bldStatus = add(info, el('span', 'bld-status', 'PLACEMENT VALID'));
    this.bldName = add(info, el('b', 'bld-name', 'Foundation'));
    this.bldDesc = add(info, el('span', 'bld-desc', ''));
    this.bldCost = add(info, div('bld-cost'));
    this.bldReasons = add(info, div('bld-reasons'));
    const meters = add(info, div('bld-meters'));
    this.bldMeter = {
      slope: this.meter(meters, 'FLOOR SLOPE'),
      depth: this.meter(meters, 'DEPTH'),
    };

    const bottom = add(this.bld, div('bld-bottom'));
    const groups = add(bottom, div('bld-groups'));
    for (const g of ['structure', 'exterior', 'interior', 'power', 'utility'] as BuildModuleDef['group'][]) {
      const b = add(groups, el('button', 'bld-group'));
      b.type = 'button';
      setText(b, g.toUpperCase());
      setClass(b, 'on', g === this.bldGroup);
      b.addEventListener('click', () => {
        this.bldGroup = g;
        this.paletteDirty = true;
      });
    }
    this.bldPalette = add(bottom, div('bld-palette'));
    const hints = add(bottom, div('bld-hints'));
    for (const [k, label] of [
      ['1-9', 'Select module'],
      ['R', 'Rotate'],
      ['LMB', 'Place'],
      ['B', 'Exit builder'],
    ] as Array<[string, string]>) {
      const row = add(hints, div('bld-hint'));
      add(row, keycap(k));
      add(row, el('span', undefined, label));
    }

    host.appendChild(root);
  }

  private meter(host: HTMLElement, label: string): HTMLElement {
    const m = add(host, div('bld-meter'));
    add(m, el('span', 'bld-meter-label', label));
    const track = add(m, div('bld-meter-track'));
    const fill = add(track, div('bld-meter-fill'));
    add(m, el('b', 'bld-meter-value', '0'));
    return fill;
  }

  setPrefs(p: UiPrefs): void {
    this.prefs = p;
  }

  /* ------------------------------------------------------------------ *
   * Fabricator
   * ------------------------------------------------------------------ */

  openFabricator(ctx: GameContext): void {
    this.fabricatorOpen = true;
    setClass(this.fab, 'on', true);
    this.ctxRef = ctx;
    this.renderFab();
    if (!this.prefs.reducedMotion) {
      this.anim.tween(0.28, (k) => setProp(this.fab, '--fab-in', k.toFixed(3)));
    } else setProp(this.fab, '--fab-in', '1');
  }

  closeFabricator(): void {
    this.fabricatorOpen = false;
    setClass(this.fab, 'on', false);
  }

  private ctxRef: GameContext | null = null;

  private renderFab(): void {
    const ctx = this.ctxRef;
    const st = ctx ? gameState(ctx) : undefined;
    clear(this.fabList);
    const visible = RECIPES.filter((r) => r.group === this.fabGroup);
    for (const r of visible) {
      const def = itemDef(r.output);
      const check = craftability(st, r);
      const cell = add(this.fabList, el('button', 'fab-cell'));
      cell.type = 'button';
      setClass(cell, 'ready', check.ok);
      setClass(cell, 'locked', check.locked);
      setClass(cell, 'on', this.fabSelected === r.id);
      add(cell, this.icons.element(r.output, 56, 'ui-icon'));
      add(cell, el('span', 'fab-cell-name', def.name));
      add(cell, div('fab-cell-glow'));
      cell.addEventListener('click', () => {
        this.fabSelected = r.id;
        this.renderFab();
      });
    }
    const sel = RECIPES.find((r) => r.id === this.fabSelected) ?? visible[0];
    clear(this.fabDetail);
    if (sel) this.renderFabDetail(sel);
  }

  private renderFabDetail(r: RecipeDef): void {
    const ctx = this.ctxRef;
    const st = ctx ? gameState(ctx) : undefined;
    const def = itemDef(r.output);
    const host = this.fabDetail;

    const iconBox = add(host, div('fab-preview'));
    add(iconBox, this.icons.element(r.output, 132, 'ui-icon'));
    add(iconBox, div('fab-preview-ring'));
    add(host, el('h3', 'det-name', def.name));
    add(host, el('p', 'det-desc', def.desc));
    const list = add(host, div('fab-req'));
    for (const ing of r.ingredients) {
      const row = add(list, div('fab-req-row'));
      add(row, this.icons.element(ing.id, 26, 'ui-icon'));
      add(row, el('span', undefined, itemDef(ing.id).name));
      const have = countOf(st?.inventory, ing.id);
      const b = add(row, el('b', undefined, `${have}/${ing.count}`));
      setClass(b, 'ok', have >= ing.count);
    }
    const check = craftability(st, r);
    const go = add(host, button(`Assemble · ${r.time.toFixed(1)} s`));
    setClass(go, 'disabled', !check.ok || this.fabBusy > 0);
    go.addEventListener('click', () => this.startFab(r));
  }

  private startFab(r: RecipeDef): void {
    const ctx = this.ctxRef;
    if (!ctx || this.fabBusy > 0) return;
    if (!craftability(gameState(ctx), r).ok) return;
    this.fabTotal = this.prefs.reducedMotion ? 0.3 : r.time;
    this.fabBusy = this.fabTotal;
    this.pendingRecipe = r;
    setText(this.fabStatus, 'ASSEMBLING');
    setClass(this.fab, 'busy', true);
  }

  private pendingRecipe: RecipeDef | null = null;

  /* ------------------------------------------------------------------ *
   * Builder
   * ------------------------------------------------------------------ */

  toggleBuild(ctx: GameContext): void {
    this.buildMode = !this.buildMode;
    setClass(this.bld, 'on', this.buildMode);
    this.paletteDirty = true;
    if (this.buildMode) {
      buildSystem(ctx)?.select?.(this.bldSelected);
      ctx.bus.emit('ui:notify', { text: 'Habitat builder online. Select a module.', kind: 'info', ttl: 3 });
    } else {
      buildSystem(ctx)?.cancel?.();
    }
  }

  private renderPalette(ctx: GameContext): void {
    this.paletteDirty = false;
    const st = gameState(ctx);
    clear(this.bldPalette);
    const list = BUILD_MODULES.filter((m) => m.group === this.bldGroup);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const affordable = m.cost.every((c) => countOf(st?.inventory, c.id) >= c.count);
      const cell = add(this.bldPalette, el('button', 'bld-cell'));
      cell.type = 'button';
      setClass(cell, 'on', m.id === this.bldSelected);
      setClass(cell, 'poor', !affordable);
      add(cell, this.icons.element(`mod_${m.id}`, 44, 'ui-icon'));
      add(cell, el('span', 'bld-cell-name', m.name));
      if (i < 9) add(cell, el('span', 'bld-cell-key', String(i + 1)));
      cell.addEventListener('click', () => {
        this.bldSelected = m.id;
        this.paletteDirty = true;
        buildSystem(ctx)?.select?.(m.id);
      });
    }
  }

  /** Selects the nth module of the visible group (1-based). */
  selectHotbar(n: number, ctx: GameContext): boolean {
    if (!this.buildMode) return false;
    const list = BUILD_MODULES.filter((m) => m.group === this.bldGroup);
    const m = list[n - 1];
    if (!m) return false;
    this.bldSelected = m.id;
    this.paletteDirty = true;
    buildSystem(ctx)?.select?.(m.id);
    return true;
  }

  private module(): BuildModuleDef {
    return BUILD_MODULES.find((m) => m.id === this.bldSelected) ?? BUILD_MODULES[0];
  }

  /**
   * Placement validity. Prefers the build system's own verdict; otherwise
   * derives one from the world query so the feedback is real, not decorative.
   */
  private validate(ctx: GameContext, m: BuildModuleDef): Validity {
    const reasons: string[] = [];
    const bs = buildSystem(ctx);
    const cam = ctx.camera;
    cam.getWorldDirection(_fwd);

    // March along the view ray until we cross into solid ground, max 14 m.
    let dist = 14;
    for (let d = 1.5; d <= 14; d += 0.7) {
      _tmp.copy(cam.position).addScaledVector(_fwd, d);
      if (_tmp.y <= ctx.world.heightAt(_tmp.x, _tmp.z)) {
        dist = d;
        break;
      }
    }
    _aim.copy(cam.position).addScaledVector(_fwd, dist);
    const floor = ctx.world.heightAt(_aim.x, _aim.z);
    ctx.world.normalAt(_aim.x, _aim.z, _nrm);
    const slope = (Math.acos(Math.min(1, Math.max(-1, _nrm.y))) * 180) / Math.PI;
    const depth = Math.max(0, -floor);

    if (slope > m.maxSlope) reasons.push(`Floor too steep — ${slope.toFixed(0)}° of ${m.maxSlope}°`);
    if (dist >= 13.9) reasons.push('No surface in range');
    if (m.needsHost) reasons.push('Must attach to an existing structure');

    const st = gameState(ctx);
    for (const c of m.cost) {
      const have = countOf(st?.inventory, c.id);
      if (have < c.count) reasons.push(`Short ${c.count - have} × ${itemDef(c.id).name}`);
    }
    if (depth > 900) reasons.push('Beyond hull crush depth');

    if (bs?.placeError) {
      const e = bs.placeError(m.id);
      if (e) reasons.push(e);
    }
    let ok = reasons.length === 0;
    if (bs?.canPlace) ok = bs.canPlace(m.id) && reasons.length === 0;
    return { ok, reasons, slope, depth };
  }

  private place(ctx: GameContext, m: BuildModuleDef): void {
    const bs = buildSystem(ctx);
    const pos: [number, number, number] = [_aim.x, ctx.world.heightAt(_aim.x, _aim.z), _aim.z];
    const handled = bs?.requestPlace?.(m.id, pos) ?? false;
    if (!handled) {
      // No build system yet — announce the intent so the world agent can adopt it.
      ctx.bus.emit('build:placed', { id: m.id, position: pos });
    }
    // Consume the cost through the inventory so the HUD stays truthful.
    const inv = gameState(ctx)?.inventory;
    if (inv?.remove) for (const c of m.cost) inv.remove(c.id, c.count);
    ctx.bus.emit('ui:notify', { text: `${m.name} placed.`, kind: 'success', ttl: 2.6 });
    this.paletteDirty = true;
    if (!this.prefs.reducedMotion) {
      this.anim.tween(0.4, (k) => setProp(this.bldBracket, '--flash', (1 - k).toFixed(3)));
    }
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */

  update(dt: number, ctx: GameContext): void {
    this.ctxRef = ctx;

    /* fabricator cycle */
    if (this.fabBusy > 0) {
      this.fabBusy -= dt;
      const k = 1 - Math.max(0, this.fabBusy) / Math.max(0.001, this.fabTotal);
      setProp(this.fabProgress, 'width', `${(k * 100).toFixed(1)}%`);
      if (this.fabBusy <= 0) {
        this.fabBusy = 0;
        setProp(this.fabProgress, 'width', '0%');
        setClass(this.fab, 'busy', false);
        setText(this.fabStatus, 'IDLE');
        const r = this.pendingRecipe;
        this.pendingRecipe = null;
        if (r && tryCraft(ctx, r)) {
          ctx.bus.emit('ui:notify', { text: `${itemDef(r.output).name} fabricated.`, kind: 'success', ttl: 3 });
        }
        if (this.fabricatorOpen) this.renderFab();
      }
    }

    /* builder */
    if (!this.buildMode) return;
    if (this.paletteDirty) this.renderPalette(ctx);
    const m = this.module();
    setText(this.bldName, m.name);
    setText(this.bldDesc, m.desc);

    const v = this.validate(ctx, m);
    setText(this.bldStatus, v.ok ? 'PLACEMENT VALID' : 'PLACEMENT BLOCKED');
    setClass(this.bld, 'invalid', !v.ok);
    setClass(this.bldBracket, 'invalid', !v.ok);
    if (v.ok !== this.lastValid) {
      this.lastValid = v.ok;
      if (!this.prefs.reducedMotion) {
        this.anim.tween(0.24, (k) => setProp(this.bldBracket, '--pop', (1 + (1 - k) * 0.14).toFixed(3)));
      }
    }

    // Reasons list — rebuilt only when the text actually changes.
    const sig = v.reasons.join('|');
    if (sig !== this.reasonSig) {
      this.reasonSig = sig;
      clear(this.bldReasons);
      for (const r of v.reasons) {
        const row = add(this.bldReasons, div('bld-reason'));
        add(row, div('bld-reason-mark'));
        add(row, el('span', undefined, r));
      }
    }

    // Costs
    const costSig = `${m.id}:${m.cost.map((c) => countOf(gameState(ctx)?.inventory, c.id)).join(',')}`;
    if (costSig !== this.costSig) {
      this.costSig = costSig;
      clear(this.bldCost);
      for (const c of m.cost) {
        const chip = add(this.bldCost, div('bld-cost-chip'));
        add(chip, this.icons.element(c.id, 20, 'ui-icon'));
        const have = countOf(gameState(ctx)?.inventory, c.id);
        const b = add(chip, el('b', undefined, `${have}/${c.count}`));
        setClass(chip, 'short', have < c.count);
        void b;
      }
    }

    setProp(this.bldMeter.slope, 'width', `${Math.min(100, (v.slope / 45) * 100).toFixed(0)}%`);
    setClass(this.bldMeter.slope, 'bad', v.slope > m.maxSlope);
    const slopeValue = this.bldMeter.slope.parentElement?.nextElementSibling;
    if (slopeValue) setText(slopeValue, `${v.slope.toFixed(0)}°`);
    setProp(this.bldMeter.depth, 'width', `${Math.min(100, (v.depth / 400) * 100).toFixed(0)}%`);
    const depthValue = this.bldMeter.depth.parentElement?.nextElementSibling;
    if (depthValue) setText(depthValue, `${v.depth.toFixed(0)} m`);

    if (ctx.input.pressed('primary') && v.ok) this.place(ctx, m);
  }

  private reasonSig = '';
  private costSig = '';

  /** Returns true when the layer consumed the key. */
  handleKey(code: string, ctx: GameContext): boolean {
    if (this.fabricatorOpen && code === 'Escape') {
      this.closeFabricator();
      return true;
    }
    if (this.buildMode && code === 'Escape') {
      this.toggleBuild(ctx);
      return true;
    }
    return false;
  }

  dispose(): void {
    this.root.remove();
  }
}

/**
 * INVENTORY — Subnautica-style 2D grid containers.
 *
 * Items occupy a WxH rectangle of cells, not a slot in a flat list, so a
 * high-capacity tank (2x3) genuinely costs you six cells of pack space and
 * repacking is a real decision. Everything here is renderer-free and
 * serialisable so the HUD can draw it and the save system can persist it.
 */

import type { EquipSlot, ItemDef } from './Items';
import { itemDefOr } from './Items';

/** Legacy flat view, kept because early UI code was written against it. */
export interface ItemStack {
  id: string;
  count: number;
}

export interface PlacedItem {
  /** Unique within a session; stable across a save round-trip. */
  uid: number;
  id: string;
  count: number;
  /** Top-left cell. */
  x: number;
  y: number;
  /** Footprint, copied from the def at placement time. */
  w: number;
  h: number;
  /** Seconds this stack has existed, for perishables. */
  age: number;
  /** Remaining charge for tools, or -1 when the item is unpowered. */
  charge: number;
}

export interface Ingredient {
  id: string;
  count: number;
}

export interface SerialisedContainer {
  id: string;
  label: string;
  width: number;
  height: number;
  items: PlacedItem[];
  quickSlots?: (number | null)[];
  equipped?: Array<[EquipSlot, number]>;
}

let nextUid = 1;

export type ItemChangeFn = (id: string, delta: number, total: number) => void;

/* ------------------------------------------------------------------ *
 * Container
 * ------------------------------------------------------------------ */

export class Container {
  readonly id: string;
  label: string;
  width: number;
  height: number;
  readonly items: PlacedItem[] = [];

  /** Cell -> uid (0 = empty). Row-major, length width*height. */
  private grid: Int32Array;
  /** Fired once per net change of an item id. Wired to the event bus by GameState. */
  onItemChanged: ItemChangeFn | null = null;
  /** Fired after any structural change (placement, move, transfer). */
  onLayoutChanged: (() => void) | null = null;

  constructor(id: string, label: string, width: number, height: number) {
    this.id = id;
    this.label = label;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.grid = new Int32Array(this.width * this.height);
  }

  /* ---------------- geometry ---------------- */

  get cellCount(): number {
    return this.width * this.height;
  }

  get usedCells(): number {
    let n = 0;
    for (const it of this.items) n += it.w * it.h;
    return n;
  }

  get freeCells(): number {
    return this.cellCount - this.usedCells;
  }

  /** Total carried mass in kg. */
  get mass(): number {
    let m = 0;
    for (const it of this.items) m += itemDefOr(it.id).mass * it.count;
    return m;
  }

  /** Grow the grid (storage upgrade modules). Existing layout is preserved. */
  resize(width: number, height: number): void {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (w === this.width && h === this.height) return;
    const kept = this.items.filter((it) => it.x + it.w <= w && it.y + it.h <= h);
    const evicted = this.items.filter((it) => kept.indexOf(it) < 0);
    this.width = w;
    this.height = h;
    this.grid = new Int32Array(w * h);
    this.items.length = 0;
    for (const it of kept) {
      this.items.push(it);
      this.stamp(it, it.uid);
    }
    // Re-home anything that fell outside the new bounds.
    for (const it of evicted) {
      const spot = this.findFree(it.w, it.h);
      if (!spot) continue;
      it.x = spot.x;
      it.y = spot.y;
      this.items.push(it);
      this.stamp(it, it.uid);
    }
    this.onLayoutChanged?.();
  }

  private stamp(it: PlacedItem, uid: number): void {
    for (let dy = 0; dy < it.h; dy++) {
      const row = (it.y + dy) * this.width;
      for (let dx = 0; dx < it.w; dx++) this.grid[row + it.x + dx] = uid;
    }
  }

  /** uid occupying a cell, or 0. */
  uidAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.grid[y * this.width + x];
  }

  itemAt(x: number, y: number): PlacedItem | null {
    const uid = this.uidAt(x, y);
    return uid ? this.byUid(uid) : null;
  }

  byUid(uid: number): PlacedItem | null {
    for (const it of this.items) if (it.uid === uid) return it;
    return null;
  }

  /** True when a WxH rectangle at (x,y) is inside bounds and unoccupied. */
  fits(w: number, h: number, x: number, y: number, ignoreUid = 0): boolean {
    if (x < 0 || y < 0 || x + w > this.width || y + h > this.height) return false;
    for (let dy = 0; dy < h; dy++) {
      const row = (y + dy) * this.width;
      for (let dx = 0; dx < w; dx++) {
        const uid = this.grid[row + x + dx];
        if (uid !== 0 && uid !== ignoreUid) return false;
      }
    }
    return true;
  }

  /** First free spot, scanning top-left to bottom-right. */
  findFree(w: number, h: number, ignoreUid = 0): { x: number; y: number } | null {
    for (let y = 0; y + h <= this.height; y++) {
      for (let x = 0; x + w <= this.width; x++) {
        if (this.fits(w, h, x, y, ignoreUid)) return { x, y };
      }
    }
    return null;
  }

  /* ---------------- mutation ---------------- */

  /**
   * Adds up to `count` units, filling partial stacks first and then placing new
   * groups wherever they fit. Returns how many were actually accepted, so the
   * caller can leave the remainder in the world.
   */
  add(id: string, count = 1): number {
    if (count <= 0) return 0;
    const def = itemDefOr(id);
    let remaining = count;

    if (def.stack > 1) {
      for (const it of this.items) {
        if (it.id !== id || it.count >= def.stack) continue;
        const take = Math.min(def.stack - it.count, remaining);
        it.count += take;
        remaining -= take;
        if (remaining <= 0) break;
      }
    }

    while (remaining > 0) {
      const spot = this.findFree(def.w, def.h);
      if (!spot) break;
      const take = Math.min(def.stack, remaining);
      const it: PlacedItem = {
        uid: nextUid++,
        id,
        count: take,
        x: spot.x,
        y: spot.y,
        w: def.w,
        h: def.h,
        age: 0,
        charge: def.charge ?? -1,
      };
      this.items.push(it);
      this.stamp(it, it.uid);
      remaining -= take;
    }

    const accepted = count - remaining;
    if (accepted > 0) {
      this.onItemChanged?.(id, accepted, this.countOf(id));
      this.onLayoutChanged?.();
    }
    return accepted;
  }

  /** Places an explicit stack at a cell. Returns null when it does not fit. */
  place(id: string, count: number, x: number, y: number): PlacedItem | null {
    const def = itemDefOr(id);
    if (!this.fits(def.w, def.h, x, y)) return null;
    const it: PlacedItem = {
      uid: nextUid++, id, count, x, y, w: def.w, h: def.h, age: 0, charge: def.charge ?? -1,
    };
    this.items.push(it);
    this.stamp(it, it.uid);
    this.onItemChanged?.(id, count, this.countOf(id));
    this.onLayoutChanged?.();
    return it;
  }

  /** Removes `count` from a specific stack. Returns how many came out. */
  removeUid(uid: number, count = Infinity): number {
    const it = this.byUid(uid);
    if (!it) return 0;
    const take = Math.min(it.count, count);
    it.count -= take;
    if (it.count <= 0) {
      this.stamp(it, 0);
      this.items.splice(this.items.indexOf(it), 1);
    }
    if (take > 0) {
      this.onItemChanged?.(it.id, -take, this.countOf(it.id));
      this.onLayoutChanged?.();
    }
    return take;
  }

  /** Removes `count` of an item id from anywhere in the container. */
  remove(id: string, count = 1): boolean {
    if (this.countOf(id) < count) return false;
    let remaining = count;
    // Drain the smallest stacks first so the grid defragments naturally.
    const stacks = this.items.filter((i) => i.id === id).sort((a, b) => a.count - b.count);
    for (const it of stacks) {
      const take = Math.min(it.count, remaining);
      it.count -= take;
      remaining -= take;
      if (it.count <= 0) {
        this.stamp(it, 0);
        this.items.splice(this.items.indexOf(it), 1);
      }
      if (remaining <= 0) break;
    }
    this.onItemChanged?.(id, -count, this.countOf(id));
    this.onLayoutChanged?.();
    return true;
  }

  countOf(id: string): number {
    let n = 0;
    for (const it of this.items) if (it.id === id) n += it.count;
    return n;
  }

  /** True when every ingredient is present in the requested quantity. */
  has(reqs: readonly Ingredient[]): boolean {
    for (const r of reqs) if (this.countOf(r.id) < r.count) return false;
    return true;
  }

  /** What is still missing from a requirement list. */
  missing(reqs: readonly Ingredient[]): Ingredient[] {
    const out: Ingredient[] = [];
    for (const r of reqs) {
      const have = this.countOf(r.id);
      if (have < r.count) out.push({ id: r.id, count: r.count - have });
    }
    return out;
  }

  /** All-or-nothing consumption. */
  consume(reqs: readonly Ingredient[]): boolean {
    if (!this.has(reqs)) return false;
    for (const r of reqs) this.remove(r.id, r.count);
    return true;
  }

  /** Moves a stack inside this container. Merges into a matching stack if possible. */
  moveTo(uid: number, x: number, y: number): boolean {
    const it = this.byUid(uid);
    if (!it) return false;
    const target = this.itemAt(x, y);
    if (target && target.uid !== uid) {
      const def = itemDefOr(it.id);
      if (target.id === it.id && def.stack > 1 && target.count < def.stack) {
        const take = Math.min(def.stack - target.count, it.count);
        target.count += take;
        this.removeUid(uid, take);
        this.onLayoutChanged?.();
        return true;
      }
      return false;
    }
    if (!this.fits(it.w, it.h, x, y, uid)) return false;
    this.stamp(it, 0);
    it.x = x;
    it.y = y;
    this.stamp(it, uid);
    this.onLayoutChanged?.();
    return true;
  }

  /**
   * Transfer API. Moves a stack (or part of one) into another container,
   * optionally at an explicit cell. Returns the number of units moved.
   */
  transfer(uid: number, target: Container, count = Infinity, x?: number, y?: number): number {
    const it = this.byUid(uid);
    if (!it || target === this) return 0;
    const want = Math.min(it.count, count);
    let moved: number;
    if (x !== undefined && y !== undefined) {
      const def = itemDefOr(it.id);
      const occupant = target.itemAt(x, y);
      if (occupant && occupant.id === it.id && def.stack > 1) {
        moved = Math.min(want, def.stack - occupant.count);
        if (moved <= 0) return 0;
        occupant.count += moved;
        target.onItemChanged?.(it.id, moved, target.countOf(it.id));
        target.onLayoutChanged?.();
      } else if (!occupant && target.fits(def.w, def.h, x, y)) {
        moved = Math.min(want, def.stack);
        target.place(it.id, moved, x, y);
      } else {
        return 0;
      }
    } else {
      moved = target.add(it.id, want);
    }
    if (moved > 0) this.removeUid(uid, moved);
    return moved;
  }

  /** Bulk "take all" / "store all". Returns how many units moved. */
  transferAll(target: Container, filter?: (it: PlacedItem) => boolean): number {
    let total = 0;
    for (const it of [...this.items]) {
      if (filter && !filter(it)) continue;
      total += this.transfer(it.uid, target);
    }
    return total;
  }

  /** Repacks: biggest footprints first, then by category, then alphabetically. */
  sort(): void {
    const stacks = [...this.items].sort((a, b) => {
      const da = itemDefOr(a.id);
      const db = itemDefOr(b.id);
      return (
        db.w * db.h - da.w * da.h ||
        da.category.localeCompare(db.category) ||
        da.name.localeCompare(db.name)
      );
    });
    this.grid.fill(0);
    this.items.length = 0;
    for (const it of stacks) {
      const spot = this.findFree(it.w, it.h);
      if (!spot) continue;
      it.x = spot.x;
      it.y = spot.y;
      this.items.push(it);
      this.stamp(it, it.uid);
    }
    this.onLayoutChanged?.();
  }

  clear(): void {
    this.grid.fill(0);
    this.items.length = 0;
    this.onLayoutChanged?.();
  }

  /** Legacy flat view: one entry per item id. */
  get slots(): ItemStack[] {
    const map = new Map<string, number>();
    for (const it of this.items) map.set(it.id, (map.get(it.id) ?? 0) + it.count);
    return [...map].map(([id, count]) => ({ id, count }));
  }

  /**
   * Ages perishables. Returns the ids that spoiled so the caller can notify.
   * Called from GameState at 1 Hz, not per frame.
   */
  tickDecay(dt: number): string[] {
    const spoiled: string[] = [];
    for (const it of [...this.items]) {
      const def = itemDefOr(it.id);
      if (!def.decay) continue;
      it.age += dt;
      if (it.age < def.decay) continue;
      const count = it.count;
      const to = def.decaysTo;
      this.removeUid(it.uid);
      if (to) this.add(to, count);
      spoiled.push(it.id);
    }
    return spoiled;
  }

  serialise(): SerialisedContainer {
    return {
      id: this.id,
      label: this.label,
      width: this.width,
      height: this.height,
      items: this.items.map((i) => ({ ...i })),
    };
  }

  deserialise(data: SerialisedContainer): void {
    this.label = data.label ?? this.label;
    this.width = Math.max(1, data.width | 0);
    this.height = Math.max(1, data.height | 0);
    this.grid = new Int32Array(this.width * this.height);
    this.items.length = 0;
    for (const raw of data.items ?? []) {
      const def = itemDefOr(raw.id);
      const it: PlacedItem = {
        uid: raw.uid > 0 ? raw.uid : nextUid++,
        id: raw.id,
        count: Math.max(1, raw.count | 0),
        x: raw.x | 0,
        y: raw.y | 0,
        w: raw.w || def.w,
        h: raw.h || def.h,
        age: raw.age ?? 0,
        charge: raw.charge ?? def.charge ?? -1,
      };
      if (!this.fits(it.w, it.h, it.x, it.y)) {
        const spot = this.findFree(it.w, it.h);
        if (!spot) continue;
        it.x = spot.x;
        it.y = spot.y;
      }
      nextUid = Math.max(nextUid, it.uid + 1);
      this.items.push(it);
      this.stamp(it, it.uid);
    }
    this.onLayoutChanged?.();
  }
}

/* ------------------------------------------------------------------ *
 * Player inventory: grid + quick slots + worn equipment
 * ------------------------------------------------------------------ */

export interface EquipmentStats {
  oxygenBonus: number;
  depthRating: number;
  swimSpeed: number;
  oxygenEfficiency: number;
  armour: number;
}

export const QUICK_SLOT_COUNT = 5;

export class Inventory extends Container {
  /** uid per quick slot, or null. Slot 0 maps to hotbar key "1". */
  readonly quickSlots: (number | null)[] = new Array(QUICK_SLOT_COUNT).fill(null);
  /** Worn items keyed by body slot. Values are uids inside this container. */
  readonly equipped = new Map<EquipSlot, number>();
  /** Which quick slot is currently in hand, or -1. */
  activeSlot = -1;

  constructor(width = 6, height = 8) {
    super('player', 'Inventory', width, height);
  }

  /** Baseline compatibility: `capacity` used to mean "number of slots". */
  get capacity(): number {
    return this.cellCount;
  }

  /* ---------------- quick slots ---------------- */

  assignQuickSlot(slot: number, uid: number | null): boolean {
    if (slot < 0 || slot >= QUICK_SLOT_COUNT) return false;
    if (uid !== null && !this.byUid(uid)) return false;
    // A stack can only live in one quick slot.
    if (uid !== null) {
      for (let i = 0; i < this.quickSlots.length; i++) if (this.quickSlots[i] === uid) this.quickSlots[i] = null;
    }
    this.quickSlots[slot] = uid;
    this.onLayoutChanged?.();
    return true;
  }

  /** Auto-binds a newly acquired tool to the first empty quick slot. */
  autoBind(uid: number): void {
    for (let i = 0; i < this.quickSlots.length; i++) {
      if (this.quickSlots[i] === null) {
        this.assignQuickSlot(i, uid);
        return;
      }
    }
  }

  quickSlotItem(slot: number): PlacedItem | null {
    const uid = this.quickSlots[slot];
    return uid === null || uid === undefined ? null : this.byUid(uid);
  }

  /** Selects a quick slot; selecting the active one puts the tool away. */
  selectQuickSlot(slot: number): PlacedItem | null {
    if (slot < 0 || slot >= QUICK_SLOT_COUNT) return null;
    this.activeSlot = this.activeSlot === slot ? -1 : slot;
    return this.activeSlot < 0 ? null : this.quickSlotItem(this.activeSlot);
  }

  get heldItem(): PlacedItem | null {
    return this.activeSlot < 0 ? null : this.quickSlotItem(this.activeSlot);
  }

  get heldDef(): ItemDef | null {
    const it = this.heldItem;
    return it ? itemDefOr(it.id) : null;
  }

  /* ---------------- equipment ---------------- */

  equip(uid: number): boolean {
    const it = this.byUid(uid);
    if (!it) return false;
    const def = itemDefOr(it.id);
    if (!def.slot || def.slot === 'hand') return false;
    this.equipped.set(def.slot, uid);
    this.onLayoutChanged?.();
    return true;
  }

  unequip(slot: EquipSlot): boolean {
    const had = this.equipped.delete(slot);
    if (had) this.onLayoutChanged?.();
    return had;
  }

  isEquipped(uid: number): boolean {
    for (const v of this.equipped.values()) if (v === uid) return true;
    return false;
  }

  equippedDef(slot: EquipSlot): ItemDef | null {
    const uid = this.equipped.get(slot);
    if (uid === undefined) return null;
    const it = this.byUid(uid);
    return it ? itemDefOr(it.id) : null;
  }

  /** Aggregated worn-gear stats. Cheap enough to call once per second. */
  stats(out?: EquipmentStats): EquipmentStats {
    const s = out ?? { oxygenBonus: 0, depthRating: 0, swimSpeed: 1, oxygenEfficiency: 1, armour: 0 };
    s.oxygenBonus = 0;
    s.depthRating = 200; // bare suit crush depth
    s.swimSpeed = 1;
    s.oxygenEfficiency = 1;
    s.armour = 0;
    for (const uid of this.equipped.values()) {
      const it = this.byUid(uid);
      if (!it) continue;
      const d = itemDefOr(it.id);
      s.oxygenBonus += d.oxygenBonus ?? 0;
      if (d.depthRating) s.depthRating = Math.max(s.depthRating, d.depthRating);
      s.swimSpeed *= d.swimSpeed ?? 1;
      s.oxygenEfficiency *= d.oxygenEfficiency ?? 1;
      s.armour = 1 - (1 - s.armour) * (1 - (d.armour ?? 0));
    }
    return s;
  }

  /** Drops equipment/quick-slot references to stacks that no longer exist. */
  prune(): void {
    for (let i = 0; i < this.quickSlots.length; i++) {
      const uid = this.quickSlots[i];
      if (uid !== null && !this.byUid(uid)) this.quickSlots[i] = null;
    }
    for (const [slot, uid] of [...this.equipped]) {
      if (!this.byUid(uid)) this.equipped.delete(slot);
    }
  }

  override serialise(): SerialisedContainer {
    return {
      ...super.serialise(),
      quickSlots: [...this.quickSlots],
      equipped: [...this.equipped] as Array<[EquipSlot, number]>,
    };
  }

  override deserialise(data: SerialisedContainer): void {
    super.deserialise(data);
    for (let i = 0; i < this.quickSlots.length; i++) {
      this.quickSlots[i] = data.quickSlots?.[i] ?? null;
    }
    this.equipped.clear();
    for (const [slot, uid] of data.equipped ?? []) this.equipped.set(slot, uid);
    this.prune();
  }
}

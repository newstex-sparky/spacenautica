/**
 * Structural view of `game.state` as the UI needs it.
 *
 * The RPG-systems agent owns the real implementation and is expected to grow it
 * (footprint inventory, craft queue, tech gating). Everything here is optional
 * and accessed through guards, so the UI works against the baseline `GameState`
 * today and picks up the richer API automatically when it lands.
 */
import type { GameContext } from '../core/Types';
import { itemDef, recipeFor } from './ItemDatabase';
import type { RecipeDef } from './ItemDatabase';

export interface StackLike {
  id: string;
  count: number;
  /** Optional authoritative grid position from the systems agent. */
  x?: number;
  y?: number;
}

export interface InventoryLike {
  slots: StackLike[];
  capacity?: number;
  /** Grid dimensions if the inventory is footprint-based. */
  width?: number;
  height?: number;
  add?(id: string, count?: number): number;
  remove?(id: string, count?: number): boolean;
  countOf?(id: string): number;
  /** Cell footprint of an item, [w, h]. */
  footprintOf?(id: string): [number, number];
  /** Authoritative move; the UI falls back to its own layout when absent. */
  moveTo?(id: string, x: number, y: number): boolean;
}

export interface CraftingLike {
  known?: Set<string>;
  craft?(id: string): boolean;
  fabricate?(id: string): boolean;
  canCraft?(id: string): boolean;
}

export interface GameStateLike {
  inventory?: InventoryLike;
  crafting?: CraftingLike;
  tech?: { unlocked?: Set<string> };
  scanner?: { progress?: Map<string, number> };
  quests?: { active?: string[]; completed?: string[] };
  databank?: { entries?: Set<string> };
  save?(slot?: string): void;
  load?(slot?: string): boolean;
}

export interface BuildSystemLike {
  /** Id of the module currently held in the builder, if the systems agent models one. */
  current?: string | null;
  /** True when the module can be placed at the current aim point. */
  canPlace?(id: string): boolean;
  /** Human-readable reason placement is blocked. */
  placeError?(id: string): string | null;
  requestPlace?(id: string, position?: [number, number, number]): boolean;
  select?(id: string): void;
  cancel?(): void;
}

export function gameState(ctx: GameContext): GameStateLike | undefined {
  return ctx.tryGet('game.state') as unknown as GameStateLike | undefined;
}

export function buildSystem(ctx: GameContext): BuildSystemLike | undefined {
  return ctx.tryGet('game.build') as unknown as BuildSystemLike | undefined;
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export function countOf(inv: InventoryLike | undefined, id: string): number {
  if (!inv) return 0;
  if (inv.countOf) return inv.countOf(id);
  let n = 0;
  for (const s of inv.slots ?? []) if (s.id === id) n += s.count;
  return n;
}

export function footprint(inv: InventoryLike | undefined, id: string): [number, number] {
  const fromInv = inv?.footprintOf?.(id);
  if (fromInv && fromInv.length === 2) return [Math.max(1, fromInv[0]), Math.max(1, fromInv[1])];
  return itemDef(id).footprint;
}

export function gridSize(inv: InventoryLike | undefined): [number, number] {
  const w = inv?.width && inv.width > 0 ? inv.width : 8;
  const h = inv?.height && inv.height > 0 ? inv.height : Math.max(4, Math.ceil((inv?.capacity ?? 48) / w));
  return [w, h];
}

export function techUnlocked(st: GameStateLike | undefined, id: string | undefined): boolean {
  if (!id) return true;
  const set = st?.tech?.unlocked;
  if (!set) return true; // no tech gating yet — do not hide content
  return set.has(id);
}

export interface Craftability {
  ok: boolean;
  locked: boolean;
  missing: Array<{ id: string; need: number; have: number }>;
}

export function craftability(st: GameStateLike | undefined, r: RecipeDef): Craftability {
  const inv = st?.inventory;
  const missing: Craftability['missing'] = [];
  for (const ing of r.ingredients) {
    const have = countOf(inv, ing.id);
    if (have < ing.count) missing.push({ id: ing.id, need: ing.count, have });
  }
  const locked = !techUnlocked(st, r.requires);
  return { ok: missing.length === 0 && !locked, locked, missing };
}

/**
 * Attempts a craft through whatever API the systems agent exposes, falling back
 * to a straightforward consume/produce against the inventory. Returns true when
 * the craft happened.
 */
export function tryCraft(ctx: GameContext, r: RecipeDef): boolean {
  const st = gameState(ctx);
  const c = st?.crafting;
  if (c?.craft) {
    const ok = c.craft(r.output);
    if (ok) ctx.bus.emit('craft:completed', { id: r.output, count: r.count });
    return ok;
  }
  if (c?.fabricate) {
    const ok = c.fabricate(r.output);
    if (ok) ctx.bus.emit('craft:completed', { id: r.output, count: r.count });
    return ok;
  }
  const inv = st?.inventory;
  if (!inv?.remove || !inv.add) return false;
  const check = craftability(st, r);
  if (!check.ok) return false;
  for (const ing of r.ingredients) {
    if (!inv.remove(ing.id, ing.count)) return false;
  }
  const total = inv.add(r.output, r.count);
  ctx.bus.emit('inventory:changed', { id: r.output, delta: r.count, total });
  ctx.bus.emit('craft:completed', { id: r.output, count: r.count });
  return true;
}

/** Drops `count` of an item, emitting the inventory event other systems watch. */
export function dropItem(ctx: GameContext, id: string, count = 1): boolean {
  const inv = gameState(ctx)?.inventory;
  if (!inv?.remove) return false;
  if (!inv.remove(id, count)) return false;
  ctx.bus.emit('inventory:changed', { id, delta: -count, total: countOf(inv, id) });
  return true;
}

/** True when a recipe exists and the player can currently make it. */
export function canMake(ctx: GameContext, itemId: string): boolean {
  const r = recipeFor(itemId);
  if (!r) return false;
  return craftability(gameState(ctx), r).ok;
}

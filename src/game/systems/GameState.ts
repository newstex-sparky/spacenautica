import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';

export interface ItemStack { id: string; count: number }

/** BASELINE — replaced by the RPG-systems agent. */
export class Inventory {
  slots: ItemStack[] = [];
  capacity = 48;
  add(id: string, count = 1): number {
    const s = this.slots.find((x) => x.id === id);
    if (s) { s.count += count; return s.count; }
    if (this.slots.length >= this.capacity) return 0;
    this.slots.push({ id, count });
    return count;
  }
  remove(id: string, count = 1): boolean {
    const i = this.slots.findIndex((x) => x.id === id);
    if (i < 0 || this.slots[i].count < count) return false;
    this.slots[i].count -= count;
    if (this.slots[i].count <= 0) this.slots.splice(i, 1);
    return true;
  }
  countOf(id: string): number { return this.slots.find((x) => x.id === id)?.count ?? 0; }
}

export class Crafting { known = new Set<string>(); }
export class TechTree { unlocked = new Set<string>(); }
export class Scanner { progress = new Map<string, number>(); }
export class QuestLog { active: string[] = []; completed: string[] = []; }
export class Databank { entries = new Set<string>(); }

export class GameState implements GameSystem {
  readonly name = 'game.state';
  readonly phase = Phase.Gameplay;

  readonly inventory = new Inventory();
  readonly crafting = new Crafting();
  readonly tech = new TechTree();
  readonly scanner = new Scanner();
  readonly quests = new QuestLog();
  readonly databank = new Databank();

  init(_ctx: GameContext): void {}
  update(_dt: number, _ctx: GameContext): void {}

  save(slot = 'auto'): void {
    try {
      localStorage.setItem(`spacenautica.save.${slot}`, JSON.stringify({
        inventory: this.inventory.slots,
        tech: [...this.tech.unlocked],
        databank: [...this.databank.entries],
      }));
    } catch { /* quota */ }
  }

  load(slot = 'auto'): boolean {
    try {
      const raw = localStorage.getItem(`spacenautica.save.${slot}`);
      if (!raw) return false;
      const d = JSON.parse(raw);
      this.inventory.slots = d.inventory ?? [];
      this.tech.unlocked = new Set(d.tech ?? []);
      this.databank.entries = new Set(d.databank ?? []);
      return true;
    } catch { return false; }
  }
}

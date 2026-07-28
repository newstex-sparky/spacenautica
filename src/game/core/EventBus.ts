/**
 * Tiny synchronous typed event bus. Systems communicate through this rather
 * than holding direct references, so ownership stays acyclic.
 */
export type Handler<T> = (payload: T) => void;

export interface GameEvents {
  /** Player picked up / lost an item. */
  'inventory:changed': { id: string; delta: number; total: number };
  /** A craft completed at a fabricator. */
  'craft:completed': { id: string; count: number };
  /** Scanner finished a full scan of a target. */
  'scan:completed': { id: string; category: string };
  /** A databank entry was unlocked. */
  'databank:unlocked': { id: string };
  /** A tech-tree node became available. */
  'tech:unlocked': { id: string };
  /** Quest state transition. */
  'quest:updated': { id: string; state: string; objective?: string };
  /** Player vitals crossed a threshold worth reacting to. */
  'vitals:critical': { kind: 'oxygen' | 'health' | 'food' | 'water'; value: number };
  /** Player took damage. */
  'player:damage': { amount: number; source: string; direction?: [number, number, number] };
  /** Player died. */
  'player:died': { cause: string };
  /** Player entered/left a biome. */
  'biome:entered': { id: string; name: string };
  /** Depth band change, used for music + colour grading. */
  'depth:band': { band: string; depth: number };
  /** Camera crossed the water surface. */
  'water:transition': { underwater: boolean };
  /** Creature aggro state, drives music stingers. */
  'creature:aggro': { species: string; distance: number };
  /** A one-shot sound cue request. */
  'audio:cue': { id: string; position?: [number, number, number]; gain?: number };
  /** UI wants to open/close a screen. */
  'ui:screen': { screen: string; open: boolean };
  /** Toast/subtitle text for the HUD. */
  'ui:notify': { text: string; kind?: 'info' | 'warn' | 'danger' | 'success'; ttl?: number };
  /** PDA voice line with subtitle. */
  'ui:voice': { text: string; speaker?: string; ttl?: number };
  /** Quality tier changed at runtime. */
  'settings:quality': { tier: string };
  /** Save/load lifecycle. */
  'save:written': { slot: string };
  'save:loaded': { slot: string };
  /** Base building placement confirmed. */
  'build:placed': { id: string; position: [number, number, number] };
  /** Generic debug channel. */
  'debug:log': { text: string };
}

export class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type as string);
    if (!set) {
      set = new Set();
      this.handlers.set(type as string, set);
    }
    set.add(fn as Handler<unknown>);
    return () => this.off(type, fn);
  }

  once<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): void {
    this.handlers.get(type as string)?.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type as string);
    if (!set) return;
    // Copy so handlers may unsubscribe during dispatch.
    for (const fn of Array.from(set)) {
      try {
        (fn as Handler<GameEvents[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${String(type)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

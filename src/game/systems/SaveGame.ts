/**
 * SAVE FORMAT + MIGRATION.
 *
 * Saves are versioned and migrated forward on load, so a save written by an
 * earlier build never has to be thrown away. `migrate()` is a pure function:
 * it takes whatever came out of storage and returns the current shape, or null
 * if the blob is unrecognisable.
 *
 * Version history
 *   1 — flat `{ inventory: ItemStack[], tech: string[], databank: string[] }`
 *       (the original baseline GameState.save()).
 *   2 — added quests, scanner fragments and a version field.
 *   3 — grid inventory (`SerialisedContainer`), external containers, crafting
 *       queue, built structures, world seed + time of day, play stats.
 */

import type { ItemStack, SerialisedContainer } from './Inventory';
import type { SerialisedBuild } from './BuildSystem';

export const SAVE_VERSION = 3;

export interface SaveVitals {
  oxygen: number;
  maxOxygen: number;
  health: number;
  food: number;
  water: number;
}

export interface SaveData {
  version: number;
  /** Unix ms. */
  savedAt: number;
  /** Seconds of play. */
  playtime: number;
  world: {
    seed: number;
    timeOfDay: number;
    dayLength: number;
  };
  player: {
    position: [number, number, number];
    yaw: number;
    pitch: number;
    vitals: SaveVitals;
  };
  inventory: SerialisedContainer;
  /** Base lockers, bioreactor hoppers, dropped crates. */
  containers: SerialisedContainer[];
  crafting: { queue: unknown[]; overflow: unknown[] };
  tech: { unlocked: string[]; deepestDepth: number };
  scanner: { fragments: Array<[string, number]>; completed: string[] };
  quests: unknown;
  databank: { entries: string[]; read: string[] };
  build?: SerialisedBuild;
  stats: {
    crafted: number;
    scans: number;
    placed: number;
    deaths: number;
    distance: number;
  };
}

/** Anything with a plausible shape; migrated to the current version. */
type UnknownSave = Record<string, unknown>;

function emptySave(): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    playtime: 0,
    world: { seed: 0, timeOfDay: 9, dayLength: 1200 },
    player: {
      position: [0, -12, 0],
      yaw: 0,
      pitch: 0,
      vitals: { oxygen: 45, maxOxygen: 45, health: 100, food: 100, water: 100 },
    },
    inventory: { id: 'player', label: 'Inventory', width: 6, height: 8, items: [] },
    containers: [],
    crafting: { queue: [], overflow: [] },
    tech: { unlocked: [], deepestDepth: 0 },
    scanner: { fragments: [], completed: [] },
    quests: {},
    databank: { entries: [], read: [] },
    stats: { crafted: 0, scans: 0, placed: 0, deaths: 0, distance: 0 },
  };
}

/** v1 -> v2: give the blob a version and the newer sub-objects. */
function migrate1to2(raw: UnknownSave): UnknownSave {
  return {
    ...raw,
    version: 2,
    quests: { active: [], completed: [] },
    scanner: { fragments: [], completed: [] },
  };
}

/**
 * v2 -> v3: the flat `ItemStack[]` inventory becomes a grid container. Items are
 * laid out left-to-right on a 6x8 grid at one cell each; the real footprints are
 * re-applied by `Container.deserialise`, which re-homes anything that no longer
 * fits.
 */
function migrate2to3(raw: UnknownSave): UnknownSave {
  const legacy = Array.isArray(raw.inventory) ? (raw.inventory as ItemStack[]) : [];
  const width = 6;
  const items = legacy.map((s, i) => ({
    uid: i + 1,
    id: String(s.id),
    count: Math.max(1, Number(s.count) || 1),
    x: i % width,
    y: Math.floor(i / width),
    w: 1,
    h: 1,
    age: 0,
    charge: -1,
  }));
  const tech = Array.isArray(raw.tech) ? (raw.tech as string[]) : [];
  const databank = Array.isArray(raw.databank) ? (raw.databank as string[]) : [];
  return {
    ...raw,
    version: 3,
    inventory: { id: 'player', label: 'Inventory', width, height: 8, items },
    containers: [],
    tech: { unlocked: tech, deepestDepth: 0 },
    databank: { entries: databank, read: [] },
    crafting: { queue: [], overflow: [] },
    build: { pieces: [] },
    stats: { crafted: 0, scans: 0, placed: 0, deaths: 0, distance: 0 },
  };
}

/** Fills in anything a partially-written save is missing. */
function coerce(raw: UnknownSave): SaveData {
  const base = emptySave();
  const out: SaveData = {
    ...base,
    ...(raw as unknown as SaveData),
    version: SAVE_VERSION,
    world: { ...base.world, ...(raw.world as SaveData['world'] | undefined) },
    player: {
      ...base.player,
      ...(raw.player as SaveData['player'] | undefined),
      vitals: { ...base.player.vitals, ...((raw.player as SaveData['player'] | undefined)?.vitals ?? {}) },
    },
    inventory: (raw.inventory as SerialisedContainer | undefined) ?? base.inventory,
    containers: (raw.containers as SerialisedContainer[] | undefined) ?? [],
    crafting: (raw.crafting as SaveData['crafting'] | undefined) ?? base.crafting,
    tech: (raw.tech as SaveData['tech'] | undefined) ?? base.tech,
    scanner: (raw.scanner as SaveData['scanner'] | undefined) ?? base.scanner,
    databank: (raw.databank as SaveData['databank'] | undefined) ?? base.databank,
    stats: { ...base.stats, ...((raw.stats as SaveData['stats'] | undefined) ?? {}) },
  };
  return out;
}

/**
 * Brings any historical save shape up to the current version. Returns null when
 * the blob has no recognisable inventory at all, which is the only case where
 * loading would silently produce a broken run.
 */
export function migrate(input: unknown): SaveData | null {
  if (!input || typeof input !== 'object') return null;
  let raw = input as UnknownSave;

  let version = typeof raw.version === 'number' ? raw.version : 1;
  if (version < 1 || version > SAVE_VERSION + 8) return null;

  if (!('inventory' in raw)) return null;

  if (version === 1) {
    raw = migrate1to2(raw);
    version = 2;
  }
  if (version === 2) {
    raw = migrate2to3(raw);
    version = 3;
  }
  // Future versions load as-is; unknown extra fields are preserved but ignored.
  return coerce(raw);
}

export function saveKey(slot: string): string {
  return `spacenautica.save.${slot}`;
}

export interface SaveSlotInfo {
  slot: string;
  savedAt: number;
  playtime: number;
  version: number;
  /** Deepest depth reached, for the slot summary line. */
  depth: number;
}

/** Lists the save slots present in localStorage, newest first. */
export function listSaves(): SaveSlotInfo[] {
  const out: SaveSlotInfo[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('spacenautica.save.')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as UnknownSave;
        out.push({
          slot: key.slice('spacenautica.save.'.length),
          savedAt: Number(parsed.savedAt) || 0,
          playtime: Number(parsed.playtime) || 0,
          version: Number(parsed.version) || 1,
          depth: Number((parsed.tech as { deepestDepth?: number } | undefined)?.deepestDepth) || 0,
        });
      } catch {
        /* corrupt slot — skip it rather than failing the whole list */
      }
    }
  } catch {
    /* storage unavailable (private mode) */
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

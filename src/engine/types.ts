// ============ Spacenautica Core Types ============

export type Vec2 = { x: number; y: number };

// Space tile types — the "ocean" is vacuum
export type TileType =
  | 'void'          // open space (walkable in EVA)
  | 'asteroid'      // mineable rock
  | 'station_floor' // pressurized station interior (walkable without EVA)
  | 'station_wall'  // station boundary
  | 'airlock'       // transition between vacuum and pressurized
  | 'debris'        // wreckage, harvestable
  | 'crystal'       // rare crystal deposit
  | 'alien_ruin'    // ancient alien structure
  | 'star'          // background star (decorative)
  | 'nebula'        // nebula cloud (decorative, slows movement)
  | 'solar'         // solar panel tile (generates power)
  | 'o2_gen'        // O2 generator tile
  | 'storage'       // storage module
  | 'fabricator'    // crafting station
  | 'reactor'       // power reactor
  | 'shield';       // shield generator

export interface Tile {
  type: TileType;
  occupied: boolean;       // blocks movement
  oreType?: OreType | null;
  oreAmount?: number;      // remaining ore in asteroid
  hullIntegrity: number;   // 0-100, station tiles only
  pressurized: boolean;     // station tiles only
  moduleId?: string | null; // which station module this belongs to
  decorationId?: string | null;
}

export type OreType = 'iron' | 'gold' | 'crystal' | 'silicon' | 'carbon' | 'uranium' | 'alien_alloy';

export interface ItemStack {
  itemId: string;
  quantity: number;
}

export interface InventorySlot {
  item: ItemStack | null;
}

export interface PlayerStats {
  oxygen: number;       // seconds of O2 remaining
  maxOxygen: number;
  power: number;        // suit power for jetpack/tools
  maxPower: number;
  health: number;
  maxHealth: number;
  hullIntegrity: number; // station hull integrity (global, for now)
  maxHull: number;
}

export type Season = 'solar_max' | 'solar_min' | 'flare' | 'quiet';

export interface GameTime {
  cycle: number;       // day cycle counter
  minutes: number;     // 0-1440
  timeString: string;
  season: Season;
}

export type GameScreen =
  | 'world'
  | 'inventory'
  | 'build'
  | 'craft'
  | 'techtree'
  | 'map'
  | 'gameover'
  | 'intro';

export interface Notification {
  id: number;
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timeout: number;
}

export interface EngineCallbacks {
  onStateChange: () => void;
  onNotification: (n: Notification) => void;
  onScreenChange: (screen: GameScreen | null) => void;
  onGameOver: (reason: string) => void;
}

// ============ Items ============

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  category: 'ore' | 'material' | 'crafted' | 'tool' | 'module' | 'food' | 'misc' | 'tech';
  sellValue: number;
  buyValue: number;
  color: string;
  emoji: string;
}

// ============ Recipes ============

export interface Recipe {
  id: string;
  name: string;
  inputs: ItemStack[];
  output: ItemStack;
  description: string;
}

// ============ Station Modules ============

export type ModuleType =
  | 'habitat'
  | 'airlock'
  | 'corridor'
  | 'solar_panel'
  | 'o2_generator'
  | 'storage'
  | 'fabricator'
  | 'reactor'
  | 'shield'
  | 'scanner'
  | 'shuttle_bay'
  | 'drone_bay';

export interface ModuleDef {
  id: ModuleType;
  name: string;
  description: string;
  cost: number;
  materials: ItemStack[];
  width: number;
  height: number;
  color: string;
  accentColor: string;
  emoji: string;
  techTier: number;
  unlocked: boolean;
  providesO2?: number;     // O2 per second
  providesPower?: number;  // power per second
  providesStorage?: number; // inventory slots
  pressurized: boolean;
}

export interface PlacedModule {
  id: string;
  type: ModuleType;
  x: number;  // top-left tile
  y: number;
  hullIntegrity: number;
}

// ============ Tech Tree ============

export interface TechNode {
  id: string;
  name: string;
  description: string;
  tier: number;
  cost: number;          // research points (or material cost)
  prerequisites: string[]; // tech IDs that must be unlocked first
  unlocks: string[];       // item/module IDs this tech unlocks
  category: 'survival' | 'station' | 'mining' | 'exploration' | 'combat' | 'endgame';
}

// ============ Sectors ============

export interface SectorDef {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  asteroidDensity: number;
  hazardLevel: number;
  hasAlienRuins: boolean;
  hasMeridianWreck: boolean;
}

// ============ Controls ============

export interface InputState {
  moveX: number;  // -1 to 1
  moveY: number;  // -1 to 1
  aimX: number;
  aimY: number;
  action: boolean;    // primary action
  cancel: boolean;
  inventory: boolean;
  build: boolean;
  craft: boolean;
  techtree: boolean;
  map: boolean;
  hotbarLeft: boolean;
  hotbarRight: boolean;
  boost: boolean;     // LT - O2 boost
  fire: boolean;      // RT - mining laser
}

export function createEmptyInput(): InputState {
  return {
    moveX: 0, moveY: 0, aimX: 0, aimY: 0,
    action: false, cancel: false, inventory: false, build: false,
    craft: false, techtree: false, map: false,
    hotbarLeft: false, hotbarRight: false, boost: false, fire: false,
  };
}
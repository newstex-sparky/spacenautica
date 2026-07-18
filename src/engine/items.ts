import type { ItemDef, Recipe, ModuleDef, OreType } from './types';

// ============ Item Definitions ============

export const ITEMS: Record<string, ItemDef> = {
  // Ores
  iron: { id: 'iron', name: 'Iron Ore', description: 'Common structural metal.', category: 'ore', sellValue: 5, buyValue: 0, color: '#aa88aa', emoji: '🔩' },
  gold: { id: 'gold', name: 'Gold Ore', description: 'Conductive and valuable.', category: 'ore', sellValue: 20, buyValue: 0, color: '#ffdd00', emoji: '🪙' },
  crystal: { id: 'crystal', name: 'Crystallite', description: 'Rare energy crystal.', category: 'ore', sellValue: 40, buyValue: 0, color: '#44ffff', emoji: '💎' },
  silicon: { id: 'silicon', name: 'Silicon', description: 'Used in electronics.', category: 'ore', sellValue: 10, buyValue: 0, color: '#cc9966', emoji: '🧊' },
  carbon: { id: 'carbon', name: 'Carbon', description: 'Fuel and composite base.', category: 'ore', sellValue: 8, buyValue: 0, color: '#333333', emoji: '⚫' },
  uranium: { id: 'uranium', name: 'Uranium', description: 'Radioactive fuel for reactors.', category: 'ore', sellValue: 60, buyValue: 0, color: '#44ff44', emoji: '☢️' },
  alien_alloy: { id: 'alien_alloy', name: 'Alien Alloy', description: 'Mysterious metal from the ruins.', category: 'ore', sellValue: 200, buyValue: 0, color: '#ff66ff', emoji: '👽' },

  // Materials (refined)
  iron_bar: { id: 'iron_bar', name: 'Iron Plate', description: 'Refined iron for construction.', category: 'material', sellValue: 15, buyValue: 0, color: '#cccccc', emoji: '⚙️' },
  gold_bar: { id: 'gold_bar', name: 'Gold Wire', description: 'Conductive wire.', category: 'material', sellValue: 50, buyValue: 0, color: '#ffee00', emoji: '✨' },
  silicon_wafer: { id: 'silicon_wafer', name: 'Silicon Wafer', description: 'Electronics component.', category: 'material', sellValue: 25, buyValue: 0, color: '#ddaa88', emoji: '🔲' },
  carbon_comp: { id: 'carbon_comp', name: 'Carbon Composite', description: 'Lightweight hull material.', category: 'material', sellValue: 20, buyValue: 0, color: '#555555', emoji: '🛡️' },
  crystal_matrix: { id: 'crystal_matrix', name: 'Crystal Matrix', description: 'Energy storage matrix.', category: 'material', sellValue: 100, buyValue: 0, color: '#88ffff', emoji: '🔷' },

  // Tools
  repair_tool: { id: 'repair_tool', name: 'Repair Tool', description: 'Fix hull breaches.', category: 'tool', sellValue: 0, buyValue: 30, color: '#ff8800', emoji: '🔧' },
  mining_laser: { id: 'mining_laser', name: 'Mining Laser', description: 'Extract ore from asteroids.', category: 'tool', sellValue: 0, buyValue: 50, color: '#ff4400', emoji: '⛏️' },
  scanner: { id: 'scanner', name: 'Scanner', description: 'Scan resources and ruins.', category: 'tool', sellValue: 0, buyValue: 40, color: '#44ddff', emoji: '📡' },
  jetpack_mk1: { id: 'jetpack_mk1', name: 'Jetpack Mk1', description: 'Faster EVA movement.', category: 'tool', sellValue: 0, buyValue: 80, color: '#88ddff', emoji: '🎒' },
  jetpack_mk2: { id: 'jetpack_mk2', name: 'Jetpack Mk2', description: 'EVA boost + dash.', category: 'tool', sellValue: 0, buyValue: 200, color: '#aaffff', emoji: '🚀' },

  // Air/Power
  air_tank: { id: 'air_tank', name: 'Air Tank', description: '+15 min O2 capacity.', category: 'misc', sellValue: 10, buyValue: 20, color: '#44aaff', emoji: '🫧' },
  battery: { id: 'battery', name: 'Battery', description: 'Stores power for EVA suit.', category: 'misc', sellValue: 15, buyValue: 30, color: '#44ff44', emoji: '🔋' },

  // Food
  ration: { id: 'ration', name: 'Ration Pack', description: 'Restores 20 health.', category: 'food', sellValue: 10, buyValue: 15, color: '#cc8844', emoji: '🍱' },
  hydro_grown: { id: 'hydro_grown', name: 'Hydro-Grown Veg', description: 'From your station farm. +30 health.', category: 'food', sellValue: 25, buyValue: 0, color: '#44aa44', emoji: '🥬' },

  // Tech items
  tech_chip: { id: 'tech_chip', name: 'Tech Chip', description: 'Research component for tech tree.', category: 'tech', sellValue: 30, buyValue: 0, color: '#ff44aa', emoji: '💾' },
  alien_key: { id: 'alien_key', name: 'Alien Key', description: 'Opens the gateway.', category: 'tech', sellValue: 0, buyValue: 0, color: '#ff66ff', emoji: '🗝️' },
};

// ============ Ore Drop Tables ============

export const ORE_DROPS: Record<string, { itemId: string; chance: number; min: number; max: number }[]> = {
  iron: [
    { itemId: 'iron', chance: 1.0, min: 2, max: 5 },
    { itemId: 'silicon', chance: 0.3, min: 1, max: 2 },
  ],
  gold: [
    { itemId: 'gold', chance: 0.8, min: 1, max: 3 },
    { itemId: 'iron', chance: 0.5, min: 1, max: 2 },
  ],
  crystal: [
    { itemId: 'crystal', chance: 0.6, min: 1, max: 2 },
    { itemId: 'silicon', chance: 0.4, min: 1, max: 3 },
  ],
  silicon: [
    { itemId: 'silicon', chance: 1.0, min: 2, max: 4 },
    { itemId: 'carbon', chance: 0.3, min: 1, max: 2 },
  ],
  carbon: [
    { itemId: 'carbon', chance: 1.0, min: 3, max: 6 },
    { itemId: 'iron', chance: 0.2, min: 1, max: 2 },
  ],
  uranium: [
    { itemId: 'uranium', chance: 0.7, min: 1, max: 2 },
    { itemId: 'iron', chance: 0.5, min: 1, max: 3 },
  ],
  alien_alloy: [
    { itemId: 'alien_alloy', chance: 0.5, min: 1, max: 2 },
    { itemId: 'crystal', chance: 0.3, min: 1, max: 2 },
    { itemId: 'tech_chip', chance: 0.2, min: 1, max: 1 },
  ],
};

// ============ Shop / Trade ============

export const SHOP_STOCK: string[] = [
  'air_tank', 'battery', 'ration', 'repair_tool', 'mining_laser', 'scanner', 'jetpack_mk1',
];

// ============ Crafting Recipes ============

export const RECIPES: Recipe[] = [
  {
    id: 'iron_plate',
    name: 'Iron Plate',
    description: 'Refine iron ore into construction plates.',
    inputs: [{ itemId: 'iron', quantity: 3 }],
    output: { itemId: 'iron_bar', quantity: 1 },
  },
  {
    id: 'gold_wire',
    name: 'Gold Wire',
    description: 'Refine gold ore into conductive wire.',
    inputs: [{ itemId: 'gold', quantity: 2 }],
    output: { itemId: 'gold_bar', quantity: 1 },
  },
  {
    id: 'silicon_wafer',
    name: 'Silicon Wafer',
    description: 'Process silicon for electronics.',
    inputs: [{ itemId: 'silicon', quantity: 3 }],
    output: { itemId: 'silicon_wafer', quantity: 1 },
  },
  {
    id: 'carbon_comp',
    name: 'Carbon Composite',
    description: 'Lightweight hull material.',
    inputs: [{ itemId: 'carbon', quantity: 4 }],
    output: { itemId: 'carbon_comp', quantity: 1 },
  },
  {
    id: 'crystal_matrix',
    name: 'Crystal Matrix',
    description: 'Energy storage crystal.',
    inputs: [{ itemId: 'crystal', quantity: 2 }, { itemId: 'gold_bar', quantity: 1 }],
    output: { itemId: 'crystal_matrix', quantity: 1 },
  },
  {
    id: 'air_tank',
    name: 'Air Tank',
    description: 'Extend your EVA O2 capacity.',
    inputs: [{ itemId: 'iron_bar', quantity: 2 }],
    output: { itemId: 'air_tank', quantity: 1 },
  },
  {
    id: 'battery',
    name: 'Battery',
    description: 'Store power for your EVA suit.',
    inputs: [{ itemId: 'silicon_wafer', quantity: 1 }, { itemId: 'iron_bar', quantity: 1 }],
    output: { itemId: 'battery', quantity: 1 },
  },
  {
    id: 'repair_tool',
    name: 'Repair Tool',
    description: 'Fix hull breaches in your station.',
    inputs: [{ itemId: 'iron_bar', quantity: 3 }, { itemId: 'silicon_wafer', quantity: 1 }],
    output: { itemId: 'repair_tool', quantity: 1 },
  },
  {
    id: 'mining_laser',
    name: 'Mining Laser',
    description: 'Extract ore from asteroids efficiently.',
    inputs: [{ itemId: 'iron_bar', quantity: 5 }, { itemId: 'crystal', quantity: 1 }],
    output: { itemId: 'mining_laser', quantity: 1 },
  },
  {
    id: 'scanner',
    name: 'Scanner',
    description: 'Scan resources and alien ruins.',
    inputs: [{ itemId: 'silicon_wafer', quantity: 2 }, { itemId: 'gold_bar', quantity: 1 }],
    output: { itemId: 'scanner', quantity: 1 },
  },
  {
    id: 'jetpack_mk1',
    name: 'Jetpack Mk1',
    description: 'Move faster in EVA.',
    inputs: [{ itemId: 'iron_bar', quantity: 5 }, { itemId: 'carbon_comp', quantity: 2 }, { itemId: 'battery', quantity: 1 }],
    output: { itemId: 'jetpack_mk1', quantity: 1 },
  },
  {
    id: 'tech_chip',
    name: 'Tech Chip',
    description: 'Research component for unlocking tech.',
    inputs: [{ itemId: 'silicon_wafer', quantity: 2 }, { itemId: 'gold_bar', quantity: 1 }, { itemId: 'crystal', quantity: 1 }],
    output: { itemId: 'tech_chip', quantity: 1 },
  },
  {
    id: 'ration',
    name: 'Ration Pack',
    description: 'Emergency food. +20 health.',
    inputs: [{ itemId: 'carbon', quantity: 2 }],
    output: { itemId: 'ration', quantity: 1 },
  },
];

// ============ Station Modules ============

export const MODULES: Record<string, ModuleDef> = {
  habitat: {
    id: 'habitat', name: 'Habitat Module', description: 'Pressurized living space. Refills O2.',
    cost: 100, materials: [{ itemId: 'iron_bar', quantity: 10 }],
    width: 4, height: 4, color: '#334466', accentColor: '#5588aa', emoji: '🏠',
    techTier: 0, unlocked: true, providesO2: 1, pressurized: true,
  },
  airlock: {
    id: 'airlock', name: 'Airlock', description: 'Transition between vacuum and station.',
    cost: 50, materials: [{ itemId: 'iron_bar', quantity: 5 }],
    width: 2, height: 2, color: '#445566', accentColor: '#88ccdd', emoji: '🚪',
    techTier: 0, unlocked: true, pressurized: true,
  },
  corridor: {
    id: 'corridor', name: 'Corridor', description: 'Connect modules together.',
    cost: 30, materials: [{ itemId: 'iron_bar', quantity: 3 }],
    width: 1, height: 3, color: '#445577', accentColor: '#6699bb', emoji: '🔗',
    techTier: 0, unlocked: true, pressurized: true,
  },
  solar_panel: {
    id: 'solar_panel', name: 'Solar Panel', description: 'Generates power from starlight.',
    cost: 80, materials: [{ itemId: 'silicon_wafer', quantity: 3 }, { itemId: 'iron_bar', quantity: 2 }],
    width: 2, height: 2, color: '#223388', accentColor: '#44aaff', emoji: '🔆',
    techTier: 0, unlocked: true, providesPower: 2, pressurized: false,
  },
  o2_generator: {
    id: 'o2_generator', name: 'O2 Generator', description: 'Converts power into oxygen.',
    cost: 120, materials: [{ itemId: 'iron_bar', quantity: 5 }, { itemId: 'silicon_wafer', quantity: 2 }],
    width: 2, height: 2, color: '#224466', accentColor: '#44ccff', emoji: '💨',
    techTier: 1, unlocked: false, providesO2: 2, pressurized: true,
  },
  storage: {
    id: 'storage', name: 'Storage Locker', description: 'Extra inventory space.',
    cost: 60, materials: [{ itemId: 'iron_bar', quantity: 4 }],
    width: 2, height: 2, color: '#554433', accentColor: '#aa8855', emoji: '📦',
    techTier: 0, unlocked: true, providesStorage: 20, pressurized: true,
  },
  fabricator: {
    id: 'fabricator', name: 'Fabricator', description: 'Craft tools and materials.',
    cost: 150, materials: [{ itemId: 'iron_bar', quantity: 8 }, { itemId: 'silicon_wafer', quantity: 3 }],
    width: 3, height: 2, color: '#443366', accentColor: '#aa66ff', emoji: '🏭',
    techTier: 1, unlocked: false, pressurized: true,
  },
  reactor: {
    id: 'reactor', name: 'RTG Reactor', description: 'Always-on nuclear power.',
    cost: 500, materials: [{ itemId: 'uranium', quantity: 3 }, { itemId: 'iron_bar', quantity: 15 }, { itemId: 'crystal_matrix', quantity: 2 }],
    width: 3, height: 3, color: '#226644', accentColor: '#44ff88', emoji: '⚛️',
    techTier: 3, unlocked: false, providesPower: 10, pressurized: false,
  },
  shield: {
    id: 'shield', name: 'Shield Generator', description: 'Protects station from debris.',
    cost: 400, materials: [{ itemId: 'crystal_matrix', quantity: 3 }, { itemId: 'iron_bar', quantity: 10 }],
    width: 3, height: 3, color: '#334488', accentColor: '#66aaff', emoji: '🛡️',
    techTier: 3, unlocked: false, pressurized: false,
  },
  scanner: {
    id: 'scanner', name: 'Scanner Array', description: 'Reveal sector maps.',
    cost: 300, materials: [{ itemId: 'silicon_wafer', quantity: 5 }, { itemId: 'gold_bar', quantity: 3 }],
    width: 3, height: 2, color: '#335577', accentColor: '#77ddff', emoji: '📡',
    techTier: 2, unlocked: false, pressurized: false,
  },
  shuttle_bay: {
    id: 'shuttle_bay', name: 'Shuttle Bay', description: 'Build and launch ships.',
    cost: 800, materials: [{ itemId: 'iron_bar', quantity: 20 }, { itemId: 'crystal_matrix', quantity: 5 }, { itemId: 'carbon_comp', quantity: 10 }],
    width: 5, height: 4, color: '#444466', accentColor: '#aaaaff', emoji: '🛸',
    techTier: 3, unlocked: false, pressurized: true,
  },
  drone_bay: {
    id: 'drone_bay', name: 'Drone Bay', description: 'Autonomous mining drones.',
    cost: 600, materials: [{ itemId: 'iron_bar', quantity: 15 }, { itemId: 'silicon_wafer', quantity: 8 }],
    width: 4, height: 3, color: '#554455', accentColor: '#bb66cc', emoji: '🤖',
    techTier: 4, unlocked: false, pressurized: false,
  },
};

export const MODULE_LIST = Object.values(MODULES);

// ============ Helper Functions ============

export function getItemName(id: string): string {
  return ITEMS[id]?.name ?? id;
}

export function getItemSellValue(id: string): number {
  return ITEMS[id]?.sellValue ?? 0;
}

export function getItemBuyValue(id: string): number {
  return ITEMS[id]?.buyValue ?? 0;
}
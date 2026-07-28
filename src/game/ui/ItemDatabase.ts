/**
 * UI-side content database.
 *
 * The RPG-systems agent owns the authoritative item/recipe/tech data. Until it
 * publishes a richer API this file is the UI's fallback catalogue: display
 * names, grid footprints, icon recipes, descriptions, blueprint costs, databank
 * lore and journal quests. `mergeCatalogue()` lets the systems agent inject or
 * override entries at runtime without the UI changing.
 *
 * Nothing here references an external asset. Icons are described as procedural
 * archetypes (see IconFactory) rather than file names.
 */

/** Procedural icon archetypes. IconFactory knows how to draw and mesh each. */
export type IconArchetype =
  | 'ore'
  | 'crystal'
  | 'metal'
  | 'plant'
  | 'seed'
  | 'fish'
  | 'egg'
  | 'circuit'
  | 'battery'
  | 'tank'
  | 'tool'
  | 'device'
  | 'module'
  | 'food'
  | 'bottle'
  | 'fragment'
  | 'blueprint'
  | 'suit'
  | 'shell';

export type ItemCategory =
  | 'raw'
  | 'basic'
  | 'advanced'
  | 'electronics'
  | 'tools'
  | 'equipment'
  | 'consumable'
  | 'seeds'
  | 'fragment'
  | 'module';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  /** Grid footprint in cells, [width, height]. Matches Subnautica's model. */
  footprint: [number, number];
  archetype: IconArchetype;
  /** Base albedo for the generated icon, hex. */
  tint: number;
  /** Secondary accent (veins, glow, trim). */
  accent: number;
  /** Emissive strength for the icon, 0..1 — bioluminescence reads at a glance. */
  glow?: number;
  /** Kilograms; shown in the detail pane. */
  mass?: number;
  /** Flavour/utility text in the detail pane. */
  desc: string;
  /** Stack limit hint for the grid badge. */
  stack?: number;
}

export interface RecipeDef {
  id: string;
  /** Item id produced. */
  output: string;
  count: number;
  ingredients: Array<{ id: string; count: number }>;
  /** Which machine can build it. */
  station: 'fabricator' | 'workbench' | 'moonpool' | 'builder';
  group: string;
  /** Seconds of fabrication animation. */
  time: number;
  /** Tech node that must be unlocked, if any. */
  requires?: string;
}

export interface DatabankEntry {
  id: string;
  title: string;
  category: 'flora' | 'fauna' | 'geology' | 'technology' | 'lore' | 'signal';
  /** Paragraphs. */
  body: string[];
  /** Seeds the procedural diagram drawn beside the text. */
  diagram: IconArchetype;
  seed: number;
  /** Optional threat/danger classification shown as a chip. */
  threat?: 'passive' | 'defensive' | 'aggressive' | 'lethal';
  depth?: string;
}

export interface QuestDef {
  id: string;
  title: string;
  summary: string;
  objectives: string[];
  priority: 'primary' | 'secondary' | 'optional';
}

export interface BuildModuleDef {
  id: string;
  name: string;
  group: 'structure' | 'exterior' | 'interior' | 'power' | 'utility';
  cost: Array<{ id: string; count: number }>;
  archetype: IconArchetype;
  /** Cells of sea floor the footprint covers, used by the placement preview. */
  size: [number, number];
  /** Maximum floor slope in degrees the module tolerates. */
  maxSlope: number;
  /** Must be attached to an existing structure. */
  needsHost?: boolean;
  desc: string;
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

function item(
  id: string,
  name: string,
  category: ItemCategory,
  footprint: [number, number],
  archetype: IconArchetype,
  tint: number,
  accent: number,
  desc: string,
  extra?: Partial<ItemDef>,
): ItemDef {
  return { id, name, category, footprint, archetype, tint, accent, desc, ...extra };
}

export const ITEMS: Record<string, ItemDef> = {};

for (const it of [
  // --- raw resources -------------------------------------------------
  item('titanium', 'Titanium', 'raw', [1, 1], 'metal', 0xb9c6cf, 0x6f8794,
    'Salvaged hull alloy, reduced to workable stock. The backbone of every fabricated frame.', { mass: 1.2 }),
  item('copper', 'Copper Ore', 'raw', [1, 1], 'ore', 0xc0713a, 0x2f8f6a,
    'Native copper in a limestone matrix. Oxidises to verdigris within days of exposure.', { mass: 1.4 }),
  item('silver', 'Silver Ore', 'raw', [1, 1], 'ore', 0xcfd6dc, 0x8a949c,
    'Argentiferous galena. Tarnishes fast in sulphide-rich water but conducts beautifully.', { mass: 1.5 }),
  item('gold', 'Gold', 'raw', [1, 1], 'ore', 0xe0b64a, 0x8a6a1c,
    'Placer gold, sluiced out of a basalt seam. Inert, ductile, and useless as structure.', { mass: 1.9 }),
  item('lead', 'Lead', 'raw', [1, 1], 'metal', 0x7d838c, 0x4a5058,
    'Dense, dull, and the only thing between your marrow and a leaking reactor.', { mass: 2.6 }),
  item('lithium', 'Lithium', 'raw', [1, 1], 'crystal', 0xd8e6ef, 0x8fd6ff,
    'Spodumene crystals. Reactive enough to fizz in your palm if you break the skin of one.', { mass: 0.8 }),
  item('quartz', 'Quartz', 'raw', [1, 1], 'crystal', 0xdff2fa, 0xa9e8ff,
    'Hydrothermal quartz. Optically clear along the c-axis — the raw stock for every window.', { mass: 1 }),
  item('salt', 'Salt Crystal', 'raw', [1, 1], 'crystal', 0xf0f4f6, 0xcfe6ee,
    'Evaporite cluster from a shallow brine pocket. Preserves protein, ruins electronics.', { mass: 0.3 }),
  item('diamond', 'Diamond', 'raw', [1, 1], 'crystal', 0xe8fbff, 0xffffff,
    'Kimberlite-hosted, poorly formed, industrially perfect. Cuts anything on this planet.', { mass: 0.4 }),
  item('magnetite', 'Magnetite', 'raw', [1, 1], 'ore', 0x3a4048, 0x767f88,
    'Lodestone. Holds a field strongly enough to spin a compass card three metres away.', { mass: 1.7 }),
  item('nickel', 'Nickel Ore', 'raw', [1, 1], 'ore', 0x9fa8a2, 0x5d6b63,
    'Pentlandite from a deep ultramafic intrusion. Only found below two hundred metres.', { mass: 1.6 }),
  item('kyanite', 'Kyanite', 'raw', [1, 1], 'crystal', 0x6fa8e8, 0xbfe0ff,
    'Blue aluminosilicate blades, stable to 1200 K. Grown only near active vents.', { mass: 1.1 }),
  item('sulphur', 'Crystalline Sulphur', 'raw', [1, 1], 'crystal', 0xe6d24a, 0xfff2a0,
    'Precipitated on a vent chimney. Smells of the inside of the planet.', { mass: 0.7 }),
  item('ruby', 'Ruby', 'raw', [1, 1], 'crystal', 0xd0384a, 0xff8f9c,
    'Corundum, chromium-stained. Hard enough for bearings, pretty enough to keep one.', { mass: 0.5 }),
  item('uraninite', 'Uraninite', 'raw', [1, 1], 'ore', 0x2b3a30, 0x7ef0a0,
    'Pitchblende. Your dosimeter clicks when you hold it. Hold it briefly.', { mass: 2.2, glow: 0.35 }),

  // --- organics ------------------------------------------------------
  item('kelp_sample', 'Creepvine Sample', 'raw', [1, 1], 'plant', 0x3f7a4a, 0x9ad46a,
    'A metre of creepvine stipe. Fibrous, tough, and useful once macerated.', { mass: 0.6 }),
  item('kelp_seed', 'Creepvine Seed Cluster', 'seeds', [1, 1], 'seed', 0x6f9a3a, 0xdfff8a,
    'Photophoric seed cluster. The oil inside is a natural silicone precursor.', { glow: 0.55 }),
  item('acid_mushroom', 'Acid Mushroom', 'raw', [1, 1], 'plant', 0x8f4f8a, 0xe08fd0,
    'Vacuole fluid at pH 2.4. An excellent electrolyte and a poor snack.', { mass: 0.2 }),
  item('table_coral', 'Table Coral Sample', 'raw', [1, 1], 'shell', 0xd8c9a8, 0x9fd8c8,
    'Aragonite plate with a living polyp film. Machines into circuit substrate.', { mass: 0.9 }),
  item('coral_tube', 'Tube Coral Sample', 'raw', [1, 1], 'shell', 0xe0806a, 0xffc0a0,
    'A single hollow polyp tube, still pulsing. Do not eat.', { mass: 0.4 }),
  item('blood_oil', 'Blood Oil', 'raw', [1, 1], 'bottle', 0x7a1f2a, 0xd0505a,
    'Lipid extract from a bloodroot bulb. The base for every synthetic polymer here.', { mass: 0.5 }),
  item('gel_sack', 'Gel Sack', 'raw', [1, 1], 'food', 0xc8b04a, 0xf0e08a,
    'Buoyancy bladder from a deep-shroom. Sticky, faintly sweet, structurally useless.', { glow: 0.3 }),
  item('deep_shroom', 'Deep Shroom', 'raw', [1, 1], 'plant', 0x6a4f9a, 0xc0a0ff,
    'Chemosynthetic fungus. The bioluminescence is a lure, not a courtesy.', { glow: 0.6 }),
  item('fish_peeper', 'Peeper', 'consumable', [1, 1], 'fish', 0xd8c46a, 0x6fc8e0,
    'Curious, edible, and fast enough to embarrass you. 220 kcal cooked.', { mass: 0.8 }),
  item('fish_bladder', 'Bladderfish', 'consumable', [1, 1], 'fish', 0xc0d8e0, 0xffe08a,
    'Filters its own drinking water. So can you, with a filtration press.', { mass: 0.6 }),
  item('fish_boomerang', 'Boomerang', 'consumable', [1, 1], 'fish', 0x4f9ac8, 0xffd06a,
    'Swims in a lazy arc because its fins are asymmetric. Tastes of nothing.', { mass: 0.7 }),
  item('fish_garry', 'Garryfish', 'consumable', [1, 1], 'fish', 0xd88f4a, 0x8fe0c0,
    'Territorial, sluggish, and the most calorie-dense thing in the shallows.', { mass: 0.9 }),
  item('creature_egg', 'Unidentified Egg', 'raw', [1, 1], 'egg', 0xd0d8c0, 0x9ff0d0,
    'Leathery, warm, and moving. Incubate it or put it back. Choose quickly.', { glow: 0.25 }),

  // --- basic materials ----------------------------------------------
  item('fiber_mesh', 'Fibre Mesh', 'basic', [1, 1], 'metal', 0x9aa87a, 0x6f7f52,
    'Woven creepvine fibre. Tensile strength comparable to aramid, at a tenth the cost.'),
  item('silicone', 'Silicone Rubber', 'basic', [1, 1], 'metal', 0xd8d8d0, 0x9a9a92,
    'Cross-linked seed oil. Seals every hatch and every cuff you own.'),
  item('glass', 'Glass', 'basic', [1, 1], 'metal', 0xa8e0f0, 0xdff8ff,
    'Fused quartz. Rated to 1500 m before the crazing starts.'),
  item('bleach', 'Bleach', 'basic', [1, 2], 'bottle', 0xe8f0f2, 0x8fd8ff,
    'Sodium hypochlorite from salt and water. Sterilises water, ruins fabric.'),
  item('lubricant', 'Lubricant', 'basic', [1, 1], 'bottle', 0xc8a84a, 0xf0d88a,
    'Refined creepvine oil. Keeps a seamoth from screaming on every turn.'),
  item('titanium_ingot', 'Titanium Ingot', 'basic', [2, 2], 'metal', 0xc8d4dc, 0x7f929e,
    'Ten units of titanium, sintered into one billet. Base plate stock.', { mass: 12 }),
  item('plasteel', 'Plasteel Ingot', 'advanced', [2, 2], 'metal', 0xdfe8ef, 0x8fd0ff,
    'Lithium-doped titanium laminate. Halves hull stress at every depth rating.', { mass: 9 }),
  item('enameled_glass', 'Enamelled Glass', 'advanced', [1, 1], 'metal', 0xbfe8f4, 0xffffff,
    'Glass with a stannic oxide enamel. Survives what plain glass does not.'),
  item('aerogel', 'Aerogel', 'advanced', [1, 1], 'metal', 0xdfe6ea, 0xa0f0ff,
    'Ninety-eight percent void. Weighs nothing, insulates absurdly, crushes if you look at it wrong.'),
  item('benzene', 'Benzene', 'advanced', [1, 1], 'bottle', 0xb0a04a, 0xe8d86a,
    'Aromatic ring stock from three deep shrooms. Precursor to polyaniline.'),
  item('polyaniline', 'Polyaniline', 'advanced', [1, 1], 'bottle', 0x4a5a9a, 0x8fa0ff,
    'Conductive polymer. Doubles the depth rating of any hull it is sprayed into.'),
  item('hydrochloric', 'Hydrochloric Acid', 'advanced', [1, 1], 'bottle', 0xd8e84a, 0xf8ff9a,
    'Etchant for circuit boards. Also for the deck, your gloves, and your afternoon.'),

  // --- electronics --------------------------------------------------
  item('wiring_kit', 'Wiring Kit', 'electronics', [2, 1], 'circuit', 0x3a4a52, 0xd8a04a,
    'A loom of silver-cored leads with a moulded strain relief.'),
  item('adv_wiring_kit', 'Advanced Wiring Kit', 'electronics', [2, 2], 'circuit', 0x2f4048, 0xffc85a,
    'Gold bus bars, three wiring kits, and a shielded backplane.'),
  item('computer_chip', 'Computer Chip', 'electronics', [1, 1], 'circuit', 0x1f3a3a, 0x6ff0c0,
    'Table-coral substrate, gold traces, a single hand-etched die.'),
  item('battery', 'Battery', 'electronics', [1, 2], 'battery', 0x2a3a44, 0xffd24a,
    'Acid-mushroom cell in a copper can. 100 units, non-rechargeable in the field.'),
  item('power_cell', 'Power Cell', 'electronics', [2, 2], 'battery', 0x2f3f4a, 0x6fe8ff,
    'Two batteries in a silicone-potted housing. 200 units, hot-swappable.'),
  item('reactor_rod', 'Reactor Rod', 'module', [2, 2], 'battery', 0x24382c, 0x8fff8f,
    'Sintered uraninite in a lead sleeve. Do not carry it against your spine.', { glow: 0.5 }),
  item('ion_cube', 'Ion Cube', 'advanced', [1, 1], 'crystal', 0x2a1f4a, 0xc08fff,
    'A perfect 40 mm cube of something that should not exist. Warm. Humming.', { glow: 0.9 }),

  // --- tools & equipment -------------------------------------------
  item('scanner', 'Scanner', 'tools', [2, 1], 'device', 0xd8862a, 0x8fe8ff,
    'Structured-light scanner. Two full passes and the databank writes itself.'),
  item('welder', 'Repair Tool', 'tools', [2, 1], 'tool', 0xc85a2a, 0xffb04a,
    'Friction-stir welder. Fixes hulls, seals leaks, cauterises regrets.'),
  item('knife', 'Survival Knife', 'tools', [2, 1], 'tool', 0x9aa4ac, 0x2f4a54,
    'Diamond-edged, titanium-spined, and the most-used object you will ever own.'),
  item('flashlight', 'Flashlight', 'tools', [1, 2], 'device', 0x3a4a52, 0xfff0c0,
    'Sealed to 900 m. Eighty lumens is more than enough to regret pointing it down.'),
  item('builder', 'Habitat Builder', 'tools', [2, 2], 'device', 0xd8a02a, 0x8fd8ff,
    'Projects a molecular scaffold and grows structure into it. Needs open water and patience.'),
  item('propulsion_cannon', 'Propulsion Cannon', 'tools', [2, 2], 'tool', 0xc8b04a, 0x6fc8ff,
    'Grabs and throws anything under 500 kg. The most fun and least safe tool aboard.'),
  item('laser_cutter', 'Laser Cutter', 'tools', [2, 1], 'tool', 0xd04a3a, 0xff8f6a,
    'Cuts sealed bulkheads. Draws forty units per door, so choose your doors.'),
  item('tank', 'High Capacity O₂ Tank', 'equipment', [2, 3], 'tank', 0xd8d8d0, 0x6fd8ff,
    'Ninety seconds of air, four kilograms of drag. Every dive is that trade.', { mass: 4 }),
  item('rebreather', 'Rebreather', 'equipment', [2, 2], 'suit', 0x2f3f48, 0x8fe0ff,
    'CO₂ scrubber loop. Removes the depth penalty on oxygen consumption entirely.'),
  item('fins', 'Swim Charge Fins', 'equipment', [2, 2], 'suit', 0x2a3a44, 0x6fe8c0,
    'Induction coils in the blade. Swimming recharges what you carry.'),
  item('dive_suit', 'Reinforced Dive Suit', 'equipment', [2, 3], 'suit', 0x2a3238, 0xd88f4a,
    'Aramid weave over closed-cell neoprene. Turns a lethal bite into a bad one.'),
  item('compass_tool', 'Compass', 'equipment', [1, 1], 'device', 0x9aa4ac, 0x6fd8ff,
    'Magnetite card in an oil-filled housing. Tells you where north was.'),

  // --- consumables --------------------------------------------------
  item('water_filtered', 'Filtered Water', 'consumable', [1, 2], 'bottle', 0xa8e0f0, 0xffffff,
    'Half a litre, potable. Twenty percent hydration and a moment of dignity.'),
  item('water_disinfected', 'Disinfected Water', 'consumable', [1, 2], 'bottle', 0xbfe8f4, 0xdfffff,
    'Bleached, boiled, and tasteless. Thirty percent hydration.'),
  item('nutrient_block', 'Nutrient Block', 'consumable', [1, 1], 'food', 0x8f7a4a, 0xd8c08a,
    'Compressed protein and cellulose. Never spoils. Never pleases.'),
  item('cooked_peeper', 'Cooked Peeper', 'consumable', [1, 1], 'food', 0xd8a04a, 0xffd08a,
    'Seared through. Twice the calories, none of the wriggling.'),
  item('cured_peeper', 'Cured Peeper', 'consumable', [1, 1], 'food', 0xc08f5a, 0xe8c89a,
    'Salted and dried. Keeps indefinitely, costs you water to eat.'),

  // --- fragments ----------------------------------------------------
  item('frag_seamoth', 'Seamoth Fragment', 'fragment', [2, 2], 'fragment', 0x8f9aa4, 0x6fc8e0,
    'A shattered thruster cowling. Three more and the blueprint resolves.'),
  item('frag_moonpool', 'Moonpool Fragment', 'fragment', [2, 2], 'fragment', 0x7f8a94, 0x8fd8ff,
    'A section of docking clamp with the hydraulics still charged.'),
  item('frag_beacon', 'Beacon Fragment', 'fragment', [1, 2], 'fragment', 0x9a8f7a, 0xffc86a,
    'Transponder housing, cracked. The emitter coil is intact.'),
  item('frag_thermal', 'Thermal Plant Fragment', 'fragment', [2, 2], 'fragment', 0x8a7a6a, 0xff8f4a,
    'A heat exchanger fin, warped by whatever cooked it.'),

  // --- blueprints / data -------------------------------------------
  item('data_box', 'Data Box', 'fragment', [2, 2], 'blueprint', 0x2f4048, 0x6fe8ff,
    'A sealed blueprint cache from a previous expedition. Someone did not come back for it.'),
]) {
  ITEMS[it.id] = it;
}

/** Never returns undefined — unknown ids get a plausible generated stub. */
export function itemDef(id: string): ItemDef {
  const found = ITEMS[id];
  if (found) return found;
  const pretty = id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const stub: ItemDef = {
    id,
    name: pretty,
    category: 'raw',
    footprint: [1, 1],
    archetype: 'fragment',
    tint: 0x8f9aa4,
    accent: 0x6fc8e0,
    desc: 'No databank entry. Scan a sample to populate this record.',
  };
  ITEMS[id] = stub;
  return stub;
}

/* ------------------------------------------------------------------ *
 * Recipes
 * ------------------------------------------------------------------ */

export const RECIPES: RecipeDef[] = [
  // Basic materials
  { id: 'r_fiber', output: 'fiber_mesh', count: 1, ingredients: [{ id: 'kelp_sample', count: 2 }], station: 'fabricator', group: 'Basic materials', time: 1.6 },
  { id: 'r_silicone', output: 'silicone', count: 1, ingredients: [{ id: 'kelp_seed', count: 1 }], station: 'fabricator', group: 'Basic materials', time: 1.6 },
  { id: 'r_glass', output: 'glass', count: 1, ingredients: [{ id: 'quartz', count: 2 }], station: 'fabricator', group: 'Basic materials', time: 2 },
  { id: 'r_bleach', output: 'bleach', count: 1, ingredients: [{ id: 'salt', count: 1 }, { id: 'water_filtered', count: 1 }], station: 'fabricator', group: 'Basic materials', time: 2.2 },
  { id: 'r_lubricant', output: 'lubricant', count: 1, ingredients: [{ id: 'kelp_seed', count: 1 }], station: 'fabricator', group: 'Basic materials', time: 1.4 },
  { id: 'r_ingot', output: 'titanium_ingot', count: 1, ingredients: [{ id: 'titanium', count: 10 }], station: 'fabricator', group: 'Basic materials', time: 3.4 },
  { id: 'r_hcl', output: 'hydrochloric', count: 1, ingredients: [{ id: 'salt', count: 1 }, { id: 'acid_mushroom', count: 2 }], station: 'fabricator', group: 'Basic materials', time: 2.4 },

  // Advanced materials
  { id: 'r_plasteel', output: 'plasteel', count: 1, ingredients: [{ id: 'titanium_ingot', count: 1 }, { id: 'lithium', count: 2 }], station: 'fabricator', group: 'Advanced materials', time: 4.5, requires: 'plasteel' },
  { id: 'r_enamel', output: 'enameled_glass', count: 1, ingredients: [{ id: 'glass', count: 1 }, { id: 'sulphur', count: 1 }], station: 'fabricator', group: 'Advanced materials', time: 3 },
  { id: 'r_aerogel', output: 'aerogel', count: 1, ingredients: [{ id: 'gel_sack', count: 1 }, { id: 'ruby', count: 1 }], station: 'fabricator', group: 'Advanced materials', time: 3.4 },
  { id: 'r_benzene', output: 'benzene', count: 1, ingredients: [{ id: 'deep_shroom', count: 3 }], station: 'fabricator', group: 'Advanced materials', time: 3 },
  { id: 'r_polyaniline', output: 'polyaniline', count: 1, ingredients: [{ id: 'gold', count: 1 }, { id: 'hydrochloric', count: 1 }], station: 'fabricator', group: 'Advanced materials', time: 3.6 },

  // Electronics
  { id: 'r_wiring', output: 'wiring_kit', count: 1, ingredients: [{ id: 'silver', count: 2 }], station: 'fabricator', group: 'Electronics', time: 2.2 },
  { id: 'r_adv_wiring', output: 'adv_wiring_kit', count: 1, ingredients: [{ id: 'wiring_kit', count: 2 }, { id: 'gold', count: 2 }], station: 'fabricator', group: 'Electronics', time: 4 },
  { id: 'r_chip', output: 'computer_chip', count: 1, ingredients: [{ id: 'table_coral', count: 2 }, { id: 'gold', count: 1 }], station: 'fabricator', group: 'Electronics', time: 3.2 },
  { id: 'r_battery', output: 'battery', count: 1, ingredients: [{ id: 'acid_mushroom', count: 2 }, { id: 'copper', count: 1 }], station: 'fabricator', group: 'Electronics', time: 2.4 },
  { id: 'r_powercell', output: 'power_cell', count: 1, ingredients: [{ id: 'battery', count: 2 }, { id: 'silicone', count: 1 }], station: 'fabricator', group: 'Electronics', time: 3.6 },
  { id: 'r_reactor_rod', output: 'reactor_rod', count: 1, ingredients: [{ id: 'uraninite', count: 3 }, { id: 'lead', count: 1 }], station: 'fabricator', group: 'Electronics', time: 5, requires: 'nuclear' },

  // Equipment
  { id: 'r_tank', output: 'tank', count: 1, ingredients: [{ id: 'titanium', count: 3 }, { id: 'silicone', count: 1 }], station: 'fabricator', group: 'Equipment', time: 3 },
  { id: 'r_rebreather', output: 'rebreather', count: 1, ingredients: [{ id: 'fiber_mesh', count: 1 }, { id: 'wiring_kit', count: 1 }], station: 'fabricator', group: 'Equipment', time: 3.4 },
  { id: 'r_fins', output: 'fins', count: 1, ingredients: [{ id: 'silicone', count: 2 }, { id: 'power_cell', count: 1 }], station: 'fabricator', group: 'Equipment', time: 4, requires: 'swimcharge' },
  { id: 'r_suit', output: 'dive_suit', count: 1, ingredients: [{ id: 'fiber_mesh', count: 2 }, { id: 'silicone', count: 1 }], station: 'fabricator', group: 'Equipment', time: 4.2 },
  { id: 'r_compass', output: 'compass_tool', count: 1, ingredients: [{ id: 'magnetite', count: 1 }, { id: 'wiring_kit', count: 1 }], station: 'fabricator', group: 'Equipment', time: 2.6 },

  // Tools
  { id: 'r_scanner', output: 'scanner', count: 1, ingredients: [{ id: 'titanium', count: 1 }, { id: 'battery', count: 1 }], station: 'fabricator', group: 'Tools', time: 2.8 },
  { id: 'r_knife', output: 'knife', count: 1, ingredients: [{ id: 'titanium', count: 1 }, { id: 'silicone', count: 1 }], station: 'fabricator', group: 'Tools', time: 2.2 },
  { id: 'r_flashlight', output: 'flashlight', count: 1, ingredients: [{ id: 'glass', count: 1 }, { id: 'battery', count: 1 }], station: 'fabricator', group: 'Tools', time: 2.4 },
  { id: 'r_welder', output: 'welder', count: 1, ingredients: [{ id: 'titanium', count: 1 }, { id: 'silicone', count: 1 }, { id: 'battery', count: 1 }], station: 'fabricator', group: 'Tools', time: 3 },
  { id: 'r_builder', output: 'builder', count: 1, ingredients: [{ id: 'computer_chip', count: 1 }, { id: 'battery', count: 1 }, { id: 'titanium', count: 2 }], station: 'fabricator', group: 'Tools', time: 4.4 },
  { id: 'r_lasercutter', output: 'laser_cutter', count: 1, ingredients: [{ id: 'diamond', count: 2 }, { id: 'battery', count: 1 }, { id: 'titanium', count: 1 }], station: 'workbench', group: 'Tools', time: 4.6, requires: 'lasercutter' },
  { id: 'r_propulsion', output: 'propulsion_cannon', count: 1, ingredients: [{ id: 'computer_chip', count: 1 }, { id: 'magnetite', count: 1 }, { id: 'battery', count: 1 }], station: 'workbench', group: 'Tools', time: 4.8, requires: 'propulsion' },

  // Sustenance
  { id: 'r_water', output: 'water_filtered', count: 1, ingredients: [{ id: 'fish_bladder', count: 2 }], station: 'fabricator', group: 'Sustenance', time: 2 },
  { id: 'r_water2', output: 'water_disinfected', count: 1, ingredients: [{ id: 'bleach', count: 1 }], station: 'fabricator', group: 'Sustenance', time: 2 },
  { id: 'r_cook', output: 'cooked_peeper', count: 1, ingredients: [{ id: 'fish_peeper', count: 1 }], station: 'fabricator', group: 'Sustenance', time: 1.8 },
  { id: 'r_cure', output: 'cured_peeper', count: 1, ingredients: [{ id: 'fish_peeper', count: 1 }, { id: 'salt', count: 1 }], station: 'fabricator', group: 'Sustenance', time: 2 },
  { id: 'r_nutrient', output: 'nutrient_block', count: 1, ingredients: [{ id: 'kelp_sample', count: 1 }, { id: 'fish_garry', count: 1 }], station: 'fabricator', group: 'Sustenance', time: 2.4 },
];

export function recipeFor(itemId: string): RecipeDef | undefined {
  return RECIPES.find((r) => r.output === itemId);
}

/* ------------------------------------------------------------------ *
 * Databank
 * ------------------------------------------------------------------ */

export const DATABANK: DatabankEntry[] = [
  {
    id: 'db_creepvine', title: 'Creepvine', category: 'flora', diagram: 'plant', seed: 11, depth: '15 – 80 m',
    body: [
      'A colonial brown alga anchored by a calcified holdfast, reaching thirty metres from floor to canopy. Gas bladders along the stipe hold it vertical without any structural tissue at all.',
      'The seed clusters are photophoric: a symbiotic bacterium in the seed coat fluoresces at 480 nm when disturbed. The effect is bright enough to read a display by, and appears to attract the small grazers that keep the blades clear of epiphytes.',
      'Assessment: harvest the stipe for fibre and the seeds for silicone precursor. The canopy is the safest place in the shallows — nothing large can turn inside it.',
    ],
  },
  {
    id: 'db_peeper', title: 'Peeper', category: 'fauna', diagram: 'fish', seed: 23, threat: 'passive', depth: '0 – 120 m',
    body: [
      'A small pelagic omnivore with disproportionate eyes and a surface-breaching habit — it takes air at the interface and can hold it for six minutes.',
      'Peepers school loosely and investigate anything new, including you, including your tools. They are the only local species observed moving between biomes on a daily cycle.',
      'Assessment: edible, abundant, and a reliable indicator. Where the peepers stop, something eats peepers.',
    ],
  },
  {
    id: 'db_stalker', title: 'Stalker', category: 'fauna', diagram: 'fish', seed: 37, threat: 'aggressive', depth: '40 – 160 m',
    body: [
      'Four metres of muscle with a jaw built for shearing rather than crushing. Restricted to creepvine forests, where it uses the stipes as cover to close distance.',
      'Stalkers collect metal. Individuals have been observed carrying scrap for hundreds of metres and dropping it at communal sites. Teeth are shed constantly during this behaviour, and the shed enamel is an excellent diamond substrate.',
      'Assessment: it will bite your tools out of your hands before it bites you. Bring a spare. Do not corner one.',
    ],
  },
  {
    id: 'db_reaper', title: 'Reaper Leviathan', category: 'fauna', diagram: 'fish', seed: 53, threat: 'lethal', depth: '80 – 300 m',
    body: [
      'Fifty-five metres from mandible to fluke. Four grasping appendages, a terminal jaw, and an echolocation call at 22 Hz that you will feel in your sternum before you hear it.',
      'It is an ambush predator that patrols the open water between reef walls. It does not investigate; it commits.',
      'Assessment: if the low call is getting louder, you are already inside its approach. Get to the floor, get behind geometry, and stay there.',
    ],
  },
  {
    id: 'db_shallows', title: 'Safe Shallows', category: 'geology', diagram: 'ore', seed: 67, depth: '0 – 60 m',
    body: [
      'A carbonate platform floored in fine bioclastic sand, punctuated by patch reefs and limestone outcrops. Visibility routinely exceeds forty metres at noon.',
      'The absence of large predators is not an accident of population: the platform is too shallow for a leviathan to manoeuvre and the reef structure blocks a charging approach.',
      'Assessment: build here. Every material needed for basic fabrication is within sixty metres of the drop point.',
    ],
  },
  {
    id: 'db_vents', title: 'Hydrothermal Vents', category: 'geology', diagram: 'crystal', seed: 79, depth: '180 – 600 m',
    body: [
      'Black smoker chimneys precipitating sulphides at 340 °C into 4 °C water. The thermal gradient across one metre of vent wall exceeds anything in the biosphere.',
      'Kyanite grows only in this gradient. So does the chemosynthetic mat that every deep grazer depends on.',
      'Assessment: a thermal plant sited within eight metres of an active chimney will run indefinitely. Anything closer will not.',
    ],
  },
  {
    id: 'db_lifepod', title: 'Lifepod 5', category: 'technology', diagram: 'module', seed: 91,
    body: [
      'Emergency escape module, single-occupant, rated for ninety days of autonomous operation. Fabricator, medical bay, radio, and a solar cell with a bad connector.',
      'The pod is your only guaranteed source of breathable atmosphere until a habitat is pressurised. It also holds the only working long-range transmitter within two hundred kilometres.',
      'Assessment: keep it repaired. Everything else is optional.',
    ],
  },
  {
    id: 'db_precursor', title: 'Anomalous Structure', category: 'lore', diagram: 'device', seed: 103,
    body: [
      'Non-native construction. Load-bearing members of an aluminium-titanium-scandium alloy that is not manufactured anywhere in Alterran space, joined without fasteners or welds.',
      'Interior surfaces carry a repeating four-glyph motif. The same motif appears on the ion cubes recovered nearby, which hold a charge density three orders of magnitude beyond anything in the catalogue.',
      'Assessment: whoever built this was here for a long time and left on purpose. Find out why.',
    ],
  },
  {
    id: 'db_signal_pod', title: 'Signal: Lifepod 12', category: 'signal', diagram: 'blueprint', seed: 117,
    body: [
      'Automated distress beacon, 121.5 MHz, transmitting a pod identifier and a decaying battery telemetry string.',
      'No voice traffic. The beacon has been running for eleven days.',
      'Assessment: a pod that is transmitting has power. A pod that is not answering does not have a survivor. Recover the fabricator caps and the data box.',
    ],
  },
  {
    id: 'db_kyanite', title: 'Kyanite', category: 'geology', diagram: 'crystal', seed: 131, depth: '> 900 m',
    body: [
      'Triclinic aluminosilicate, forming blue blades in high-pressure metamorphic rock. Retains structural integrity to 1200 K, which is why every deep hull uses it.',
      'It occurs only in the lava-adjacent zones, in outcrops that are themselves inside the thermal envelope of an active flow.',
      'Assessment: you will need a rated hull and a cooled suit before this becomes a resource rather than a fact.',
    ],
  },
  {
    id: 'db_bloodkelp', title: 'Blood Kelp Zone', category: 'geology', diagram: 'plant', seed: 149, depth: '250 – 500 m',
    body: [
      'A column forest of heterotrophic vines with no photosynthetic tissue at all. They feed on particulate rain from the shallows and glow to attract the things that produce it.',
      'Ambient light here is under 0.1 lux at noon. Your eyes will adapt; your depth perception will not.',
      'Assessment: the bulbs yield blood oil, the only local source of aromatic hydrocarbons. Bring two light sources.',
    ],
  },
  {
    id: 'db_o2', title: 'Oxygen Management', category: 'technology', diagram: 'tank', seed: 163,
    body: [
      'A standard tank holds forty-five seconds of surface-pressure air. Consumption scales with ambient pressure, so the same tank is worth thirty seconds at 150 m and twenty at 300 m.',
      'A rebreather scrubs CO₂ from the exhaled loop and removes the depth penalty entirely. It is the single highest-value item you can fabricate.',
      'Assessment: plan every dive on half your air. The other half is the trip back, and the trip back is always longer.',
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Quests
 * ------------------------------------------------------------------ */

export const QUESTS: QuestDef[] = [
  {
    id: 'q_survive', title: 'Immediate Survival', priority: 'primary',
    summary: 'The pod is intact but the hull breach vented your supplies. Secure air, water and calories before anything else.',
    objectives: ['Fabricate a survival knife', 'Secure a source of drinking water', 'Fabricate a high-capacity oxygen tank'],
  },
  {
    id: 'q_repair_pod', title: 'Repair Lifepod 5', priority: 'primary',
    summary: 'Two hull plates and the solar connector are compromised. The radio will not transmit until the pod holds pressure.',
    objectives: ['Fabricate a repair tool', 'Weld the two breached hull plates', 'Re-seat the solar cell connector'],
  },
  {
    id: 'q_radio', title: 'Answer the Radio', priority: 'primary',
    summary: 'The pod radio has queued four messages. Each one resolves to a set of coordinates.',
    objectives: ['Restore pod power', 'Play the queued transmissions', 'Log the first signal to the beacon list'],
  },
  {
    id: 'q_habitat', title: 'Establish a Habitat', priority: 'secondary',
    summary: 'A pressurised base removes the oxygen ceiling on everything you do. Start with a foundation and one multipurpose room.',
    objectives: ['Recover habitat builder fragments', 'Place a foundation on level floor', 'Pressurise a multipurpose room'],
  },
  {
    id: 'q_deep', title: 'Beyond the Shallows', priority: 'secondary',
    summary: 'Everything past the reef wall needs a depth rating you do not have. Build toward it.',
    objectives: ['Scan a seamoth fragment', 'Fabricate a rebreather', 'Reach 200 m and return'],
  },
  {
    id: 'q_structure', title: 'The Anomalous Structure', priority: 'optional',
    summary: 'Something down there is emitting a directed pulse every ninety seconds. It is not one of ours.',
    objectives: ['Triangulate the pulse source', 'Recover an ion cube', 'Scan the four-glyph motif'],
  },
];

/* ------------------------------------------------------------------ *
 * Base-building modules
 * ------------------------------------------------------------------ */

export const BUILD_MODULES: BuildModuleDef[] = [
  { id: 'foundation', name: 'Foundation', group: 'structure', cost: [{ id: 'titanium', count: 2 }], archetype: 'module', size: [4, 4], maxSlope: 14, desc: 'Levels the floor and gives every attached room its load path.' },
  { id: 'corridor_i', name: 'Corridor', group: 'structure', cost: [{ id: 'titanium', count: 2 }], archetype: 'module', size: [2, 4], maxSlope: 22, needsHost: true, desc: 'Straight pressure corridor. Snaps to any open hull port.' },
  { id: 'corridor_t', name: 'T Corridor', group: 'structure', cost: [{ id: 'titanium', count: 2 }], archetype: 'module', size: [3, 3], maxSlope: 22, needsHost: true, desc: 'Three-way junction. Costs one extra bulkhead of hull integrity.' },
  { id: 'room_multi', name: 'Multipurpose Room', group: 'structure', cost: [{ id: 'titanium_ingot', count: 1 }], archetype: 'module', size: [6, 6], maxSlope: 10, desc: 'Six-metre pressure sphere. The only module that takes interior fittings.' },
  { id: 'moonpool', name: 'Moonpool', group: 'structure', cost: [{ id: 'titanium_ingot', count: 2 }, { id: 'lubricant', count: 1 }, { id: 'adv_wiring_kit', count: 1 }], archetype: 'module', size: [8, 6], maxSlope: 6, desc: 'Docks and recharges a vehicle in atmosphere. Needs very flat floor.' },
  { id: 'hatch', name: 'Hatch', group: 'exterior', cost: [{ id: 'titanium', count: 1 }, { id: 'quartz', count: 1 }], archetype: 'module', size: [2, 2], maxSlope: 30, needsHost: true, desc: 'Pressure door. A habitat with no hatch is a very expensive tank.' },
  { id: 'window', name: 'Reinforced Window', group: 'exterior', cost: [{ id: 'glass', count: 2 }], archetype: 'module', size: [2, 2], maxSlope: 30, needsHost: true, desc: 'Enamelled pane. Costs hull integrity; worth every point of it.' },
  { id: 'reinforcement', name: 'Bulkhead Reinforcement', group: 'exterior', cost: [{ id: 'titanium', count: 3 }, { id: 'lithium', count: 1 }], archetype: 'module', size: [2, 2], maxSlope: 30, needsHost: true, desc: 'Adds seven points of hull integrity to one wall segment.' },
  { id: 'solar', name: 'Solar Panel', group: 'power', cost: [{ id: 'quartz', count: 2 }, { id: 'titanium', count: 1 }, { id: 'copper', count: 1 }], archetype: 'device', size: [2, 2], maxSlope: 24, desc: 'Seventy-five units at noon at ten metres. Nothing below eighty.' },
  { id: 'thermal', name: 'Thermal Plant', group: 'power', cost: [{ id: 'titanium', count: 3 }, { id: 'wiring_kit', count: 1 }, { id: 'magnetite', count: 1 }], archetype: 'device', size: [3, 3], maxSlope: 18, desc: 'Scales with local water temperature. Site it on a vent field.' },
  { id: 'bioreactor', name: 'Bioreactor', group: 'power', cost: [{ id: 'titanium', count: 3 }, { id: 'wiring_kit', count: 1 }, { id: 'lubricant', count: 1 }], archetype: 'device', size: [2, 2], maxSlope: 8, needsHost: true, desc: 'Digests organic matter for power. Interior fitting only.' },
  { id: 'nuclear', name: 'Nuclear Reactor', group: 'power', cost: [{ id: 'plasteel', count: 1 }, { id: 'lead', count: 3 }, { id: 'adv_wiring_kit', count: 1 }], archetype: 'device', size: [4, 4], maxSlope: 6, needsHost: true, desc: 'Two hundred and fifty units per rod. Depleted rods must be stored.' },
  { id: 'locker', name: 'Wall Locker', group: 'interior', cost: [{ id: 'titanium', count: 2 }], archetype: 'module', size: [1, 2], maxSlope: 90, needsHost: true, desc: 'Eighteen cells of storage, labelled from the PDA.' },
  { id: 'fabricator_unit', name: 'Fabricator', group: 'interior', cost: [{ id: 'titanium', count: 1 }, { id: 'gold', count: 1 }, { id: 'table_coral', count: 1 }], archetype: 'device', size: [1, 2], maxSlope: 90, needsHost: true, desc: 'The full recipe list, in atmosphere, without a dive timer.' },
  { id: 'planter', name: 'Interior Planter', group: 'utility', cost: [{ id: 'titanium', count: 2 }, { id: 'glass', count: 1 }], archetype: 'plant', size: [2, 2], maxSlope: 90, needsHost: true, desc: 'Grows land and water flora indoors. Renewable fibre and food.' },
  { id: 'scanner_room', name: 'Scanner Room', group: 'utility', cost: [{ id: 'titanium', count: 5 }, { id: 'gold', count: 1 }, { id: 'table_coral', count: 2 }], archetype: 'device', size: [5, 5], maxSlope: 12, desc: 'Maps one resource type within five hundred metres. Draws heavily.' },
  { id: 'beacon', name: 'Beacon', group: 'utility', cost: [{ id: 'titanium', count: 1 }, { id: 'copper', count: 1 }], archetype: 'device', size: [1, 1], maxSlope: 40, desc: 'A named marker on the HUD, visible from any depth.' },
];

/**
 * Build modules also need icons, so each one is registered as a pseudo-item
 * under `mod_<id>`. The icon factory then treats them like anything else.
 */
for (const m of BUILD_MODULES) {
  const tints: Record<BuildModuleDef['group'], [number, number]> = {
    structure: [0xb9c6cf, 0x6fd8ff],
    exterior: [0xa8c0cc, 0x8fe8ff],
    interior: [0x9fb0ba, 0x6fe8c0],
    power: [0xc8b04a, 0xffe08a],
    utility: [0x8fa8b4, 0xc08fff],
  };
  const [tint, accent] = tints[m.group];
  ITEMS[`mod_${m.id}`] = {
    id: `mod_${m.id}`,
    name: m.name,
    category: 'module',
    footprint: [2, 2],
    archetype: m.archetype,
    tint,
    accent,
    desc: m.desc,
  };
}

/* ------------------------------------------------------------------ *
 * Depth bands
 * ------------------------------------------------------------------ */

export interface DepthBand {
  id: string;
  label: string;
  /** Inclusive lower bound in metres of depth. */
  from: number;
  /** Accent colour used by the depth readout. */
  color: string;
  /** Shown under the band label when relevant. */
  note?: string;
}

export const DEPTH_BANDS: DepthBand[] = [
  { id: 'surface', label: 'Surface', from: 0, color: '#8ff0ff' },
  { id: 'shallows', label: 'Shallows', from: 6, color: '#7fe8ff' },
  { id: 'sunlit', label: 'Sunlit Zone', from: 40, color: '#6ddcf5' },
  { id: 'twilight', label: 'Twilight Zone', from: 100, color: '#59b7e0', note: 'Light loss' },
  { id: 'deep', label: 'Deep Zone', from: 200, color: '#4a8fc4', note: 'Hull stress' },
  { id: 'abyssal', label: 'Abyssal Zone', from: 450, color: '#3d6ba8', note: 'Crush depth' },
  { id: 'void', label: 'The Void', from: 900, color: '#5a52b0', note: 'No floor' },
];

export function depthBand(depth: number): DepthBand {
  let out = DEPTH_BANDS[0];
  for (const b of DEPTH_BANDS) if (depth >= b.from) out = b;
  return out;
}

/* ------------------------------------------------------------------ *
 * Runtime extension point for the systems agent
 * ------------------------------------------------------------------ */

export interface CataloguePatch {
  items?: ItemDef[];
  recipes?: RecipeDef[];
  databank?: DatabankEntry[];
  quests?: QuestDef[];
  modules?: BuildModuleDef[];
}

/**
 * Merges externally-authored content into the UI catalogue. Safe to call at any
 * time; the PDA rebuilds its lists on next open.
 */
export function mergeCatalogue(patch: CataloguePatch): void {
  for (const it of patch.items ?? []) ITEMS[it.id] = { ...ITEMS[it.id], ...it };
  for (const r of patch.recipes ?? []) {
    const i = RECIPES.findIndex((x) => x.id === r.id);
    if (i >= 0) RECIPES[i] = r;
    else RECIPES.push(r);
  }
  for (const d of patch.databank ?? []) {
    const i = DATABANK.findIndex((x) => x.id === d.id);
    if (i >= 0) DATABANK[i] = d;
    else DATABANK.push(d);
  }
  for (const q of patch.quests ?? []) {
    const i = QUESTS.findIndex((x) => x.id === q.id);
    if (i >= 0) QUESTS[i] = q;
    else QUESTS.push(q);
  }
  for (const m of patch.modules ?? []) {
    const i = BUILD_MODULES.findIndex((x) => x.id === m.id);
    if (i >= 0) BUILD_MODULES[i] = m;
    else BUILD_MODULES.push(m);
  }
}

/**
 * CRAFTING RECIPE TREE — data only.
 *
 * Recipes are keyed by their own id (usually `craft.<output>`), state which
 * station can print them, how long the print takes, and which tech node has to
 * be unlocked first. The tree is genuinely a tree: plasteel needs lithium and
 * titanium ingots, an ingot needs ten titanium, and a deep suit needs all three.
 */

import type { Ingredient } from './Inventory';

export type StationType =
  | 'fabricator'
  | 'workbench'
  | 'moonpool'
  | 'scanner_room'
  | 'bioreactor'
  | 'water_filtration'
  | 'habitat_builder';

export type RecipeCategory =
  | 'resources'
  | 'basic_materials'
  | 'advanced_materials'
  | 'electronics'
  | 'tools'
  | 'equipment'
  | 'upgrades'
  | 'food'
  | 'water'
  | 'medical'
  | 'deployables'
  | 'habitat';

export interface RecipeDef {
  id: string;
  /** What comes out. */
  output: Ingredient;
  ingredients: Ingredient[];
  /** Seconds of fabricator animation. */
  time: number;
  station: StationType;
  category: RecipeCategory;
  /** Tech node that must be unlocked. Absent = known from the start. */
  requires?: string;
  /** Display order hint inside a category. */
  tier: number;
  /** Optional flavour line shown in the fabricator UI. */
  note?: string;
}

const g = (id: string, count = 1): Ingredient => ({ id, count });

const LIST: RecipeDef[] = [
  /* ---------------- resource processing ---------------- */
  {
    id: 'craft.titanium', output: g('titanium', 2), ingredients: [g('limestone_chunk')],
    time: 2.5, station: 'fabricator', category: 'resources', tier: 0,
    note: 'Crush, sinter, cast. Two billets per chunk if the seam ran true.',
  },
  {
    id: 'craft.copper_ore', output: g('copper_ore'), ingredients: [g('limestone_chunk')],
    time: 2.5, station: 'fabricator', category: 'resources', tier: 0,
  },
  {
    id: 'craft.quartz_from_sandstone', output: g('quartz'), ingredients: [g('sandstone_chunk')],
    time: 2.5, station: 'fabricator', category: 'resources', tier: 0,
  },
  {
    id: 'craft.silver_from_sandstone', output: g('silver_ore'), ingredients: [g('sandstone_chunk')],
    time: 2.5, station: 'fabricator', category: 'resources', tier: 0,
  },
  {
    id: 'craft.titanium_ingot', output: g('titanium_ingot'), ingredients: [g('titanium', 10)],
    time: 8, station: 'fabricator', category: 'resources', tier: 1,
    note: 'The press runs hot enough to fog the compartment.',
  },
  {
    id: 'craft.titanium_from_ingot', output: g('titanium', 10), ingredients: [g('titanium_ingot')],
    time: 6, station: 'fabricator', category: 'resources', tier: 1,
  },

  /* ---------------- basic materials ---------------- */
  {
    id: 'craft.glass', output: g('glass'), ingredients: [g('quartz', 2)],
    time: 3, station: 'fabricator', category: 'basic_materials', tier: 0,
  },
  {
    id: 'craft.silicone_rubber', output: g('silicone_rubber'), ingredients: [g('creepvine_seed')],
    time: 3, station: 'fabricator', category: 'basic_materials', tier: 0,
    note: 'The seed oil polymerises the moment it meets the catalyst plate.',
  },
  {
    id: 'craft.fibre_mesh', output: g('fibre_mesh'), ingredients: [g('creepvine_sample', 2)],
    time: 3, station: 'fabricator', category: 'basic_materials', tier: 0,
  },
  {
    id: 'craft.copper_wire', output: g('copper_wire'), ingredients: [g('copper_ore', 2)],
    time: 3, station: 'fabricator', category: 'basic_materials', tier: 0,
  },
  {
    id: 'craft.bleach', output: g('bleach'), ingredients: [g('salt_crystal'), g('salt_crystal')],
    time: 4, station: 'fabricator', category: 'basic_materials', tier: 0,
  },
  {
    id: 'craft.lubricant', output: g('lubricant'), ingredients: [g('gel_sack')],
    time: 3, station: 'fabricator', category: 'basic_materials', tier: 0,
  },
  {
    id: 'craft.hydrochloric_acid', output: g('hydrochloric_acid'), ingredients: [g('acid_mushroom', 2), g('salt_crystal')],
    time: 5, station: 'fabricator', category: 'basic_materials', tier: 1,
  },
  {
    id: 'craft.benzene', output: g('benzene'), ingredients: [g('blood_oil', 3)],
    time: 6, station: 'fabricator', category: 'advanced_materials', tier: 1,
    requires: 'tech.advanced_materials',
  },
  {
    id: 'craft.synthetic_fibres', output: g('synthetic_fibres'), ingredients: [g('benzene'), g('fibre_mesh')],
    time: 6, station: 'fabricator', category: 'advanced_materials', tier: 2,
    requires: 'tech.advanced_materials',
  },
  {
    id: 'craft.aerogel', output: g('aerogel'), ingredients: [g('gel_sack'), g('quartz', 2)],
    time: 7, station: 'fabricator', category: 'advanced_materials', tier: 2,
    requires: 'tech.advanced_materials',
  },
  {
    id: 'craft.polyaniline', output: g('polyaniline'), ingredients: [g('gold'), g('hydrochloric_acid')],
    time: 7, station: 'fabricator', category: 'advanced_materials', tier: 2,
    requires: 'tech.advanced_materials',
  },
  {
    id: 'craft.plasteel_ingot', output: g('plasteel_ingot'), ingredients: [g('titanium_ingot'), g('lithium', 2)],
    time: 12, station: 'fabricator', category: 'advanced_materials', tier: 3,
    requires: 'tech.plasteel',
    note: 'Nine minutes of cycling pressure, compressed by the fabricator into twelve seconds you can watch.',
  },
  {
    id: 'craft.enamelled_glass', output: g('enamelled_glass'), ingredients: [g('glass'), g('ruby')],
    time: 9, station: 'fabricator', category: 'advanced_materials', tier: 3,
    requires: 'tech.plasteel',
  },

  /* ---------------- electronics & power ---------------- */
  {
    id: 'craft.battery', output: g('battery'), ingredients: [g('acid_mushroom', 2), g('copper_ore')],
    time: 4, station: 'fabricator', category: 'electronics', tier: 0,
  },
  {
    id: 'craft.computer_chip', output: g('computer_chip'), ingredients: [g('table_coral_sample'), g('gold'), g('copper_wire')],
    time: 6, station: 'fabricator', category: 'electronics', tier: 1,
    requires: 'tech.electronics',
  },
  {
    id: 'craft.wiring_kit', output: g('wiring_kit'), ingredients: [g('silver_ore', 2)],
    time: 5, station: 'fabricator', category: 'electronics', tier: 1,
    requires: 'tech.electronics',
  },
  {
    id: 'craft.advanced_wiring_kit', output: g('advanced_wiring_kit'), ingredients: [g('wiring_kit'), g('computer_chip'), g('gold', 2)],
    time: 9, station: 'fabricator', category: 'electronics', tier: 2,
    requires: 'tech.advanced_electronics',
  },
  {
    id: 'craft.power_cell', output: g('power_cell'), ingredients: [g('battery', 2), g('silicone_rubber')],
    time: 6, station: 'fabricator', category: 'electronics', tier: 1,
    requires: 'tech.power_cell',
  },
  {
    id: 'craft.ion_battery', output: g('ion_battery'), ingredients: [g('kyanite'), g('diamond')],
    time: 8, station: 'fabricator', category: 'electronics', tier: 3,
    requires: 'tech.ion_power',
  },
  {
    id: 'craft.ion_power_cell', output: g('ion_power_cell'), ingredients: [g('ion_battery', 2), g('silicone_rubber')],
    time: 10, station: 'fabricator', category: 'electronics', tier: 3,
    requires: 'tech.ion_power',
  },
  {
    id: 'craft.reactor_rod', output: g('reactor_rod'), ingredients: [g('lead', 3), g('crystalline_sulphur', 2), g('titanium', 2)],
    time: 14, station: 'workbench', category: 'electronics', tier: 3,
    requires: 'tech.nuclear',
  },

  /* ---------------- tools ---------------- */
  {
    id: 'craft.scanner', output: g('scanner'), ingredients: [g('titanium'), g('battery')],
    time: 5, station: 'fabricator', category: 'tools', tier: 0,
    note: 'Emitter, coil, and a lens ground out of the wreck viewport.',
  },
  {
    id: 'craft.survival_knife', output: g('survival_knife'), ingredients: [g('titanium'), g('silicone_rubber')],
    time: 4, station: 'fabricator', category: 'tools', tier: 0,
  },
  {
    id: 'craft.flashlight', output: g('flashlight'), ingredients: [g('titanium'), g('glass'), g('battery')],
    time: 5, station: 'fabricator', category: 'tools', tier: 0,
  },
  {
    id: 'craft.habitat_builder', output: g('habitat_builder'), ingredients: [g('titanium', 2), g('computer_chip'), g('battery')],
    time: 8, station: 'fabricator', category: 'tools', tier: 1,
    requires: 'tech.habitat_builder',
  },
  {
    id: 'craft.repair_tool', output: g('repair_tool'), ingredients: [g('titanium'), g('silicone_rubber'), g('battery')],
    time: 6, station: 'fabricator', category: 'tools', tier: 1,
    requires: 'tech.repair_tool',
  },
  {
    id: 'craft.seaglide', output: g('seaglide'), ingredients: [g('titanium'), g('lubricant'), g('power_cell'), g('copper_wire')],
    time: 10, station: 'fabricator', category: 'tools', tier: 2,
    requires: 'tech.seaglide',
  },
  {
    id: 'craft.laser_cutter', output: g('laser_cutter'), ingredients: [g('titanium', 2), g('diamond', 2), g('battery')],
    time: 10, station: 'fabricator', category: 'tools', tier: 2,
    requires: 'tech.laser_cutter',
  },
  {
    id: 'craft.thermoblade', output: g('thermoblade'), ingredients: [g('survival_knife'), g('battery'), g('titanium')],
    time: 7, station: 'workbench', category: 'upgrades', tier: 2,
    requires: 'tech.thermoblade',
  },
  {
    id: 'craft.propulsion_cannon', output: g('propulsion_cannon'), ingredients: [g('titanium', 2), g('computer_chip'), g('battery'), g('wiring_kit')],
    time: 12, station: 'fabricator', category: 'tools', tier: 2,
    requires: 'tech.propulsion_cannon',
  },
  {
    id: 'craft.stasis_rifle', output: g('stasis_rifle'), ingredients: [g('computer_chip'), g('magnetite', 2), g('titanium', 2), g('battery')],
    time: 12, station: 'fabricator', category: 'tools', tier: 3,
    requires: 'tech.stasis_rifle',
  },
  {
    id: 'craft.beacon', output: g('beacon'), ingredients: [g('titanium'), g('copper_wire')],
    time: 4, station: 'fabricator', category: 'deployables', tier: 1,
    requires: 'tech.beacon',
  },
  {
    id: 'craft.air_bladder', output: g('air_bladder'), ingredients: [g('bladderfish'), g('silicone_rubber')],
    time: 5, station: 'fabricator', category: 'equipment', tier: 1,
    requires: 'tech.air_bladder',
  },

  /* ---------------- equipment ---------------- */
  {
    id: 'craft.standard_tank', output: g('standard_tank'), ingredients: [g('titanium', 3)],
    time: 6, station: 'fabricator', category: 'equipment', tier: 0,
  },
  {
    id: 'craft.fins', output: g('fins'), ingredients: [g('silicone_rubber', 2)],
    time: 5, station: 'fabricator', category: 'equipment', tier: 0,
  },
  {
    id: 'craft.high_capacity_tank', output: g('high_capacity_tank'), ingredients: [g('standard_tank'), g('titanium', 3), g('silicone_rubber', 2)],
    time: 9, station: 'workbench', category: 'equipment', tier: 1,
    requires: 'tech.high_capacity_tank',
  },
  {
    id: 'craft.lightweight_tank', output: g('lightweight_tank'), ingredients: [g('standard_tank'), g('plasteel_ingot'), g('aerogel')],
    time: 11, station: 'workbench', category: 'equipment', tier: 3,
    requires: 'tech.lightweight_tank',
  },
  {
    id: 'craft.ultra_glide_fins', output: g('ultra_glide_fins'), ingredients: [g('fins'), g('silicone_rubber'), g('aerogel')],
    time: 8, station: 'workbench', category: 'equipment', tier: 2,
    requires: 'tech.ultra_glide_fins',
  },
  {
    id: 'craft.rebreather', output: g('rebreather'), ingredients: [g('fibre_mesh'), g('wiring_kit')],
    time: 7, station: 'fabricator', category: 'equipment', tier: 1,
    requires: 'tech.rebreather',
  },
  {
    id: 'craft.radiation_suit', output: g('radiation_suit'), ingredients: [g('fibre_mesh', 2), g('lead', 2)],
    time: 9, station: 'fabricator', category: 'equipment', tier: 2,
    requires: 'tech.radiation_suit',
  },
  {
    id: 'craft.reinforced_dive_suit', output: g('reinforced_dive_suit'), ingredients: [g('fibre_mesh', 2), g('silicone_rubber', 2), g('stalker_tooth', 2)],
    time: 11, station: 'workbench', category: 'equipment', tier: 2,
    requires: 'tech.reinforced_suit',
  },
  {
    id: 'craft.pressure_suit_mk2', output: g('pressure_suit_mk2'), ingredients: [g('reinforced_dive_suit'), g('kyanite', 2), g('aerogel'), g('synthetic_fibres')],
    time: 16, station: 'workbench', category: 'equipment', tier: 4,
    requires: 'tech.pressure_suit_mk2',
    note: 'The compensator has to be tuned wet. Expect to lose an afternoon.',
  },
  {
    id: 'craft.compass', output: g('compass'), ingredients: [g('copper_wire'), g('magnetite')],
    time: 5, station: 'fabricator', category: 'equipment', tier: 1,
    requires: 'tech.compass',
  },
  {
    id: 'craft.oxygen_chip', output: g('oxygen_chip'), ingredients: [g('computer_chip'), g('bladderfish', 2)],
    time: 6, station: 'fabricator', category: 'equipment', tier: 2,
    requires: 'tech.oxygen_chip',
  },

  /* ---------------- food, water, medical ---------------- */
  {
    id: 'craft.cooked_peeper', output: g('cooked_peeper'), ingredients: [g('peeper')],
    time: 2, station: 'fabricator', category: 'food', tier: 0,
  },
  {
    id: 'craft.cured_peeper', output: g('cured_peeper'), ingredients: [g('peeper'), g('salt_crystal')],
    time: 3, station: 'fabricator', category: 'food', tier: 0,
  },
  {
    id: 'craft.cooked_reginald', output: g('cooked_reginald'), ingredients: [g('reginald')],
    time: 2.5, station: 'fabricator', category: 'food', tier: 0,
  },
  {
    id: 'craft.nutrient_block', output: g('nutrient_block'), ingredients: [g('cured_peeper'), g('bulb_bush_sample'), g('salt_crystal')],
    time: 6, station: 'fabricator', category: 'food', tier: 1,
    requires: 'tech.nutrient_block',
  },
  {
    id: 'craft.disinfected_water', output: g('disinfected_water'), ingredients: [g('bleach')],
    time: 3, station: 'fabricator', category: 'water', tier: 0,
  },
  {
    id: 'craft.filtered_water', output: g('filtered_water'), ingredients: [g('bulb_bush_sample', 2)],
    time: 3, station: 'fabricator', category: 'water', tier: 0,
  },
  {
    id: 'craft.large_filtered_water', output: g('large_filtered_water', 2), ingredients: [g('salt_crystal', 2)],
    time: 20, station: 'water_filtration', category: 'water', tier: 1,
    requires: 'tech.water_filtration',
    note: 'The unit runs continuously. Come back when the tank light goes green.',
  },
  {
    id: 'craft.first_aid_kit', output: g('first_aid_kit'), ingredients: [g('fibre_mesh'), g('gel_sack')],
    time: 5, station: 'fabricator', category: 'medical', tier: 1,
    requires: 'tech.first_aid',
  },
  {
    id: 'craft.floodlight', output: g('floodlight'), ingredients: [g('titanium', 2), g('glass'), g('battery')],
    time: 7, station: 'fabricator', category: 'deployables', tier: 1,
    requires: 'tech.floodlight',
  },
  {
    id: 'craft.waterproof_locker', output: g('waterproof_locker'), ingredients: [g('titanium', 4)],
    time: 8, station: 'fabricator', category: 'deployables', tier: 1,
    requires: 'tech.waterproof_locker',
  },
];

export const RECIPES: ReadonlyMap<string, RecipeDef> = new Map(LIST.map((r) => [r.id, r]));
export const RECIPE_LIST: readonly RecipeDef[] = LIST;

export function recipeDef(id: string): RecipeDef | undefined {
  return RECIPES.get(id);
}

/** All recipes that produce a given item id. */
export function recipesProducing(itemId: string): RecipeDef[] {
  return LIST.filter((r) => r.output.id === itemId);
}

export function recipesForStation(station: StationType): RecipeDef[] {
  return LIST.filter((r) => r.station === station);
}

/**
 * Recursively expands a recipe into raw-resource totals. Used by the PDA to show
 * "you still need 14 titanium" rather than only the immediate ingredients.
 */
export function expandToRaw(recipeId: string, out = new Map<string, number>(), depth = 0): Map<string, number> {
  if (depth > 8) return out;
  const r = RECIPES.get(recipeId);
  if (!r) return out;
  for (const ing of r.ingredients) {
    const sub = recipesProducing(ing.id)[0];
    if (sub && sub.id !== recipeId) {
      const batches = Math.ceil(ing.count / Math.max(1, sub.output.count));
      for (let i = 0; i < batches; i++) expandToRaw(sub.id, out, depth + 1);
    } else {
      out.set(ing.id, (out.get(ing.id) ?? 0) + ing.count);
    }
  }
  return out;
}

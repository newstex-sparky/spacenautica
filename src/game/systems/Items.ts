/**
 * ITEM DATABASE — data-driven, in code, zero external assets.
 *
 * Every item carries:
 *  - `mass` (kg) and `stack` (max per stack)
 *  - `w`/`h`: the Subnautica-style 2D grid footprint in inventory cells
 *  - `icon`: *parameters* for a procedurally generated icon. The UI agent reads
 *    these and rasterises them; nothing here loads an image.
 *  - `description`: written text, shown in the PDA.
 *  - `category` + `tags` for filtering.
 *
 * Nothing in this file imports three.js — it is pure data so the HUD can read it
 * without pulling in the renderer.
 */

export type ItemCategory =
  | 'raw'          // mined / harvested straight from the world
  | 'refined'      // fabricator intermediates
  | 'tool'         // held, has durability/charge
  | 'equipment'    // worn, modifies vitals or depth rating
  | 'consumable'   // eaten / drunk / applied
  | 'sample'       // creature + flora samples, scanner food
  | 'blueprint'    // data boxes that unlock tech on use
  | 'building';    // deployables placed by the habitat builder

/** Shape archetype for the procedural icon renderer. */
export type IconShape =
  | 'ore' | 'crystal' | 'ingot' | 'shard' | 'sphere' | 'canister' | 'cell'
  | 'chip' | 'coil' | 'plant' | 'seed' | 'fish' | 'egg' | 'meat' | 'flask'
  | 'tool' | 'suit' | 'tank' | 'fins' | 'mask' | 'fabric' | 'module' | 'card';

/**
 * Deterministic recipe for drawing an item icon. The renderer is expected to
 * build a small canvas (or a tiny three.js scene) from these numbers — the same
 * inputs must always produce the same picture.
 */
export interface IconParams {
  shape: IconShape;
  /** Primary albedo, 0xRRGGBB. */
  tint: number;
  /** Accent used for veins, seams, rims, highlights. */
  accent: number;
  /** 0..1 emissive strength (bioluminescence, powered indicators). */
  glow: number;
  /** 0..1 surface complexity: facet count, greeble density, vein noise. */
  detail: number;
  /** 0..1 metalness. */
  metal: number;
  /** 0..1 roughness. */
  rough: number;
  /** Deterministic per-item seed derived from the id. */
  seed: number;
}

export type EquipSlot = 'head' | 'body' | 'gloves' | 'feet' | 'tank' | 'chip' | 'hand';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  /** Kilograms. Drives encumbrance and vehicle balance. */
  mass: number;
  /** Max units per grid cell group. 1 = never stacks. */
  stack: number;
  /** Grid footprint in cells. */
  w: number;
  h: number;
  description: string;
  icon: IconParams;
  /** Free-form flags: 'edible', 'flammable', 'deep', 'organic', 'metal'… */
  tags: string[];

  /* --- consumable --- */
  food?: number;
  water?: number;
  heal?: number;
  /** Instant oxygen top-up (bladderfish, air bladder). */
  oxygen?: number;
  /** Real seconds before an uncured organic decays into `decaysTo`. */
  decay?: number;
  decaysTo?: string;

  /* --- equipment --- */
  slot?: EquipSlot;
  /** Metres of crush depth this grants (suits). */
  depthRating?: number;
  /** Extra oxygen capacity in seconds (tanks). */
  oxygenBonus?: number;
  /** Multiplier on swim speed (fins). */
  swimSpeed?: number;
  /** Multiplier on oxygen drain (rebreather < 1). */
  oxygenEfficiency?: number;
  /** Flat damage reduction fraction 0..1. */
  armour?: number;

  /* --- tool --- */
  /** Battery capacity in seconds of continuous use. 0 = unpowered. */
  charge?: number;
  /** Charge drained per second of use. */
  drain?: number;
  /** Melee/harvest damage. */
  damage?: number;

  /* --- world hints (read by props/fauna for spawn tables) --- */
  foundIn?: string[];
  /** Outcrop / harvest source that yields this. */
  source?: string;

  /* --- links --- */
  /** Tech node this blueprint item unlocks when used. */
  unlocks?: string;
  /** Databank entry surfaced alongside this item. */
  databank?: string;
}

/* ------------------------------------------------------------------ *
 * Construction helpers — keep the table below readable.
 * ------------------------------------------------------------------ */

function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 1000000;
}

function ic(
  shape: IconShape,
  tint: number,
  accent: number,
  glow = 0,
  detail = 0.5,
  metal = 0,
  rough = 0.6,
): Omit<IconParams, 'seed'> {
  return { shape, tint, accent, glow, detail, metal, rough };
}

type ItemInit = Omit<ItemDef, 'mass' | 'stack' | 'w' | 'h' | 'tags' | 'icon'> & {
  mass?: number;
  stack?: number;
  w?: number;
  h?: number;
  tags?: string[];
  icon: Omit<IconParams, 'seed'>;
};

function def(init: ItemInit): ItemDef {
  return {
    mass: 1,
    stack: 5,
    w: 1,
    h: 1,
    tags: [],
    ...init,
    icon: { ...init.icon, seed: seedOf(init.id) },
  };
}

/* ------------------------------------------------------------------ *
 * THE TABLE
 * ------------------------------------------------------------------ */

const LIST: ItemDef[] = [
  /* ---------------- raw resources: metals & minerals ---------------- */
  def({
    id: 'titanium', name: 'Titanium', category: 'raw', mass: 2.4, stack: 10,
    icon: ic('ingot', 0x9aa3ab, 0x3a4148, 0, 0.45, 0.85, 0.42),
    tags: ['metal', 'salvage'],
    source: 'limestone_outcrop', foundIn: ['shallows', 'kelp_forest', 'grassy_plateau'],
    description:
      'Salvaged plating, melted down and recast into a workable billet. Light, ' +
      'stubbornly corrosion-proof, and the backbone of every habitat you will ever build.',
  }),
  def({
    id: 'copper_ore', name: 'Copper Ore', category: 'raw', mass: 3.1, stack: 10,
    icon: ic('ore', 0xb4643a, 0x2f7a63, 0, 0.7, 0.5, 0.72),
    tags: ['metal'], source: 'limestone_outcrop',
    foundIn: ['shallows', 'kelp_forest', 'grassy_plateau', 'mushroom_forest'],
    description:
      'A knuckle of ore streaked with green oxide. Conducts well enough to carry ' +
      'a habitat\'s nervous system.',
  }),
  def({
    id: 'quartz', name: 'Quartz', category: 'raw', mass: 1.4, stack: 10,
    icon: ic('crystal', 0xdfe9ee, 0x8fb8c6, 0.05, 0.85, 0.05, 0.14),
    tags: ['mineral'], source: 'sandstone_outcrop',
    foundIn: ['shallows', 'kelp_forest', 'grassy_plateau', 'red_grass'],
    description:
      'Hexagonal, water-clear, faintly warm in the hand. Fused into glass it is ' +
      'the only thing between you and four hundred metres of pressure.',
  }),
  def({
    id: 'silver_ore', name: 'Silver Ore', category: 'raw', mass: 2.7, stack: 10,
    icon: ic('ore', 0xc9cfd4, 0x54606b, 0, 0.65, 0.7, 0.5),
    tags: ['metal'], source: 'sandstone_outcrop',
    foundIn: ['grassy_plateau', 'red_grass', 'mushroom_forest'],
    description: 'Tarnished grey nodules. The best signal conductor you can dig out of a reef.',
  }),
  def({
    id: 'gold', name: 'Gold', category: 'raw', mass: 4.2, stack: 10,
    icon: ic('ore', 0xd9a72c, 0x5a4310, 0, 0.6, 0.9, 0.32),
    tags: ['metal'], source: 'shale_outcrop',
    foundIn: ['red_grass', 'mushroom_forest', 'blood_kelp'],
    description:
      'Soft, heavy, contact-perfect. Alterra\'s cost accountants would like a word ' +
      'about how much of it you just put inside a wiring kit.',
  }),
  def({
    id: 'lead', name: 'Lead', category: 'raw', mass: 5.6, stack: 10,
    icon: ic('ingot', 0x6e7278, 0x2c2f34, 0, 0.35, 0.65, 0.58),
    tags: ['metal', 'shielding'], source: 'sandstone_outcrop',
    foundIn: ['grassy_plateau', 'red_grass', 'blood_kelp'],
    description:
      'Dull, dense and dead to radiation. You will be very grateful for it later, ' +
      'when the reactor readings stop being theoretical.',
  }),
  def({
    id: 'lithium', name: 'Lithium', category: 'raw', mass: 1.1, stack: 10,
    icon: ic('crystal', 0xe3e8ea, 0xa8b4bb, 0.02, 0.7, 0.4, 0.3),
    tags: ['metal'], source: 'shale_outcrop',
    foundIn: ['mushroom_forest', 'blood_kelp', 'lost_river'],
    description: 'Feather-light metal in flaky plates. Doubles the bite of any power cell.',
  }),
  def({
    id: 'ruby', name: 'Ruby', category: 'raw', mass: 1.6, stack: 10,
    icon: ic('crystal', 0xb4243a, 0x4a0a14, 0.12, 0.9, 0.1, 0.1),
    tags: ['mineral', 'deep'], source: 'shale_outcrop',
    foundIn: ['blood_kelp', 'lost_river'],
    description:
      'Corundum, blood-dark, grown in a fissure nobody was ever meant to see. ' +
      'Grinds into an optical window that laughs at pressure.',
  }),
  def({
    id: 'magnetite', name: 'Magnetite', category: 'raw', mass: 3.4, stack: 10,
    icon: ic('ore', 0x2d3136, 0x6d7480, 0, 0.55, 0.6, 0.66),
    tags: ['metal', 'deep'], source: 'basalt_outcrop',
    foundIn: ['mushroom_forest', 'lost_river', 'lava_zone'],
    description:
      'Iron oxide with a memory. Your compass swings when you hold it, which is ' +
      'either useful or a warning depending on where you found it.',
  }),
  def({
    id: 'diamond', name: 'Diamond', category: 'raw', mass: 1.2, stack: 10,
    icon: ic('crystal', 0xeef6fa, 0xbfe0ea, 0.18, 0.95, 0.02, 0.05),
    tags: ['mineral', 'deep'], source: 'shale_outcrop',
    foundIn: ['lost_river', 'lava_zone'],
    description: 'Carbon under an unreasonable amount of persuasion. Cuts anything softer than itself.',
  }),
  def({
    id: 'crystalline_sulphur', name: 'Crystalline Sulphur', category: 'raw', mass: 1.8, stack: 10,
    icon: ic('crystal', 0xe2c53a, 0x7a5c08, 0.22, 0.8, 0.05, 0.34),
    tags: ['mineral', 'volatile', 'deep'], source: 'sulphur_pod',
    foundIn: ['lava_zone'],
    description:
      'Yellow blades grown around a vent, still smelling of the planet\'s insides. ' +
      'Handle it upstream of anything you care about.',
  }),
  def({
    id: 'kyanite', name: 'Kyanite', category: 'raw', mass: 2.2, stack: 10,
    icon: ic('crystal', 0x2f74c9, 0x0b2a52, 0.28, 0.85, 0.08, 0.18),
    tags: ['mineral', 'deep', 'heatproof'], source: 'basalt_outcrop',
    foundIn: ['lava_zone'],
    description:
      'Blue lamellae that refuse to conduct heat. Everything rated for the lava ' +
      'zone has a sliver of this in it somewhere.',
  }),
  def({
    id: 'nickel_ore', name: 'Nickel Ore', category: 'raw', mass: 3.0, stack: 10,
    icon: ic('ore', 0x9a9d86, 0x3c4030, 0, 0.6, 0.7, 0.5),
    tags: ['metal', 'deep'], source: 'basalt_outcrop', foundIn: ['lost_river'],
    description: 'Greenish nodules from the river bed. Alloys that hate to give up their shape.',
  }),
  def({
    id: 'salt_crystal', name: 'Salt Crystal', category: 'raw', mass: 0.6, stack: 20,
    icon: ic('crystal', 0xf1f4f6, 0xc6d4da, 0, 0.5, 0.02, 0.5),
    tags: ['mineral', 'organic'], source: 'seafloor',
    foundIn: ['shallows', 'kelp_forest', 'grassy_plateau'],
    description:
      'A cube of the ocean, dried out and left behind. Cures fish, purifies water, ' +
      'and tastes like the inside of your own mask.',
  }),

  /* ---------------- raw resources: rock outcrops ---------------- */
  def({
    id: 'limestone_chunk', name: 'Limestone Chunk', category: 'raw', mass: 4.5, stack: 8,
    icon: ic('ore', 0xb9b0a0, 0x6a6152, 0, 0.5, 0.05, 0.82),
    tags: ['rock'], foundIn: ['shallows', 'kelp_forest', 'grassy_plateau'],
    description: 'Pale, chalky, fossil-flecked. Crack it open for titanium or copper.',
  }),
  def({
    id: 'sandstone_chunk', name: 'Sandstone Chunk', category: 'raw', mass: 4.8, stack: 8,
    icon: ic('ore', 0xc2a172, 0x6d5433, 0, 0.55, 0.05, 0.86),
    tags: ['rock'], foundIn: ['grassy_plateau', 'red_grass', 'mushroom_forest'],
    description: 'Grainy and layered. Hides silver, gold and lead in equal disappointment.',
  }),
  def({
    id: 'shale_chunk', name: 'Shale Chunk', category: 'raw', mass: 5.2, stack: 8,
    icon: ic('ore', 0x4a4b52, 0x1d1e22, 0, 0.6, 0.08, 0.78),
    tags: ['rock', 'deep'], foundIn: ['red_grass', 'blood_kelp', 'lost_river'],
    description: 'Splits along a thousand parallel planes. The good stuff hides in the deepest laminae.',
  }),
  def({
    id: 'basalt_chunk', name: 'Basalt Chunk', category: 'raw', mass: 5.9, stack: 8,
    icon: ic('ore', 0x2b2d31, 0x121316, 0, 0.55, 0.06, 0.72),
    tags: ['rock', 'deep'], foundIn: ['lost_river', 'lava_zone'],
    description: 'Cooled fast, full of gas voids. Whatever crystallised inside it did so under protest.',
  }),

  /* ---------------- flora & organics ---------------- */
  def({
    id: 'creepvine_sample', name: 'Creepvine Sample', category: 'raw', mass: 0.7, stack: 10,
    icon: ic('plant', 0x4c7a2e, 0x9fd25a, 0.04, 0.7, 0, 0.72),
    tags: ['organic', 'kelp'], foundIn: ['kelp_forest'],
    description:
      'A metre of blade cut from a stalk forty metres tall. Wet, ropy, and stronger ' +
      'along the grain than anything Alterra sells by the reel.',
  }),
  def({
    id: 'creepvine_seed', name: 'Creepvine Seed Cluster', category: 'raw', mass: 0.9, stack: 8,
    icon: ic('seed', 0xd9c25a, 0x6f5a1a, 0.55, 0.75, 0, 0.5),
    tags: ['organic', 'kelp', 'flammable'], foundIn: ['kelp_forest'],
    description:
      'A knot of glowing pods. Squeeze one and it weeps an oil that burns on ' +
      'contact with air — which is why you keep them in your pack and not your suit.',
  }),
  def({
    id: 'acid_mushroom', name: 'Acid Mushroom', category: 'raw', mass: 0.5, stack: 10,
    icon: ic('plant', 0x9f4bbd, 0x3d1050, 0.35, 0.65, 0, 0.62),
    tags: ['organic', 'acid'], foundIn: ['shallows', 'kelp_forest', 'grassy_plateau'],
    description:
      'Violet caps that spit when you cut them. The sap eats aluminium and makes ' +
      'a perfectly serviceable battery electrolyte.',
  }),
  def({
    id: 'bulb_bush_sample', name: 'Bulbo Tree Sample', category: 'raw', mass: 0.8, stack: 8,
    icon: ic('plant', 0x7fb26b, 0xd8e39a, 0.08, 0.7, 0, 0.68),
    tags: ['organic', 'edible'], foundIn: ['grassy_plateau', 'red_grass'],
    description: 'A water-heavy bulb with papery skin. Presses into nearly a litre of drinkable fluid.',
  }),
  def({
    id: 'gel_sack', name: 'Gel Sack', category: 'raw', mass: 0.6, stack: 8,
    icon: ic('sphere', 0xe27a4a, 0x7c2f14, 0.3, 0.55, 0, 0.4),
    tags: ['organic'], foundIn: ['mushroom_forest', 'red_grass'],
    description:
      'A translucent bladder full of something between honey and hydraulic fluid. ' +
      'Rendered down it makes an excellent lubricant, and a passable antiseptic.',
  }),
  def({
    id: 'blood_oil', name: 'Blood Oil', category: 'raw', mass: 0.9, stack: 8,
    icon: ic('flask', 0x7a1220, 0x2a0308, 0.1, 0.5, 0, 0.28),
    tags: ['organic', 'deep', 'flammable'], foundIn: ['blood_kelp'],
    description:
      'Wrung from a blood vine four hundred metres down. Black in the light of ' +
      'your torch, arterial red when it thins on your gloves.',
  }),
  def({
    id: 'table_coral_sample', name: 'Table Coral Sample', category: 'raw', mass: 1.1, stack: 8,
    icon: ic('plant', 0xd88f6c, 0x6a3a24, 0.05, 0.8, 0, 0.7),
    tags: ['organic', 'mineral'], foundIn: ['shallows', 'kelp_forest'],
    description: 'A shed plate of aragonite skeleton. Kiln it and it yields a wafer that takes a circuit print.',
  }),
  def({
    id: 'deep_shroom_sample', name: 'Deep Shroom Sample', category: 'raw', mass: 0.7, stack: 8,
    icon: ic('plant', 0x6a4fa0, 0xc9a6ff, 0.5, 0.7, 0, 0.6),
    tags: ['organic', 'deep'], foundIn: ['mushroom_forest', 'blood_kelp'],
    description: 'Bioluminescent flesh that keeps glowing for hours after cutting. Nobody has told it it is dead.',
  }),
  def({
    id: 'sea_crown_seed', name: 'Sea Crown Seed', category: 'raw', mass: 0.4, stack: 8,
    icon: ic('seed', 0x8fd0c2, 0x1f5a52, 0.4, 0.6, 0, 0.45),
    tags: ['organic', 'deep', 'rare'], foundIn: ['lost_river'],
    description: 'One seed from a plant that grows nowhere the sun reaches. Plant it and it remembers the light anyway.',
  }),

  /* ---------------- creature samples ---------------- */
  def({
    id: 'peeper', name: 'Peeper', category: 'sample', mass: 1.3, stack: 4,
    icon: ic('fish', 0xd9d24a, 0x3d5a8a, 0.1, 0.6, 0, 0.44),
    tags: ['organic', 'edible', 'raw_fish'], food: 21, water: -4, decay: 900, decaysTo: 'spoiled_organics',
    foundIn: ['shallows', 'kelp_forest'],
    description: 'Round, gormless, and absolutely everywhere. First thing most survivors ever eat on this planet.',
  }),
  def({
    id: 'bladderfish', name: 'Bladderfish', category: 'sample', mass: 1.0, stack: 4,
    icon: ic('fish', 0xc7e0e8, 0x7b96a8, 0.12, 0.6, 0, 0.4),
    tags: ['organic', 'edible', 'raw_fish'], food: 12, water: 20, oxygen: 12,
    decay: 900, decaysTo: 'spoiled_organics', foundIn: ['shallows', 'blood_kelp'],
    description:
      'Carries its own gas bladder full of filtered air. Bite the bladder in an ' +
      'emergency; press the body for water in a slightly less urgent one.',
  }),
  def({
    id: 'hoverfish', name: 'Hoverfish', category: 'sample', mass: 0.9, stack: 4,
    icon: ic('fish', 0x8fd0b8, 0x2a5a4c, 0.1, 0.55, 0, 0.42),
    tags: ['organic', 'edible', 'raw_fish'], food: 16, water: -2,
    decay: 900, decaysTo: 'spoiled_organics', foundIn: ['grassy_plateau'],
    description: 'Holds station in a current with two flickering fins and infinite patience.',
  }),
  def({
    id: 'boomerang', name: 'Boomerang', category: 'sample', mass: 1.1, stack: 4,
    icon: ic('fish', 0x4aa8d9, 0xd9a24a, 0.14, 0.65, 0, 0.42),
    tags: ['organic', 'edible', 'raw_fish'], food: 18, water: -3,
    decay: 900, decaysTo: 'spoiled_organics', foundIn: ['shallows', 'kelp_forest'],
    description: 'Two mirrored lobes and no discernible front. Swims in lazy returning arcs, as advertised.',
  }),
  def({
    id: 'garryfish', name: 'Garryfish', category: 'sample', mass: 0.8, stack: 4,
    icon: ic('fish', 0xd97a4a, 0x53321c, 0.08, 0.55, 0, 0.44),
    tags: ['organic', 'edible', 'raw_fish'], food: 14, water: -2,
    decay: 900, decaysTo: 'spoiled_organics', foundIn: ['grassy_plateau', 'red_grass'],
    description: 'Small, orange, indifferent. Named by a survivor with no imagination and a friend called Garry.',
  }),
  def({
    id: 'reginald', name: 'Reginald', category: 'sample', mass: 2.1, stack: 2,
    icon: ic('fish', 0x5a7fa8, 0xe0e6ea, 0.06, 0.6, 0, 0.4),
    tags: ['organic', 'edible', 'raw_fish'], food: 30, water: -6,
    decay: 900, decaysTo: 'spoiled_organics', foundIn: ['kelp_forest', 'grassy_plateau', 'red_grass'],
    description: 'A long, tubular, mostly-mouth arrangement. Enough meat on one to skip a meal you were dreading.',
  }),
  def({
    id: 'eyeye', name: 'Eyeye', category: 'sample', mass: 1.4, stack: 4,
    icon: ic('fish', 0x8a4a9f, 0xf0e8c0, 0.16, 0.7, 0, 0.42),
    tags: ['organic', 'edible', 'raw_fish'], food: 20, water: -4,
    decay: 900, decaysTo: 'spoiled_organics', foundIn: ['red_grass', 'mushroom_forest'],
    description: 'One enormous eye bolted to a fish. It watches you the entire time you are killing it.',
  }),
  def({
    id: 'spadefish', name: 'Spadefish', category: 'sample', mass: 2.6, stack: 2,
    icon: ic('fish', 0xbfc9cf, 0x4c5a63, 0.05, 0.6, 0, 0.4),
    tags: ['organic', 'edible', 'raw_fish'], food: 26, water: -5,
    decay: 900, decaysTo: 'spoiled_organics', foundIn: ['grassy_plateau', 'red_grass'],
    description: 'Broad as a dinner plate and about as animated. Schools in slow revolving discs.',
  }),
  def({
    id: 'stalker_tooth', name: 'Stalker Tooth', category: 'sample', mass: 0.3, stack: 10,
    icon: ic('shard', 0xf0ead6, 0x7d6a4a, 0, 0.7, 0.1, 0.32),
    tags: ['organic', 'hard'], foundIn: ['kelp_forest'],
    description:
      'Shed while the animal was chewing on a piece of your ship. Enamel harder ' +
      'than the alloy it was gnawing, which should worry you.',
  }),
  def({
    id: 'stalker_egg', name: 'Stalker Egg', category: 'sample', mass: 3.4, stack: 1, w: 2, h: 2,
    icon: ic('egg', 0xc9b98a, 0x5a4a28, 0.2, 0.65, 0, 0.55),
    tags: ['organic', 'egg'], foundIn: ['kelp_forest'],
    description: 'Leathery, warm, and faintly moving. Hatches in captivity if you can stand the wait.',
  }),
  def({
    id: 'crabsnake_egg', name: 'Crabsnake Egg', category: 'sample', mass: 4.1, stack: 1, w: 2, h: 2,
    icon: ic('egg', 0x8a7a9f, 0x2f2440, 0.28, 0.7, 0, 0.5),
    tags: ['organic', 'egg', 'deep'], foundIn: ['mushroom_forest'],
    description: 'Found nested inside a hollow mushroom. The mother is somewhere very close and does not blink.',
  }),
  def({
    id: 'spoiled_organics', name: 'Spoiled Organics', category: 'sample', mass: 0.8, stack: 10,
    icon: ic('meat', 0x6b6a4a, 0x2f2f1e, 0, 0.4, 0, 0.8),
    tags: ['organic', 'waste'],
    description: 'It was food. Now it is bioreactor feedstock and a smell you cannot get out of the airlock.',
  }),

  /* ---------------- refined / intermediate goods ---------------- */
  def({
    id: 'titanium_ingot', name: 'Titanium Ingot', category: 'refined', mass: 22, stack: 3, w: 2, h: 1,
    icon: ic('ingot', 0xa9b2ba, 0x2f3439, 0, 0.35, 0.9, 0.34),
    tags: ['metal'],
    description: 'Ten billets pressed into one bar. Where large, ambitious construction starts.',
  }),
  def({
    id: 'glass', name: 'Glass', category: 'refined', mass: 1.7, stack: 8,
    icon: ic('shard', 0xcfe6ee, 0x8fb8c6, 0.04, 0.3, 0.02, 0.08),
    tags: ['brittle'],
    description: 'Quartz taken to fifteen hundred degrees and cooled with contempt for its former structure.',
  }),
  def({
    id: 'enamelled_glass', name: 'Enamelled Glass', category: 'refined', mass: 2.6, stack: 6,
    icon: ic('shard', 0xdff0f4, 0xb4243a, 0.06, 0.45, 0.05, 0.07),
    tags: ['brittle', 'pressure'],
    description:
      'Glass with a fused ruby-corundum skin. Holds a viewport open at five hundred ' +
      'metres, which normal glass emphatically does not.',
  }),
  def({
    id: 'plasteel_ingot', name: 'Plasteel Ingot', category: 'refined', mass: 18, stack: 3, w: 2, h: 1,
    icon: ic('ingot', 0x8d99a6, 0x1e2429, 0, 0.4, 0.75, 0.3),
    tags: ['metal', 'pressure'],
    description:
      'Titanium laced with lithium and a polymer matrix. Half the mass of steel and ' +
      'it does not creep under sustained pressure. The reason deep hulls exist.',
  }),
  def({
    id: 'silicone_rubber', name: 'Silicone Rubber', category: 'refined', mass: 0.9, stack: 8,
    icon: ic('fabric', 0x2f3236, 0x6f767c, 0, 0.5, 0, 0.86),
    tags: ['polymer'],
    description: 'Vulcanised creepvine sap. Every seal, gasket and fin blade in your kit is made of this.',
  }),
  def({
    id: 'fibre_mesh', name: 'Fibre Mesh', category: 'refined', mass: 0.6, stack: 8,
    icon: ic('fabric', 0x9aa07a, 0x4a4f34, 0, 0.65, 0, 0.9),
    tags: ['textile'],
    description: 'Creepvine fibre combed, twisted and woven flat. Takes a bandage or a suit lining equally well.',
  }),
  def({
    id: 'synthetic_fibres', name: 'Synthetic Fibres', category: 'refined', mass: 0.5, stack: 8,
    icon: ic('fabric', 0xd2d6c8, 0x7c8474, 0, 0.6, 0, 0.82),
    tags: ['textile'],
    description: 'Benzene-drawn filament, finer and stronger than anything the reef grows. Cold to the touch.',
  }),
  def({
    id: 'copper_wire', name: 'Copper Wire', category: 'refined', mass: 1.2, stack: 8,
    icon: ic('coil', 0xc0703a, 0x3d2411, 0, 0.7, 0.6, 0.5),
    tags: ['metal', 'electrical'],
    description: 'Drawn down to half a millimetre and spooled. Boring, essential, always the thing you have run out of.',
  }),
  def({
    id: 'wiring_kit', name: 'Wiring Kit', category: 'refined', mass: 2.4, stack: 5, w: 2, h: 1,
    icon: ic('module', 0xb9812f, 0x2b3138, 0.12, 0.8, 0.5, 0.45),
    tags: ['electrical'],
    description: 'Loom, junctions, sensor bus, gold contacts. Drop it in a bulkhead and the compartment wakes up.',
  }),
  def({
    id: 'advanced_wiring_kit', name: 'Advanced Wiring Kit', category: 'refined', mass: 4.8, stack: 3, w: 2, h: 1,
    icon: ic('module', 0xd8a63c, 0x1d2328, 0.24, 0.9, 0.6, 0.36),
    tags: ['electrical'],
    description:
      'Three wiring kits, a computer chip and a great deal of solder. Runs anything ' +
      'that has to think faster than you do.',
  }),
  def({
    id: 'computer_chip', name: 'Computer Chip', category: 'refined', mass: 0.4, stack: 5,
    icon: ic('chip', 0x2b6f5a, 0xd8c34a, 0.3, 0.95, 0.35, 0.28),
    tags: ['electrical'],
    description: 'Coral wafer, gold traces, table-salt-sized dies. Prints in ninety seconds and outlives the habitat.',
  }),
  def({
    id: 'battery', name: 'Battery', category: 'refined', mass: 1.1, stack: 5,
    icon: ic('cell', 0x2f7a3a, 0xd8d24a, 0.35, 0.6, 0.4, 0.4),
    tags: ['power'], charge: 200,
    description: 'Acid-mushroom electrolyte in a copper can. Two hundred seconds of light, or one very determined cut.',
  }),
  def({
    id: 'power_cell', name: 'Power Cell', category: 'refined', mass: 3.2, stack: 3, w: 2, h: 1,
    icon: ic('cell', 0x2f6f8a, 0x8fd2e0, 0.45, 0.65, 0.45, 0.36),
    tags: ['power'], charge: 800,
    description: 'Two batteries, a silicone jacket and a proper bus bar. The standard currency of anything that moves.',
  }),
  def({
    id: 'ion_battery', name: 'Ion Battery', category: 'refined', mass: 1.0, stack: 5,
    icon: ic('cell', 0x3a2f7a, 0x8fe0ff, 0.8, 0.75, 0.4, 0.22),
    tags: ['power', 'alien'], charge: 1000,
    description:
      'Alien crystal in a human casing. Charges from nothing anyone has identified ' +
      'and holds five times what it has any right to.',
  }),
  def({
    id: 'ion_power_cell', name: 'Ion Power Cell', category: 'refined', mass: 3.0, stack: 3, w: 2, h: 1,
    icon: ic('cell', 0x2f2f8a, 0xa8f0ff, 0.9, 0.8, 0.45, 0.2),
    tags: ['power', 'alien'], charge: 4000,
    description: 'Enough stored energy in one hand to run a small habitat for a week. It hums when you hold it.',
  }),
  def({
    id: 'lubricant', name: 'Lubricant', category: 'refined', mass: 0.8, stack: 8,
    icon: ic('flask', 0xd9b04a, 0x5a4310, 0.05, 0.4, 0, 0.3),
    tags: ['fluid'],
    description: 'Rendered gel sack. Keeps hinges, propellers and airlock rings from screaming at you.',
  }),
  def({
    id: 'bleach', name: 'Bleach', category: 'refined', mass: 1.0, stack: 6,
    icon: ic('canister', 0xe8eef0, 0x2f6f8a, 0, 0.35, 0.15, 0.45),
    tags: ['fluid', 'toxic'],
    description: 'Salt and water, electrolysed until the water gives up. Makes sea water drinkable, slowly.',
  }),
  def({
    id: 'hydrochloric_acid', name: 'Hydrochloric Acid', category: 'refined', mass: 1.2, stack: 6,
    icon: ic('flask', 0xc9d84a, 0x4a5208, 0.08, 0.4, 0, 0.26),
    tags: ['fluid', 'toxic'],
    description: 'Distilled from acid mushrooms in a fume hood you should not have had to improvise.',
  }),
  def({
    id: 'benzene', name: 'Benzene', category: 'refined', mass: 1.0, stack: 6,
    icon: ic('flask', 0xb0a08a, 0x3a3226, 0.02, 0.35, 0, 0.24),
    tags: ['fluid', 'flammable'],
    description: 'Aromatic ring stock cracked out of blood oil. Precursor to every polymer worth having.',
  }),
  def({
    id: 'polyaniline', name: 'Polyaniline', category: 'refined', mass: 1.4, stack: 6,
    icon: ic('module', 0x3f2f5a, 0x9f7ad0, 0.15, 0.6, 0.2, 0.4),
    tags: ['polymer'],
    description: 'A conducting polymer. Thin films of it are why your deep modules do not implode.',
  }),
  def({
    id: 'aerogel', name: 'Aerogel', category: 'refined', mass: 0.2, stack: 6,
    icon: ic('module', 0xdfeaf2, 0x9fc4d8, 0.1, 0.5, 0, 0.7),
    tags: ['insulator'],
    description: 'Ninety-nine percent nothing. Weighs less than the air it displaced and stops heat dead.',
  }),
  def({
    id: 'reactor_rod', name: 'Reactor Rod', category: 'refined', mass: 8.4, stack: 1, w: 1, h: 2,
    icon: ic('canister', 0x4a5a3a, 0x9fe04a, 0.7, 0.55, 0.5, 0.34),
    tags: ['power', 'radioactive'],
    description:
      'Depleted fuel in a lead sleeve. It will run a base for days and then it will ' +
      'be a problem you have to store somewhere.',
  }),

  /* ---------------- tools ---------------- */
  def({
    id: 'scanner', name: 'Scanner', category: 'tool', mass: 1.4, stack: 1, w: 2, h: 1,
    icon: ic('tool', 0xd8863a, 0x2b3138, 0.4, 0.75, 0.4, 0.42),
    tags: ['handheld', 'powered'], slot: 'hand', charge: 300, drain: 1.4,
    description:
      'Hold the trigger and let the emitter walk across the target. Full coverage ' +
      'builds a fabricator pattern; partial coverage builds only frustration.',
  }),
  def({
    id: 'survival_knife', name: 'Survival Knife', category: 'tool', mass: 0.9, stack: 1, w: 2, h: 1,
    icon: ic('tool', 0xbfc7cd, 0x2f3439, 0, 0.6, 0.85, 0.28),
    tags: ['handheld', 'melee'], slot: 'hand', damage: 22,
    description: 'Serrated on one edge, flat on the other. Cuts kelp, samples, and things that bite first.',
  }),
  def({
    id: 'thermoblade', name: 'Thermoblade', category: 'tool', mass: 1.2, stack: 1, w: 2, h: 1,
    icon: ic('tool', 0xd9542f, 0x2f3439, 0.55, 0.7, 0.7, 0.3),
    tags: ['handheld', 'melee', 'powered'], slot: 'hand', damage: 30, charge: 300, drain: 0.8,
    description: 'A knife that glows dull orange underwater. Cooks what it kills, which saves a trip home.',
  }),
  def({
    id: 'flashlight', name: 'Flashlight', category: 'tool', mass: 0.7, stack: 1, w: 1, h: 2,
    icon: ic('tool', 0x3f4348, 0xf2e6a0, 0.75, 0.55, 0.5, 0.4),
    tags: ['handheld', 'powered', 'light'], slot: 'hand', charge: 600, drain: 1,
    description: 'Twelve hundred lumens into water that swallows nine hundred of them. Still the difference between lost and found.',
  }),
  def({
    id: 'seaglide', name: 'Seaglide', category: 'tool', mass: 5.4, stack: 1, w: 2, h: 2,
    icon: ic('tool', 0xd8a63c, 0x2b3138, 0.4, 0.8, 0.45, 0.42),
    tags: ['handheld', 'powered', 'mobility'], slot: 'hand', charge: 900, drain: 1.6,
    description:
      'A ducted impeller with handlebars and a small sonar plate. Doubles your ' +
      'range, halves your dignity, and maps the floor while it drags you along.',
  }),
  def({
    id: 'habitat_builder', name: 'Habitat Builder', category: 'tool', mass: 3.1, stack: 1, w: 2, h: 2,
    icon: ic('tool', 0xd88a3a, 0x1e2429, 0.5, 0.85, 0.5, 0.38),
    tags: ['handheld', 'powered', 'build'], slot: 'hand', charge: 1200, drain: 2.4,
    description:
      'Projects a structural ghost, then prints it out of whatever is in your pack. ' +
      'Aim carefully: it will happily weld a corridor into a cliff face.',
  }),
  def({
    id: 'repair_tool', name: 'Repair Tool', category: 'tool', mass: 1.6, stack: 1, w: 2, h: 1,
    icon: ic('tool', 0xc9a13a, 0x2f3439, 0.35, 0.7, 0.5, 0.4),
    tags: ['handheld', 'powered'], slot: 'hand', charge: 600, drain: 1.2,
    description: 'A welding head on a gimbal. Closes hull breaches faster than the ocean can find them.',
  }),
  def({
    id: 'laser_cutter', name: 'Laser Cutter', category: 'tool', mass: 2.2, stack: 1, w: 2, h: 1,
    icon: ic('tool', 0xb4243a, 0x2b3138, 0.6, 0.8, 0.6, 0.34),
    tags: ['handheld', 'powered'], slot: 'hand', charge: 400, drain: 3,
    description: 'Cuts the sealed doors on wrecks. Takes ten seconds and makes the water around your visor boil.',
  }),
  def({
    id: 'propulsion_cannon', name: 'Propulsion Cannon', category: 'tool', mass: 6.2, stack: 1, w: 2, h: 2,
    icon: ic('tool', 0x8a9299, 0xd8a63c, 0.45, 0.85, 0.6, 0.36),
    tags: ['handheld', 'powered'], slot: 'hand', charge: 500, drain: 4,
    description: 'Grabs a two-hundred-kilo object and throws it. Works on crates, rocks, and — memorably — on fauna.',
  }),
  def({
    id: 'stasis_rifle', name: 'Stasis Rifle', category: 'tool', mass: 4.4, stack: 1, w: 2, h: 2,
    icon: ic('tool', 0x4a6f8a, 0xa8f0ff, 0.65, 0.9, 0.55, 0.3),
    tags: ['handheld', 'powered', 'defence'], slot: 'hand', charge: 500, drain: 5,
    description:
      'Freezes a sphere of water and everything in it. Buys you eight seconds, ' +
      'which is longer than it sounds when something has your leg.',
  }),
  def({
    id: 'beacon', name: 'Beacon', category: 'tool', mass: 1.8, stack: 5, w: 1, h: 2,
    icon: ic('tool', 0xd8542f, 0xf0f4f6, 0.8, 0.5, 0.4, 0.42),
    tags: ['deployable', 'navigation'],
    description: 'Drop it, name it, and it stays on your HUD forever. The only map this planet will give you.',
  }),
  def({
    id: 'air_bladder', name: 'Air Bladder', category: 'tool', mass: 0.8, stack: 1, w: 1, h: 2,
    icon: ic('sphere', 0xe8b04a, 0xd9542f, 0.1, 0.45, 0, 0.6),
    tags: ['handheld', 'safety'], slot: 'hand', oxygen: 0,
    description: 'Inflates and hauls you to the surface whether or not you were finished. Ask your ears afterwards.',
  }),

  /* ---------------- equipment ---------------- */
  def({
    id: 'standard_tank', name: 'Standard O2 Tank', category: 'equipment', mass: 8.5, stack: 1, w: 2, h: 2,
    icon: ic('tank', 0xd8d24a, 0x2f3439, 0, 0.5, 0.55, 0.4),
    tags: ['worn'], slot: 'tank', oxygenBonus: 30,
    description: 'Thirty extra seconds of air. Not much. Enough to be the reason you are reading this.',
  }),
  def({
    id: 'high_capacity_tank', name: 'High Capacity O2 Tank', category: 'equipment', mass: 16.2, stack: 1, w: 2, h: 3,
    icon: ic('tank', 0x3a8a5a, 0x2f3439, 0, 0.6, 0.6, 0.38),
    tags: ['worn'], slot: 'tank', oxygenBonus: 75, swimSpeed: 0.92,
    description: 'Seventy-five seconds, and a noticeable drag on your kick. Every survivor makes this trade eventually.',
  }),
  def({
    id: 'lightweight_tank', name: 'Lightweight O2 Tank', category: 'equipment', mass: 5.4, stack: 1, w: 2, h: 2,
    icon: ic('tank', 0xbfc7cd, 0x2f6f8a, 0, 0.55, 0.7, 0.34),
    tags: ['worn'], slot: 'tank', oxygenBonus: 45, swimSpeed: 1.06,
    description: 'Plasteel shell, aerogel liner. Forty-five seconds of air and no penalty for carrying it.',
  }),
  def({
    id: 'fins', name: 'Swim Fins', category: 'equipment', mass: 1.6, stack: 1, w: 2, h: 2,
    icon: ic('fins', 0x2f3236, 0x6f767c, 0, 0.55, 0, 0.82),
    tags: ['worn'], slot: 'feet', swimSpeed: 1.18,
    description: 'Silicone blades with a stiff spine. Eighteen percent more speed for the same burnt oxygen.',
  }),
  def({
    id: 'ultra_glide_fins', name: 'Ultra Glide Fins', category: 'equipment', mass: 2.1, stack: 1, w: 2, h: 2,
    icon: ic('fins', 0x1f2226, 0x8fd2e0, 0.1, 0.7, 0, 0.7),
    tags: ['worn'], slot: 'feet', swimSpeed: 1.34,
    description: 'Longer, thinner, tuned to flutter rather than kick. You will feel the difference in your calves.',
  }),
  def({
    id: 'rebreather', name: 'Rebreather', category: 'equipment', mass: 2.8, stack: 1, w: 2, h: 2,
    icon: ic('mask', 0x2f3439, 0xd8a63c, 0.1, 0.75, 0.3, 0.44),
    tags: ['worn'], slot: 'head', oxygenEfficiency: 0.55,
    description:
      'Scrubs your exhalation and hands it back. Below a hundred metres it is the ' +
      'difference between exploring and dying with a full tank.',
  }),
  def({
    id: 'radiation_suit', name: 'Radiation Suit', category: 'equipment', mass: 9.2, stack: 1, w: 2, h: 3,
    icon: ic('suit', 0xd8c93a, 0x2f3439, 0, 0.65, 0.1, 0.72),
    tags: ['worn', 'shielded'], slot: 'body', armour: 0.05,
    description: 'Lead-lined and stiff as cardboard. Wear it near the drive core or do not go near the drive core.',
  }),
  def({
    id: 'reinforced_dive_suit', name: 'Reinforced Dive Suit', category: 'equipment', mass: 7.4, stack: 1, w: 2, h: 3,
    icon: ic('suit', 0x2f4a5a, 0xd8863a, 0, 0.7, 0.15, 0.62),
    tags: ['worn', 'pressure'], slot: 'body', depthRating: 500, armour: 0.35,
    description:
      'Fibre mesh over plasteel scales. Rated to five hundred metres and it will ' +
      'shrug off a bite that would otherwise have ended the expedition.',
  }),
  def({
    id: 'pressure_suit_mk2', name: 'Reinforced Suit Mk II', category: 'equipment', mass: 11.8, stack: 1, w: 2, h: 3,
    icon: ic('suit', 0x24333f, 0x8fd2e0, 0.08, 0.8, 0.2, 0.5),
    tags: ['worn', 'pressure', 'deep'], slot: 'body', depthRating: 1000, armour: 0.45,
    description:
      'Kyanite ribbing, aerogel batting, active pressure compensation. One thousand ' +
      'metres. Past that, no fabric will help you.',
  }),
  def({
    id: 'compass', name: 'Compass', category: 'equipment', mass: 0.4, stack: 1,
    icon: ic('chip', 0x3f4348, 0xd8a63c, 0.3, 0.6, 0.4, 0.4),
    tags: ['worn', 'navigation'], slot: 'chip',
    description: 'A magnetometer chip clipped to your HUD. Lies politely near magnetite.',
  }),
  def({
    id: 'oxygen_chip', name: 'Capacity Booster Chip', category: 'equipment', mass: 0.4, stack: 1,
    icon: ic('chip', 0x2b6f5a, 0x8fd2e0, 0.4, 0.7, 0.35, 0.34),
    tags: ['worn'], slot: 'chip', oxygenBonus: 20,
    description: 'Trims your metabolic model to breathe shallower. Twenty seconds, at the cost of a headache.',
  }),

  /* ---------------- consumables ---------------- */
  def({
    id: 'cooked_peeper', name: 'Cooked Peeper', category: 'consumable', mass: 1.1, stack: 4,
    icon: ic('meat', 0xc98a4a, 0x5a3418, 0, 0.55, 0, 0.62),
    tags: ['edible'], food: 32, water: -6, decay: 2400, decaysTo: 'spoiled_organics',
    description: 'Seared through on a thermoblade. Tastes of iodine and relief.',
  }),
  def({
    id: 'cured_peeper', name: 'Cured Peeper', category: 'consumable', mass: 0.9, stack: 6,
    icon: ic('meat', 0xb08a5a, 0x4a3218, 0, 0.6, 0, 0.7),
    tags: ['edible', 'preserved'], food: 24, water: -10,
    description: 'Salted and hung. Keeps indefinitely and drinks a tenth of you on the way down.',
  }),
  def({
    id: 'cooked_reginald', name: 'Cooked Reginald', category: 'consumable', mass: 1.8, stack: 3,
    icon: ic('meat', 0xd09a5a, 0x63421c, 0, 0.6, 0, 0.6),
    tags: ['edible'], food: 44, water: -8, decay: 2400, decaysTo: 'spoiled_organics',
    description: 'Enough for a whole shift on the reef. Flakes apart in the water before you can eat it all.',
  }),
  def({
    id: 'filtered_water', name: 'Filtered Water', category: 'consumable', mass: 1.0, stack: 6,
    icon: ic('canister', 0xa8dcea, 0x2f6f8a, 0.05, 0.35, 0.1, 0.24),
    tags: ['drink'], water: 30,
    description: 'Bleach-treated, carbon-polished, faintly metallic. The most valuable thing in your pack.',
  }),
  def({
    id: 'large_filtered_water', name: 'Large Filtered Water', category: 'consumable', mass: 2.4, stack: 3, w: 1, h: 2,
    icon: ic('canister', 0x8fd2e0, 0x2f6f8a, 0.05, 0.4, 0.1, 0.22),
    tags: ['drink'], water: 55,
    description: 'A full litre from a habitat filtration unit. Drink it slowly; it took the base an hour.',
  }),
  def({
    id: 'disinfected_water', name: 'Disinfected Water', category: 'consumable', mass: 1.0, stack: 6,
    icon: ic('canister', 0xdfeef2, 0x3a8a5a, 0.04, 0.3, 0.1, 0.26),
    tags: ['drink'], water: 20,
    description: 'Bleach and sea water in a bottle. Legal, potable, unpleasant.',
  }),
  def({
    id: 'first_aid_kit', name: 'First Aid Kit', category: 'consumable', mass: 1.2, stack: 4,
    icon: ic('module', 0xf0f4f6, 0xb4243a, 0.06, 0.5, 0.05, 0.5),
    tags: ['medical'], heal: 55,
    description:
      'Fibre bandage, coagulant foam, an autoinjector of something Alterra will not ' +
      'name. Fixes bites. Does not fix judgement.',
  }),
  def({
    id: 'nutrient_block', name: 'Nutrient Block', category: 'consumable', mass: 0.9, stack: 6,
    icon: ic('module', 0xc0b48a, 0x5c5334, 0, 0.4, 0, 0.78),
    tags: ['edible', 'preserved'], food: 30, water: -4,
    description: 'Compressed protein and fibre in a foil wrap. Engineered to be adequate for a very long time.',
  }),

  /* ---------------- blueprints / data boxes ---------------- */
  def({
    id: 'databox_seaglide', name: 'Data Box: Seaglide', category: 'blueprint', mass: 4.2, stack: 1, w: 2, h: 2,
    icon: ic('card', 0x2f4a5a, 0x8fd2e0, 0.5, 0.7, 0.4, 0.36),
    tags: ['databox'], unlocks: 'tech.seaglide', databank: 'lore.databox',
    description: 'A sealed Alterra pattern crate, still blinking. Whoever dropped it did not come back for it.',
  }),
  def({
    id: 'databox_reinforced_suit', name: 'Data Box: Reinforced Dive Suit', category: 'blueprint', mass: 4.2, stack: 1, w: 2, h: 2,
    icon: ic('card', 0x2f4a5a, 0xd8863a, 0.5, 0.7, 0.4, 0.36),
    tags: ['databox'], unlocks: 'tech.reinforced_suit', databank: 'lore.databox',
    description: 'Recovered from a wreck compartment that was still holding pressure. Barely.',
  }),
  def({
    id: 'databox_moonpool', name: 'Data Box: Moonpool', category: 'blueprint', mass: 4.2, stack: 1, w: 2, h: 2,
    icon: ic('card', 0x2f4a5a, 0xd8c93a, 0.5, 0.7, 0.4, 0.36),
    tags: ['databox'], unlocks: 'tech.moonpool', databank: 'lore.databox',
    description: 'Habitat pattern for a wet dock. Someone had ambitions for this planet.',
  }),
  def({
    id: 'databox_thermal_plant', name: 'Data Box: Thermal Plant', category: 'blueprint', mass: 4.2, stack: 1, w: 2, h: 2,
    icon: ic('card', 0x2f4a5a, 0xd9542f, 0.5, 0.7, 0.4, 0.36),
    tags: ['databox'], unlocks: 'tech.thermal_plant', databank: 'lore.databox',
    description: 'Geothermal tap schematics. Found, appropriately, beside a vent that has been running for a millennium.',
  }),

  /* ---------------- deployables ---------------- */
  def({
    id: 'floodlight', name: 'Floodlight', category: 'building', mass: 6.4, stack: 2, w: 2, h: 2,
    icon: ic('module', 0x3f4348, 0xf2e6a0, 0.7, 0.6, 0.5, 0.42),
    tags: ['deployable', 'light', 'powered'],
    description: 'A staked lamp on a gimbal. Turns a black trench into a room with edges.',
  }),
  def({
    id: 'waterproof_locker', name: 'Waterproof Locker', category: 'building', mass: 9.8, stack: 1, w: 2, h: 2,
    icon: ic('module', 0x8a9299, 0xd8a63c, 0.1, 0.6, 0.6, 0.5),
    tags: ['deployable', 'storage'],
    description: 'A sealed crate you can drop on the floor and come back to. Twenty-four cells of relief.',
  }),
];

export const ITEMS: ReadonlyMap<string, ItemDef> = new Map(LIST.map((i) => [i.id, i]));
export const ITEM_LIST: readonly ItemDef[] = LIST;

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS.get(id);
}

/** Never throws — returns a visibly-wrong placeholder so the HUD cannot crash. */
export function itemDefOr(id: string): ItemDef {
  return ITEMS.get(id) ?? UNKNOWN_ITEM;
}

export const UNKNOWN_ITEM: ItemDef = def({
  id: 'unknown', name: 'Unidentified Object', category: 'raw',
  icon: ic('module', 0xff00ff, 0x000000, 0.5, 0.5, 0, 0.5),
  description: 'Your PDA has no pattern for this. It refuses to speculate.',
});

export function itemsByCategory(cat: ItemCategory): ItemDef[] {
  return LIST.filter((i) => i.category === cat);
}

export function itemsWithTag(tag: string): ItemDef[] {
  return LIST.filter((i) => i.tags.includes(tag));
}

/** Total footprint area in grid cells, used for encumbrance heuristics. */
export function itemCells(id: string): number {
  const d = itemDefOr(id);
  return d.w * d.h;
}

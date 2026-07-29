/**
 * TECH TREE — prerequisites plus depth gating.
 *
 * A node becomes *available* when every prerequisite is unlocked and the player
 * has actually been deep enough to have plausibly found the hardware. It becomes
 * *unlocked* when the scanner finishes the required fragment count, a data box
 * is used, or a quest grants it. Unlocking a node reveals its recipes and build
 * pieces; nothing else in the game reads recipe availability directly.
 */

export type TechCategory =
  | 'survival' | 'materials' | 'electronics' | 'tools' | 'equipment'
  | 'habitat' | 'power' | 'deep' | 'story';

export interface TechNode {
  id: string;
  name: string;
  description: string;
  category: TechCategory;
  /** All of these must be unlocked first. */
  prerequisites: string[];
  /** Metres of depth the player must have reached for this to be available. */
  requiresDepth?: number;
  /** Recipe ids revealed by this node. */
  recipes: string[];
  /** Build-piece ids revealed by this node. */
  build?: string[];
  /** Unlocked from the very first frame. */
  startsUnlocked?: boolean;
}

const NODES: TechNode[] = [
  {
    id: 'tech.basics', name: 'Emergency Fabrication', category: 'survival',
    prerequisites: [], startsUnlocked: true,
    recipes: [
      'craft.titanium', 'craft.copper_ore', 'craft.quartz_from_sandstone', 'craft.silver_from_sandstone',
      'craft.glass', 'craft.silicone_rubber', 'craft.fibre_mesh', 'craft.copper_wire',
      'craft.bleach', 'craft.lubricant', 'craft.hydrochloric_acid',
      'craft.battery', 'craft.scanner', 'craft.survival_knife', 'craft.flashlight',
      'craft.standard_tank', 'craft.fins',
      'craft.cooked_peeper', 'craft.cured_peeper', 'craft.cooked_reginald',
      'craft.disinfected_water', 'craft.filtered_water',
      'craft.titanium_ingot', 'craft.titanium_from_ingot',
    ],
    description:
      'The lifepod fabricator boots with Alterra\'s mandatory survival patterns ' +
      'burned into ROM. It is not generous, but it is enough to stop you drowning today.',
  },
  {
    id: 'tech.electronics', name: 'Basic Electronics', category: 'electronics',
    prerequisites: ['tech.basics'], recipes: ['craft.wiring_kit', 'craft.computer_chip'],
    description:
      'Wafer printing and loom assembly. Once the fabricator can make a chip, ' +
      'everything downstream of it stops being impossible.',
  },
  {
    id: 'tech.advanced_electronics', name: 'Advanced Electronics', category: 'electronics',
    prerequisites: ['tech.electronics'], requiresDepth: 80,
    recipes: ['craft.advanced_wiring_kit'],
    description: 'Multilayer boards and gold bus work, reverse-engineered from wreck avionics.',
  },
  {
    id: 'tech.power_cell', name: 'Power Cell Assembly', category: 'power',
    prerequisites: ['tech.basics'], recipes: ['craft.power_cell'],
    description: 'Two batteries, one jacket, four times the useful life. Standard fleet pattern.',
  },
  {
    id: 'tech.advanced_materials', name: 'Advanced Materials', category: 'materials',
    prerequisites: ['tech.basics'], requiresDepth: 150,
    recipes: ['craft.benzene', 'craft.synthetic_fibres', 'craft.aerogel', 'craft.polyaniline'],
    description:
      'Cracking, drawing, and freeze-drying. Requires reagents that only grow ' +
      'where the light has already given up.',
  },
  {
    id: 'tech.plasteel', name: 'Plasteel & Enamelled Glass', category: 'materials',
    prerequisites: ['tech.advanced_materials'], requiresDepth: 200,
    recipes: ['craft.plasteel_ingot', 'craft.enamelled_glass'],
    build: ['reinforced_bulkhead'],
    description:
      'The pressure barrier. Everything below three hundred metres is built out of ' +
      'these two materials or it is built out of mistakes.',
  },
  {
    id: 'tech.habitat_builder', name: 'Habitat Builder', category: 'habitat',
    prerequisites: ['tech.electronics'], recipes: ['craft.habitat_builder'],
    build: ['foundation', 'corridor_straight', 'corridor_bend', 'hatch', 'window', 'locker', 'fabricator_wall'],
    description:
      'A structural printer with a projection ghost. Ninety percent of surviving ' +
      'this planet is having somewhere dry to come back to.',
  },
  {
    id: 'tech.habitat_rooms', name: 'Multipurpose Rooms', category: 'habitat',
    prerequisites: ['tech.habitat_builder'], requiresDepth: 60,
    build: ['room_multipurpose', 'corridor_tee', 'corridor_cross', 'growbed', 'solar_panel'],
    recipes: [],
    description:
      'A five-metre pressure cylinder with four flanged ports. The first room that ' +
      'feels like architecture instead of plumbing.',
  },
  {
    id: 'tech.moonpool', name: 'Moonpool', category: 'habitat',
    prerequisites: ['tech.habitat_rooms', 'tech.advanced_electronics'], requiresDepth: 120,
    build: ['moonpool'], recipes: [],
    description:
      'An open bay held dry by pressure differential. Walk out of the water into ' +
      'your own base without a single hatch cycle.',
  },
  {
    id: 'tech.solar', name: 'Solar Power', category: 'power',
    prerequisites: ['tech.habitat_builder'], build: ['solar_panel'], recipes: [],
    description:
      'Two hundred watts at the surface, four at eighty metres. Sunlight is a ' +
      'shallow-water luxury and the panel will remind you of that daily.',
  },
  {
    id: 'tech.thermal_plant', name: 'Thermal Plant', category: 'power',
    prerequisites: ['tech.advanced_electronics'], requiresDepth: 220,
    build: ['thermal_plant'], recipes: [],
    description:
      'Bolt it beside a vent and it drinks the temperature gradient. Output scales ' +
      'with how uncomfortable the surroundings are.',
  },
  {
    id: 'tech.nuclear', name: 'Nuclear Reactor', category: 'power',
    prerequisites: ['tech.thermal_plant', 'tech.plasteel'], requiresDepth: 500,
    build: ['nuclear_reactor'], recipes: ['craft.reactor_rod'],
    description:
      'Two hundred and fifty kilowatts and a waste problem. Alterra requires a ' +
      'signed acknowledgement that you understand the second part.',
  },
  {
    id: 'tech.ion_power', name: 'Ion Power', category: 'power',
    prerequisites: ['tech.nuclear'], requiresDepth: 900,
    recipes: ['craft.ion_battery', 'craft.ion_power_cell'],
    description:
      'Not our engineering. The crystal holds charge in a way the PDA describes as ' +
      '"structurally implausible" and then quietly accepts.',
  },
  {
    id: 'tech.repair_tool', name: 'Repair Tool', category: 'tools',
    prerequisites: ['tech.basics'], recipes: ['craft.repair_tool'],
    description: 'A welding head that reads hull strain and closes the worst of it first.',
  },
  {
    id: 'tech.seaglide', name: 'Seaglide', category: 'tools',
    prerequisites: ['tech.power_cell'], recipes: ['craft.seaglide'],
    description: 'Ducted impeller, sonar plate, handlebars. Turns a forty-metre swim into a ten-second one.',
  },
  {
    id: 'tech.laser_cutter', name: 'Laser Cutter', category: 'tools',
    prerequisites: ['tech.advanced_electronics'], requiresDepth: 150,
    recipes: ['craft.laser_cutter'],
    description: 'Opens the sealed doors on every wreck you have swum past and resented.',
  },
  {
    id: 'tech.thermoblade', name: 'Thermoblade', category: 'tools',
    prerequisites: ['tech.repair_tool'], recipes: ['craft.thermoblade'],
    description: 'A heated edge. Cooks the catch as it kills it, which saves an entire trip home.',
  },
  {
    id: 'tech.propulsion_cannon', name: 'Propulsion Cannon', category: 'tools',
    prerequisites: ['tech.advanced_electronics'], requiresDepth: 100,
    recipes: ['craft.propulsion_cannon'],
    description: 'Repulsor field with a two-hundred-kilo limit. Salvage recovery, and occasionally self-defence.',
  },
  {
    id: 'tech.stasis_rifle', name: 'Stasis Rifle', category: 'tools',
    prerequisites: ['tech.propulsion_cannon'], requiresDepth: 200,
    recipes: ['craft.stasis_rifle'],
    description: 'Freezes a volume of water solid for eight seconds. The single best answer to a leviathan.',
  },
  {
    id: 'tech.beacon', name: 'Beacon', category: 'tools',
    prerequisites: ['tech.basics'], recipes: ['craft.beacon'],
    description: 'This planet has no satellites and no maps. Your beacons are the only geography you will ever own.',
  },
  {
    id: 'tech.air_bladder', name: 'Air Bladder', category: 'equipment',
    prerequisites: ['tech.basics'], recipes: ['craft.air_bladder'],
    description: 'Harvested bladderfish membrane in a silicone sleeve. Pulls you up whether or not you agreed.',
  },
  {
    id: 'tech.rebreather', name: 'Rebreather', category: 'equipment',
    prerequisites: ['tech.electronics'], requiresDepth: 60,
    recipes: ['craft.rebreather'],
    description: 'CO2 scrubbing mask. Nearly halves your oxygen burn below a hundred metres.',
  },
  {
    id: 'tech.high_capacity_tank', name: 'High Capacity Tank', category: 'equipment',
    prerequisites: ['tech.basics'], requiresDepth: 40, recipes: ['craft.high_capacity_tank'],
    description: 'Seventy-five seconds of air, and a drag penalty you will feel in your thighs.',
  },
  {
    id: 'tech.lightweight_tank', name: 'Lightweight Tank', category: 'equipment',
    prerequisites: ['tech.plasteel'], requiresDepth: 250, recipes: ['craft.lightweight_tank'],
    description: 'Plasteel shell and an aerogel liner. All the air, none of the drag.',
  },
  {
    id: 'tech.ultra_glide_fins', name: 'Ultra Glide Fins', category: 'equipment',
    prerequisites: ['tech.advanced_materials'], recipes: ['craft.ultra_glide_fins'],
    description: 'Longer blades tuned to a flutter kick. Thirty-four percent faster for the same air.',
  },
  {
    id: 'tech.reinforced_suit', name: 'Reinforced Dive Suit', category: 'equipment',
    prerequisites: ['tech.basics'], requiresDepth: 180, recipes: ['craft.reinforced_dive_suit'],
    description:
      'Plasteel scales under fibre mesh. Five hundred metres of crush rating and it ' +
      'will absorb a bite that would otherwise be the end of the log.',
  },
  {
    id: 'tech.pressure_suit_mk2', name: 'Reinforced Suit Mk II', category: 'deep',
    prerequisites: ['tech.reinforced_suit', 'tech.plasteel'], requiresDepth: 600,
    recipes: ['craft.pressure_suit_mk2'],
    description: 'Kyanite ribbing and active compensation. One kilometre. Nothing takes you further in fabric.',
  },
  {
    id: 'tech.radiation_suit', name: 'Radiation Suit', category: 'equipment',
    prerequisites: ['tech.basics'], recipes: ['craft.radiation_suit'],
    description: 'Lead-lined, stiff, unpleasant. Mandatory near a breached drive core.',
  },
  {
    id: 'tech.compass', name: 'Compass', category: 'equipment',
    prerequisites: ['tech.electronics'], recipes: ['craft.compass'],
    description: 'A magnetometer chip on your HUD. It will lie to you near magnetite, and only there.',
  },
  {
    id: 'tech.oxygen_chip', name: 'Capacity Booster Chip', category: 'equipment',
    prerequisites: ['tech.advanced_electronics'], recipes: ['craft.oxygen_chip'],
    description: 'Retunes your metabolic model for shallower breathing. Twenty free seconds.',
  },
  {
    id: 'tech.first_aid', name: 'First Aid Kit', category: 'survival',
    prerequisites: ['tech.basics'], recipes: ['craft.first_aid_kit'],
    description: 'Coagulant foam and a bandage. The difference between a bad day and a last one.',
  },
  {
    id: 'tech.nutrient_block', name: 'Nutrient Block', category: 'survival',
    prerequisites: ['tech.basics'], recipes: ['craft.nutrient_block'],
    description: 'Shelf-stable protein. Engineered by a committee to be adequate forever.',
  },
  {
    id: 'tech.water_filtration', name: 'Water Filtration Unit', category: 'habitat',
    prerequisites: ['tech.habitat_rooms'], requiresDepth: 60,
    recipes: ['craft.large_filtered_water'], build: ['water_filtration'],
    description: 'Runs on base power and turns the ocean into two bottles an hour. Never think about thirst again.',
  },
  {
    id: 'tech.floodlight', name: 'Floodlight', category: 'habitat',
    prerequisites: ['tech.habitat_builder'], recipes: ['craft.floodlight'],
    description: 'A staked lamp. Gives a trench edges and gives you a horizon to work against.',
  },
  {
    id: 'tech.waterproof_locker', name: 'Waterproof Locker', category: 'habitat',
    prerequisites: ['tech.habitat_builder'], recipes: ['craft.waterproof_locker'],
    description: 'Twenty-four cells of storage you can drop on the seabed and trust.',
  },
  {
    id: 'tech.bioreactor', name: 'Bioreactor', category: 'power',
    prerequisites: ['tech.habitat_rooms'], build: ['bioreactor'], recipes: [],
    description: 'Eats organics, makes watts. The correct destination for every peeper that went off in your pack.',
  },
  /* ---- story-gated nodes ---- */
  {
    id: 'tech.signal_decoder', name: 'Signal Decoder', category: 'story',
    prerequisites: ['tech.advanced_electronics'], requiresDepth: 250,
    recipes: [], build: [],
    description:
      'A narrowband receiver tuned to the repeating pulse from the north-east ' +
      'trench. It is not a distress call. It has never been a distress call.',
  },
  {
    id: 'tech.alien_containment_key', name: 'Ion Cube Interface', category: 'story',
    prerequisites: ['tech.ion_power'], requiresDepth: 1100,
    recipes: [], build: [],
    description:
      'The facility doors read the cube, not you. Whatever built them expected ' +
      'visitors, and expected them to arrive holding proof.',
  },
];

export const TECH_NODES: ReadonlyMap<string, TechNode> = new Map(NODES.map((n) => [n.id, n]));
export const TECH_LIST: readonly TechNode[] = NODES;

export interface TechUnlockInfo {
  node: TechNode;
  recipes: string[];
  build: string[];
}

export class TechTree {
  readonly unlocked = new Set<string>();
  /** Deepest depth in metres the player has ever reached. Set by GameState. */
  deepestDepth = 0;
  /** Fired on every successful unlock. GameState forwards it to the event bus. */
  onUnlock: ((info: TechUnlockInfo) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.unlocked.clear();
    for (const n of NODES) if (n.startsUnlocked) this.unlocked.add(n.id);
  }

  node(id: string): TechNode | undefined {
    return TECH_NODES.get(id);
  }

  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  prereqsMet(id: string): boolean {
    const n = TECH_NODES.get(id);
    if (!n) return false;
    for (const p of n.prerequisites) if (!this.unlocked.has(p)) return false;
    return true;
  }

  depthMet(id: string): boolean {
    const n = TECH_NODES.get(id);
    if (!n) return false;
    return this.deepestDepth >= (n.requiresDepth ?? 0);
  }

  /** Can be worked toward right now (visible in the tech tree, not yet owned). */
  available(id: string): boolean {
    return !this.isUnlocked(id) && this.prereqsMet(id) && this.depthMet(id);
  }

  /** Everything the player could plausibly unlock next. */
  frontier(): TechNode[] {
    return NODES.filter((n) => this.available(n.id));
  }

  /** Blocked only by depth — the HUD shows these as "descend to N m". */
  depthBlocked(): TechNode[] {
    return NODES.filter((n) => !this.isUnlocked(n.id) && this.prereqsMet(n.id) && !this.depthMet(n.id));
  }

  /**
   * Unlocks a node. Prerequisites are enforced unless `force` (data boxes and
   * quest rewards hand you hardware you have not earned the theory for).
   */
  unlock(id: string, force = false): boolean {
    const n = TECH_NODES.get(id);
    if (!n || this.unlocked.has(id)) return false;
    if (!force && !this.prereqsMet(id)) return false;
    this.unlocked.add(id);
    this.onUnlock?.({ node: n, recipes: [...n.recipes], build: [...(n.build ?? [])] });
    return true;
  }

  /** All recipe ids currently printable. */
  knownRecipes(): Set<string> {
    const out = new Set<string>();
    for (const id of this.unlocked) {
      const n = TECH_NODES.get(id);
      if (!n) continue;
      for (const r of n.recipes) out.add(r);
    }
    return out;
  }

  /** All build-piece ids currently placeable. */
  knownBuildPieces(): Set<string> {
    const out = new Set<string>();
    for (const id of this.unlocked) {
      for (const b of TECH_NODES.get(id)?.build ?? []) out.add(b);
    }
    return out;
  }

  /**
   * Records a new depth record and returns any nodes that just became
   * available because of it, so the PDA can announce them.
   */
  noteDepth(depth: number): TechNode[] {
    if (!Number.isFinite(depth) || depth <= this.deepestDepth) return [];
    const before = new Set(this.frontier().map((n) => n.id));
    this.deepestDepth = depth;
    return this.frontier().filter((n) => !before.has(n.id));
  }

  /**
   * Establishes the depth baseline WITHOUT reporting anything as newly
   * available. Used for the first depth sample of a run — at spawn, on load,
   * and after a teleport — because depth you simply started at was never
   * "descended to". Without this, frame one drags `deepestDepth` from 0 up to
   * wherever the player actually is and every gate below that fires at once.
   */
  primeDepth(depth: number): void {
    if (!Number.isFinite(depth)) return;
    this.deepestDepth = Math.max(this.deepestDepth, Math.max(0, depth));
  }

  serialise(): { unlocked: string[]; deepestDepth: number } {
    return { unlocked: [...this.unlocked], deepestDepth: this.deepestDepth };
  }

  deserialise(data: { unlocked?: string[]; deepestDepth?: number }): void {
    this.reset();
    for (const id of data.unlocked ?? []) if (TECH_NODES.has(id)) this.unlocked.add(id);
    this.deepestDepth = data.deepestDepth ?? 0;
  }
}

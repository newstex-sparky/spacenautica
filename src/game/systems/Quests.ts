/**
 * QUESTS — a hand-authored critical path plus optional objectives.
 *
 * crash -> survive -> explore -> build -> discover the signal -> descend ->
 * understand the infection -> reach the lava zone -> escape.
 *
 * Objectives complete off gameplay triggers (depth records, biome entry, scan
 * completion, item acquisition, crafting, tech unlocks, base construction), never
 * off UI clicks. All display text is written to be read on screen.
 */

export type QuestTrigger =
  /** Player reached this depth (metres below sea level). */
  | { kind: 'depth'; depth: number }
  /** Player entered this biome id. */
  | { kind: 'biome'; id: string }
  /** A scan target's fragment set completed. */
  | { kind: 'scan'; id: string }
  /** N scans completed, optionally within one category. */
  | { kind: 'scanCount'; count: number; category?: string }
  /** Inventory total for an item reached `count`. */
  | { kind: 'item'; id: string; count?: number }
  /** A recipe finished printing. */
  | { kind: 'craft'; id: string }
  /** A tech node unlocked. */
  | { kind: 'tech'; id: string }
  /** N tech nodes unlocked in total. */
  | { kind: 'techCount'; count: number }
  /** A build piece was placed. */
  | { kind: 'build'; id: string }
  /** N build pieces placed in total. */
  | { kind: 'buildCount'; count: number }
  /** A databank entry unlocked. */
  | { kind: 'databank'; id: string }
  /** Seconds of play since the quest started. */
  | { kind: 'elapsed'; seconds: number }
  /** Only completed by an explicit call to `QuestLog.force()`. */
  | { kind: 'manual' };

export interface ObjectiveDef {
  id: string;
  /** Imperative, one line, shown in the HUD tracker. */
  text: string;
  trigger: QuestTrigger;
  /** Optional objectives never block quest completion. */
  optional?: boolean;
  /** Longer nudge shown in the PDA when the player asks for help. */
  hint?: string;
  /** Unlocked when this objective completes. */
  grantsDatabank?: string;
  grantsTech?: string;
}

export interface QuestDef {
  id: string;
  title: string;
  /** Critical-path quests chain via `next` and drive the main tracker. */
  critical: boolean;
  /** One-line summary in the quest list. */
  summary: string;
  /** PDA voice lines played when the quest starts, in order. */
  briefing: string[];
  objectives: ObjectiveDef[];
  /** Shown when every required objective is done. */
  completion: string;
  /** Auto-started when this quest completes. */
  next?: string;
  /** Databank entry granted on completion. */
  grantsDatabank?: string;
  /** Started automatically at game start. */
  autoStart?: boolean;
  /** Optional quests unlock once these quests are complete. */
  after?: string[];
}

const QUESTS: QuestDef[] = [
  /* ================= CRITICAL PATH ================= */
  {
    id: 'q.crash', title: 'Impact', critical: true, autoStart: true,
    summary: 'The Aurora is aground and burning. You are not.',
    briefing: [
      'Lifepod 5 is intact. Hull integrity nominal. Life support nominal.',
      'Please refrain from screaming. It consumes oxygen at a rate of point four litres per minute.',
      'Recommendation: exit the pod. Assess the immediate environment. Salvage what floats.',
    ],
    objectives: [
      {
        id: 'o.look', text: 'Leave the lifepod and look at what is left of the Aurora.',
        trigger: { kind: 'elapsed', seconds: 14 },
        hint: 'Surface and turn east. You will not have to look hard.',
        grantsDatabank: 'lore.aurora',
      },
      {
        id: 'o.titanium', text: 'Salvage 4 titanium from the debris field.',
        trigger: { kind: 'item', id: 'titanium', count: 4 },
        hint: 'Break open limestone outcrops on the shelf floor, or grab loose plating from the debris.',
      },
      {
        id: 'o.scanner', text: 'Fabricate a scanner.',
        trigger: { kind: 'craft', id: 'craft.scanner' },
        hint: 'The lifepod fabricator has the pattern. One titanium, one battery.',
      },
      {
        id: 'o.pod_scan', text: 'Scan the lifepod debris trail.', optional: true,
        trigger: { kind: 'scan', id: 'wreck.lifepod' },
        grantsDatabank: 'lore.lifepod',
      },
    ],
    completion: 'You are alive, equipped, and standing on the floor of an ocean that goes down further than your suit will. Good start.',
    next: 'q.survive',
  },
  {
    id: 'q.survive', title: 'First Night', critical: true,
    summary: 'Air, water, food, in that order. Then a blade.',
    briefing: [
      'Reminder: this planet\'s water is not potable. Your body will attempt to drink it anyway if you let it get far enough.',
      'Bulbo trees on the plateau store filterable fluid. Peepers are edible raw and abundant.',
      'You have approximately thirty-one hours before dehydration becomes the primary threat to your contract.',
    ],
    objectives: [
      {
        id: 'o.water', text: 'Produce drinkable water.',
        trigger: { kind: 'craft', id: 'craft.filtered_water' },
        hint: 'Two bulbo tree samples in the fabricator. Or bleach, if you have the salt for it.',
      },
      {
        id: 'o.food', text: 'Cook something.',
        trigger: { kind: 'craft', id: 'craft.cooked_peeper' },
        hint: 'Catch a peeper by hand in the shallows and put it in the fabricator.',
      },
      {
        id: 'o.knife', text: 'Fabricate a survival knife.',
        trigger: { kind: 'craft', id: 'craft.survival_knife' },
        hint: 'Titanium and silicone rubber. Creepvine seed clusters make the rubber.',
      },
      {
        id: 'o.tank', text: 'Fabricate an oxygen tank.',
        trigger: { kind: 'craft', id: 'craft.standard_tank' },
      },
      {
        id: 'o.fins', text: 'Fabricate swim fins.', optional: true,
        trigger: { kind: 'craft', id: 'craft.fins' },
        hint: 'Eighteen percent more distance per breath. Worth an afternoon of kelp cutting.',
      },
      {
        id: 'o.scan_flora', text: 'Scan three organisms.', optional: true,
        trigger: { kind: 'scanCount', count: 3 },
      },
    ],
    completion: 'Ninety seconds of air, a full canteen and a knife. You have gone from casualty to inhabitant.',
    next: 'q.explore',
  },
  {
    id: 'q.explore', title: 'Charting the Shelf', critical: true,
    summary: 'Find the biomes. Find the wrecks. Find out how deep you can go before your ears complain.',
    briefing: [
      'Passive sonar indicates the shelf terminates roughly nine hundred metres east of your position, then drops.',
      'Multiple metallic returns between here and the drop-off — debris from the Aurora\'s entry, and something older underneath it.',
      'You will need a habitat before you need anything else. Alterra pattern fragments are scattered through the wreck field.',
    ],
    objectives: [
      {
        id: 'o.kelp', text: 'Enter the kelp forest.',
        trigger: { kind: 'biome', id: 'kelp_forest' },
        grantsDatabank: 'geo.kelp',
      },
      {
        id: 'o.plateau', text: 'Cross the grassy plateaus.',
        trigger: { kind: 'biome', id: 'grassy_plateau' },
        grantsDatabank: 'geo.plateau',
      },
      {
        id: 'o.depth60', text: 'Reach 60 metres.',
        trigger: { kind: 'depth', depth: 60 },
        hint: 'The plateau terraces step down past sixty. Watch your air on the way back up.',
      },
      {
        id: 'o.creepvine', text: 'Scan a creepvine.',
        trigger: { kind: 'scan', id: 'flora.creepvine' },
      },
      {
        id: 'o.builder', text: 'Recover the habitat builder pattern.',
        trigger: { kind: 'tech', id: 'tech.habitat_builder' },
        hint: 'Two fragments, both in the shallow wreck field. Scan each one.',
      },
      {
        id: 'o.stalker', text: 'Scan a stalker.', optional: true,
        trigger: { kind: 'scan', id: 'fauna.stalker' },
        hint: 'They are territorial, not hungry. Hold still, hold the trigger, and accept that it will not feel that way.',
      },
    ],
    completion: 'You have a map in your head now, which is more than the PDA can offer. And you can build.',
    next: 'q.homestead',
  },
  {
    id: 'q.homestead', title: 'Somewhere Dry', critical: true,
    summary: 'A hull, a hatch, a light, and power to run all three.',
    briefing: [
      'Structural note: habitat integrity is the sum of what your hull can bear minus what it has to hold up. Foundations add capacity. Windows and hatches subtract it.',
      'If integrity reaches zero, the compartment breaches, and the compartment floods, and everything not bolted down leaves through the hole.',
      'Build small. Build braced. Build a door on the side facing away from the kelp.',
    ],
    objectives: [
      {
        id: 'o.foundation', text: 'Place a foundation.',
        trigger: { kind: 'build', id: 'foundation' },
        hint: 'Find flat ground. The ghost turns red on slopes steeper than about twenty degrees.',
      },
      {
        id: 'o.corridor', text: 'Build a pressurised corridor.',
        trigger: { kind: 'build', id: 'corridor_straight' },
      },
      {
        id: 'o.hatch', text: 'Fit a hatch so you can get inside.',
        trigger: { kind: 'build', id: 'hatch' },
      },
      {
        id: 'o.power', text: 'Bring the base online with a power source.',
        trigger: { kind: 'buildCount', count: 4 },
        hint: 'A solar panel is enough down to sixty metres. Below that, thermal.',
      },
      {
        id: 'o.locker', text: 'Install a locker and stop carrying everything.', optional: true,
        trigger: { kind: 'build', id: 'locker' },
      },
      {
        id: 'o.window', text: 'Fit a viewport. You have earned a view.', optional: true,
        trigger: { kind: 'build', id: 'window' },
      },
    ],
    completion: 'Positive pressure, breathable air, and a floor. The ocean is now something you visit rather than something you are in.',
    next: 'q.signal',
  },
  {
    id: 'q.signal', title: 'Bearing 041', critical: true,
    summary: 'Something in the north-east trench has been transmitting since before you arrived.',
    briefing: [
      'Anomaly: narrowband transmission, three point four second period, bearing zero four one, range approximately eleven hundred metres.',
      'The signal predates the Aurora\'s arrival by — correction — the signal predates Alterra.',
      'It is not a distress pattern. It is a beacon. Beacons are for guiding things in.',
    ],
    objectives: [
      {
        id: 'o.log_signal', text: 'Log the transmission in your databank.',
        trigger: { kind: 'elapsed', seconds: 20 },
        grantsDatabank: 'story.signal_1',
      },
      {
        id: 'o.rebreather', text: 'Fabricate a rebreather before going deeper.',
        trigger: { kind: 'craft', id: 'craft.rebreather' },
        hint: 'The pattern is in the wreck field. Below a hundred metres it nearly halves your oxygen burn.',
      },
      {
        id: 'o.depth150', text: 'Reach 150 metres.',
        trigger: { kind: 'depth', depth: 150 },
      },
      {
        id: 'o.mushroom', text: 'Pass through the mushroom forest.',
        trigger: { kind: 'biome', id: 'mushroom_forest' },
        grantsDatabank: 'geo.mushroom',
      },
      {
        id: 'o.transmitter', text: 'Find and scan the source of the transmission.',
        trigger: { kind: 'scan', id: 'terminal.signal' },
        hint: 'It is seated in the trench wall at about four hundred metres. The pulse tightens as you close.',
      },
    ],
    completion: 'The structure is eighty metres across, and it is not human, and it has been waiting.',
    next: 'q.descend',
  },
  {
    id: 'q.descend', title: 'Under the Shelf', critical: true,
    summary: 'Past the blood kelp, into the river of brine, where the bones are.',
    briefing: [
      'Warning: ambient pressure beyond three hundred metres exceeds the rating of your dive suit. Reinforcement is not optional.',
      'Warning: downwelling light beyond three hundred metres is functionally zero. Bring your own.',
      'Note: your PDA is detecting elevated bacterial activity in your bloodstream. Analysis pending. It has been pending for some time.',
    ],
    objectives: [
      {
        id: 'o.suit', text: 'Fabricate a reinforced dive suit.',
        trigger: { kind: 'craft', id: 'craft.reinforced_dive_suit' },
      },
      {
        id: 'o.blood_kelp', text: 'Descend into the blood kelp zone.',
        trigger: { kind: 'biome', id: 'blood_kelp' },
        grantsDatabank: 'geo.blood_kelp',
      },
      {
        id: 'o.depth300', text: 'Reach 300 metres.',
        trigger: { kind: 'depth', depth: 300 },
      },
      {
        id: 'o.river', text: 'Find the Lost River.',
        trigger: { kind: 'biome', id: 'lost_river' },
        grantsDatabank: 'geo.lost_river',
      },
      {
        id: 'o.glyph', text: 'Scan an Architect glyph panel.',
        trigger: { kind: 'scan', id: 'terminal.precursor_glyph' },
      },
      {
        id: 'o.crabsquid', text: 'Scan a crabsquid.', optional: true,
        trigger: { kind: 'scan', id: 'fauna.crabsquid' },
        hint: 'Turn your lights off first. Everything about that sentence is a warning.',
      },
    ],
    completion: 'Kilometres of articulated bone along the banks of a river that flows underwater. Something has been dying here on a schedule.',
    next: 'q.contagion',
  },
  {
    id: 'q.contagion', title: 'Contagion', critical: true,
    summary: 'The green striations on your forearm are stage one.',
    briefing: [
      'Analysis complete. Bloodstream contains an unregistered bacterium, cross-species, aggressive replication.',
      'Infection vector: environmental. Time of exposure: approximately four minutes after your arrival on this planet.',
      'There is no vaccine in the Alterra formulary. I have checked twice.',
    ],
    objectives: [
      {
        id: 'o.lab', text: 'Find the Architect disease research terminal.',
        trigger: { kind: 'scan', id: 'terminal.disease_lab' },
        hint: 'Follow the river to its head. The facility is built into the cave roof.',
      },
      {
        id: 'o.read', text: 'Read the containment record.',
        trigger: { kind: 'databank', id: 'story.kharaa' },
      },
      {
        id: 'o.architects', text: 'Learn what happened to the Architects.',
        trigger: { kind: 'databank', id: 'story.precursor' },
      },
      {
        id: 'o.tech30', text: 'Reconstruct 20 fabricator patterns.', optional: true,
        trigger: { kind: 'techCount', count: 20 },
      },
    ],
    completion: 'They came here to cure it too. They built a gun in orbit to make sure nobody left carrying it. Then they died in their own quarantine.',
    next: 'q.deep',
  },
  {
    id: 'q.deep', title: 'The Floor of the World', critical: true,
    summary: 'A kilometre down, where the rock is younger than your ship.',
    briefing: [
      'Thermal gradient increasing. Ambient temperature at the floor exceeds eighty degrees; water one metre above it does not. Do not linger in either.',
      'Structure detected below the lava sheet. Volume: approximately nine hundred thousand cubic metres. Age estimate: one thousand and forty years, plus or minus twelve.',
      'It is a facility. It is still running. Something is still paying its power bill.',
    ],
    objectives: [
      {
        id: 'o.suit2', text: 'Fabricate a suit rated past 500 metres.',
        trigger: { kind: 'craft', id: 'craft.pressure_suit_mk2' },
      },
      {
        id: 'o.depth700', text: 'Reach 700 metres.',
        trigger: { kind: 'depth', depth: 700 },
      },
      {
        id: 'o.lava', text: 'Enter the inactive lava zone.',
        trigger: { kind: 'biome', id: 'lava_zone' },
        grantsDatabank: 'geo.lava_zone',
      },
      {
        id: 'o.ion', text: 'Reverse-engineer ion power.',
        trigger: { kind: 'tech', id: 'tech.ion_power' },
      },
      {
        id: 'o.quarantine', text: 'Scan the quarantine enforcement node.',
        trigger: { kind: 'scan', id: 'terminal.quarantine' },
        grantsDatabank: 'story.quarantine',
      },
    ],
    completion: 'The gun in orbit is not hostile. It is procedural. It will stand down for a clean vessel and for nothing else.',
    next: 'q.escape',
  },
  {
    id: 'q.escape', title: 'Departure Conditions', critical: true,
    summary: 'Synthesise the cure. Build something that holds pressure and atmosphere at once. Leave.',
    briefing: [
      'Enzyme synthesis requires samples from every trophic level of the infection, up to and including a mature leviathan.',
      'Once you are clean, the platform will permit a launch. It will verify. Do not attempt to bluff a system that has been correct for a thousand years.',
      'And — for the record — it has been a privilege to be your PDA.',
    ],
    objectives: [
      {
        id: 'o.interface', text: 'Gain access to the containment facility.',
        trigger: { kind: 'tech', id: 'tech.alien_containment_key' },
      },
      {
        id: 'o.depth1100', text: 'Reach 1100 metres.',
        trigger: { kind: 'depth', depth: 1100 },
      },
      {
        id: 'o.cure', text: 'Synthesise the enzyme and cure yourself.',
        trigger: { kind: 'manual' },
        hint: 'The facility will not open the incubator until it has read a full sample set.',
      },
      {
        id: 'o.launch', text: 'Build a vessel and leave this planet.',
        trigger: { kind: 'manual' },
      },
    ],
    completion:
      'The quarantine holds. The reef is clean. Four thousand five hundred metres of ocean falls away below you and does not follow.',
    grantsDatabank: 'story.escape',
  },

  /* ================= OPTIONAL ================= */
  {
    id: 'q.opt.cartographer', title: 'Cartographer', critical: false, after: ['q.explore'],
    summary: 'This planet has no maps. Make your own.',
    briefing: ['No orbital survey is available. No satellite network exists. Your beacons are the only geography you will ever own.'],
    objectives: [
      { id: 'o.beacon_tech', text: 'Recover the beacon pattern.', trigger: { kind: 'tech', id: 'tech.beacon' } },
      { id: 'o.beacons', text: 'Fabricate 4 beacons.', trigger: { kind: 'item', id: 'beacon', count: 4 } },
      { id: 'o.depth_map', text: 'Reach 200 metres.', trigger: { kind: 'depth', depth: 200 } },
    ],
    completion: 'Four fixed points in four hundred metres of water. You can find your way home in the dark now.',
  },
  {
    id: 'q.opt.naturalist', title: 'Naturalist', critical: false, after: ['q.survive'],
    summary: 'Alterra pays a survey bonus. Assuming anyone ever collects it.',
    briefing: ['Xenobiology survey contract 9924-C remains open. Compensation is per confirmed species and is, frankly, insulting.'],
    objectives: [
      { id: 'o.fauna8', text: 'Scan 8 species of fauna.', trigger: { kind: 'scanCount', count: 8, category: 'fauna' } },
      { id: 'o.flora4', text: 'Scan 4 species of flora.', trigger: { kind: 'scanCount', count: 4, category: 'flora' } },
      {
        id: 'o.leviathan', text: 'Scan a leviathan-class organism.', optional: true,
        trigger: { kind: 'scan', id: 'fauna.reaper' },
        hint: 'You will need to be inside its patrol volume, holding still, for eight seconds. Consider a stasis rifle.',
      },
    ],
    completion: 'Twelve species catalogued on a world that will outlive the company that asked.',
  },
  {
    id: 'q.opt.prospector', title: 'Prospector', critical: false, after: ['q.homestead'],
    summary: 'The interesting minerals are all inconveniently deep.',
    briefing: ['Geological note: every material rated for pressure has to be recovered from somewhere that has plenty of it. This is not a coincidence.'],
    objectives: [
      { id: 'o.ruby', text: 'Recover 2 rubies.', trigger: { kind: 'item', id: 'ruby', count: 2 } },
      { id: 'o.diamond', text: 'Recover 2 diamonds.', trigger: { kind: 'item', id: 'diamond', count: 2 } },
      { id: 'o.lithium', text: 'Recover 4 lithium.', trigger: { kind: 'item', id: 'lithium', count: 4 } },
      { id: 'o.kyanite', text: 'Recover kyanite from the lava zone.', optional: true, trigger: { kind: 'item', id: 'kyanite', count: 1 } },
      { id: 'o.plasteel', text: 'Cast a plasteel ingot.', trigger: { kind: 'craft', id: 'craft.plasteel_ingot' } },
    ],
    completion: 'Plasteel and enamelled glass. Everything below three hundred metres is now merely difficult.',
  },
  {
    id: 'q.opt.architect', title: 'Architect', critical: false, after: ['q.homestead'],
    summary: 'A corridor is a shelter. A base is a decision.',
    briefing: ['Structural integrity is a budget, not a suggestion. Spend it on rooms, not on windows.'],
    objectives: [
      { id: 'o.room', text: 'Build a multipurpose room.', trigger: { kind: 'build', id: 'room_multipurpose' } },
      { id: 'o.moonpool', text: 'Build a moonpool.', trigger: { kind: 'build', id: 'moonpool' } },
      { id: 'o.growbed', text: 'Install a growbed and stop hunting.', trigger: { kind: 'build', id: 'growbed' } },
      { id: 'o.pieces12', text: 'Place 12 structures.', trigger: { kind: 'buildCount', count: 12 } },
      { id: 'o.thermal', text: 'Tap a thermal vent for power.', optional: true, trigger: { kind: 'build', id: 'thermal_plant' } },
    ],
    completion: 'Lit windows on the floor of an alien ocean, and a dry bay you can walk out of. This is a home.',
  },
  {
    id: 'q.opt.gourmet', title: 'Shelf Stable', critical: false, after: ['q.survive'],
    summary: 'Nothing you catch keeps. Fix that.',
    briefing: ['Reminder: uncured organics decay within fifteen minutes at ambient temperature. Salt exists. Use it.'],
    objectives: [
      { id: 'o.cured', text: 'Cure a fish with salt.', trigger: { kind: 'craft', id: 'craft.cured_peeper' } },
      { id: 'o.block', text: 'Fabricate a nutrient block.', trigger: { kind: 'craft', id: 'craft.nutrient_block' } },
      { id: 'o.filter', text: 'Install a water filtration unit.', trigger: { kind: 'build', id: 'water_filtration' } },
    ],
    completion: 'You will never again be six hundred metres down doing arithmetic about a spoiling peeper.',
  },
];

export const QUEST_DEFS: ReadonlyMap<string, QuestDef> = new Map(QUESTS.map((q) => [q.id, q]));
export const QUEST_LIST: readonly QuestDef[] = QUESTS;

export type QuestState = 'locked' | 'available' | 'active' | 'completed';

export interface QuestUpdate {
  quest: QuestDef;
  state: 'started' | 'objective' | 'completed';
  objective?: ObjectiveDef;
  /** Text worth putting on screen for this transition. */
  text: string;
}

/** Live view of one active quest, for the HUD tracker. */
export interface QuestView {
  quest: QuestDef;
  done: string[];
  remaining: ObjectiveDef[];
  /** 0..1 over required objectives only. */
  progress: number;
}

export class QuestLog {
  /** Active quest ids, critical path first. Field names kept from the baseline. */
  readonly active: string[] = [];
  readonly completed: string[] = [];

  /** Completed objective ids per quest. */
  private done = new Map<string, Set<string>>();
  /** Seconds each active quest has been running. */
  private clocks = new Map<string, number>();

  /** Aggregate tallies used by the *Count triggers. */
  private scansTotal = 0;
  private scansByCategory = new Map<string, number>();
  private techTotal = 0;
  private buildTotal = 0;

  onUpdate: ((u: QuestUpdate) => void) | null = null;
  /** Fired when an objective grants a databank entry or tech node. */
  onGrantDatabank: ((id: string) => void) | null = null;
  onGrantTech: ((id: string) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.active.length = 0;
    this.completed.length = 0;
    this.done.clear();
    this.clocks.clear();
    this.scansTotal = 0;
    this.scansByCategory.clear();
    this.techTotal = 0;
    this.buildTotal = 0;
  }

  /** Starts every auto-start quest. Called once by GameState after init/load. */
  bootstrap(): void {
    for (const q of QUEST_LIST) {
      if (q.autoStart && !this.completed.includes(q.id) && !this.active.includes(q.id)) this.start(q.id);
    }
    this.openOptionalQuests();
  }

  /* ---------------- state ---------------- */

  stateOf(id: string): QuestState {
    if (this.completed.includes(id)) return 'completed';
    if (this.active.includes(id)) return 'active';
    const q = QUEST_DEFS.get(id);
    if (!q) return 'locked';
    if (q.after && !q.after.every((a) => this.completed.includes(a))) return 'locked';
    return 'available';
  }

  isDone(questId: string, objectiveId: string): boolean {
    return this.done.get(questId)?.has(objectiveId) ?? false;
  }

  start(id: string): boolean {
    const q = QUEST_DEFS.get(id);
    if (!q || this.active.includes(id) || this.completed.includes(id)) return false;
    this.active.push(id);
    // Critical path stays at the top of the tracker.
    this.active.sort((a, b) => Number(!QUEST_DEFS.get(a)?.critical) - Number(!QUEST_DEFS.get(b)?.critical));
    this.done.set(id, this.done.get(id) ?? new Set());
    this.clocks.set(id, 0);
    this.onUpdate?.({ quest: q, state: 'started', text: q.title });
    return true;
  }

  /** Live tracker data: critical path first, then optional. */
  views(): QuestView[] {
    const out: QuestView[] = [];
    for (const id of this.active) {
      const q = QUEST_DEFS.get(id);
      if (!q) continue;
      const done = this.done.get(id) ?? new Set<string>();
      const required = q.objectives.filter((o) => !o.optional);
      const doneRequired = required.filter((o) => done.has(o.id)).length;
      out.push({
        quest: q,
        done: [...done],
        remaining: q.objectives.filter((o) => !done.has(o.id)),
        progress: required.length ? doneRequired / required.length : 1,
      });
    }
    return out;
  }

  /** The single line the HUD should show as "current objective". */
  currentObjective(): { quest: QuestDef; objective: ObjectiveDef } | null {
    for (const id of this.active) {
      const q = QUEST_DEFS.get(id);
      if (!q) continue;
      const done = this.done.get(id) ?? new Set<string>();
      const next = q.objectives.find((o) => !o.optional && !done.has(o.id));
      if (next) return { quest: q, objective: next };
    }
    return null;
  }

  /* ---------------- trigger intake ---------------- */

  update(dt: number): void {
    for (const id of [...this.active]) {
      this.clocks.set(id, (this.clocks.get(id) ?? 0) + dt);
    }
    this.satisfy((t, questId) => t.kind === 'elapsed' && (this.clocks.get(questId) ?? 0) >= t.seconds);
  }

  noteDepth(depth: number): void {
    this.satisfy((t) => t.kind === 'depth' && depth >= t.depth);
  }

  noteBiome(id: string): void {
    this.satisfy((t) => t.kind === 'biome' && t.id === id);
  }

  noteScan(id: string, category: string): void {
    this.scansTotal++;
    this.scansByCategory.set(category, (this.scansByCategory.get(category) ?? 0) + 1);
    this.satisfy((t) => {
      if (t.kind === 'scan') return t.id === id;
      if (t.kind === 'scanCount') {
        const have = t.category ? (this.scansByCategory.get(t.category) ?? 0) : this.scansTotal;
        return have >= t.count;
      }
      return false;
    });
  }

  noteItem(id: string, total: number): void {
    this.satisfy((t) => t.kind === 'item' && t.id === id && total >= (t.count ?? 1));
  }

  noteCraft(recipeId: string, outputId: string): void {
    this.satisfy((t) => t.kind === 'craft' && (t.id === recipeId || t.id === outputId));
  }

  noteTech(id: string): void {
    this.techTotal++;
    this.satisfy((t) => (t.kind === 'tech' && t.id === id) || (t.kind === 'techCount' && this.techTotal >= t.count));
  }

  noteBuild(id: string): void {
    this.buildTotal++;
    this.satisfy((t) => (t.kind === 'build' && t.id === id) || (t.kind === 'buildCount' && this.buildTotal >= t.count));
  }

  noteDatabank(id: string): void {
    this.satisfy((t) => t.kind === 'databank' && t.id === id);
  }

  /** Completes a `manual` objective (scripted story beats). */
  force(questId: string, objectiveId: string): boolean {
    const q = QUEST_DEFS.get(questId);
    if (!q || !this.active.includes(questId)) return false;
    const o = q.objectives.find((x) => x.id === objectiveId);
    if (!o || this.isDone(questId, objectiveId)) return false;
    this.completeObjective(q, o);
    this.checkCompletion(q);
    return true;
  }

  /**
   * Walks every active quest's outstanding objectives and completes those whose
   * trigger the predicate accepts. One pass; cheap enough to call per event.
   */
  private satisfy(pred: (t: QuestTrigger, questId: string) => boolean): void {
    for (const questId of [...this.active]) {
      const q = QUEST_DEFS.get(questId);
      if (!q) continue;
      const done = this.done.get(questId) ?? new Set<string>();
      let changed = false;
      for (const o of q.objectives) {
        if (done.has(o.id)) continue;
        if (!pred(o.trigger, questId)) continue;
        this.completeObjective(q, o);
        changed = true;
      }
      if (changed) this.checkCompletion(q);
    }
  }

  private completeObjective(q: QuestDef, o: ObjectiveDef): void {
    let set = this.done.get(q.id);
    if (!set) {
      set = new Set();
      this.done.set(q.id, set);
    }
    set.add(o.id);
    if (o.grantsDatabank) this.onGrantDatabank?.(o.grantsDatabank);
    if (o.grantsTech) this.onGrantTech?.(o.grantsTech);
    this.onUpdate?.({ quest: q, state: 'objective', objective: o, text: o.text });
  }

  private checkCompletion(q: QuestDef): void {
    const done = this.done.get(q.id) ?? new Set<string>();
    for (const o of q.objectives) {
      if (!o.optional && !done.has(o.id)) return;
    }
    const i = this.active.indexOf(q.id);
    if (i >= 0) this.active.splice(i, 1);
    if (!this.completed.includes(q.id)) this.completed.push(q.id);
    if (q.grantsDatabank) this.onGrantDatabank?.(q.grantsDatabank);
    this.onUpdate?.({ quest: q, state: 'completed', text: q.completion });
    if (q.next) this.start(q.next);
    this.openOptionalQuests();
  }

  /** Auto-starts optional quests whose prerequisite quests are done. */
  private openOptionalQuests(): void {
    for (const q of QUEST_LIST) {
      if (q.critical || q.autoStart) continue;
      if (this.stateOf(q.id) !== 'available') continue;
      if (!q.after) continue;
      this.start(q.id);
    }
  }

  /* ---------------- persistence ---------------- */

  serialise(): {
    active: string[];
    completed: string[];
    done: Array<[string, string[]]>;
    clocks: Array<[string, number]>;
    tallies: { scans: number; byCategory: Array<[string, number]>; tech: number; build: number };
  } {
    return {
      active: [...this.active],
      completed: [...this.completed],
      done: [...this.done].map(([k, v]) => [k, [...v]] as [string, string[]]),
      clocks: [...this.clocks],
      tallies: {
        scans: this.scansTotal,
        byCategory: [...this.scansByCategory],
        tech: this.techTotal,
        build: this.buildTotal,
      },
    };
  }

  deserialise(data: {
    active?: string[];
    completed?: string[];
    done?: Array<[string, string[]]>;
    clocks?: Array<[string, number]>;
    tallies?: { scans?: number; byCategory?: Array<[string, number]>; tech?: number; build?: number };
  }): void {
    this.reset();
    for (const id of data.completed ?? []) if (QUEST_DEFS.has(id)) this.completed.push(id);
    for (const id of data.active ?? []) if (QUEST_DEFS.has(id)) this.active.push(id);
    for (const [k, v] of data.done ?? []) this.done.set(k, new Set(v));
    for (const [k, v] of data.clocks ?? []) this.clocks.set(k, v);
    this.scansTotal = data.tallies?.scans ?? 0;
    for (const [k, v] of data.tallies?.byCategory ?? []) this.scansByCategory.set(k, v);
    this.techTotal = data.tallies?.tech ?? 0;
    this.buildTotal = data.tallies?.build ?? 0;
  }
}

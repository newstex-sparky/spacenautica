/**
 * DATABANK — the PDA's written record. Pure text, unlocked by scanning, by
 * quest progression, or by reading a data terminal. This is where the world
 * building lives; the HUD renders `title` + `text` verbatim.
 */

export type DatabankCategory =
  | 'fauna' | 'flora' | 'geology' | 'tech' | 'story' | 'log' | 'indigenous';

export interface DatabankEntry {
  id: string;
  title: string;
  category: DatabankCategory;
  /** Paragraphs. Rendered in order with spacing between them. */
  text: string[];
  /** Optional attribution line ("Alterra Field Guide, 12th ed."). */
  source?: string;
  /** Threat classification shown as a coloured chip for fauna entries. */
  threat?: 'passive' | 'defensive' | 'aggressive' | 'lethal';
  /** Unlocked from the start (the survival manual). */
  startsUnlocked?: boolean;
}

const ENTRIES: DatabankEntry[] = [
  /* ---------------- opening / survival ---------------- */
  {
    id: 'lore.welcome', title: 'Emergency Procedure 4-B', category: 'log', startsUnlocked: true,
    source: 'Alterra Corporation — Mandatory Onboarding',
    text: [
      'You are reading this because your vessel is no longer a vessel.',
      'Priority one is breathable air. Priority two is water. Priority three is a ' +
      'structure with a door. Everything else — including rescue — is priority four ' +
      'and will remain priority four for longer than you would like.',
      'Alterra reminds all contracted personnel that survival equipment recovered ' +
      'from company wreckage remains company property, and that any debt accrued ' +
      'during rescue operations is payable on return to a settled system.',
    ],
  },
  {
    id: 'lore.aurora', title: 'The Aurora', category: 'story', startsUnlocked: true,
    text: [
      'Twelve hundred metres of deep-space construction rig, capital-class, ' +
      'seventy-nine hands aboard. She came in fast on a survey vector and something ' +
      'reached up and hit her.',
      'Not weather. Not debris. Something aimed.',
      'She is aground on the shelf to the east, burning in three compartments, and ' +
      'her drive core is leaking. The glow you can see from the surface at night is ' +
      'not sunset.',
    ],
  },
  {
    id: 'lore.lifepod', title: 'Lifepod 5', category: 'log',
    text: [
      'Four metres of pressure-rated shell, one fabricator, one radio, one bunk you ' +
      'will not sleep in.',
      'The radio works. That is the cruel part. You can hear the other pods, and the ' +
      'other pods can hear you, and none of you can do anything about it.',
    ],
  },
  {
    id: 'lore.databox', title: 'Recovered Data Box', category: 'tech',
    text: [
      'A sealed Alterra pattern crate, buoyancy-neutral, blinking on a two-second ' +
      'cycle. They are dropped from lifepods when the crew realises they will not be ' +
      'using the contents.',
      'The fabricator pattern inside is intact. Whoever packed it was not.',
    ],
  },

  /* ---------------- geology / biomes ---------------- */
  {
    id: 'geo.shallows', title: 'Safe Shallows', category: 'geology',
    text: [
      'Fifteen to fifty metres. Carbonate sand over a limestone shelf, cut with ' +
      'coral tubes that stand three metres out of the floor and vent bubbles all day.',
      'Sunlight reaches the bottom here, so everything grows. Nothing in this biome ' +
      'is large enough to be a problem, which is why every survivor who lives past ' +
      'the first week starts here and gets sentimental about it later.',
    ],
  },
  {
    id: 'geo.kelp', title: 'Kelp Forest', category: 'geology',
    text: [
      'Twenty to a hundred and ten metres. Creepvine anchors in the silt and climbs ' +
      'forty metres to the light, in stands dense enough to lose a horizon in.',
      'Visibility drops to eight metres inside the canopy. Sound carries strangely. ' +
      'You will hear the stalkers before you see them, and you will hear them ' +
      'chewing on salvage they have dragged up from the wreck field.',
    ],
  },
  {
    id: 'geo.plateau', title: 'Grassy Plateaus', category: 'geology',
    text: [
      'Fifty to a hundred and sixty metres. Broad sandstone terraces furred with ' +
      'blade grass, stepping down toward the shelf edge.',
      'Open ground. Excellent for finding outcrops, poor for hiding, and sand sharks ' +
      'burrow under the grass and wait for something to walk across the ceiling of ' +
      'their world.',
    ],
  },
  {
    id: 'geo.mushroom', title: 'Mushroom Forest', category: 'geology',
    text: [
      'A hundred and twenty to two hundred and sixty metres. Fungal trees eight ' +
      'metres across, stacked in tiers, each cap bioluminescing on a slow cycle that ' +
      'the whole forest keeps in loose synchrony.',
      'It is the most beautiful place on this planet and the caps are hollow. Things ' +
      'nest in them.',
    ],
  },
  {
    id: 'geo.blood_kelp', title: 'Blood Kelp Zone', category: 'geology',
    text: [
      'Two hundred and fifty to four hundred and eighty metres. The vines here are ' +
      'black in torchlight and arterial red at the edges. They bleed an oil when cut.',
      'Below three hundred metres, downwelling light is effectively zero. Your entire ' +
      'world becomes a fourteen-metre sphere with you at the centre, and the sphere ' +
      'is full of shapes that do not stay still.',
    ],
  },
  {
    id: 'geo.lost_river', title: 'Lost River', category: 'geology',
    text: [
      'Four hundred and twenty to seven hundred and eighty metres. A brine river — ' +
      'water so saline it is denser than the water above it — flowing along the floor ' +
      'of a flooded cave system with a visible surface. A river, underwater.',
      'The banks are lined with bones. Not fossils: bones, articulated, kilometres of ' +
      'them, from animals larger than the Aurora. Something has been dying here on a ' +
      'schedule for a very long time.',
    ],
  },
  {
    id: 'geo.lava_zone', title: 'Inactive Lava Zone', category: 'geology',
    text: [
      'Seven hundred to thirteen hundred metres. Basalt sheet flows, sulphur pods, ' +
      'and a residual thermal gradient of eighty degrees between the floor and the ' +
      'water a metre above it.',
      'The rock here is younger than the wreck of your ship. There is a structure ' +
      'down here that is older than the species that built your ship.',
    ],
  },

  /* ---------------- fauna ---------------- */
  {
    id: 'fauna.peeper', title: 'Peeper', category: 'fauna', threat: 'passive',
    text: [
      'Thirty centimetres, spherical, two enormous forward eyes and no visible plan.',
      'Peepers migrate in loose shoals between the shallows and the kelp line on a ' +
      'roughly diurnal cycle. They are the base of most food webs here, edible raw, ' +
      'and easy to catch by hand — a combination that has kept more survivors alive ' +
      'than every piece of Alterra equipment put together.',
    ],
  },
  {
    id: 'fauna.bladderfish', title: 'Bladderfish', category: 'fauna', threat: 'passive',
    text: [
      'A filter feeder with a gas bladder it inflates with separated oxygen.',
      'Field note: the bladder can be bitten open for roughly twelve seconds of ' +
      'breathable air. Nobody who has needed to do this describes it fondly, but ' +
      'nobody who has done it is dead.',
    ],
  },
  {
    id: 'fauna.stalker', title: 'Stalker', category: 'fauna', threat: 'aggressive',
    text: [
      'Four metres, cartilaginous, absurdly overbuilt jaw. Kelp forest resident.',
      'Stalkers collect metal. They will pull salvage out of a wreck, carry it a ' +
      'hundred metres, drop it, and go back for more, apparently for the pleasure of ' +
      'chewing on it. The teeth they shed doing this are harder than the alloy they ' +
      'were chewing.',
      'They are territorial rather than predatory. This distinction will not comfort ' +
      'you at the time.',
    ],
  },
  {
    id: 'fauna.sandshark', title: 'Sand Shark', category: 'fauna', threat: 'aggressive',
    text: [
      'Two and a half metres of armour plate with a shovel for a face. Burrows into ' +
      'the plateau sand and ambushes upward.',
      'It reads pressure, not light. Swimming higher does not help. Swimming ' +
      'somewhere else does.',
    ],
  },
  {
    id: 'fauna.crabsquid', title: 'Crabsquid', category: 'fauna', threat: 'lethal',
    text: [
      'Eight metres. Six ambulatory limbs, one mantle, one eye the size of your ' +
      'faceplate.',
      'It discharges an electromagnetic pulse that kills powered equipment inside ' +
      'twenty metres — lights, propulsion, everything. It does this first, then it ' +
      'comes over to see what it has caught.',
      'Recommendation: do not be a powered object in a blood kelp trench.',
    ],
  },
  {
    id: 'fauna.reaper', title: 'Reaper Leviathan', category: 'fauna', threat: 'lethal',
    text: [
      'Fifty-five metres. Four mandibular arms. Echolocation call audible at eight ' +
      'hundred metres and physically painful at two hundred.',
      'It patrols the shelf edge around the Aurora. It does not hunt you; you are too ' +
      'small to be food. It grabs you because you are in its water and it has ' +
      'four arms and no reason not to.',
      'If you can hear it, you are already inside its patrol volume. If it goes ' +
      'quiet, it has found you.',
    ],
  },
  {
    id: 'fauna.ghost_leviathan', title: 'Ghost Leviathan', category: 'fauna', threat: 'lethal',
    text: [
      'Juveniles of eighteen metres in the river caves; adults past a hundred in the ' +
      'open void beyond the shelf.',
      'Translucent. Bioluminescent along the dorsal ridge. It moves like weather.',
      'The adults live in water two thousand metres deep with nothing to eat. Nobody ' +
      'has explained what they are doing there. Nobody has been able to ask.',
    ],
  },
  {
    id: 'fauna.jellyray', title: 'Jellyray', category: 'fauna', threat: 'passive',
    text: [
      'Three metres of translucent mantle with a bell of trailing filaments. Grazes ' +
      'on suspended organics.',
      'They travel in slow, silent lines through the reef at dusk. Watching them go ' +
      'past is the closest this planet comes to an apology.',
    ],
  },

  /* ---------------- flora ---------------- */
  {
    id: 'flora.creepvine', title: 'Creepvine', category: 'flora',
    text: [
      'A holdfast the size of a dinner table, a stipe forty metres long, and blades ' +
      'that carry the plant\'s entire photosynthetic load.',
      'The fibre runs true along the stipe and takes a load of four hundred kilos ' +
      'per bundle. The seed clusters contain an oil that polymerises on contact with ' +
      'air — the source of every gasket and fin blade in your kit.',
    ],
  },
  {
    id: 'flora.acid_mushroom', title: 'Acid Mushroom', category: 'flora',
    text: [
      'Violet, stalked, and defended by a vacuole of dilute hydrochloric acid it ' +
      'releases when the cap is breached.',
      'The same vacuole makes an excellent battery electrolyte. The plant has ' +
      'evolved a perfect deterrent against everything on this planet except a ' +
      'primate with a fabricator.',
    ],
  },
  {
    id: 'flora.bulb_bush', title: 'Bulbo Tree', category: 'flora',
    text: [
      'Water storage organ up to sixty centimetres across, skinned in a papery ' +
      'cuticle that reduces loss to almost nothing.',
      'Presses to nine hundred millilitres of near-potable fluid. On a planet made ' +
      'entirely of undrinkable water, this plant is the single most important ' +
      'organism to a stranded human.',
    ],
  },
  {
    id: 'flora.blood_vine', title: 'Blood Vine', category: 'flora',
    text: [
      'Aphotic. It does not photosynthesise; it feeds on dissolved organics falling ' +
      'from above, and on anything that stops moving nearby.',
      'The oil in the vine is a complex aromatic mix — the feedstock for benzene, ' +
      'and by extension for every polymer that lets you go deeper than the vine does.',
    ],
  },

  /* ---------------- story chain ---------------- */
  {
    id: 'story.signal_1', title: 'Repeating Signal — Bearing 041', category: 'story',
    text: [
      'A narrowband pulse, 3.4-second period, from the north-east trench. It has been ' +
      'running since before the Aurora arrived.',
      'It is not an Alterra frequency. It is not a distress pattern in any registry ' +
      'the PDA carries. It is regular, artificial, and patient.',
      'Whatever is transmitting has been transmitting for a very long time, and it has ' +
      'not adjusted its message once.',
    ],
  },
  {
    id: 'story.signal_2', title: 'Signal Source — Structure Detected', category: 'story',
    text: [
      'Sonar return at four hundred and ten metres: a geometric mass eighty metres ' +
      'across, seated in the trench wall. Right angles. Deliberate symmetry.',
      'Surface composition reads as a ceramic-metal composite with no entry in the ' +
      'materials database. It has been down here long enough for the reef to have ' +
      'grown over the lower third and then died back twice.',
      'The signal is coming from inside it, and now that you are close, it has ' +
      'changed period.',
    ],
  },
  {
    id: 'story.quarantine', title: 'Quarantine Enforcement Platform', category: 'story',
    text: [
      'The thing that shot down the Aurora was not hostile. It was procedural.',
      'This planet is under quarantine, enforced by an automated platform that has ' +
      'been destroying anything attempting to leave the atmosphere for approximately ' +
      'one thousand and forty years.',
      'It is not going to stop because you asked. It is going to stop when the ' +
      'reason for the quarantine stops being true.',
    ],
  },
  {
    id: 'story.kharaa', title: 'Kharaa Bacterium', category: 'story',
    text: [
      'A engineered pathogen, released here in a containment failure. Cross-species, ' +
      'aggressive, and eventually lethal to everything with a circulatory system.',
      'You are infected. You have been infected since you swam through the wreck ' +
      'field. The green striations on your forearm are the first stage.',
      'There is no vaccine in the Alterra formulary. There was never going to be.',
    ],
  },
  {
    id: 'story.precursor', title: 'The Architects', category: 'indigenous',
    text: [
      'Four fingers. Bilateral. Substantially larger than human. They arrived here ' +
      'chasing the same bacterium and they lost.',
      'They built a disease research facility a kilometre under the sea floor, a ' +
      'containment array around the whole planet, and a gun in orbit to make sure ' +
      'nobody carried the infection out. Then, one by one, they died in their own ' +
      'quarantine.',
      'The last of them left the cure unfinished, the doors unlocked, and a note in a ' +
      'language nobody was ever supposed to need to read.',
    ],
  },
  {
    id: 'story.escape', title: 'Departure Conditions', category: 'story',
    text: [
      'The platform will stand down for a biologically clean vessel. That is the ' +
      'entire specification. It has no other criteria and it cannot be argued with.',
      'So: synthesise the enzyme, cure yourself, cure the reef, build something that ' +
      'can hold pressure and atmosphere at once, and go.',
      'Alterra will bill you for the rocket.',
    ],
  },
];

export const DATABANK_ENTRIES: ReadonlyMap<string, DatabankEntry> = new Map(ENTRIES.map((e) => [e.id, e]));
export const DATABANK_LIST: readonly DatabankEntry[] = ENTRIES;

export class Databank {
  /** Unlocked entry ids. Field name kept from the baseline. */
  readonly entries = new Set<string>();
  /** Entries the player has opened, so the HUD can badge unread ones. */
  readonly read = new Set<string>();
  onUnlock: ((entry: DatabankEntry) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.entries.clear();
    this.read.clear();
    for (const e of DATABANK_LIST) if (e.startsUnlocked) this.entries.add(e.id);
  }

  unlock(id: string): boolean {
    const e = DATABANK_ENTRIES.get(id);
    if (!e || this.entries.has(id)) return false;
    this.entries.add(id);
    this.onUnlock?.(e);
    return true;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  markRead(id: string): void {
    if (this.entries.has(id)) this.read.add(id);
  }

  get unreadCount(): number {
    let n = 0;
    for (const id of this.entries) if (!this.read.has(id)) n++;
    return n;
  }

  /** Unlocked entries, optionally filtered, newest-unlocked last. */
  list(category?: DatabankCategory): DatabankEntry[] {
    const out: DatabankEntry[] = [];
    for (const e of DATABANK_LIST) {
      if (!this.entries.has(e.id)) continue;
      if (category && e.category !== category) continue;
      out.push(e);
    }
    return out;
  }

  categories(): DatabankCategory[] {
    const set = new Set<DatabankCategory>();
    for (const e of this.list()) set.add(e.category);
    return [...set];
  }

  serialise(): { entries: string[]; read: string[] } {
    return { entries: [...this.entries], read: [...this.read] };
  }

  deserialise(data: { entries?: string[]; read?: string[] }): void {
    this.reset();
    for (const id of data.entries ?? []) if (DATABANK_ENTRIES.has(id)) this.entries.add(id);
    for (const id of data.read ?? []) this.read.add(id);
  }
}

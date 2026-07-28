/**
 * SCANNER — progressive, hold-to-fill scanning.
 *
 * The player points the scanner at a registered target id and holds the trigger.
 * `hold()` fills a 0..1 bar; releasing lets it bleed back down, so an interrupted
 * scan costs you time but not everything. Completing a scan counts one *fragment*
 * of that target. Blueprint targets need several distinct fragments before the
 * tech node unlocks; a fauna scan needs one and gives you a databank entry.
 */

import type { Ingredient } from './Inventory';

export type ScanCategory =
  | 'fauna' | 'flora' | 'resource' | 'wreck' | 'fragment' | 'terminal' | 'lore';

export interface ScanTargetDef {
  id: string;
  name: string;
  category: ScanCategory;
  /** Seconds of continuous hold for one complete scan pass. */
  scanTime: number;
  /** Distinct fragments needed before `unlocks` fires. 1 for organics. */
  fragments: number;
  /** Tech node unlocked once every fragment is scanned. */
  unlocks?: string;
  /** Databank entry unlocked on the first completed scan. */
  databank?: string;
  /** Items dropped into the inventory on a completed scan (tissue samples). */
  yields?: Ingredient[];
  /** Shown in the scanner HUD while filling. */
  hint?: string;
}

const TARGETS: ScanTargetDef[] = [
  /* ---------------- fauna ---------------- */
  { id: 'fauna.peeper', name: 'Peeper', category: 'fauna', scanTime: 2.5, fragments: 1, databank: 'fauna.peeper' },
  { id: 'fauna.bladderfish', name: 'Bladderfish', category: 'fauna', scanTime: 2.5, fragments: 1, databank: 'fauna.bladderfish', unlocks: 'tech.air_bladder' },
  { id: 'fauna.boomerang', name: 'Boomerang', category: 'fauna', scanTime: 2.5, fragments: 1 },
  { id: 'fauna.hoverfish', name: 'Hoverfish', category: 'fauna', scanTime: 2.5, fragments: 1 },
  { id: 'fauna.reginald', name: 'Reginald', category: 'fauna', scanTime: 3, fragments: 1 },
  { id: 'fauna.eyeye', name: 'Eyeye', category: 'fauna', scanTime: 3, fragments: 1 },
  { id: 'fauna.jellyray', name: 'Jellyray', category: 'fauna', scanTime: 4, fragments: 1, databank: 'fauna.jellyray' },
  {
    id: 'fauna.stalker', name: 'Stalker', category: 'fauna', scanTime: 5, fragments: 1,
    databank: 'fauna.stalker', hint: 'Hold position. It will circle before it commits.',
  },
  { id: 'fauna.sandshark', name: 'Sand Shark', category: 'fauna', scanTime: 5, fragments: 1, databank: 'fauna.sandshark' },
  {
    id: 'fauna.crabsquid', name: 'Crabsquid', category: 'fauna', scanTime: 6, fragments: 1,
    databank: 'fauna.crabsquid', hint: 'Kill your lights first. It hunts what draws current.',
  },
  {
    id: 'fauna.reaper', name: 'Reaper Leviathan', category: 'fauna', scanTime: 8, fragments: 1,
    databank: 'fauna.reaper', hint: 'You should not be close enough to read this.',
  },
  { id: 'fauna.ghost_leviathan', name: 'Ghost Leviathan', category: 'fauna', scanTime: 8, fragments: 1, databank: 'fauna.ghost_leviathan' },

  /* ---------------- flora ---------------- */
  { id: 'flora.creepvine', name: 'Creepvine', category: 'flora', scanTime: 3, fragments: 1, databank: 'flora.creepvine' },
  { id: 'flora.acid_mushroom', name: 'Acid Mushroom', category: 'flora', scanTime: 2.5, fragments: 1, databank: 'flora.acid_mushroom' },
  { id: 'flora.bulb_bush', name: 'Bulbo Tree', category: 'flora', scanTime: 2.5, fragments: 1, databank: 'flora.bulb_bush' },
  { id: 'flora.blood_vine', name: 'Blood Vine', category: 'flora', scanTime: 4, fragments: 1, databank: 'flora.blood_vine' },
  { id: 'flora.table_coral', name: 'Table Coral', category: 'flora', scanTime: 2.5, fragments: 1, unlocks: 'tech.electronics' },

  /* ---------------- resources / geology ---------------- */
  { id: 'resource.limestone', name: 'Limestone Outcrop', category: 'resource', scanTime: 2, fragments: 1 },
  { id: 'resource.sandstone', name: 'Sandstone Outcrop', category: 'resource', scanTime: 2, fragments: 1 },
  { id: 'resource.shale', name: 'Shale Outcrop', category: 'resource', scanTime: 2.5, fragments: 1 },
  { id: 'resource.basalt', name: 'Basalt Outcrop', category: 'resource', scanTime: 2.5, fragments: 1 },
  { id: 'resource.thermal_vent', name: 'Thermal Vent', category: 'resource', scanTime: 4, fragments: 1, unlocks: 'tech.thermal_plant' },
  { id: 'resource.sulphur_pod', name: 'Sulphur Pod', category: 'resource', scanTime: 4, fragments: 1 },

  /* ---------------- wreck fragments (multi-part blueprints) ---------------- */
  {
    id: 'fragment.seaglide', name: 'Seaglide Fragment', category: 'fragment', scanTime: 4, fragments: 2,
    unlocks: 'tech.seaglide', hint: 'Two intact assemblies will complete the pattern.',
  },
  { id: 'fragment.habitat_builder', name: 'Habitat Builder Fragment', category: 'fragment', scanTime: 4, fragments: 2, unlocks: 'tech.habitat_builder' },
  { id: 'fragment.repair_tool', name: 'Repair Tool Fragment', category: 'fragment', scanTime: 3.5, fragments: 2, unlocks: 'tech.repair_tool' },
  { id: 'fragment.beacon', name: 'Beacon Fragment', category: 'fragment', scanTime: 3, fragments: 2, unlocks: 'tech.beacon' },
  { id: 'fragment.solar_panel', name: 'Solar Panel Fragment', category: 'fragment', scanTime: 4, fragments: 2, unlocks: 'tech.solar' },
  { id: 'fragment.multipurpose_room', name: 'Multipurpose Room Fragment', category: 'fragment', scanTime: 5, fragments: 3, unlocks: 'tech.habitat_rooms' },
  { id: 'fragment.moonpool', name: 'Moonpool Fragment', category: 'fragment', scanTime: 6, fragments: 4, unlocks: 'tech.moonpool' },
  { id: 'fragment.bioreactor', name: 'Bioreactor Fragment', category: 'fragment', scanTime: 4.5, fragments: 2, unlocks: 'tech.bioreactor' },
  { id: 'fragment.water_filtration', name: 'Water Filtration Fragment', category: 'fragment', scanTime: 4.5, fragments: 3, unlocks: 'tech.water_filtration' },
  { id: 'fragment.thermal_plant', name: 'Thermal Plant Fragment', category: 'fragment', scanTime: 5, fragments: 3, unlocks: 'tech.thermal_plant' },
  { id: 'fragment.laser_cutter', name: 'Laser Cutter Fragment', category: 'fragment', scanTime: 5, fragments: 3, unlocks: 'tech.laser_cutter' },
  { id: 'fragment.propulsion_cannon', name: 'Propulsion Cannon Fragment', category: 'fragment', scanTime: 5, fragments: 3, unlocks: 'tech.propulsion_cannon' },
  { id: 'fragment.stasis_rifle', name: 'Stasis Rifle Fragment', category: 'fragment', scanTime: 5.5, fragments: 3, unlocks: 'tech.stasis_rifle' },
  { id: 'fragment.nuclear_reactor', name: 'Nuclear Reactor Fragment', category: 'fragment', scanTime: 6, fragments: 4, unlocks: 'tech.nuclear' },
  { id: 'fragment.rebreather', name: 'Rebreather Fragment', category: 'fragment', scanTime: 4, fragments: 2, unlocks: 'tech.rebreather' },

  /* ---------------- wrecks & terminals ---------------- */
  {
    id: 'wreck.aurora', name: 'Aurora — Hull Breach', category: 'wreck', scanTime: 5, fragments: 1,
    databank: 'lore.aurora',
  },
  { id: 'wreck.lifepod', name: 'Lifepod Debris', category: 'wreck', scanTime: 3, fragments: 1, databank: 'lore.lifepod' },
  {
    id: 'terminal.signal', name: 'Alien Transmitter', category: 'terminal', scanTime: 6, fragments: 1,
    databank: 'story.signal_2', unlocks: 'tech.signal_decoder',
    hint: 'The pulse period shortens the longer you hold the beam on it.',
  },
  { id: 'terminal.precursor_glyph', name: 'Architect Glyph Panel', category: 'terminal', scanTime: 7, fragments: 1, databank: 'story.precursor' },
  { id: 'terminal.quarantine', name: 'Quarantine Enforcement Node', category: 'terminal', scanTime: 8, fragments: 1, databank: 'story.quarantine' },
  { id: 'terminal.disease_lab', name: 'Disease Research Terminal', category: 'terminal', scanTime: 8, fragments: 1, databank: 'story.kharaa' },
];

export const SCAN_TARGETS: ReadonlyMap<string, ScanTargetDef> = new Map(TARGETS.map((t) => [t.id, t]));
export const SCAN_TARGET_LIST: readonly ScanTargetDef[] = TARGETS;

export interface ScanCompletion {
  target: ScanTargetDef;
  /** Fragments found after this scan. */
  found: number;
  /** Fragments required in total. */
  required: number;
  /** True when this scan finished the set. */
  finished: boolean;
}

/** Rate the bar bleeds back when the trigger is released, in fractions/second. */
const DECAY_RATE = 0.45;

export class Scanner {
  /** Partial progress 0..1 per target id. Field name kept from the baseline. */
  readonly progress = new Map<string, number>();
  /** Completed scan passes per target id. */
  readonly fragmentsFound = new Map<string, number>();
  /** Targets whose fragment set is complete. */
  readonly completed = new Set<string>();

  /** Target currently under the beam, or null. */
  activeTarget: string | null = null;
  /** Whether the trigger was held this frame. */
  private heldThisFrame = false;

  onScan: ((c: ScanCompletion) => void) | null = null;
  /** Items yielded by a completed scan; GameState routes them to the inventory. */
  onYield: ((items: Ingredient[]) => void) | null = null;

  /* ---------------- queries ---------------- */

  target(id: string): ScanTargetDef | undefined {
    return SCAN_TARGETS.get(id);
  }

  /** 0..1 fill for the HUD ring. */
  progressOf(id: string): number {
    return this.progress.get(id) ?? 0;
  }

  fragmentsOf(id: string): number {
    return this.fragmentsFound.get(id) ?? 0;
  }

  requiredFor(id: string): number {
    return SCAN_TARGETS.get(id)?.fragments ?? 1;
  }

  remainingFor(id: string): number {
    return Math.max(0, this.requiredFor(id) - this.fragmentsOf(id));
  }

  isComplete(id: string): boolean {
    return this.completed.has(id);
  }

  /** Anything worth pointing the scanner at that is not finished yet. */
  outstanding(category?: ScanCategory): ScanTargetDef[] {
    return TARGETS.filter((t) => !this.completed.has(t.id) && (!category || t.category === category));
  }

  /* ---------------- the interaction ---------------- */

  /**
   * Call every frame while the trigger is down and a target is in the reticle.
   * Returns the completion record on the frame a pass finishes, else null.
   */
  hold(targetId: string, dt: number): ScanCompletion | null {
    const t = SCAN_TARGETS.get(targetId);
    if (!t) return null;
    this.heldThisFrame = true;

    // Switching targets abandons the previous bar quickly rather than instantly.
    if (this.activeTarget && this.activeTarget !== targetId) {
      this.bleed(this.activeTarget, dt * 3);
    }
    this.activeTarget = targetId;

    if (this.completed.has(targetId) && t.fragments <= this.fragmentsOf(targetId)) {
      // Already fully known: keep the bar pinned so the HUD reads "known".
      this.progress.set(targetId, 1);
      return null;
    }

    const p = (this.progress.get(targetId) ?? 0) + dt / Math.max(0.1, t.scanTime);
    if (p < 1) {
      this.progress.set(targetId, p);
      return null;
    }

    // ---- one pass complete ----
    this.progress.set(targetId, 0);
    const found = this.fragmentsOf(targetId) + 1;
    this.fragmentsFound.set(targetId, found);
    const required = t.fragments;
    const finished = found >= required;
    if (finished) this.completed.add(targetId);
    const record: ScanCompletion = { target: t, found, required, finished };
    if (t.yields?.length) this.onYield?.(t.yields.map((y) => ({ ...y })));
    this.onScan?.(record);
    return record;
  }

  /** Call every frame. Bleeds down any bar that was not held this frame. */
  update(dt: number): void {
    if (!this.heldThisFrame) {
      for (const [id, v] of this.progress) {
        if (this.completed.has(id)) continue;
        if (v <= 0) continue;
        this.bleed(id, dt);
      }
      this.activeTarget = null;
    }
    this.heldThisFrame = false;
  }

  private bleed(id: string, dt: number): void {
    const v = (this.progress.get(id) ?? 0) - DECAY_RATE * dt;
    if (v <= 0) this.progress.delete(id);
    else this.progress.set(id, v);
  }

  /** Grants a fragment without a scan (data box, quest reward, debug). */
  grantFragment(targetId: string, count = 1): ScanCompletion | null {
    const t = SCAN_TARGETS.get(targetId);
    if (!t) return null;
    const found = Math.min(t.fragments, this.fragmentsOf(targetId) + count);
    this.fragmentsFound.set(targetId, found);
    const finished = found >= t.fragments;
    if (finished) this.completed.add(targetId);
    const record: ScanCompletion = { target: t, found, required: t.fragments, finished };
    this.onScan?.(record);
    return record;
  }

  reset(): void {
    this.progress.clear();
    this.fragmentsFound.clear();
    this.completed.clear();
    this.activeTarget = null;
  }

  serialise(): { fragments: Array<[string, number]>; completed: string[] } {
    return { fragments: [...this.fragmentsFound], completed: [...this.completed] };
  }

  deserialise(data: { fragments?: Array<[string, number]>; completed?: string[] }): void {
    this.reset();
    for (const [id, n] of data.fragments ?? []) if (SCAN_TARGETS.has(id)) this.fragmentsFound.set(id, n);
    for (const id of data.completed ?? []) if (SCAN_TARGETS.has(id)) this.completed.add(id);
  }
}

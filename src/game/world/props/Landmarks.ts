/**
 * Deterministic landmark registry.
 *
 * The world's set pieces are placed at hand-chosen XZ coordinates (their Y is
 * resolved against `ctx.world.heightAt` at load, so they stay planted whatever
 * the terrain generator produces). Quests, the HUD compass, the audio system
 * and the databank can all read this registry through
 * `PropsSystem.landmarks` — it is the single source of truth for "named place".
 */
import * as THREE from 'three';

export type LandmarkKind = 'wreck' | 'pod' | 'precursor' | 'vent_field' | 'debris' | 'boulder_field';

export interface Landmark {
  /** Stable id — safe to persist in a save file or reference from a quest. */
  id: string;
  name: string;
  kind: LandmarkKind;
  /** World position: XZ as authored, Y snapped to the sea floor at load. */
  readonly position: THREE.Vector3;
  /** Radius that reads as "you are here", metres. */
  radius: number;
  /** Depth of the floor beneath it, metres (>= 0). Filled in at load. */
  depth: number;
  /** Set true the first time the player comes within `radius`. */
  discovered: boolean;
  /** Databank entry unlocked on discovery, if any. */
  databank?: string;
  /** Short line the HUD/PDA can show when it is the active waypoint. */
  blurb: string;
}

/** Authoring table. XZ only — Y comes from the terrain at load time. */
export interface LandmarkSeed {
  id: string;
  name: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  radius: number;
  yaw: number;
  blurb: string;
  databank?: string;
}

/**
 * The authored world. Coordinates are chosen so that the scripted capture
 * vantage points (see `scripts/capture.mjs`) look *at* something: the hull
 * section sits ahead of `08_wreck`, the escape pod ahead of `02_shallows_floor`,
 * the vent field ahead of `04_reef_wall`, and the precursor gate ahead of
 * `05_deep_dark`.
 */
export const LANDMARK_SEEDS: LandmarkSeed[] = [
  {
    id: 'pod_five', name: 'Lifepod 5', kind: 'pod', x: -7, z: -13, radius: 14, yaw: 0.7,
    blurb: 'Your lifepod. Scorched, listing, still transmitting.', databank: 'pod_five',
  },
  {
    id: 'aurora_bow', name: 'Severed Bow Section', kind: 'wreck', x: -71, z: -224, radius: 34, yaw: 0.42,
    blurb: 'A thirty-metre hull section torn clean off. Something is still powered inside.',
    databank: 'wreck_bow',
  },
  {
    id: 'aurora_debris', name: 'Debris Field', kind: 'debris', x: -46, z: -196, radius: 40, yaw: 0,
    blurb: 'Plating, girders and split cargo scattered across the sand.',
  },
  {
    id: 'cargo_spill', name: 'Cargo Spill', kind: 'debris', x: 62, z: 148, radius: 30, yaw: 1.9,
    blurb: 'Containers burst on impact. Salvageable alloy everywhere.',
  },
  {
    id: 'smoker_ridge', name: 'Smoker Ridge', kind: 'vent_field', x: 249, z: -136, radius: 42, yaw: 0,
    blurb: 'Black smokers venting along a fracture. The water here is warm.',
    databank: 'vents',
  },
  {
    id: 'deep_smokers', name: 'Abyssal Smokers', kind: 'vent_field', x: -352, z: -344, radius: 46, yaw: 0,
    blurb: 'A vent field on the basin floor, far below the light.',
  },
  {
    id: 'precursor_gate', name: 'Precursor Gate', kind: 'precursor', x: -334, z: -323, radius: 38, yaw: 0.55,
    blurb: 'Not human. The alloy is unscratched after who knows how long.',
    databank: 'precursor_gate',
  },
  {
    id: 'boulder_garden', name: 'Boulder Garden', kind: 'boulder_field', x: 122, z: 84, radius: 46, yaw: 0,
    blurb: 'A field of fractured basalt, thick with limestone outcrops.',
  },
  {
    id: 'kelp_shelf', name: 'Kelp Shelf Rocks', kind: 'boulder_field', x: -138, z: 122, radius: 40, yaw: 0,
    blurb: 'Bedrock breaking through the sand at the edge of the kelp.',
  },
];

export class LandmarkRegistry {
  readonly all: Landmark[] = [];
  private byId = new Map<string, Landmark>();

  add(l: Landmark): void {
    this.all.push(l);
    this.byId.set(l.id, l);
  }

  get(id: string): Landmark | undefined {
    return this.byId.get(id);
  }

  /** Nearest landmark, optionally filtered by kind. Null if the world is empty. */
  nearest(pos: THREE.Vector3, kind?: LandmarkKind): Landmark | null {
    let best: Landmark | null = null;
    let bestD = Infinity;
    for (const l of this.all) {
      if (kind && l.kind !== kind) continue;
      const d = l.position.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best;
  }

  /** Everything whose centre falls inside `radius` of `pos`. */
  within(pos: THREE.Vector3, radius: number, out: Landmark[] = []): Landmark[] {
    out.length = 0;
    const r2 = radius * radius;
    for (const l of this.all) if (l.position.distanceToSquared(pos) <= r2) out.push(l);
    return out;
  }

  /** Landmarks the player has already found, for the compass and save file. */
  discovered(): Landmark[] {
    return this.all.filter((l) => l.discovered);
  }
}

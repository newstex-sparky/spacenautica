/**
 * The audio environment: one object handed to every sub-module so they can
 * allocate voices without knowing anything about the mixer topology, the
 * quality tier or the current world state.
 *
 * The world-state fields are *structurally* typed on purpose. The audio module
 * never imports the player, water or terrain classes — those files belong to
 * other agents and are being rewritten in parallel — it only reads the shapes
 * documented in `CONTRACTS.md`.
 */
import * as THREE from 'three';
import type { QualityTier } from '../core/Types';
import { Mixer } from './Mixer';
import type { BusName } from './Mixer';
import { NoiseBank, Voice } from './Dsp';
import { Spatial } from './Spatial';
import type { Vec3Like, PlaceOptions } from './Spatial';
import { UnderwaterChain } from './UnderwaterChain';

/** Subset of `PlayerSystem` the audio module reads (see CONTRACTS.md). */
export interface PlayerLike {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly depth: number;
  readonly swimming: boolean;
  readonly sprinting: boolean;
  readonly grounded: boolean;
  readonly inVehicle: string | null;
  readonly vitals: { oxygen: number; maxOxygen: number; health: number; food: number; water: number };
}

/** Subset of `WaterSystem` the audio module reads. */
export interface WaterLike {
  readonly underwater: boolean;
  readonly cameraDepth: number;
}

export interface WorldState {
  underwater: boolean;
  /** Metres below the surface, >= 0. */
  depth: number;
  /** 0 = open water, 1 = fully enclosed (wreck / cave / base interior). */
  enclosure: number;
  /** Dominant biome id, or '' before terrain reports one. */
  biome: string;
  /** Eye position, world space. */
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  speed: number;
  swimming: boolean;
  sprinting: boolean;
  grounded: boolean;
  inVehicle: string | null;
  /** 0..1 */
  oxygen: number;
  /** 0..1 */
  health: number;
  /** Seconds of accumulated aggro pressure, drives music tension. */
  threat: number;
}

const VOICE_BUDGET: Record<QualityTier, number> = { low: 14, medium: 22, high: 34, ultra: 48 };

export interface VoiceOptions {
  /** Route through the underwater processor. Default true. */
  world?: boolean;
  /** World position; when present the voice is spatialised. */
  pos?: Vec3Like;
  /** 0 = decorative, 1 = normal, 2 = never dropped. */
  priority?: number;
  place?: PlaceOptions;
}

export class AudioEnv {
  readonly mixer: Mixer;
  readonly uw: UnderwaterChain;
  readonly spatial: Spatial;
  readonly noise: NoiseBank;

  readonly state: WorldState = {
    underwater: true,
    depth: 12,
    enclosure: 0,
    biome: 'shallows',
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    speed: 0,
    swimming: true,
    sprinting: false,
    grounded: false,
    inVehicle: null,
    oxygen: 1,
    health: 1,
    threat: 0,
  };

  private live = 0;
  private budget: number;

  constructor(
    readonly ac: AudioContext,
    public tier: QualityTier,
    readonly rng: () => number,
  ) {
    this.uw = new UnderwaterChain(ac, tier, rng);
    this.mixer = new Mixer(ac, this.uw.input);
    this.uw.output.connect(this.mixer.master);
    this.spatial = new Spatial(ac, tier);
    this.noise = new NoiseBank(ac, rng, tier === 'low' ? 0.6 : 1);
    this.budget = VOICE_BUDGET[tier];
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
    this.budget = VOICE_BUDGET[tier];
    this.uw.setTier(tier);
    this.spatial.setTier(tier);
  }

  now(): number {
    return this.ac.currentTime;
  }

  get voiceCount(): number {
    return this.live;
  }

  /**
   * Allocates a voice on a bus. Returns null when the polyphony budget is full
   * and the sound is not important enough to steal a slot — dropping a decorative
   * bubble is always better than glitching the frame.
   */
  voice(bus: BusName, opts: VoiceOptions = {}): Voice | null {
    const priority = opts.priority ?? 1;
    if (this.live >= this.budget && priority < 2) return null;
    this.live++;
    const out = this.mixer.input(bus, opts.world ?? true);
    const v = new Voice(this.ac, out, () => {
      this.live--;
    });
    return v;
  }

  /**
   * Convenience: allocate a voice and return both it and the node to synthesise
   * into (already spatialised when `pos` is given).
   */
  head(bus: BusName, opts: VoiceOptions = {}): { v: Voice; out: AudioNode } | null {
    const v = this.voice(bus, opts);
    if (!v) return null;
    const out = this.spatial.place(v, opts.pos, opts.place);
    return { v, out };
  }

  dispose(): void {
    this.mixer.dispose();
    this.uw.dispose();
  }
}

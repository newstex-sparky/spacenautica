/**
 * Core engine contracts. Every subsystem in the game implements `GameSystem`
 * and receives the shared `GameContext`. Nothing in this file may import from
 * outside `core/` — it is the dependency root.
 */
import type * as THREE from 'three';
import type { EventBus } from './EventBus';
import type { InputState } from './Input';
import type { Settings } from './Settings';

/** Ordered update phases. Systems are updated in ascending phase order. */
export enum Phase {
  /** Input sampling, time, settings reconciliation. */
  PreUpdate = 0,
  /** World streaming: terrain chunks, LOD selection, vegetation population. */
  World = 10,
  /** Physics + player controller integration. */
  Physics = 20,
  /** AI, fauna, boids, creature state machines. */
  Simulation = 30,
  /** Gameplay systems: inventory, crafting, quests, scanning. */
  Gameplay = 40,
  /** Camera, view-model, animation driven by the resolved player state. */
  Camera = 50,
  /** Renderer-facing uniform pushes (water, sky, fog, post-processing). */
  PreRender = 60,
  /** HUD/UI updates that read final state. */
  UI = 70,
}

export interface GameSystem {
  /** Unique key used by `ctx.get<T>(name)`. */
  readonly name: string;
  readonly phase: Phase;
  /** Called once, in registration order, before the first frame. May be async. */
  init?(ctx: GameContext): void | Promise<void>;
  /** Called once per frame. `dt` is clamped seconds. */
  update?(dt: number, ctx: GameContext): void;
  /** Called on canvas resize. */
  resize?(width: number, height: number, ctx: GameContext): void;
  /** Release GPU resources. */
  dispose?(): void;
}

/**
 * Read-only queries about the world that any system may ask. Implemented by the
 * terrain system and installed onto the context during init.
 */
export interface WorldQuery {
  /** Terrain surface height (world Y) at a world XZ. Sea floor, not water. */
  heightAt(x: number, z: number): number;
  /** Approximate outward surface normal of the sea floor at a world XZ. */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Biome weights at a world XZ; keys are biome ids. */
  biomeAt(x: number, z: number): BiomeSample;
  /** True when the point is inside solid terrain (used by physics sweeps). */
  isSolid(x: number, y: number, z: number): boolean;
  /** Water surface Y at a world XZ (includes wave displacement when available). */
  waterHeightAt(x: number, z: number, time: number): number;
  /** Water current velocity at a world position, m/s. */
  currentAt(x: number, y: number, z: number, time: number, out: THREE.Vector3): THREE.Vector3;
}

export interface BiomeSample {
  /** Dominant biome id. */
  id: string;
  /** Blend weight of the dominant biome, 0..1. */
  weight: number;
  /** All contributing weights keyed by biome id. */
  weights: Readonly<Record<string, number>>;
}

/** Everything a system is allowed to touch. */
export interface GameContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly bus: EventBus;
  readonly input: InputState;
  readonly settings: Settings;
  /** Seconds since engine start, unpaused. */
  readonly time: number;
  /** Frame index since engine start. */
  readonly frame: number;
  /** Canvas drawing-buffer size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio actually used for the drawing buffer. */
  readonly pixelRatio: number;
  /** World queries. Available after the terrain system's `init`. */
  world: WorldQuery;
  /** Resolve another system by name. Throws if absent. */
  get<T extends GameSystem>(name: string): T;
  /** Resolve another system by name, or undefined. */
  tryGet<T extends GameSystem>(name: string): T | undefined;
  /** Register a system after boot (used by lazily-created subsystems). */
  register(system: GameSystem): void;
}

/** Discrete quality tiers. Systems must honour these for scalability. */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_ORDER: QualityTier[] = ['low', 'medium', 'high', 'ultra'];

export function qualityAtLeast(a: QualityTier, b: QualityTier): boolean {
  return QUALITY_ORDER.indexOf(a) >= QUALITY_ORDER.indexOf(b);
}

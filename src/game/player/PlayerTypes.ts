/**
 * Shared vocabulary for the player module: vitals, equipment, locomotion modes,
 * tool ids and the small amount of spring/damper maths every part of the rig
 * uses. Nothing here touches the scene graph, so it stays cheap to import.
 */
import * as THREE from 'three';

/**
 * Render layer used by every first-person view-model object. The camera opts
 * into it during `ViewModelSystem.init`. Post passes that should not see the
 * hands (DOF near-field, GTAO, SSR) can exclude this layer.
 */
export const VIEWMODEL_LAYER = 8;

/**
 * Player vitals. The five baseline fields keep their meaning and range; the
 * `temperature` field is additive (core body temperature, °C) and is only read
 * by systems that know about it.
 */
export interface Vitals {
  oxygen: number;
  maxOxygen: number;
  health: number;
  food: number;
  water: number;
  /** Core body temperature in °C. 37 = normal, < 35 = hypothermia. */
  temperature: number;
}

/** Worn/carried equipment. Mutated by the RPG systems; read by the controller. */
export interface PlayerEquipment {
  /** Swim fins: more thrust, less lateral drag. */
  fins: boolean;
  /** Tank type drives `maxOxygen` and a little positive buoyancy. */
  tank: 'standard' | 'high_capacity' | 'ultra_capacity' | 'rebreather';
  /** Suit drives insulation and buoyancy. */
  suit: 'none' | 'wetsuit' | 'reinforced' | 'coldsuit';
  /** Ballast: makes you sink, useful for walking the floor. */
  weightBelt: boolean;
  /** Carried mass in kg — heavier cargo means less net buoyancy. */
  cargoMass: number;
}

export const DEFAULT_EQUIPMENT: PlayerEquipment = {
  fins: false,
  tank: 'standard',
  suit: 'wetsuit',
  weightBelt: false,
  cargoMass: 0,
};

/** Oxygen capacity in seconds per tank type. */
export const TANK_OXYGEN: Record<PlayerEquipment['tank'], number> = {
  standard: 45,
  high_capacity: 75,
  ultra_capacity: 135,
  rebreather: 180,
};

/** 0..1 insulation factor; 1 would be perfect. */
export const SUIT_INSULATION: Record<PlayerEquipment['suit'], number> = {
  none: 0.08,
  wetsuit: 0.42,
  reinforced: 0.55,
  coldsuit: 0.86,
};

/** How the body is currently moving through the world. */
export type LocomotionMode = 'swim' | 'surface' | 'walk';

/** Every tool the view-model can hold. `none` means bare hands. */
export type ToolId =
  | 'none'
  | 'scanner'
  | 'knife'
  | 'flashlight'
  | 'builder'
  | 'propulsion'
  | 'lasercutter';

/** Hotbar order used by the 1..7 number keys. */
export const TOOL_ORDER: ToolId[] = [
  'none',
  'scanner',
  'knife',
  'flashlight',
  'builder',
  'propulsion',
  'lasercutter',
];

/* ------------------------------------------------------------------ *
 * Maths — all allocation-free.
 * ------------------------------------------------------------------ */

/** Frame-rate independent exponential approach. `lambda` is 1/seconds. */
export function expDamp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Same, for angles: takes the short way around. */
export function expDampAngle(current: number, target: number, lambda: number, dt: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-lambda * dt));
}

export function expDampVec(
  current: THREE.Vector3,
  target: THREE.Vector3,
  lambda: number,
  dt: number,
): void {
  const k = Math.exp(-lambda * dt);
  current.x = target.x + (current.x - target.x) * k;
  current.y = target.y + (current.y - target.y) * k;
  current.z = target.z + (current.z - target.z) * k;
}

/** Smoothstep, clamped. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * A scalar spring with explicit stiffness/damping, integrated semi-implicitly
 * and sub-stepped so it stays stable at 15 fps as well as 240.
 */
export class Spring1 {
  value = 0;
  velocity = 0;
  constructor(
    public stiffness = 120,
    public damping = 18,
  ) {}

  step(dt: number, target: number): number {
    const steps = dt > 1 / 60 ? Math.min(6, Math.ceil(dt * 60)) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  /** Add an instantaneous velocity kick (recoil, impacts, damage). */
  kick(v: number): void {
    this.velocity += v;
  }

  reset(v = 0): void {
    this.value = v;
    this.velocity = 0;
  }
}

/** Three independent springs sharing one set of coefficients. */
export class Spring3 {
  readonly value = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  constructor(
    public stiffness = 120,
    public damping = 18,
  ) {}

  step(dt: number, target: THREE.Vector3): THREE.Vector3 {
    const steps = dt > 1 / 60 ? Math.min(6, Math.ceil(dt * 60)) : 1;
    const h = dt / steps;
    const v = this.value;
    const vel = this.velocity;
    for (let i = 0; i < steps; i++) {
      const ax = (target.x - v.x) * this.stiffness - vel.x * this.damping;
      const ay = (target.y - v.y) * this.stiffness - vel.y * this.damping;
      const az = (target.z - v.z) * this.stiffness - vel.z * this.damping;
      vel.x += ax * h;
      vel.y += ay * h;
      vel.z += az * h;
      v.x += vel.x * h;
      v.y += vel.y * h;
      v.z += vel.z * h;
    }
    return v;
  }

  kick(x: number, y: number, z: number): void {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
  }

  reset(): void {
    this.value.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
  }
}

/**
 * Ambient water temperature in °C for a biome id at a depth. There is no
 * temperature field on `BiomeDef` (its shape is frozen), so the mapping lives
 * here and falls back to a thermocline curve for unknown biomes.
 */
const BIOME_TEMP: Record<string, number> = {
  shallows: 24,
  kelp_forest: 19,
  grassy_plateau: 16,
  red_grass: 13,
  mushroom_forest: 11,
  blood_kelp: 3.5,
  lost_river: 1.5,
  lava_zone: 48,
};

export function ambientWaterTemp(biomeId: string, depth: number): number {
  const known = BIOME_TEMP[biomeId];
  if (known !== undefined) return known;
  // Generic thermocline: 25 °C at the surface decaying to ~2 °C by 600 m.
  return 2 + 23 * Math.exp(-depth / 190);
}

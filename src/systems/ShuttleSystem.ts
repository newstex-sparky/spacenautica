import * as THREE from 'three';

/**
 * Shuttle System
 *
 * Shuttle pod fuel management and flight controls.
 * Handles fuel consumption, cargo tracking, and flight state.
 */

// ====================== Constants ======================

const SHUTTLE_MAX_FUEL = 100;
const SHUTTLE_FUEL_CONSUMPTION_RATE_BASE = 0.1; // per second
const SHUTTLE_FUEL_CONSUMPTION_MULTIPLIER = 1.5; // multiplier for speed

const CARGO_SLOTS = {
  IRON: { name: 'Raw Iron', icon: '📦', maxSize: 50 },
  ICE: { name: 'Water Ice', icon: '❄️', maxSize: 50 },
  RAW_ORE: { name: 'Raw Ore', icon: '💎', maxSize: 30 },
  IRON_METAL: { name: 'Iron Metal', icon: '⚙️', maxSize: 20 },
  TITANIUM: { name: 'Titanium', icon: '🔩', maxSize: 20 },
  OXYGEN: { name: 'Oxygen Crystal', icon: '💧', maxSize: 100 },
  H2: { name: 'H2 Fuel', icon: '⛽', maxSize: 50 },
};

// Shuttle types and their properties
export type ShuttleType = 'shuttle-mk1' | 'shuttle-rescue';

export interface ShuttleConfig {
  type: ShuttleType;
  name: string;
  maxFuel: number;
  maxSpeed: number;
  acceleration: number;
  deceleration: number;
  fuelConsumptionRate: number;
  maneuverability: number;
}

const SHUTTLE_CONFIGS: Record<ShuttleType, ShuttleConfig> = {
  'shuttle-mk1': {
    type: 'shuttle-mk1',
    name: 'Shuttle MK-1',
    maxFuel: SHUTTLE_MAX_FUEL,
    maxSpeed: 15,
    acceleration: 8,
    deceleration: 4,
    fuelConsumptionRate: SHUTTLE_FUEL_CONSUMPTION_RATE_BASE,
    maneuverability: 0.03,
  },
  'shuttle-rescue': {
    type: 'shuttle-rescue',
    name: 'Rescue Shuttle',
    maxFuel: SHUTTLE_MAX_FUEL * 1.5,
    maxSpeed: 12,
    acceleration: 6,
    deceleration: 3,
    fuelConsumptionRate: SHUTTLE_FUEL_CONSUMPTION_RATE_BASE * 0.8,
    maneuverability: 0.04,
  },
};

// Shuttle state
export interface ShuttleState {
  inShuttle: boolean;
  currentShuttleType: ShuttleType;
  isDocked: boolean;
  isLaunching: boolean;
  isLanding: boolean;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;
  altitude: number; // Meters from station
  fuelPercent: number;
  isEngineOn: boolean;
  isAirbrakeOn: boolean;
  throttle: number; // 0-1
  heading: number; // Radians
  pitchAngle: number; // Radians
  rollAngle: number; // Radians
  cargo: CargoItem[];
  resources: {
    iron: number;
    ice: number;
    rawOre: number;
    ironMetal: number;
    titanium: number;
    oxygen: number;
    h2: number;
  };
}

// Cargo item interface
export interface CargoItem {
  type: keyof typeof CARGO_SLOTS;
  amount: number;
}

// Flight input state
export interface ShuttleFlightInput {
  thrust: boolean; // Forward/Throttle
  backward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  airbrake: boolean;
  autopilot: boolean;
}

// ====================== System Functions ======================

/**
 * Initialize a new shuttle state
 */
export function initializeShuttleState(shuttleType: ShuttleType = 'shuttle-mk1'): ShuttleState {
  const config = SHUTTLE_CONFIGS[shuttleType];

  return {
    inShuttle: false,
    currentShuttleType: shuttleType,
    isDocked: true,
    isLaunching: false,
    isLanding: false,
    position: new THREE.Vector3(0, 0, 20), // Initial spawn position
    rotation: new THREE.Euler(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    altitude: 20,
    fuelPercent: 100,
    isEngineOn: false,
    isAirbrakeOn: false,
    throttle: 0,
    heading: Math.PI / 2, // Facing forward (+Z)
    pitchAngle: 0,
    rollAngle: 0,
    cargo: [],
    resources: {
      iron: 0,
      ice: 0,
      rawOre: 0,
      ironMetal: 0,
      titanium: 0,
      oxygen: 0,
      h2: 0,
    },
  };
}

/**
 * Create a new cargo item
 */
export function createCargoItem(type: keyof typeof CARGO_SLOTS, amount: number = 1): CargoItem | null {
  if (amount > CARGO_SLOTS[type].maxSize) {
    console.warn(`Exceeded max size for ${CARGO_SLOTS[type].name}`);
    return null;
  }
  return { type, amount };
}

/**
 * Add cargo to shuttle
 */
export function addCargo(
  state: ShuttleState,
  type: keyof typeof CARGO_SLOTS,
  amount: number
): ShuttleState {
  const existing = state.cargo.find((item) => item.type === type);
  const config = CARGO_SLOTS[type];

  if (existing) {
    const newAmount = existing.amount + amount;
    if (newAmount <= config.maxSize) {
      existing.amount = newAmount;
    }
  } else {
    const newItem = createCargoItem(type, amount);
    if (newItem) {
      state.cargo.push(newItem);
    }
  }

  // Update resource totals
  updateResourceTotals(state, type, amount);

  return { ...state };
}

/**
 * Remove cargo from shuttle (unloaded at station)
 */
export function removeCargo(
  state: ShuttleState,
  type: keyof typeof CARGO_SLOTS,
  amount: number
): ShuttleState {
  const existingIndex = state.cargo.findIndex((item) => item.type === type);
  if (existingIndex === -1) return state;

  const existing = state.cargo[existingIndex];

  if (existing.amount <= amount) {
    state.cargo.splice(existingIndex, 1);
  } else {
    existing.amount -= amount;
  }

  // Update resource totals
  updateResourceTotals(state, type, -amount);

  return { ...state };
}

/**
 * Update resource totals from cargo
 */
function updateResourceTotals(
  state: ShuttleState,
  type: keyof typeof CARGO_SLOTS,
  delta: number
) {
  const config = CARGO_SLOTS[type];

  switch (type) {
    case 'IRON':
      state.resources.iron += delta;
      break;
    case 'ICE':
      state.resources.ice += delta;
      break;
    case 'RAW_ORE':
      state.resources.rawOre += delta;
      break;
    case 'IRON_METAL':
      state.resources.ironMetal += delta;
      break;
    case 'TITANIUM':
      state.resources.titanium += delta;
      break;
    case 'OXYGEN':
      state.resources.oxygen += delta;
      break;
    case 'H2':
      state.resources.h2 += delta;
      break;
  }
}

/**
 * Update shuttle flight physics
 */
export function updateShuttleFlight(
  state: ShuttleState,
  input: ShuttleFlightInput,
  deltaTime: number
): ShuttleState {
  const config = SHUTTLE_CONFIGS[state.currentShuttleType];
  const position = state.position.clone();
  const rotation = state.rotation.clone();
  const velocity = state.velocity.clone();

  // Handle throttle
  const targetThrottle = input.thrust ? 1 : 0;
  state.throttle += (targetThrottle - state.throttle) * deltaTime * config.acceleration;

  // Handle airbrake
  state.isAirbrakeOn = input.airbrake;

  // Apply movement forces
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().setFromEuler(rotation)
  );
  const up = new THREE.Vector3(0, 1, 0);

  if (input.thrust) {
    velocity.add(forward.clone().multiplyScalar(config.acceleration * deltaTime));
  }
  if (input.backward) {
    velocity.add(forward.clone().multiplyScalar(-config.deceleration * deltaTime));
  }
  if (input.up) {
    velocity.add(up.clone().multiplyScalar(config.acceleration * deltaTime * 0.5));
  }

  // Apply rotation
  const rotationSpeed = config.maneuverability;
  if (input.left) {
    rotation.y -= rotationSpeed * deltaTime;
  }
  if (input.right) {
    rotation.y += rotationSpeed * deltaTime;
  }

  // Apply airbrake (retro rockets)
  if (input.airbrake) {
    velocity.multiplyScalar(0.98);
  }

  // Update rotation quaternion
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);

  // Calculate altitude (distance from station at 0,0,0)
  const stationPosition = new THREE.Vector3(0, 0, 0);
  state.altitude = position.clone().distanceTo(stationPosition);

  // Update position
  const newVelocity = velocity.multiplyScalar(0.99); // Drag
  state.position.add(newVelocity);
  state.velocity = newVelocity;

  return { ...state };
}

/**
 * Calculate fuel consumption
 */
export function calculateFuelConsumption(
  state: ShuttleState,
  deltaTime: number,
  speed: number
): number {
  const config = SHUTTLE_CONFIGS[state.currentShuttleType];

  if (state.fuelPercent <= 0) return 0;

  // Fuel consumption based on throttle and speed
  const consumption = (state.throttle * config.fuelConsumptionRate * deltaTime) +
    (speed * SHUTTLE_FUEL_CONSUMPTION_MULTIPLIER * deltaTime * 0.01);

  return Math.min(consumption, state.fuelPercent / 60); // Cap at ~1% per second
}

/**
 * Update fuel level
 */
export function updateFuel(state: ShuttleState, consumption: number): ShuttleState {
  return {
    ...state,
    fuelPercent: Math.max(0, state.fuelPercent - consumption),
  };
}

/**
 * Check if shuttle is ready to launch
 */
export function isReadyToLaunch(state: ShuttleState): boolean {
  return state.isDocked &&
         state.fuelPercent > 0 &&
         !state.isLaunching &&
         !state.isLanding;
}

/**
 * Check if shuttle is ready to land
 */
export function isReadyToLand(state: ShuttleState): boolean {
  return state.altitude < 30 &&
         state.velocity.length() < 5 &&
         !state.isLanding &&
         !state.isLaunching;
}

/**
   * Return shuttle to station dock via autopilot
   */
export function autopilotReturn(
  state: ShuttleState,
  deltaTime: number,
  stationPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
): ShuttleState {
  const config = SHUTTLE_CONFIGS[state.currentShuttleType];

  // Calculate distance to station
  const distance = state.position.distanceTo(stationPosition);

  let newVelocity = state.velocity.clone();

  if (distance < 20) {
    // Approach and land
    const approachDirection = stationPosition.clone().sub(state.position).normalize();
    newVelocity.add(approachDirection.multiplyScalar(config.acceleration * deltaTime * 0.5));
    newVelocity.multiplyScalar(0.98); // Gradual deceleration for landing
  } else {
    // Cruise towards station
    const cruiseDirection = stationPosition.clone().sub(state.position).normalize();
    newVelocity.add(cruiseDirection.multiplyScalar(config.acceleration * deltaTime * 0.3));
  }

  // Apply airbrake at higher speeds
  if (newVelocity.length() > 10) {
    newVelocity.multiplyScalar(0.99);
  }

  return {
    ...state,
    position: state.position.clone().add(newVelocity),
    velocity: newVelocity,
  };
}

// ====================== Enums ======================

export enum ShuttleStatus {
  DOCKED = 'docked',
  LAUNCHING = 'launching',
  FLYING = 'flying',
  LANDED = 'landed',
}

// ====================== Export ======================

export default {
  SHUTTLE_CONFIGS: SHUTTLE_CONFIGS,
  SHUTTLE_MAX_FUEL: SHUTTLE_MAX_FUEL,
  CARGO_SLOTS: CARGO_SLOTS,
  ShuttleType: ShuttleType,
  ShuttleState: ShuttleState,
  ShuttleFlightInput: ShuttleFlightInput,
  initializeShuttleState: initializeShuttleState,
  createCargoItem: createCargoItem,
  addCargo: addCargo,
  removeCargo: removeCargo,
  updateShuttleFlight: updateShuttleFlight,
  calculateFuelConsumption: calculateFuelConsumption,
  updateFuel: updateFuel,
  isReadyToLaunch: isReadyToLaunch,
  isReadyToLand: isReadyToLand,
  autopilotReturn: autopilotReturn,
  ShuttleStatus: ShuttleStatus,
};
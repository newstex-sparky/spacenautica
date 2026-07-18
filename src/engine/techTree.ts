import type { TechNode } from './types';

// ============ Tech Tree ============

export const TECH_TREE: TechNode[] = [
  // Tier 0 — Survival (auto-unlocked)
  { id: 'eva_basic', name: 'EVA Suit', description: 'Baseline survival in vacuum.', tier: 0, cost: 0, prerequisites: [], unlocks: ['air_tank', 'solar_panel', 'habitat', 'airlock', 'corridor', 'storage'], category: 'survival' },
  { id: 'repair_tool', name: 'Hull Repair', description: 'Fix breaches and damage.', tier: 0, cost: 2, prerequisites: ['eva_basic'], unlocks: ['repair_tool'], category: 'survival' },
  { id: 'mining_basic', name: 'Basic Mining', description: 'Extract ore from asteroids.', tier: 0, cost: 3, prerequisites: ['eva_basic'], unlocks: ['mining_laser'], category: 'mining' },
  { id: 'scanner_basic', name: 'Scanner', description: 'Scan resources and ruins.', tier: 0, cost: 3, prerequisites: ['eva_basic'], unlocks: ['scanner'], category: 'exploration' },

  // Tier 1 — Station Building
  { id: 'o2_gen', name: 'O2 Generation', description: 'Generate oxygen from power.', tier: 1, cost: 5, prerequisites: ['eva_basic', 'solar_panel'], unlocks: ['o2_generator'], category: 'station' },
  { id: 'fabricator', name: 'Fabricator', description: 'Advanced crafting station.', tier: 1, cost: 5, prerequisites: ['eva_basic'], unlocks: ['fabricator'], category: 'station' },
  { id: 'jetpack1', name: 'Jetpack Mk1', description: 'Faster EVA movement.', tier: 1, cost: 4, prerequisites: ['mining_basic'], unlocks: ['jetpack_mk1'], category: 'exploration' },

  // Tier 2 — Industrial
  { id: 'battery_bank', name: 'Battery Bank', description: 'Store excess power.', tier: 2, cost: 8, prerequisites: ['o2_gen'], unlocks: ['battery'], category: 'station' },
  { id: 'reinforced_hull', name: 'Reinforced Hull', description: 'Survive debris impacts.', tier: 2, cost: 8, prerequisites: ['fabricator'], unlocks: ['carbon_comp'], category: 'station' },
  { id: 'comms_array', name: 'Comms Array', description: 'Contact other survivors.', tier: 2, cost: 10, prerequisites: ['scanner_basic'], unlocks: ['scanner_array'], category: 'exploration' },
  { id: 'radiation_suit', name: 'Radiation Suit', description: 'Enter irradiated sectors.', tier: 2, cost: 12, prerequisites: ['reinforced_hull'], unlocks: ['radiation_suit'], category: 'survival' },

  // Tier 3 — Deep Space
  { id: 'shuttle_bay', name: 'Shuttle Bay', description: 'Build and launch small ships.', tier: 3, cost: 20, prerequisites: ['battery_bank', 'reinforced_hull'], unlocks: ['shuttle_bay'], category: 'exploration' },
  { id: 'scanner_array', name: 'Scanner Array', description: 'Reveal full sector maps.', tier: 3, cost: 15, prerequisites: ['comms_array'], unlocks: ['scanner'], category: 'exploration' },
  { id: 'shield_gen', name: 'Shield Generator', description: 'Protect station from debris.', tier: 3, cost: 18, prerequisites: ['reinforced_hull', 'battery_bank'], unlocks: ['shield'], category: 'station' },
  { id: 'rtg_reactor', name: 'RTG Reactor', description: 'Always-on nuclear power.', tier: 3, cost: 25, prerequisites: ['battery_bank', 'fabricator'], unlocks: ['reactor'], category: 'station' },

  // Tier 4 — Advanced
  { id: 'drone_bay', name: 'Drone Bay', description: 'Autonomous mining drones.', tier: 4, cost: 40, prerequisites: ['shuttle_bay', 'rtg_reactor'], unlocks: ['drone_bay'], category: 'mining' },
  { id: 'habitat_dome', name: 'Habitat Dome', description: 'Large pressurized area for farming.', tier: 4, cost: 35, prerequisites: ['rtg_reactor'], unlocks: ['hydro_grown'], category: 'station' },
  { id: 'alien_scanner', name: 'Alien Artifact Scanner', description: 'Detect alien technology.', tier: 4, cost: 50, prerequisites: ['scanner_array', 'alien_ruins'], unlocks: ['alien_key'], category: 'exploration' },
  { id: 'vacuum_walker', name: 'Vacuum Walker', description: 'Survive in vacuum indefinitely.', tier: 4, cost: 45, prerequisites: ['shield_gen', 'rtg_reactor'], unlocks: ['jetpack_mk2'], category: 'survival' },

  // Tier 5 — Endgame
  { id: 'gravity_drive', name: 'Gravity Drive', description: 'Move your entire station.', tier: 5, cost: 80, prerequisites: ['vacuum_walker', 'alien_scanner'], unlocks: ['gravity_drive'], category: 'endgame' },
  { id: 'gateway_repair', name: 'Gateway Reactivation', description: 'Repair the alien gateway. Win condition.', tier: 5, cost: 100, prerequisites: ['alien_scanner', 'gravity_drive'], unlocks: ['alien_key'], category: 'endgame' },
  { id: 'fusion_reactor', name: 'Fusion Reactor', description: 'Endgame power source.', tier: 5, cost: 70, prerequisites: ['rtg_reactor', 'alien_scanner'], unlocks: ['fusion_reactor'], category: 'station' },
  { id: 'stellar_engine', name: 'Stellar Engine', description: 'Stabilize the dying sun.', tier: 5, cost: 120, prerequisites: ['fusion_reactor', 'gravity_drive'], unlocks: ['stellar_engine'], category: 'endgame' },
];

export function getStartingTech(): string[] {
  return ['eva_basic']; // auto-unlocked
}

export function getUnlockableTech(unlocked: Set<string>): TechNode[] {
  return TECH_TREE.filter(node => {
    if (unlocked.has(node.id)) return false;
    return node.prerequisites.every(prereq => unlocked.has(prereq));
  });
}

export function canUnlockTech(techId: string, unlocked: Set<string>, techChips: number): boolean {
  const node = TECH_TREE.find(t => t.id === techId);
  if (!node) return false;
  if (unlocked.has(techId)) return false;
  if (techChips < node.cost) return false;
  return node.prerequisites.every(prereq => unlocked.has(prereq));
}
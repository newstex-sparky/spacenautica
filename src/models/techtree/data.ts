import { TechTreeNode, TECH_TREE_CONFIG, TECH_CATEGORIES } from './types';

/**
 * Tech Tree Data
 * All nodes configured for Spacenautica survival/base-building game
 */
export const TECH_TREE_NODES: TechTreeNode[] = [
  // === TIER 1: Starting Tech ===

  // Basic Mining
  {
    id: 'mining-basic',
    name: 'Basic Mining',
    description: 'Unlock mining drill Mk1 for asteroid resource gathering',
    tier: 1,
    cost: { iron: 0, h2: 0 },
    unlocked: true, // Always available
    researched: true,
    prerequisites: [],
    category: TECH_CATEGORIES.mining,
    position: new THREE.Vector3(-4, 0, -3),
    icon: 'references/kenny-tool.png',
  },

  // Basic Building
  {
    id: 'building-basic',
    name: 'Basic Building',
    description: 'Build habitat dome and solar panel structures',
    tier: 1,
    cost: { iron: 0, h2: 0 },
    unlocked: true, // Always available
    researched: true,
    prerequisites: [],
    category: TECH_CATEGORIES.building,
    position: new THREE.Vector3(0, 0, -4),
    icon: 'references/kenny-station.png',
  },

  // Basic Refining
  {
    id: 'refining-basic',
    name: 'Basic Refining',
    description: 'Build smelter (converts iron ore → metals) and electrolysis refinery',
    tier: 1,
    cost: { iron: 10, h2: 0 },
    unlocked: true,
    researched: true,
    prerequisites: [],
    category: TECH_CATEGORIES.building,
    position: new THREE.Vector3(4, 0, -3),
  },

  // === TIER 2: Advanced Tech (requires Tier 1) ===

  // Advanced Mining
  {
    id: 'mining-advanced',
    name: 'Advanced Mining',
    description: 'Unlock mining drill Mk2 and scanner tool',
    tier: 2,
    cost: { iron: 20, h2: 0 },
    unlocked: false,
    researched: false,
    prerequisites: ['mining-basic', 'building-basic'],
    category: TECH_CATEGORIES.mining,
    position: new THREE.Vector3(-5, 1.5, 0),
    icon: 'references/kenny-tool.png',
  },

  // Pressurization
  {
    id: 'building-pressurization',
    name: 'Pressurization',
    description: 'Build airlock for vacuum to pressurized interior transitions',
    tier: 2,
    cost: { iron: 15, h2: 0 },
    unlocked: false,
    researched: false,
    prerequisites: ['building-basic'],
    category: TECH_CATEGORIES.building,
    position: new THREE.Vector3(0, 1.5, -2),
    icon: 'references/kenny-station.png',
  },

  // Power Grid
  {
    id: 'power-grid',
    name: 'Power Grid',
    description: 'Build H2 storage tank and power distribution system for station',
    tier: 2,
    cost: { iron: 20, h2: 0 },
    unlocked: false,
    researched: false,
    prerequisites: ['refining-basic'],
    category: TECH_CATEGORIES.power,
    position: new THREE.Vector3(5, 1.5, 0),
  },

  // === TIER 3: Advanced Tech (requires Tier 2) ===

  // Jetpack
  {
    id: 'movement-jetpack',
    name: 'Jetpack',
    description: 'Personal flight device for enhanced EVA movement',
    tier: 3,
    cost: { iron: 30, h2: 10 },
    unlocked: false,
    researched: false,
    prerequisites: ['mining-advanced', 'power-grid'],
    category: TECH_CATEGORIES.movement,
    position: new THREE.Vector3(-3, 3, 2),
    icon: 'references/kenny-tool.png',
  },

  // Fabricator
  {
    id: 'building-fabricator',
    name: 'Fabricator',
    description: 'Craft station tools and advanced structures',
    tier: 3,
    cost: { iron: 25, h2: 0 },
    unlocked: false,
    researched: false,
    prerequisites: ['building-pressurization'],
    category: TECH_CATEGORIES.building,
    position: new THREE.Vector3(0, 3, 1),
    icon: 'references/kenny-station.png',
  },

  // Signal Tech (Win Condition)
  {
    id: 'utility-signal',
    name: 'Signal Tech',
    description: 'Build Signal Relay Array for distress broadcast and win condition',
    tier: 3,
    cost: { iron: 40, h2: 20 },
    unlocked: false,
    researched: false,
    prerequisites: ['movement-jetpack', 'fabricator'],
    category: TECH_CATEGORIES.utility,
    position: new THREE.Vector3(3, 3, 2),
    icon: 'references/kenny-station.png',
  },
];

/**
 * Tech Tree System Functions
 */

/**
 * Check if a node can be researched
 */
export function canResearchNode(nodeId: string, currentResources: { iron: number; h2: number }, researchedNodes: Set<string>): boolean {
  const node = TECH_TREE_NODES.find(n => n.id === nodeId);
  if (!node) return false;

  // Check resources
  if (currentResources.iron < node.cost.iron) return false;
  if (currentResources.h2 < node.cost.h2) return false;

  // Check prerequisites
  for (const prereqId of node.prerequisites) {
    if (!researchedNodes.has(prereqId)) return false;
  }

  return true;
}

/**
 * Research a node and deduct resources
 */
export function researchNode(
  nodeId: string,
  currentResources: { iron: number; h2: number },
  researchedNodes: Set<string>
): { success: boolean; resourcesRemaining: { iron: number; h2: number }; message: string } {
  const node = TECH_TREE_NODES.find(n => n.id === nodeId);
  if (!node) {
    return {
      success: false,
      resourcesRemaining: currentResources,
      message: `Unknown technology node: ${nodeId}`,
    };
  }

  if (researchedNodes.has(nodeId)) {
    return {
      success: false,
      resourcesRemaining: currentResources,
      message: `Already researched: ${node.name}`,
    };
  }

  // Check prerequisites
  for (const prereqId of node.prerequisites) {
    if (!researchedNodes.has(prereqId)) {
      return {
        success: false,
        resourcesRemaining: currentResources,
        message: `Missing prerequisite: ${getTechNodeName(prereqId)}`,
      };
    }
  }

  // Check resources
  if (currentResources.iron < node.cost.iron) {
    return {
      success: false,
      resourcesRemaining: currentResources,
      message: `Insufficient iron: need ${node.cost.iron}, have ${currentResources.iron}`,
    };
  }

  if (currentResources.h2 < node.cost.h2) {
    return {
      success: false,
      resourcesRemaining: currentResources,
      message: `Insufficient H2: need ${node.cost.h2}, have ${currentResources.h2}`,
    };
  }

  // Deduct resources
  const resourcesRemaining = {
    iron: currentResources.iron - node.cost.iron,
    h2: currentResources.h2 - node.cost.h2,
  };

  // Mark as researched
  researchedNodes.add(nodeId);
  node.researched = true;

  return {
    success: true,
    resourcesRemaining,
    message: `Researched: ${node.name}`,
  };
}

/**
 * Get node name by ID
 */
function getTechNodeName(id: string): string {
  const node = TECH_TREE_NODES.find(n => n.id === id);
  return node?.name || id;
}

/**
 * Get available nodes (unlocked but not yet researched)
 */
export function getAvailableNodes(researchedNodes: Set<string>): TechTreeNode[] {
  return TECH_TREE_NODES.filter(node => {
    return node.unlocked && !node.researched && canResearchNode(node.id, { iron: Infinity, h2: Infinity }, researchedNodes);
  });
}

/**
 * Get locked nodes (require prerequisites)
 */
export function getLockedNodes(researchedNodes: Set<string>): TechTreeNode[] {
  return TECH_TREE_NODES.filter(node => {
    return node.unlocked && !node.researched;
  });
}

/**
 * Get researched nodes only
 */
export function getResearchedNodes(): TechTreeNode[] {
  return TECH_TREE_NODES.filter(node => node.researched);
}
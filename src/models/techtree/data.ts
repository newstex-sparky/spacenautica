// ====================== Tech Tree Data ======================
// Defines all unlockable technologies in Spacenautica

export interface TechTreeNode {
  id: string;
  name: string;
  description: string;
  category: 'basic' | 'survival' | 'manufacturing' | 'communication' | 'special';
  cost: number; // Research points required
  requires: string | null; // Parent node ID
  unlock: string[]; // Technologies unlocked when researched
  researchProgress: number; // Current progress (0 to cost)
}

export const TECH_TREE_NODES: TechTreeNode[] = [
  // === BASIC TECHNOLOGIES ===
  {
    id: 'basic-1',
    name: 'Refinery Automation',
    description: 'Automate ore processing with AI controls. Reduces refining time by 50%.',
    category: 'basic',
    cost: 10,
    requires: null,
    unlock: [],
    researchProgress: 0
  },
  {
    id: 'basic-2',
    name: 'Energy Efficiency I',
    description: 'Basic solar panel optimization. Reduces power consumption by 10%.',
    category: 'basic',
    cost: 15,
    requires: 'basic-1',
    unlock: [],
    researchProgress: 0
  },

  // === SURVIVAL TECHNOLOGIES ===
  {
    id: 'survival-1',
    name: 'Advanced Life Support',
    description: 'Improved air filters and O2 scrubbers. Extends O2 reserves by 25%.',
    category: 'survival',
    cost: 20,
    requires: null,
    unlock: [],
    researchProgress: 0
  },
  {
    id: 'survival-2',
    name: 'O2 Recycling',
    description: 'Recycle exhaled CO2 back to O2. Reduces O2 consumption by 30%.',
    category: 'survival',
    cost: 25,
    requires: 'survival-1',
    unlock: [],
    researchProgress: 0
  },
  {
    id: 'survival-3',
    name: 'Emergency Oxygen',
    description: 'Deployable emergency O2 canisters. Single-use emergency supply.',
    category: 'survival',
    cost: 15,
    requires: 'survival-1',
    unlock: [],
    researchProgress: 0
  },

  // === MANUFACTURING TECHNOLOGIES ===
  {
    id: 'manufacturing-1',
    name: 'Smelter Efficiency',
    description: 'Advanced smelting furnace. Increases ore conversion rate by 20%.',
    category: 'manufacturing',
    cost: 30,
    requires: null,
    unlock: [],
    researchProgress: 0
  },
  {
    id: 'manufacturing-2',
    name: 'Hull Reinforcement',
    description: 'Reinforced hull plating. Reduces hull damage taken by 15%.',
    category: 'manufacturing',
    cost: 35,
    requires: 'manufacturing-1',
    unlock: [],
    researchProgress: 0
  },
  {
    id: 'manufacturing-3',
    name: 'Modular Construction',
    description: 'Snap-to-grid construction templates. Reduces station build time by 40%.',
    category: 'manufacturing',
    cost: 40,
    requires: 'basic-2',
    unlock: [],
    researchProgress: 0
  },

  // === COMMUNICATION TECHNOLOGIES ===
  {
    id: 'communication-1',
    name: 'Signal Amplifier',
    description: 'Amplifies distress signals. Increases signal range by 50%.',
    category: 'communication',
    cost: 50,
    requires: null,
    unlock: [],
    researchProgress: 0
  },
  {
    id: 'communication-2',
    name: 'Data Encryption',
    description: 'Encrypts distress transmissions. Prevents false signals from attracting enemies.',
    category: 'communication',
    cost: 20,
    requires: 'communication-1',
    unlock: [],
    researchProgress: 0
  },
  {
    id: 'communication-3',
    name: 'Long Range Comms',
    description: 'Long-range transceiver. Extends communication range to 50 sectors.',
    category: 'communication',
    cost: 60,
    requires: 'communication-2',
    unlock: [],
    researchProgress: 0
  },

  // === SPECIAL TECHNOLOGIES (Endgame) ===
  {
    id: 'special-1',
    name: 'AI Research Assistant',
    description: 'Advanced AI that accelerates research by 100%.',
    category: 'special',
    cost: 80,
    requires: 'manufacturing-3',
    unlock: ['special-2'],
    researchProgress: 0
  },
  {
    id: 'special-2',
    name: 'Quantum Computing',
    description: 'Quantum processors for real-time sector analysis.',
    category: 'special',
    cost: 100,
    requires: 'special-1',
    unlock: ['special-3'],
    researchProgress: 0
  },
  {
    id: 'special-3',
    name: 'Signal Relay Array',
    description: 'Super-antenna for distress broadcasts. Win condition trigger.',
    category: 'special',
    cost: 120,
    requires: 'special-2',
    unlock: ['communication-3'],
    researchProgress: 0
  }
];

// Get nodes by category
export function getNodesByCategory(category: TechTreeNode['category']): TechTreeNode[] {
  return TECH_TREE_NODES.filter(node => node.category === category);
}

// Get child nodes (nodes that require this node)
export function getChildrenNodes(nodeId: string): TechTreeNode[] {
  return TECH_TREE_NODES.filter(node => node.requires === nodeId);
}

// Find node by ID
export function findNode(nodeId: string): TechTreeNode | undefined {
  return TECH_TREE_NODES.find(node => node.id === nodeId);
}

// Check if a node is available (all requirements met)
export function canResearchNode(node: TechTreeNode, researchedNodeIds: string[]): boolean {
  if (node.requires === null) return true;
  return researchedNodeIds.includes(node.requires);
}

// Research a node (add progress)
export function researchNode(nodeId: string, researchPoints: number, researchedNodeIds: Set<string>): { progress: number; completed: boolean; newUnlocks: string[] } {
  const node = findNode(nodeId);
  if (!node) {
    return { progress: researchPoints, completed: false, newUnlocks: [] };
  }

  if (researchedNodeIds.has(nodeId)) {
    return { progress: node.cost, completed: true, newUnlocks: [] };
  }

  let newProgress = node.researchProgress + researchPoints;
  if (newProgress >= node.cost) {
    newProgress = node.cost;
    // Unlock dependent nodes
    const dependentNodes = TECH_TREE_NODES.filter(n => n.requires === nodeId);
    return {
      progress: newProgress,
      completed: true,
      newUnlocks: dependentNodes.map(n => n.id)
    };
  }

  return { progress: newProgress, completed: false, newUnlocks: [] };
}
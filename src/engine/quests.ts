// ============ Quest Data ============

export type QuestStatus = 'not_started' | 'in_progress' | 'completed' | 'failed';

export interface QuestStep {
  description: string;
  targetId: string;
  targetName: string;
  requiredItem?: string;
  requiredModule?: string;
  requiredTech?: string;
  check: (gameState: GameState) => boolean;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  steps: QuestStep[];
  status: QuestStatus;
  rewards: {
    items: string[];
    techPoints: number;
    modules: string[];
  };
}

export interface GameState {
  inventory: { [key: string]: number };
  modules: string[];
  techUnlocked: string[];
  alienAlloy: number;
  gatewayCore: boolean;
  reactorBuilt: boolean;
  gatewayActivated: boolean;
  questHistory: string[];
}

// ============ Quest Chain: Gateway Repair ============

export const questChain: Quest[] = [
  {
    id: 'collect_alien_alloy',
    title: 'Alien Alloy Found',
    description: 'Find alien alloy in the derelict Meridian wreckage',
    status: 'not_started',
    steps: [
      {
        description: 'Explore the Meridian wreckage',
        targetId: 'meridian_wreck',
        targetName: 'Meridian Wreckage',
        requiredItem: 'alien_alloy',
        check: (gs: GameState) => gs.alienAlloy > 0,
      },
    ],
    rewards: {
      items: [],
      techPoints: 0,
      modules: [],
    },
  },
  {
    id: 'craft_gateway_core',
    title: 'Gateway Core Crafted',
    description: 'Use the alloy to craft a Gateway Core',
    status: 'not_started',
    steps: [
      {
        description: 'Craft Gateway Core using alien alloy',
        targetId: 'gateway_core',
        targetName: 'Gateway Core',
        requiredItem: 'alien_alloy',
        check: (gs: GameState) => gs.gatewayCore === true,
      },
    ],
    rewards: {
      items: ['gateway_core'],
      techPoints: 0,
      modules: [],
    },
  },
  {
    id: 'build_fusion_reactor',
    title: 'Fusion Reactor Built',
    description: 'Construct a Fusion Reactor to power the gateway',
    status: 'not_started',
    steps: [
      {
        description: 'Build a Fusion Reactor',
        targetId: 'reactor',
        targetName: 'Fusion Reactor',
        requiredTech: 'fusion',
        check: (gs: GameState) => gs.modules.includes('reactor'),
      },
    ],
    rewards: {
      items: [],
      techPoints: 0,
      modules: ['reactor'],
    },
  },
  {
    id: 'install_gateway_core',
    title: 'Gateway Core Installed',
    description: 'Install the Gateway Core into the reactor',
    status: 'not_started',
    steps: [
      {
        description: 'Install Gateway Core into Reactor',
        targetId: 'gateway_core_installed',
        targetName: 'Gateway Core',
        check: (gs: GameState) => gs.gatewayActivated === false && gs.gatewayCore === true,
      },
    ],
    rewards: {
      items: [],
      techPoints: 0,
      modules: [],
    },
  },
  {
    id: 'activate_gateway',
    title: 'Gateway Activated',
    description: 'Activate the Gateway and face the final choice',
    status: 'not_started',
    steps: [
      {
        description: 'Activate the Gateway',
        targetId: 'gateway_activated',
        targetName: 'Gateway',
        check: (gs: GameState) => gs.gatewayActivated === true,
      },
    ],
    rewards: {
      items: [],
      techPoints: 0,
      modules: [],
    },
  },
];
import * as THREE from 'three';

export interface BiomeDef {
  id: string;
  name: string;
  depthRange: [number, number];
  floorColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  ambientLight: number;
  flora: Array<{ id: string; density: number }>;
  fauna: Array<{ id: string; density: number }>;
  music: string;
}

const c = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

export const BIOMES: BiomeDef[] = [
  {
    id: 'shallows', name: 'Safe Shallows', depthRange: [0, 55],
    floorColor: c(0xd9c9a3), fogColor: c(0x2ec8d8), fogDensity: 0.014, ambientLight: 1.0,
    flora: [{ id: 'kelp_short', density: 0.5 }, { id: 'coral_fan', density: 0.35 }, { id: 'seagrass', density: 1.2 }],
    fauna: [{ id: 'peeper', density: 1.0 }, { id: 'boomerang', density: 0.6 }], music: 'shallows',
  },
  {
    id: 'kelp_forest', name: 'Kelp Forest', depthRange: [20, 110],
    floorColor: c(0x8f8f5e), fogColor: c(0x1e9e96), fogDensity: 0.022, ambientLight: 0.78,
    flora: [{ id: 'kelp_giant', density: 1.4 }, { id: 'algae_mat', density: 0.7 }],
    fauna: [{ id: 'stalker', density: 0.25 }, { id: 'peeper', density: 0.5 }], music: 'kelp',
  },
  {
    id: 'grassy_plateau', name: 'Grassy Plateaus', depthRange: [50, 160],
    floorColor: c(0x7fa05a), fogColor: c(0x18868f), fogDensity: 0.026, ambientLight: 0.66,
    flora: [{ id: 'seagrass', density: 1.6 }, { id: 'coral_tube', density: 0.4 }],
    fauna: [{ id: 'sandshark', density: 0.2 }, { id: 'hoverfish', density: 0.8 }], music: 'plateau',
  },
  {
    id: 'red_grass', name: 'Sparse Reef', depthRange: [90, 220],
    floorColor: c(0x9a5f4a), fogColor: c(0x146b7d), fogDensity: 0.031, ambientLight: 0.5,
    flora: [{ id: 'coral_brain', density: 0.8 }, { id: 'sponge', density: 0.5 }],
    fauna: [{ id: 'jellyray', density: 0.3 }], music: 'reef',
  },
  {
    id: 'mushroom_forest', name: 'Mushroom Forest', depthRange: [120, 260],
    floorColor: c(0x6b5b74), fogColor: c(0x116271), fogDensity: 0.034, ambientLight: 0.45,
    flora: [{ id: 'tree_mushroom', density: 0.9 }, { id: 'bioluminescent', density: 0.6 }],
    fauna: [{ id: 'jellyray', density: 0.4 }, { id: 'crabsnake', density: 0.12 }], music: 'mushroom',
  },
  {
    id: 'blood_kelp', name: 'Blood Kelp Zone', depthRange: [250, 480],
    floorColor: c(0x4a2b34), fogColor: c(0x2a2438), fogDensity: 0.048, ambientLight: 0.22,
    flora: [{ id: 'blood_kelp', density: 1.1 }, { id: 'bioluminescent', density: 1.2 }],
    fauna: [{ id: 'crabsquid', density: 0.1 }, { id: 'bladderfish', density: 0.5 }], music: 'bloodkelp',
  },
  {
    id: 'lost_river', name: 'Lost River', depthRange: [420, 780],
    floorColor: c(0x3a4a4a), fogColor: c(0x123a33), fogDensity: 0.055, ambientLight: 0.16,
    flora: [{ id: 'bioluminescent', density: 1.5 }],
    fauna: [{ id: 'ghostray', density: 0.15 }], music: 'lostriver',
  },
  {
    id: 'lava_zone', name: 'Inactive Lava Zone', depthRange: [700, 1300],
    floorColor: c(0x2a1a18), fogColor: c(0x3a1408), fogDensity: 0.062, ambientLight: 0.12,
    flora: [{ id: 'lava_coral', density: 0.4 }],
    fauna: [{ id: 'lavalarva', density: 0.3 }], music: 'lava',
  },
];

export const BIOME_MAP: ReadonlyMap<string, BiomeDef> = new Map(BIOMES.map((b) => [b.id, b]));

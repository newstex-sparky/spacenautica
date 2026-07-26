import * as THREE from 'three';

/**
 * Tech Tree Node Data Structure
 */
export interface TechTreeNode {
  id: string;
  name: string;
  description: string;
  tier: number;
  cost: {
    iron: number;
    h2: number;
  };
  unlocked: boolean;
  researched: boolean;
  prerequisites: string[];
  category: string;
  position: THREE.Vector3;
  icon?: string;
}

/**
 * Tech Tree Hub Configuration
 */
export const TECH_TREE_CONFIG = {
  hubPosition: new THREE.Vector3(0, 0, 0),
  nodeRadius: 1.5,
  connectionDistance: 8,
  cameraDistance: 15,
  cameraHeight: 5,
} as const;

/**
 * Tech Tree Categories
 */
export const TECH_CATEGORIES = {
  mining: 'Mining',
  building: 'Building',
  power: 'Power',
  movement: 'Movement',
  utility: 'Utility',
} as const;
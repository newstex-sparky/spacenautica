/**
 * img2threejs Model Factory Index
 *
 * Central export point for all procedural 3D model generators.
 * Used by Survival3D component and other parts of the game.
 */

// Base interfaces
export type ModelOptions = {
  scale?: number;
  position?: THREE.Vector3;
  rotation?: THREE.Euler;
};

// Type exports from Factory.ts
export { createProceduralAsteroid, createStationModule, createTool, createContainer } from './Factory';
export { createFloorTexture, createAsteroidTexture, createIceTexture } from './Factory';

// Re-export Three.js types
export type * from 'three';

// Model data structures
export interface Asteroid {
  mesh: THREE.Group;
  type: 'iron' | 'ice' | 'oxygen';
  health: number;
  maxHealth: number;
  isDestructible: boolean;
}

export interface StationModule {
  mesh: THREE.Group;
  type: 'dome' | 'solar' | 'smelter' | 'refinery' | 'o2generator';
  health: number;
  maxHealth: number;
}

export interface Tool {
  mesh: THREE.Group;
  type: 'laser-cutter' | 'mining-laser' | 'scanner';
  battery: number;
}

export interface Container {
  mesh: THREE.Group;
  size: 'small' | 'medium' | 'large';
  locked: boolean;
  contents: string[];
}
// Type declarations for procedural 3D models
import * as THREE from 'three';

// Ore deposit data
export interface OreDeposit {
  position: THREE.Vector3;
  size: number;
  rotation: THREE.Vector3;
}

// Additional user data type
export interface ModelUserData {
  isHead?: boolean;
  offset?: number;
  velocity?: THREE.Vector3;
  lifeTime?: number;
}

// Generic model interface
export interface Model {
  mesh: THREE.Group;
  type: string;
  health: number;
  maxHealth: number;
  isDestructible: boolean;
  isDead: boolean;
  lifeTime?: number;
  velocity?: THREE.Vector3;
}

// Add custom properties to THREE.Group for runtime data
declare module 'three' {
  interface Group extends Model {
    rotationSpeed?: THREE.Vector3;
    driftVelocity?: THREE.Vector3;
    oreDeposits?: OreDeposit[];
    chunks?: THREE.Mesh[];
    healthPercent?: number;
    userData: ModelUserData & THREE.Group['userData'];
  }
}

// Material declarations
interface MeshStandardMaterial extends THREE.MeshStandardMaterial {
  metalness: number;
  roughness: number;
}

declare module 'three' {
  interface Material {
    metalness?: number;
    roughness?: number;
  }
}
// Type declarations for procedural 3D models
import * as THREE from 'three';

// Ore deposit data
export interface OreDeposit {
  position: THREE.Vector3;
  size: number;
  rotation: THREE.Vector3;
}

// Model user data
export interface ModelUserData {
  isHead?: boolean;
  offset?: number;
  velocity?: THREE.Vector3;
  lifeTime?: number;
  [key: string]: any;
}

// Extended Group type for runtime model data
export interface ExtendedGroup extends THREE.Group {
  rotationSpeed?: THREE.Vector3;
  driftVelocity?: THREE.Vector3;
  oreDeposits?: OreDeposit[];
  chunks?: THREE.Mesh[];
  healthPercent?: number;
  userData: ModelUserData & THREE.Group['userData'];
}
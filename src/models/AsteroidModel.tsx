import * as THREE from 'three';
import { ExtendedGroup, OreDeposit } from './Types';

// Asteroid type
export type AsteroidType = 'iron' | 'gold' | 'crystal' | 'silicon' | 'uranium' | 'alien_alloy';

// Ore deposit colors
const ORE_COLORS: Record<AsteroidType, { base: number; ore: number }> = {
  iron: { base: 0x8b8b8b, ore: 0xa8a8a8 },
  gold: { base: 0xffd700, ore: 0xffaa00 },
  crystal: { base: 0x00ffff, ore: 0xffffff },
  silicon: { base: 0xc0c0c0, ore: 0xe0e0e0 },
  uranium: { base: 0x32cd32, ore: 0x00ff00 },
  'alien_alloy': { base: 0x8844ff, ore: 0xff00ff },
};

// Ore deposit positions (random but pre-generated per asteroid)
interface OreDeposit {
  position: THREE.Vector3;
  size: number;
  rotation: THREE.Vector3;
}

// Asteroid model data
export interface Asteroid {
  mesh: ExtendedGroup;
  type: AsteroidType;
  health: number;
  maxHealth: number;
  oreDeposits: OreDeposit[];
  isDestructible: boolean;
  chunks: THREE.Mesh[];
  rotationSpeed: THREE.Vector3;
  driftVelocity: THREE.Vector3;
  healthPercent: number; // 0-100
  isDead: boolean;
}

// Create irregular asteroid geometry using Icosahedron with noise
function createIrregularGeometry(
  radius: number,
  detail: number = 12,
  distortion: number = 1.2
): THREE.IcosahedronGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);

  // Apply procedural noise to vertices
  const positionAttribute = geometry.attributes.position;
  const vertexCount = positionAttribute.count;

  for (let i = 0; i < vertexCount; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);

    // Simple noise function using sines
    const noise =
      Math.sin(x * 0.5) * Math.cos(y * 0.5) * Math.sin(z * 0.5) * distortion;

    // Apply noise with radial falloff
    const distance = Math.sqrt(x * x + y * y + z * z);
    const falloff = 1 - (distance / radius) * (distortion - 1);

    const scale = 1 + noise * falloff * 0.3;

    positionAttribute.setXYZ(i, x * scale, y * scale, z * scale);
  }

  geometry.computeVertexNormals();
  return geometry;
}

// Create ore deposit mesh
function createOreDeposit(
  asteroidType: AsteroidType,
  position: THREE.Vector3,
  size: number
): THREE.Mesh {
  const { base, ore } = ORE_COLORS[asteroidType];

  // Ore cluster geometry (multiple small spheres clustered)
  const clusterGeometry = new THREE.SphereGeometry(size * 0.2, 8, 8);
  const clusterMaterial = new THREE.MeshStandardMaterial({
    color: ore,
    metalness: 0.7,
    roughness: 0.3,
  });

  const cluster = new THREE.Mesh(clusterGeometry, clusterMaterial);
  cluster.position.copy(position);

  return cluster;
}

// Create destructible chunk
function createChunk(
  position: THREE.Vector3,
  velocity: THREE.Vector3
): THREE.Mesh {
  const size = 0.5 + Math.random() * 0.5;

  const geometry = new THREE.IcosahedronGeometry(size * 0.4, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x666666,
    metalness: 0.6,
    roughness: 0.4,
    flatShading: true,
  });

  const chunk = new THREE.Mesh(geometry, material);
  chunk.position.copy(position);
  (chunk.userData as { velocity?: THREE.Vector3; lifeTime?: number }).velocity = velocity.clone();
  (chunk.userData as { lifeTime?: number }).lifeTime = 5; // seconds

  return chunk;
}

// Main asteroid factory
export function createAsteroid(
  position: THREE.Vector3,
  type: AsteroidType = 'iron',
  size: number = 3
): Asteroid {
  const { base, ore } = ORE_COLORS[type];
  const health = size * 100; // Larger asteroids have more health
  const maxHealth = health;

  const asteroid = new THREE.Group();
  asteroid.position.copy(position);

  // Create irregular geometry
  const geometry = createIrregularGeometry(size, 6, 1.3);
  const material = new THREE.MeshStandardMaterial({
    color: base,
    metalness: 0.5,
    roughness: 0.6,
    flatShading: true,
    vertexColors: false,
  });

  const asteroidMesh = new THREE.Mesh(geometry, material);
  asteroidMesh.castShadow = true;
  asteroidMesh.receiveShadow = true;
  asteroid.add(asteroidMesh);

  // Generate ore deposits (random positions on surface)
  const oreDeposits: OreDeposit[] = [];

  const depositCount = 3 + Math.floor(Math.random() * 5); // 3-7 deposits

  for (let i = 0; i < depositCount; i++) {
    // Random spherical coordinates
    const phi = Math.acos(-1 + (2 * i) / depositCount);
    const theta = Math.sqrt(depositCount * Math.PI) * phi;

    const depositSize = 0.3 + Math.random() * 0.4;
    const radius = size * (0.7 + Math.random() * 0.3); // Deposit on outer 30% of asteroid

    const depositPosition = new THREE.Vector3()
      .setFromSphericalCoords(radius, phi, theta)
      .multiplyScalar(1.1); // Slightly outside surface

    const depositMesh = createOreDeposit(type, depositPosition, depositSize);
    asteroid.add(depositMesh);

    oreDeposits.push({
      position: depositPosition,
      size: depositSize,
      rotation: new THREE.Vector3(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      ),
    });
  }

  // Random rotation speed
  const rotationSpeed = new THREE.Vector3(
    (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.5
  );

  // Drift velocity (slow movement in space)
  const driftVelocity = new THREE.Vector3(
    (Math.random() - 0.5) * 0.01,
    (Math.random() - 0.5) * 0.01,
    (Math.random() - 0.5) * 0.01
  );

  asteroid.rotationSpeed = rotationSpeed;
  asteroid.driftVelocity = driftVelocity;

  return {
    mesh: asteroid,
    type,
    health,
    maxHealth,
    oreDeposits,
    isDestructible: true,
    chunks: [],
    rotationSpeed,
    driftVelocity,
    healthPercent: 100,
    isDead: false,
  };
}

// Spawn asteroid chunks on destruction
export function explodeAsteroid(
  asteroid: Asteroid,
  force: number = 15
): THREE.Mesh[] {
  if (!asteroid.isDestructible) return [];

  const chunks: THREE.Mesh[] = [];
  const particleCount = 8 + Math.floor(Math.random() * 8);

  for (let i = 0; i < particleCount; i++) {
    const chunk = createChunk(
      asteroid.mesh.position.clone(),
      new THREE.Vector3(
        (Math.random() - 0.5) * force,
        Math.random() * force * 0.5,
        (Math.random() - 0.5) * force
      )
    );
    chunks.push(chunk);
    asteroid.mesh.add(chunk);
  }

  asteroid.chunks = chunks;

  return chunks;
}

// Update asteroid physics
export function updateAsteroid(asteroid: Asteroid, deltaTime: number): void {
  if (asteroid.isDead) {
    // Update chunks
    for (let i = asteroid.chunks.length - 1; i >= 0; i--) {
      const chunk = asteroid.chunks[i];

      // Apply velocity
      const chunkVel = (chunk.userData as { velocity?: THREE.Vector3 }).velocity;
      if (chunkVel) {
        chunk.position.add(chunkVel.clone().multiplyScalar(deltaTime * 60));
      }

      // Apply gravity (pull chunks to asteroid)
      const toAsteroid = asteroid.mesh.position.clone().sub(chunk.position).normalize();
      if (chunkVel) {
        chunkVel.add(toAsteroid.multiplyScalar(deltaTime * -0.05));
      }

      // Apply drag
      const vel = (chunk.userData as { velocity?: THREE.Vector3 }).velocity;
      if (vel) {
        vel.multiplyScalar(0.98);
      }

      // Decay life
      const lifeTime = (chunk.userData as { lifeTime?: number }).lifeTime;
      if (lifeTime !== undefined) {
        lifeTime -= deltaTime;

        // Remove old chunks
        if (lifeTime <= 0) {
          asteroid.mesh.remove(chunk);
          chunk.geometry.dispose();
          (chunk.material as THREE.Material).dispose();
          asteroid.chunks.splice(i, 1);
        }
      }
    }
    return;
  }

  // Rotate asteroid
  asteroid.mesh.rotation.x += asteroid.rotationSpeed.x * deltaTime;
  asteroid.mesh.rotation.y += asteroid.rotationSpeed.y * deltaTime;
  asteroid.mesh.rotation.z += asteroid.rotationSpeed.z * deltaTime;

  // Drift asteroid
  asteroid.mesh.position.add(asteroid.driftVelocity.clone().multiplyScalar(deltaTime * 60));

  // Update health percent
  asteroid.healthPercent = (asteroid.health / asteroid.maxHealth) * 100;

  // Update ore deposit rotations
  asteroid.oreDeposits.forEach((deposit) => {
    const depositMesh = asteroid.mesh.children.find(
      (child): child is THREE.Mesh => child.geometry instanceof THREE.SphereGeometry
    );
    if (depositMesh && depositMesh === asteroid.mesh.children[1 + asteroid.oreDeposits.indexOf(deposit)]) {
      depositMesh.rotation.x += deposit.rotation.x * deltaTime;
      depositMesh.rotation.y += deposit.rotation.y * deltaTime;
      depositMesh.rotation.z += deposit.rotation.z * deltaTime;
    }
  });
}

// Cleanup asteroid resources
export function cleanupAsteroid(asteroid: Asteroid): void {
  asteroid.mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}
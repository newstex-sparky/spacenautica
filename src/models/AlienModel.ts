import * as THREE from 'three';
import { ExtendedGroup, OreDeposit } from './Types';

// Alien alloy type
export type AlienAlloyType = 'neon_void' | 'crimson_expanse' | 'starlight_essence' | 'void_energy';

// Alien alloy colors
const ALIEN_ALLOY_COLORS: Record<AlienAlloyType, { base: number; glow: number; accent: number }> = {
  'neon_void': { base: 0x110022, glow: 0x8800ff, accent: 0x00ffff },
  'crimson_expanse': { base: 0x2a0010, glow: 0xff0033, accent: 0xffaa00 },
  'starlight_essence': { base: 0x001a1a, glow: 0x00ff88, accent: 0x00aaff },
  'void_energy': { base: 0x0a0a15, glow: 0x6600cc, accent: 0xff00ff },
};

// Alien ruin model data
export interface AlienRuin {
  mesh: THREE.Group;
  alloyType: AlienAlloyType;
  health: number;
  maxHealth: number;
  energyLevel: number; // 0-100, affects ring animation
  chambers: THREE.Mesh[];
  energyRings: THREE.Mesh[];
  holographicDisplays: THREE.Mesh[];
  alienKey: THREE.Mesh | null;
  isActivated: boolean;
  rotationSpeed: THREE.Vector3;
  healthPercent: number;
  isDead: boolean;
  interiorChambers: THREE.Mesh[];
  bioluminescentAccents: THREE.Mesh[];
}

// Aliens key data
export interface AlienKey {
  mesh: THREE.Mesh;
  activated: boolean;
  glowIntensity: number;
  collected: boolean;
}

// Create alien alloy ore deposit
function createAlienAlloyDeposit(
  alloyType: AlienAlloyType,
  position: THREE.Vector3,
  size: number
): THREE.Mesh {
  const { base, glow, accent } = ALIEN_ALLOY_COLORS[alloyType];

  // Alien alloy cluster geometry (multiple crystals)
  const clusterGeometry = new THREE.OctahedronGeometry(size * 0.25, 0);
  const clusterMaterial = new THREE.MeshStandardMaterial({
    color: base,
    metalness: 0.9,
    roughness: 0.2,
    transparent: true,
    opacity: 0.8,
  });

  const cluster = new THREE.Mesh(clusterGeometry, clusterMaterial);
  cluster.position.copy(position);

  // Add glowing crystal spikes
  const spikeCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < spikeCount; i++) {
    const spikeGeometry = new THREE.ConeGeometry(size * 0.08, size * 0.3, 6);
    const spikeMaterial = new THREE.MeshBasicMaterial({
      color: glow,
      transparent: true,
      opacity: 0.7,
    });
    const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);

    // Random spike orientation
    const angle = Math.random() * Math.PI * 2;
    spike.position.x = Math.cos(angle) * size * 0.15;
    spike.position.y = Math.sin(angle) * size * 0.15;
    spike.position.z = Math.random() * size * 0.15 - size * 0.075;
    spike.rotation.x = Math.random() * Math.PI;
    spike.rotation.z = Math.random() * Math.PI;
    cluster.add(spike);
  }

  // Accent crystals
  const accentCount = 2;
  for (let i = 0; i < accentCount; i++) {
    const accentGeometry = new THREE.OctahedronGeometry(size * 0.1, 0);
    const accentMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.6,
    });
    const accentMesh = new THREE.Mesh(accentGeometry, accentMaterial);
    accentMesh.position.set(
      (Math.random() - 0.5) * size * 0.3,
      (Math.random() - 0.5) * size * 0.3,
      (Math.random() - 0.5) * size * 0.3
    );
    cluster.add(accentMesh);
  }

  return cluster;
}

// Create alien architecture segments (irregular shapes with alien patterns)
function createAlienStructureSegment(
  size: number,
  alloyType: AlienAlloyType
): THREE.Mesh {
  const { base, glow, accent } = ALIEN_ALLOY_COLORS[alloyType];

  // Use icosa geometry for organic alien shapes
  const geometry = new THREE.IcosahedronGeometry(size * (0.4 + Math.random() * 0.4), 1);

  // Apply alien pattern distortion
  const positionAttribute = geometry.attributes.position;
  const vertexCount = positionAttribute.count;

  for (let i = 0; i < vertexCount; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);

    // Strange alien distortion patterns
    const noise =
      Math.sin(x * 0.8) * Math.cos(y * 0.6) * Math.sin(z * 0.8) * 0.5 +
      Math.sin(x * 1.2 + y * 0.4) * Math.cos(z * 0.6) * 0.3;

    positionAttribute.setXYZ(i, x + noise, y + noise, z + noise);
  }

  geometry.computeVertexNormals();

  // Alien alloy material with emissive glow
  const material = new THREE.MeshStandardMaterial({
    color: base,
    metalness: 0.8,
    roughness: 0.3,
    emissive: glow,
    emissiveIntensity: 0.1,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Add bioluminescent patches
  const patchGeometry = new THREE.SphereGeometry(size * 0.15, 8, 8);
  const patchMaterial = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.4,
  });
  const patch = new THREE.Mesh(patchGeometry, patchMaterial);
  patch.position.set(
    (Math.random() - 0.5) * size * 0.6,
    (Math.random() - 0.5) * size * 0.6,
    (Math.random() - 0.5) * size * 0.6
  );
  mesh.add(patch);

  return mesh;
}

// Create energy ring with pulsing effect
function createEnergyRing(
  radius: number,
  ringType: 'outer' | 'inner' | 'portal',
  alloyType: AlienAlloyType
): THREE.Mesh {
  const { glow, accent } = ALIEN_ALLOY_COLORS[alloyType];

  // Ring geometry (torus)
  const geometry = ringType === 'portal'
    ? new THREE.TorusGeometry(radius, radius * 0.02, 8, 64)
    : new THREE.TorusGeometry(radius, radius * 0.05, 8, 32);

  // Energy material
  const material = new THREE.MeshBasicMaterial({
    color: glow,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });

  const ring = new THREE.Mesh(geometry, material);

  // Add energy particles around ring
  const particleCount = ringType === 'portal' ? 12 : 8;
  for (let i = 0; i < particleCount; i++) {
    const particleGeometry = new THREE.SphereGeometry(radius * 0.03, 8, 8);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.8,
    });
    const particle = new THREE.Mesh(particleGeometry, particleMaterial);

    const angle = (i / particleCount) * Math.PI * 2;
    particle.position.set(
      Math.cos(angle) * radius,
      (Math.random() - 0.5) * radius * 0.3,
      Math.sin(angle) * radius
    );
    ring.add(particle);
  }

  return ring;
}

// Create interior alien chambers
function createAlienChamber(
  position: THREE.Vector3,
  alloyType: AlienAlloyType,
  chamberType: 'ore' | 'treasure' | 'void'
): THREE.Mesh {
  const { base, glow, accent } = ALIEN_ALLOY_COLORS[alloyType];

  const chamberSize = chamberType === 'ore' ? 2 : chamberType === 'treasure' ? 1.5 : 1.2;

  // Chamber base - hexagonal shape
  const chamberGeometry = new THREE.CylinderGeometry(chamberSize, chamberSize, 0.3, 6);
  const chamberMaterial = new THREE.MeshStandardMaterial({
    color: base,
    metalness: 0.7,
    roughness: 0.4,
  });
  const chamber = new THREE.Mesh(chamberGeometry, chamberMaterial);
  chamber.position.copy(position);
  chamber.rotation.x = Math.PI / 2;

  // Chamber ceiling - dome shape
  const domeGeometry = new THREE.SphereGeometry(chamberSize * 0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMaterial = new THREE.MeshStandardMaterial({
    color: glow,
    metalness: 0.6,
    roughness: 0.3,
    transparent: true,
    opacity: 0.3,
    emissive: glow,
    emissiveIntensity: 0.2,
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.position.copy(position);
  dome.rotation.x = Math.PI / 2;
  dome.scale.z = 0.3;
  chamber.add(dome);

  // Add alloy deposits in chamber
  if (chamberType === 'ore') {
    const depositCount = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < depositCount; i++) {
      const deposit = createAlienAlloyDeposit(
        alloyType,
        new THREE.Vector3(
          (Math.random() - 0.5) * chamberSize * 0.7,
          chamberSize * 0.3,
          (Math.random() - 0.5) * chamberSize * 0.7
        ),
        0.3 + Math.random() * 0.3
      );
      chamber.add(deposit);
    }
  }

  // Void energy effect in treasure chambers
  if (chamberType === 'void') {
    const voidCoreGeometry = new THREE.SphereGeometry(chamberSize * 0.5, 16, 16);
    const voidCoreMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.8,
    });
    const voidCore = new THREE.Mesh(voidCoreGeometry, voidCoreMaterial);
    voidCore.position.set(0, chamberSize * 0.5, 0);
    chamber.add(voidCore);

    // Void particles
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const particleGeometry = new THREE.SphereGeometry(chamberSize * 0.05, 4, 4);
      const particleMaterial = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.5,
      });
      const particle = new THREE.Mesh(particleGeometry, particleMaterial);

      particle.position.set(
        (Math.random() - 0.5) * chamberSize * 2,
        chamberSize * 0.3,
        (Math.random() - 0.5) * chamberSize * 2
      );
      chamber.add(particle);

      // Animate particle later
      (particle.userData as { speed?: THREE.Vector3; offset?: number }).speed = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5 + 0.2,
        (Math.random() - 0.5) * 0.5
      );
      (particle.userData as { offset?: number }).offset = Math.random() * Math.PI * 2;
    }
  }

  return chamber;
}

// Create holographic display for scanner lore
function createHolographicDisplay(
  position: THREE.Vector3,
  loreData: { title: string; description: string; color: number }
): THREE.Mesh {
  // Display screen
  const screenGeometry = new THREE.PlaneGeometry(1.5, 1);
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: loreData.color,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.position.copy(position);
  screen.lookAt(position.clone().add(new THREE.Vector3(0, 0, 5)));

  // Holographic frame
  const frameGeometry = new THREE.EdgesGeometry(screenGeometry);
  const frameMaterial = new THREE.LineBasicMaterial({ color: loreData.color, transparent: true, opacity: 0.6 });
  const frame = new THREE.LineSegments(frameGeometry, frameMaterial);
  frame.position.copy(position);
  frame.lookAt(position.clone().add(new THREE.Vector3(0, 0, 5)));

  // Scan lines effect
  const scanLineGeometry = new THREE.PlaneGeometry(1.45, 0.1);
  const scanLineMaterial = new THREE.MeshBasicMaterial({
    color: loreData.color,
    transparent: true,
    opacity: 0.6,
  });

  const scanLine1 = new THREE.Mesh(scanLineGeometry, scanLineMaterial);
  scanLine1.position.set(position.x, position.y - 0.3, position.z);
  scanLine1.lookAt(position.clone().add(new THREE.Vector3(0, 0, 5)));

  const scanLine2 = new THREE.Mesh(scanLineGeometry, scanLineMaterial);
  scanLine2.position.set(position.x, position.y + 0.3, position.z);
  scanLine2.lookAt(position.clone().add(new THREE.Vector3(0, 0, 5)));

  const displayGroup = new THREE.Group();
  displayGroup.add(screen);
  displayGroup.add(frame);
  displayGroup.add(scanLine1);
  displayGroup.add(scanLine2);

  // Animation data
  (scanLine1.userData as { animOffset?: number; speed?: number }).animOffset = 0;
  (scanLine1.userData as { animOffset?: number; speed?: number }).speed = 2;
  (scanLine2.userData as { animOffset?: number; speed?: number }).animOffset = 2;
  (scanLine2.userData as { animOffset?: number; speed?: number }).speed = 2;

  return displayGroup;
}

// Create alien key in deepest chamber
function createAlienKey(): THREE.Mesh {
  const keyGroup = new THREE.Group();

  // Core gem
  const coreGeometry = new THREE.OctahedronGeometry(0.3, 2);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.userData.isCore = true;
  keyGroup.add(core);

  // Outer rings
  const ringGeometry = new THREE.TorusGeometry(0.4, 0.05, 8, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.8,
  });

  const ring1 = new THREE.Mesh(ringGeometry, ringMaterial);
  ring1.rotation.x = Math.PI / 2;
  keyGroup.add(ring1);

  const ring2 = new THREE.Mesh(ringGeometry, ringMaterial);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.z = -0.1;
  keyGroup.add(ring2);

  const ring3 = new THREE.Mesh(ringGeometry, ringMaterial);
  ring3.rotation.x = Math.PI / 2;
  ring3.position.z = 0.1;
  keyGroup.add(ring3);

  // Energy pillars
  for (let i = 0; i < 4; i++) {
    const pillarGeometry = new THREE.BoxGeometry(0.08, 0.6, 0.08);
    const pillarMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      transparent: true,
      opacity: 0.7,
    });
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);

    const angle = (i / 4) * Math.PI * 2;
    pillar.position.set(
      Math.cos(angle) * 0.3,
      0.3,
      Math.sin(angle) * 0.3
    );
    keyGroup.add(pillar);
  }

  // Floating particles
  for (let i = 0; i < 8; i++) {
    const particleGeometry = new THREE.SphereGeometry(0.05, 6, 6);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6,
    });
    const particle = new THREE.Mesh(particleGeometry, particleMaterial);

    particle.position.set(
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.6
    );
    keyGroup.add(particle);

    (particle.userData as { animOffset?: number; axis?: THREE.Vector3 }).animOffset = Math.random() * Math.PI * 2;
    (particle.userData as { animOffset?: number; axis?: THREE.Vector3 }).axis = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
  }

  return keyGroup;
}

// Main alien ruin gateway factory
export function createAlienRuinGateway(
  position: THREE.Vector3,
  alloyType: 'neon_void' | 'crimson_expanse' | 'starlight_essence' | 'void_energy' = 'neon_void',
  size: number = 8
): AlienRuin {
  const ruin = new THREE.Group();
  ruin.position.copy(position);

  // Use the selected alloy color scheme
  const { base, glow, accent } = ALIEN_ALLOY_COLORS[alloyType];
  const health = size * 150; // Larger ruins have more health
  const maxHealth = health;

  // Base asteroid-like core
  const coreGeometry = new THREE.IcosahedronGeometry(size * 0.8, 8);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: base,
    metalness: 0.7,
    roughness: 0.5,
    flatShading: true,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.castShadow = true;
  core.receiveShadow = true;
  ruin.add(core);

  // Create embedded alien architecture segments
  const architectureSegments = [];
  const segmentCount = 8 + Math.floor(size * 1.5);
  for (let i = 0; i < segmentCount; i++) {
    const segment = createAlienStructureSegment(
      size * (0.15 + Math.random() * 0.25),
      alloyType
    );

    // Position on alien surface
    const phi = Math.acos(-1 + (2 * i) / segmentCount);
    const theta = Math.sqrt(segmentCount * Math.PI) * phi;

    const position = new THREE.Vector3()
      .setFromSphericalCoords(size * 0.7, phi, theta);

    segment.position.copy(position);
    segment.lookAt(ruin.position.clone().add(position.normalize().multiplyScalar(10)));
    segment.rotateX(Math.random() * Math.PI);
    segment.rotateY(Math.random() * Math.PI);
    segment.rotateZ(Math.random() * Math.PI);

    ruin.add(segment);
    architectureSegments.push(segment);
  }

  // Create interior chambers
  const interiorChambers = [];
  const chamberPositions = [
    new THREE.Vector3(0, -size * 0.2, -size * 0.3),
    new THREE.Vector3(size * 0.3, size * 0.1, 0),
    new THREE.Vector3(-size * 0.3, size * 0.05, 0),
  ];

  chamberPositions.forEach((pos, i) => {
    const chamberType = i === 0 ? 'ore' : i === 1 ? 'treasure' : 'void';
    const chamber = createAlienChamber(pos, alloyType, chamberType);
    ruin.add(chamber);
    interiorChambers.push(chamber);
  });

  // Create energy rings - outer rings
  const energyRings = [];
  for (let i = 0; i < 3; i++) {
    const radius = size * (0.5 - i * 0.15);
    const ring = createEnergyRing(radius, i === 2 ? 'portal' : 'outer', alloyType);
    ruin.add(ring);
    energyRings.push(ring);
  }

  // Create alien key in deepest chamber (void chamber)
  const alienKey = createAlienKey();
  alienKey.position.set(-size * 0.3, size * 0.05, 0);
  ruin.add(alienKey);

  // Create holographic displays
  const holographicDisplays = [];
  const loreDisplayPositions = [
    { pos: new THREE.Vector3(-size * 0.4, size * 0.2, -size * 0.5), color: 0x00ffff },
    { pos: new THREE.Vector3(size * 0.4, size * 0.15, -size * 0.6), color: 0xff00ff },
  ];

  loreDisplayPositions.forEach(({ pos, color }) => {
    const display = createHolographicDisplay(pos, {
      title: 'ANCIENT CIVILIZATION',
      description: 'Lost civilization that once thrived among the stars. Their technology speaks of a forgotten golden age of exploration and discovery.',
      color,
    });
    ruin.add(display);
    holographicDisplays.push(display);
  });

  // Bioluminescent ambient light
  const ambientLight = new THREE.PointLight(glow, 0.5, size * 2);
  ambientLight.position.set(0, size * 0.3, 0);
  ruin.add(ambientLight);

  // Random rotation speed
  const rotationSpeed = new THREE.Vector3(
    (Math.random() - 0.5) * 0.1,
    (Math.random() - 0.5) * 0.1,
    (Math.random() - 0.5) * 0.05
  );

  return {
    mesh: ruin,
    alloyType,
    health,
    maxHealth,
    energyLevel: 30 + Math.random() * 40, // Initial energy (0-100)
    chambers: interiorChambers,
    energyRings,
    holographicDisplays,
    alienKey,
    isActivated: false,
    rotationSpeed,
    healthPercent: 100,
    isDead: false,
    interiorChambers,
    bioluminescentAccents: [],
  };
}

// Update alien ruin animation
export function updateAlienRuin(ruin: AlienRuin, deltaTime: number): void {
  if (ruin.isDead) return;

  // Rotate the whole ruin
  ruin.mesh.rotation.x += ruin.rotationSpeed.x * deltaTime;
  ruin.mesh.rotation.y += ruin.rotationSpeed.y * deltaTime;

  // Pulse energy rings
  ruin.energyLevel = Math.max(0, Math.min(100, ruin.energyLevel));
  ruin.energyRings.forEach((ring, i) => {
    const baseScale = 1 + (i * 0.1);
    const pulse = Math.sin(Date.now() * 0.003 - i * 2) * 0.05;
    ring.scale.setScalar(1 + pulse * 0.1);

    // Animate energy particles
    ring.children.forEach(particle => {
      if (particle.userData?.animOffset !== undefined) {
        particle.position.y += Math.sin(Date.now() * 0.005 + particle.userData.animOffset) * 0.001;
      }
    });
  });

  // Animate holographic displays
  ruin.holographicDisplays.forEach(display => {
    display.children.forEach(child => {
      if (child.userData?.animOffset !== undefined && child.userData?.speed) {
        (child.userData as { animOffset?: number }).animOffset += child.userData.speed * deltaTime;
      }
    });
  });

  // Animate alien key glow
  if (ruin.alienKey) {
    ruin.alienKey.children.forEach(child => {
      if (child.userData?.animOffset !== undefined) {
        (child.userData as { animOffset?: number }).animOffset += 2 * deltaTime;
      }
    });
  }

  // Animate interior chamber void particles
  ruin.interiorChambers.forEach(chamber => {
    chamber.children.forEach(child => {
      if (child.userData?.speed) {
        (child.userData as { speed?: THREE.Vector3 }).speed?.multiplyScalar(1.0);
      }
    });
  });

  // Update health percent
  ruin.healthPercent = (ruin.health / ruin.maxHealth) * 100;
}

// Cleanup alien ruin resources
export function cleanupAlienRuin(ruin: AlienRuin): void {
  ruin.mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if ((child.material as THREE.Material).transparent) {
        (child.material as THREE.MeshBasicMaterial).map?.dispose();
        (child.material as THREE.MeshBasicMaterial).dispose();
      } else {
        (child.material as THREE.Material).dispose();
      }
    }
  });
}
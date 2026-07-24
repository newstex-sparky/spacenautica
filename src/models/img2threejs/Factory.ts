/**
 * img2threejs Integration for Spacenautica
 *
 * This module provides a simplified interface to img2threejs-style procedural
 * 3D model generation. The full img2threejs pipeline requires reference images,
 * but this module provides a working implementation pattern that can generate
 * detailed Three.js models from code without external image references.
 */

import * as THREE from 'three';

// ======================
// Base Factory Interface
// ======================

export type ModelOptions = {
  scale?: number;
  position?: THREE.Vector3;
  rotation?: THREE.Euler;
};

// ======================
// Procedural Model Generators
// ======================

/**
 * Create a detailed asteroid model using IcosahedronGeometry with
 * noise-based vertex displacement for realistic asteroid shapes.
 */
export function createProceduralAsteroid(
  type: 'iron' | 'ice' | 'oxygen',
  radius: number = 4,
  options: ModelOptions = {}
): THREE.Group {
  const { scale = 1, position = new THREE.Vector3(), rotation = new THREE.Euler() } = options;

  const asteroid = new THREE.Group();

  // Position and rotation
  asteroid.position.copy(position);
  asteroid.rotation.copy(rotation);
  asteroid.scale.setScalar(scale);

  // Asteroid type colors
  const typeColors: Record<string, { base: number; noise: number }> = {
    iron: { base: 0x666666, noise: 0x222222 },      // Gray with noise
    ice: { base: 0xaaddff, noise: 0x004466 },      // Light blue
    oxygen: { base: 0xff4488, noise: 0xaa0022 },   // Pinkish-red crystals
  };

  const { base, noise } = typeColors[type];

  // Create irregular geometry with noise-displaced vertices
  const geometry = new THREE.IcosahedronGeometry(radius, 12);

  // Apply noise to vertices
  const positionAttribute = geometry.attributes.position;
  const vertexCount = positionAttribute.count;

  for (let i = 0; i < vertexCount; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);

    // Simple noise function using sines
    const noise1 = Math.sin(x * 0.5) * Math.cos(y * 0.5) * Math.sin(z * 0.5);
    const noise2 = Math.sin(x * 1.3) * Math.cos(y * 1.3) * Math.sin(z * 1.3);
    const combinedNoise = (noise1 + noise2) * 0.3;

    // Apply noise with radial falloff
    const distance = Math.sqrt(x * x + y * y + z * z);
    const falloff = 1 - (distance / radius) * 0.3;
    const scale = 1 + combinedNoise * falloff;

    positionAttribute.setXYZ(i, x * scale, y * scale, z * scale);
  }

  geometry.computeVertexNormals();

  // Material
  const material = new THREE.MeshStandardMaterial({
    color: base,
    roughness: 0.8,
    metalness: 0.6,
    flatShading: false,
    side: THREE.DoubleSide,
  });

  // Base mesh
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  asteroid.add(mesh);

  // Add procedural surface details based on type
  if (type === 'ice') {
    // Ice craters and surface irregularities
    for (let i = 0; i < 5; i++) {
      const craterGeometry = new THREE.IcosahedronGeometry(radius * 0.15, 4);
      const craterMaterial = new THREE.MeshStandardMaterial({
        color: noise,
        roughness: 0.95,
        metalness: 0.1,
      });

      const crater = new THREE.Mesh(craterGeometry, craterMaterial);

      // Random position on surface
      const angle = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const distance = radius * (0.7 + Math.random() * 0.3);

      crater.position.setFromSphericalCoords(distance, phi, angle);
      crater.lookAt(0, 0, 0);
      crater.scale.multiplyScalar(0.8 + Math.random() * 0.4);

      asteroid.add(crater);
    }
  } else if (type === 'oxygen') {
    // Oxygen crystal glow effect
    const glowGeometry = new THREE.SphereGeometry(radius * 0.95, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff88bb,
      transparent: true,
      opacity: 0.3,
    });

    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    asteroid.add(glow);

    // Add crystal facets
    const facetCount = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < facetCount; i++) {
      const facetGeometry = new THREE.ConeGeometry(radius * 0.4, radius * 0.3, 5);
      const facetMaterial = new THREE.MeshStandardMaterial({
        color: 0xff66aa,
        roughness: 0.2,
        metalness: 0.4,
        emissive: 0xff4488,
        emissiveIntensity: 0.5,
      });

      const facet = new THREE.Mesh(facetGeometry, facetMaterial);

      const angle = (i / facetCount) * Math.PI * 2;
      facet.position.setFromCylindricalCoords(radius * 0.6, angle, 0);
      facet.rotation.set(Math.PI / 2 + Math.random() * 0.5, angle, 0);
      facet.lookAt(0, 0, 0);

      asteroid.add(facet);
    }
  }

  // Random rotation and drift data
  (asteroid.userData as any).rotationSpeed = new THREE.Vector3(
    (Math.random() - 0.5) * 0.2,
    (Math.random() - 0.5) * 0.2,
    (Math.random() - 0.5) * 0.2
  );

  (asteroid.userData as any).driftVelocity = new THREE.Vector3(
    (Math.random() - 0.5) * 0.01,
    (Math.random() - 0.5) * 0.01,
    (Math.random() - 0.5) * 0.01
  );

  (asteroid.userData as any).type = type;
  (asteroid.userData as any).maxHealth = Math.floor(radius * 25);
  (asteroid.userData as any).health = (asteroid.userData as any).maxHealth;

  return asteroid;
}

/**
 * Create a station module model with detailed construction
 */
export function createStationModule(
  type: 'dome' | 'solar' | 'smelter' | 'refinery' | 'o2generator',
  position: THREE.Vector3,
  rotation: number = 0,
  scale: number = 1
): THREE.Group {
  const module = new THREE.Group();
  module.position.copy(position);
  module.rotation.y = rotation;
  module.scale.setScalar(scale);

  // Module geometry based on type
  const boxGeometry = new THREE.BoxGeometry(4, 4, 4);
  const cylinderGeometry = new THREE.CylinderGeometry(3, 3, 4, 16);

  // Colors and materials
  const colors: Record<string, number> = {
    dome: 0x00aacc,
    solar: 0xffcc00,
    smelter: 0xaaaaaa,
    refinery: 0x88ccff,
    o2generator: 0xcc66ff,
  };

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: colors[type] || 0x666666,
    roughness: 0.7,
    metalness: 0.6,
  });

  // Create module base
  const base = new THREE.Mesh(boxGeometry, baseMaterial);
  base.position.y = scale;
  base.castShadow = true;
  base.receiveShadow = true;
  module.add(base);

  // Add type-specific details
  if (type === 'dome') {
    // Habitable dome with spherical top
    const domeGeometry = new THREE.SphereGeometry(3.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMaterial = new THREE.MeshStandardMaterial({
      color: colors[type],
      roughness: 0.2,
      metalness: 0.4,
      transparent: true,
      opacity: 0.7,
    });

    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.position.y = scale;
    module.add(dome);

    // Airlock hatch
    const hatchGeometry = new THREE.CylinderGeometry(0.6, 0.6, 0.3, 16);
    const hatchMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.3,
      metalness: 0.8,
    });

    const hatch = new THREE.Mesh(hatchGeometry, hatchMaterial);
    hatch.position.set(0, scale, 2.6);
    hatch.rotation.z = Math.PI / 2;
    module.add(hatch);

    // Structural supports
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const supportGeometry = new THREE.CylinderGeometry(0.15, 0.15, scale * 2, 8);
      const support = new THREE.Mesh(supportGeometry, baseMaterial);

      support.position.set(Math.cos(angle) * 2, scale / 2, Math.sin(angle) * 2);
      module.add(support);
    }
  } else if (type === 'solar') {
    // Solar panels
    const panelGeometry = new THREE.BoxGeometry(3, 0.1, 1);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      roughness: 0.3,
      metalness: 0.4,
      emissive: 0xffaa00,
      emissiveIntensity: 0.2,
    });

    // Left panel
    const panel1 = new THREE.Mesh(panelGeometry, panelMaterial);
    panel1.position.set(-2, scale + 1.5, 0);
    panel1.rotation.x = Math.PI / 6;
    module.add(panel1);

    // Right panel
    const panel2 = new THREE.Mesh(panelGeometry, panelMaterial);
    panel2.position.set(2, scale + 1.5, 0);
    panel2.rotation.x = -Math.PI / 6;
    module.add(panel2);

    // Central structure
    const coreGeometry = new THREE.BoxGeometry(1, scale * 2, 1);
    const core = new THREE.Mesh(coreGeometry, baseMaterial);
    module.add(core);
  } else if (type === 'smelter') {
    // Smelter with furnace
    const furnaceGeometry = new THREE.CylinderGeometry(1.5, 1.5, 1.5, 16);
    const furnaceMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444,
      roughness: 0.6,
      metalness: 0.8,
    });

    const furnace = new THREE.Mesh(furnaceGeometry, furnaceMaterial);
    furnace.position.y = scale;
    module.add(furnace);

    // Heat glow
    const glowGeometry = new THREE.SphereGeometry(1.3, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.4,
    });

    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.y = scale;
    module.add(glow);

    // Ore input port
    const portGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.5);
    const portMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.4,
      metalness: 0.6,
    });

    const inputPort = new THREE.Mesh(portGeometry, portMaterial);
    inputPort.position.set(-1.8, scale, 2);
    inputPort.rotation.y = Math.PI / 4;
    module.add(inputPort);
  } else if (type === 'refinery') {
    // Electrolysis refinery
    const reactorGeometry = new THREE.CylinderGeometry(2, 2, 2.5, 16);
    const reactor = new THREE.Mesh(reactorGeometry, baseMaterial);
    reactor.position.y = scale;
    module.add(reactor);

    // Piping
    for (let i = 0; i < 6; i++) {
      const pipeAngle = (i / 6) * Math.PI * 2;
      const pipeGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2.5, 8);
      const pipeMaterial = new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        roughness: 0.3,
        metalness: 0.8,
      });

      const pipe = new THREE.Mesh(pipeGeometry, pipeMaterial);
      pipe.position.setFromCylindricalCoords(2.2, pipeAngle, 1.25);
      module.add(pipe);
    }

    // Oxygen vents
    for (let i = 0; i < 3; i++) {
      const ventGeometry = new THREE.ConeGeometry(0.2, 0.3, 8);
      const ventMaterial = new THREE.MeshStandardMaterial({
        color: 0x00aaff,
        roughness: 0.2,
        metalness: 0.6,
      });

      const vent = new THREE.Mesh(ventGeometry, ventMaterial);
      const angle = (i / 3) * Math.PI * 2;
      vent.position.set(Math.cos(angle) * 2.5, scale, Math.sin(angle) * 2.5);
      vent.rotation.x = -Math.PI / 2;
      module.add(vent);
    }
  } else if (type === 'o2generator') {
    // O2 generator with storage tanks
    const unitGeometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const unit = new THREE.Mesh(unitGeometry, baseMaterial);
    unit.position.y = scale;
    module.add(unit);

    // H2 storage tanks
    const tankGeometry = new THREE.CylinderGeometry(0.7, 0.7, 2, 16);
    const tankMaterial = new THREE.MeshStandardMaterial({
      color: 0x4444ff,
      roughness: 0.3,
      metalness: 0.8,
    });

    const tank1 = new THREE.Mesh(tankGeometry, tankMaterial);
    tank1.position.set(1.5, scale / 2, 0);
    module.add(tank1);

    const tank2 = new THREE.Mesh(tankGeometry, tankMaterial);
    tank2.position.set(2.3, scale / 2, 0);
    module.add(tank2);

    // Generator core
    const coreGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xcc66ff,
      emissive: 0xcc66ff,
      emissiveIntensity: 0.8,
    });

    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.y = scale;
    module.add(core);
  }

  // Connectors
  const connectorGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8);
  const connectorMaterial = baseMaterial.clone();

  connectorMaterial.color.setHex(0x333333);

  // Four corner connectors
  const positions = [
    [-1.8, 1.25, -1.8],
    [1.8, 1.25, -1.8],
    [-1.8, 1.25, 1.8],
    [1.8, 1.25, 1.8],
  ];

  positions.forEach(([x, y, z]) => {
    const connector = new THREE.Mesh(connectorGeometry, connectorMaterial);
    connector.position.set(x, y, z);
    module.add(connector);
  });

  // Module data
  (module.userData as any).type = type;
  (module.userData as any).health = 100;
  (module.userData as any).maxHealth = 100;

  return module;
}

/**
 * Create a tool object model (laser cutter, mining laser, scanner)
 */
export function createTool(
  type: 'laser-cutter' | 'mining-laser' | 'scanner',
  scale: number = 1
): THREE.Group {
  const tool = new THREE.Group();
  tool.scale.setScalar(scale);

  // Tool body
  const bodyGeometry = new THREE.BoxGeometry(1, 1.5, 0.6);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.4,
    metalness: 0.9,
  });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  tool.add(body);

  // Tool handle
  const handleGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1, 8);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.6,
    metalness: 0.3,
  });

  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  handle.position.y = -1.2;
  tool.add(handle);

  // Type-specific elements
  if (type === 'laser-cutter') {
    // Laser emitter
    const emitterGeometry = new THREE.CylinderGeometry(0.4, 0.5, 0.6, 8);
    const emitterMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff4400,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.7,
    });

    const emitter = new THREE.Mesh(emitterGeometry, emitterMaterial);
    emitter.position.y = 0.8;
    tool.add(emitter);

    // Power indicator light
    const indicatorGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const indicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
    });

    const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
    indicator.position.set(0.6, 0.8, 0.3);
    tool.add(indicator);

  } else if (type === 'mining-laser') {
    // Mining head
    const headGeometry = new THREE.CapsuleGeometry(0.4, 0.5, 4, 8);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xcc00ff,
      emissive: 0xcc00ff,
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.8,
    });

    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 0.8;
    tool.add(head);

    // Power core
    const coreGeometry = new THREE.BoxGeometry(0.7, 0.4, 0.7);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xaa00ff,
      emissive: 0xaa00ff,
      emissiveIntensity: 0.6,
    });

    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.set(0, 0.8, -0.4);
    tool.add(core);

  } else if (type === 'scanner') {
    // Scanner dish
    const dishGeometry = new THREE.ConeGeometry(0.6, 0.3, 16, 1, true);
    const dishMaterial = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      roughness: 0.3,
      metalness: 0.7,
      transparent: true,
      opacity: 0.6,
    });

    const dish = new THREE.Mesh(dishGeometry, dishMaterial);
    dish.rotation.x = -Math.PI / 2;
    dish.position.y = 1;
    dish.position.z = -0.2;
    tool.add(dish);

    // Scanner array
    const arrayGeometry = new THREE.BoxGeometry(1, 0.1, 0.8);
    const arrayMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 0.3,
    });

    const array = new THREE.Mesh(arrayGeometry, arrayMaterial);
    array.position.y = 0.8;
    tool.add(array);

    // Data display
    const displayGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.1);
    const displayMaterial = new THREE.MeshStandardMaterial({
      color: 0x003344,
      emissive: 0x003344,
      emissiveIntensity: 0.5,
    });

    const display = new THREE.Mesh(displayGeometry, displayMaterial);
    display.position.set(0.5, 0.5, 0.4);
    tool.add(display);
  }

  // Safety guards
  const guardGeometry = new THREE.CylinderGeometry(0.6, 0.6, 0.1, 16);
  const guardMaterial = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.5,
    metalness: 0.6,
  });

  const guard = new THREE.Mesh(guardGeometry, guardMaterial);
  guard.rotation.x = Math.PI / 2;
  tool.add(guard);

  // Tool data
  (tool.userData as any).type = type;
  (tool.userData as any).battery = 100;

  return tool;
}

/**
 * Create a chest/item container model with realistic design
 */
export function createContainer(
  size: 'small' | 'medium' | 'large',
  scale: number = 1
): THREE.Group {
  const container = new THREE.Group();
  container.scale.setScalar(scale);

  const containerData: Record<string, { width: number; height: number; depth: number }> = {
    small: { width: 1, height: 1.5, depth: 0.8 },
    medium: { width: 1.5, height: 1.8, depth: 1 },
    large: { width: 2, height: 2, depth: 1.2 },
  };

  const { width, height, depth } = containerData[size];

  // Container box
  const boxGeometry = new THREE.BoxGeometry(width, height, depth);
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: 0x445566,
    roughness: 0.6,
    metalness: 0.7,
  });

  const box = new THREE.Mesh(boxGeometry, boxMaterial);
  box.castShadow = true;
  container.add(box);

  // Container lid
  const lidGeometry = new THREE.BoxGeometry(width + 0.1, 0.1, depth + 0.1);
  const lidMaterial = new THREE.MeshStandardMaterial({
    color: 0x556677,
    roughness: 0.5,
    metalness: 0.8,
  });

  const lid = new THREE.Mesh(lidGeometry, lidMaterial);
  lid.position.y = height / 2;
  lid.castShadow = true;
  container.add(lid);

  // Handle
  const handleGeometry = new THREE.TorusGeometry(0.2, 0.05, 8, 16, Math.PI);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    roughness: 0.3,
    metalness: 0.9,
  });

  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  handle.position.set(0, height * 0.3, depth / 2 + 0.05);
  container.add(handle);

  // Lock mechanism
  const lockGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 8);
  const lockMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 1,
  });

  const lock = new THREE.Mesh(lockGeometry, lockMaterial);
  lock.position.set(width * 0.3, height * 0.25, depth * 0.75);
  container.add(lock);

  const lock2 = lock.clone();
  lock2.position.set(-width * 0.3, height * 0.25, depth * 0.75);
  container.add(lock2);

  // Label
  const labelGeometry = new THREE.PlaneGeometry(width * 0.6, 0.2);
  const labelMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6633,
    roughness: 0.3,
    metalness: 0.6,
    emissive: 0xff6633,
    emissiveIntensity: 0.2,
  });

  const label = new THREE.Mesh(labelGeometry, labelMaterial);
  label.position.set(0, height * 0.45, depth / 2 + 0.001);
  container.add(label);

  // Container data
  (container.userData as any).size = size;
  (container.userData as any).locked = false;
  (container.userData as any).contents = [];

  return container;
}

/**
 * Generate detailed ground texture for space station floors
 */
export function createFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base metal floor
  ctx.fillStyle = '#333344';
  ctx.fillRect(0, 0, 512, 512);

  // Add metal panels
  ctx.strokeStyle = '#444455';
  ctx.lineWidth = 2;
  for (let x = 0; x < 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let y = 0; y < 512; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  // Add grime/stains
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = 10 + Math.random() * 30;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.3})`;
    ctx.fill();
  }

  // Add scratches
  ctx.strokeStyle = '#222233';
  ctx.lineWidth = 1;
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 20 - 10, y + Math.random() * 20 - 10);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);

  return texture;
}

/**
 * Generate detailed asteroid texture
 */
export function createAsteroidTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base rock texture
  ctx.fillStyle = '#666677';
  ctx.fillRect(0, 0, 512, 512);

  // Noise texture
  for (let x = 0; x < 512; x += 2) {
    for (let y = 0; y < 512; y += 2) {
      const noise = (Math.random() * 50 + 50) / 255;
      const r = Math.floor(100 * noise + 100);
      const g = Math.floor(100 * noise + 100);
      const b = Math.floor(110 * noise + 100);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // Craters
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = 5 + Math.random() * 20;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(50, 50, 60, ${Math.random() * 0.5 + 0.3})`;
    ctx.fill();

    // Crater edge highlight
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Small surface rocks
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 3;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(30, 30, 40, ${Math.random() * 0.6})`;
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);

  return texture;
}

/**
 * Generate detailed ice texture
 */
export function createIceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base ice
  const gradient = ctx.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, '#88ccff');
  gradient.addColorStop(0.5, '#aaddff');
  gradient.addColorStop(1, '#6699bb');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  // Ice crystals
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = 1 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + size * 0.7, y - size * 0.7);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size * 0.7, y + size * 0.7);
    ctx.closePath();
    ctx.fillStyle = `rgba(200, 230, 255, ${Math.random() * 0.4})`;
    ctx.fill();
  }

  // Frost patches
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = 20 + Math.random() * 40;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);

  return texture;
}
import * as THREE from 'three';

/**
 * Generated Tool Models from Kenny CC0 reference
 */

/**
 * Repair Tool - Welding torch for hull repair
 */
export function createRepairTool(): THREE.Group;

/**
 * Mining Drill Mk2 - Upgraded mining tool with more power
 */
export function createMiningDrillMk2(): THREE.Group;

/**
 * Mining Drill - Primary mining tool
 */
export function createMiningDrill(): THREE.Group;

// ======================
// Item Models (inventory/crafting display)
// ======================

/**
 * Raw Ore Chunk - Rock material from asteroids
 */
export function createRawOreItem(): THREE.Mesh;

/**
 * Water Ice Chunk - Crystalline frozen water
 */
export function createWaterIceItem(): THREE.Mesh;

/**
 * Metal Ingot (Iron) - Smelted iron ore
 */
export function createIronIngotItem(): THREE.Mesh;

/**
 * Metal Ingot (Titanium) - Smelted titanium ore
 */
export function createTitaniumIngotItem(): THREE.Mesh;

/**
 * O2 Canister - Refilled with oxygen
 */
export function createO2CanisterItem(): THREE.Mesh;

/**
 * H2 Canister - Hydrogen fuel canister
 */
export function createH2CanisterItem(): THREE.Mesh;

/**
 * Tech Chip - Circuit board for crafting/upgrade
 */
export function createTechChipItem(): THREE.Mesh;
export function createMiningDrill(): THREE.Group {
  const drill = new THREE.Group();

  // Drill housing
  const housingGeometry = new THREE.CylinderGeometry(0.3, 0.35, 1.2, 12);
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.6,
    metalness: 0.9,
  });
  const housing = new THREE.Mesh(housingGeometry, housingMaterial);
  housing.rotation.x = Math.PI / 2;
  drill.add(housing);

  // Drill bit (3-blade)
  const bitGroup = new THREE.Group();
  const bladeGeometry = new THREE.BoxGeometry(0.6, 0.05, 0.15);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    metalness: 0.9,
    roughness: 0.3,
  });

  // Rotate blades around Y
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    const angle = (i / 3) * Math.PI * 2;
    blade.position.set(0.3 * Math.cos(angle), 0, 0.3 * Math.sin(angle));
    blade.rotation.y = angle;
    bitGroup.add(blade);
  }

  bitGroup.position.x = 0.4;
  drill.add(bitGroup);

  // Grip handles
  const handleGeometry = new THREE.BoxGeometry(0.15, 0.4, 0.15);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.8,
    metalness: 0.6,
  });

  const leftHandle = new THREE.Mesh(handleGeometry, handleMaterial);
  leftHandle.position.set(-0.6, 0.2, 0);
  leftHandle.rotation.z = 0.3;
  drill.add(leftHandle);

  const rightHandle = new THREE.Mesh(handleGeometry, handleMaterial);
  rightHandle.position.set(-0.6, -0.2, 0);
  rightHandle.rotation.z = -0.3;
  drill.add(rightHandle);

  // Power indicator
  const powerGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.3, 12);
  const powerMaterial = new THREE.MeshStandardMaterial({
    color: 0xff4444,
    emissive: 0xff1100,
    emissiveIntensity: 0.8,
  });
  const power = new THREE.Mesh(powerGeometry, powerMaterial);
  power.position.set(-0.9, 0, 0);
  drill.add(power);

  // Status lights
  const lightGeometry = new THREE.SphereGeometry(0.03, 8, 8);
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ff88,
    emissive: 0x00ff88,
    emissiveIntensity: 0.6,
  });

  const statusLight1 = new THREE.Mesh(lightGeometry, lightMaterial);
  statusLight1.position.set(-0.9, 0.7, 0);
  drill.add(statusLight1);

  const statusLight2 = new THREE.Mesh(lightGeometry, lightMaterial);
  statusLight2.position.set(-0.9, -0.7, 0);
  drill.add(statusLight2);

  drill.userData = {
    type: 'mining-drill',
    purpose: 'mine-asteroids',
    powerLevel: 85,
    damage: 30,
    durability: 100,
  };

  return drill;
}

/**
 * Jetpack - Personal flight device
 */
export function createJetpack(): THREE.Group {
  const jetpack = new THREE.Group();

  // Main body
  const bodyGeometry = new THREE.CylinderGeometry(0.45, 0.4, 1.1, 12);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.5,
    metalness: 0.8,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  jetpack.add(body);

  // Fuel tanks
  const tankGeometry = new THREE.CapsuleGeometry(0.25, 0.8, 4, 8);
  const tankMaterial = new THREE.MeshStandardMaterial({
    color: 0x151520,
    roughness: 0.4,
    metalness: 0.9,
  });

  const tank1 = new THREE.Mesh(tankGeometry, tankMaterial);
  tank1.rotation.z = Math.PI / 2;
  tank1.position.set(-0.6, 0, 0);
  jetpack.add(tank1);

  const tank2 = new THREE.Mesh(tankGeometry, tankMaterial);
  tank2.rotation.z = Math.PI / 2;
  tank2.position.set(0.6, 0, 0);
  jetpack.add(tank2);

  // Backpack straps (decorative)
  const strapGeometry = new THREE.BoxGeometry(0.12, 0.3, 0.08);
  const strapMaterial = new THREE.MeshStandardMaterial({
    color: 0x0a0a10,
    roughness: 0.9,
    metalness: 0.3,
  });

  for (let i = 0; i < 6; i++) {
    const strap = new THREE.Mesh(strapGeometry, strapMaterial);
    strap.position.set(
      -0.35 + (i * 0.15) - 0.45,
      (i % 2 === 0 ? 0.6 : -0.6),
      0
    );
    jetpack.add(strap);
  }

  // Thruster nozzles
  const nozzleGeometry = new THREE.CylinderGeometry(0.08, 0.12, 0.2, 12);
  const nozzleMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a5a,
    metalness: 1.0,
    roughness: 0.3,
  });

  // Back thrusters
  for (let i = 0; i < 2; i++) {
    const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzle.position.set(
      0,
      -0.4 + (i * 0.4),
      0.35
    );
    nozzle.rotation.z = Math.PI / 6;
    jetpack.add(nozzle);
  }

  // Side thrusters
  for (let i = 0; i < 4; i++) {
    const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzle.position.set(
      (i % 2 === 0 ? -0.4 : 0.4),
      -0.4 + (Math.floor(i / 2) * 0.4),
      0
    );
    nozzle.rotation.z = Math.PI / 4 * (i % 2 === 0 ? 1 : -1);
    nozzle.rotation.x = Math.PI / 6;
    jetpack.add(nozzle);
  }

  // Emission glow
  const glowGeometry = new THREE.CircleGeometry(0.15, 16);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.6,
  });

  // Back glow
  const backGlow = new THREE.Mesh(glowGeometry, glowMaterial);
  backGlow.position.set(0, 0.1, 0.45);
  backGlow.rotation.y = Math.PI;
  jetpack.add(backGlow);

  // Fuel level indicators
  const indicatorGeometry = new THREE.BoxGeometry(0.2, 0.08, 0.05);
  const indicatorMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 0.4,
  });

  const fuelIndicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
  fuelIndicator.position.set(0.7, 0, 0.3);
  fuelIndicator.rotation.z = -Math.PI / 4;
  jetpack.add(fuelIndicator);

  jetpack.userData = {
    type: 'jetpack',
    purpose: 'personal-flight',
    fuelCapacity: 100,
    speed: 15, // m/s
    powerUsage: 20,
  };

  return jetpack;
}

/**
 * Scanner - Equipment for resource scanning
 */
export function createScanner(): THREE.Group {
  const scanner = new THREE.Group();

  // Scanner housing
  const housingGeometry = new THREE.BoxGeometry(0.4, 0.3, 0.6);
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a40,
    roughness: 0.4,
    metalness: 0.9,
  });
  const housing = new THREE.Mesh(housingGeometry, housingMaterial);
  scanner.add(housing);

  // Detection dish
  const dishGeometry = new THREE.ConeGeometry(0.3, 0.2, 8);
  const dishMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a8a,
    metalness: 0.8,
    roughness: 0.4,
  });
  const dish = new THREE.Mesh(dishGeometry, dishMaterial);
  dish.position.set(0, 0.25, -0.3);
  scanner.add(dish);

  // Sensor array on top
  const sensorGeometry = new THREE.BoxGeometry(0.25, 0.1, 0.2);
  const sensorMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ff88,
    emissive: 0x00ff88,
    emissiveIntensity: 0.4,
  });
  const sensor = new THREE.Mesh(sensorGeometry, sensorMaterial);
  sensor.position.set(0, 0.35, 0.1);
  scanner.add(sensor);

  // Handle
  const handleGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.6, 8);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    metalness: 0.9,
    roughness: 0.3,
  });
  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  handle.position.set(0, -0.55, 0);
  scanner.add(handle);

  // Screen display
  const screenGeometry = new THREE.PlaneGeometry(0.15, 0.1);
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.5,
  });
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.position.set(0.21, -0.1, 0.25);
  scanner.add(screen);

  // Side controls
  const controlGeometry = new THREE.BoxGeometry(0.1, 0.15, 0.08);
  const controlMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    metalness: 0.9,
    roughness: 0.3,
  });

  const leftControl = new THREE.Mesh(controlGeometry, controlMaterial);
  leftControl.position.set(-0.2, 0.15, 0.25);
  scanner.add(leftControl);

  const rightControl = new THREE.Mesh(controlGeometry, controlMaterial);
  rightControl.position.set(0.2, 0.15, 0.25);
  scanner.add(rightControl);

  // Detection wave effect (emissive ring)
  const waveGeometry = new THREE.RingGeometry(0.35, 0.4, 16);
  const waveMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const wave = new THREE.Mesh(waveGeometry, waveMaterial);
  wave.position.set(0, 0.1, -0.4);
  wave.rotation.x = -Math.PI / 2;
  scanner.add(wave);

  scanner.userData = {
    type: 'scanner',
    purpose: 'resource-detection',
    range: 50, // meters
    powerUsage: 10,
    batteryLevel: 100,
  };

  return scanner;
}
/**
 * Repair Tool - Welding torch for hull repair
 */
export function createRepairTool(): THREE.Group {
  const tool = new THREE.Group();

  // Handle
  const handleGeometry = new THREE.BoxGeometry(0.15, 0.7, 0.1);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.7,
    metalness: 0.8,
  });

  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  handle.position.y = -0.8;
  handle.rotation.z = 0.3;
  tool.add(handle);

  // Torch nozzle
  const nozzleGeometry = new THREE.CylinderGeometry(0.05, 0.08, 0.3, 8);
  const nozzleMaterial = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.5,
    metalness: 0.9,
  });

  const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.3, -0.4);
  tool.add(nozzle);

  // Flame emitter (glowing)
  const flameGeometry = new THREE.ConeGeometry(0.06, 0.4, 8);
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.8,
  });

  const flame = new THREE.Mesh(flameGeometry, flameMaterial);
  flame.position.set(0, 0.5, -0.4);
  tool.add(flame);

  // Power indicator
  const powerGeometry = new THREE.CylinderGeometry(0.04, 0.06, 0.15, 8);
  const powerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xffaa00,
    emissiveIntensity: 0.6,
  });

  const power = new THREE.Mesh(powerGeometry, powerMaterial);
  power.position.set(0.1, 0.9, -0.4);
  tool.add(power);

  // Status lights
  const warningGeometry = new THREE.SphereGeometry(0.025, 6, 6);
  const warningMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 0.8,
  });

  const warning1 = new THREE.Mesh(warningGeometry, warningMaterial);
  warning1.position.set(0.15, 0, -0.2);
  tool.add(warning1);

  const warning2 = warning1.clone();
  warning2.position.set(0.15, 0.7, -0.2);
  tool.add(warning2);

  tool.userData = {
    type: 'repair-tool',
    purpose: 'hull-repair',
    battery: 100,
    currentMode: 'weld',
  };

  return tool;
}

/**
 * Mining Drill Mk2 - Upgraded mining tool with more power
 */
export function createMiningDrillMk2(): THREE.Group {
  const drill = new THREE.Group();

  // Drill housing
  const housingGeometry = new THREE.CylinderGeometry(0.35, 0.4, 1.5, 16);
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.5,
    metalness: 1.0,
  });
  const housing = new THREE.Mesh(housingGeometry, housingMaterial);
  housing.rotation.x = Math.PI / 2;
  drill.add(housing);

  // Heavy-duty drill bits (5 blades)
  const bitGroup = new THREE.Group();
  const bladeGeometry = new THREE.BoxGeometry(0.7, 0.08, 0.18);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a5a5a,
    metalness: 1.0,
    roughness: 0.3,
  });

  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    const angle = (i / 5) * Math.PI * 2;
    blade.position.set(0.4 * Math.cos(angle), 0, 0.4 * Math.sin(angle));
    blade.rotation.y = angle;
    bitGroup.add(blade);
  }

  bitGroup.position.x = 0.5;
  drill.add(bitGroup);

  // Extended grip handles
  const handleGeometry = new THREE.BoxGeometry(0.18, 0.5, 0.15);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.6,
    metalness: 0.8,
  });

  const leftHandle = new THREE.Mesh(handleGeometry, handleMaterial);
  leftHandle.position.set(-0.7, 0.25, 0);
  leftHandle.rotation.z = 0.25;
  drill.add(leftHandle);

  const rightHandle = new THREE.Mesh(handleGeometry, handleMaterial);
  rightHandle.position.set(-0.7, -0.25, 0);
  rightHandle.rotation.z = -0.25;
  drill.add(rightHandle);

  // High-power LED indicators
  const powerGeometry = new THREE.CylinderGeometry(0.1, 0.12, 0.4, 16);
  const powerMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00aa00,
    emissiveIntensity: 0.8,
  });

  const power = new THREE.Mesh(powerGeometry, powerMaterial);
  power.position.set(-1.1, 0, 0);
  drill.add(power);

  // Cooling vents
  const ventGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 8);
  const ventMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.9,
  });

  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(ventGeometry, ventMaterial);
    vent.position.set(0, 0.9 - i * 0.25, 0.5);
    drill.add(vent);
  }

  // Shielded screen display
  const screenGeometry = new THREE.PlaneGeometry(0.2, 0.1);
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.7,
  });

  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.position.set(0.3, 1.15, -0.8);
  screen.rotation.x = -0.5;
  drill.add(screen);

  // Battery pack
  const batteryGeometry = new THREE.BoxGeometry(0.25, 0.3, 0.35);
  const batteryMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a4a,
    roughness: 0.3,
    metalness: 0.95,
  });

  const battery = new THREE.Mesh(batteryGeometry, batteryMaterial);
  battery.position.set(0.3, -0.8, -0.4);
  drill.add(battery);

  drill.userData = {
    type: 'mining-drill-mk2',
    purpose: 'mine-asteroids',
    powerLevel: 100,
    damage: 55,
    durability: 150,
    mode: 'auto',
  };

  return drill;
}

// ======================
// Item Models (inventory/crafting display)
// ======================

/**
 * Raw Ore Chunk - Rock material from asteroids
 */
export function createRawOreItem(): THREE.Mesh {
  const geometry = new THREE.DodecahedronGeometry(0.3, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.9,
    metalness: 0.4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    type: 'raw-ore',
    name: 'Raw Ore',
    stackable: true,
    maxStack: 100,
    yield: 5,
  };
  return mesh;
}

/**
 * Water Ice Chunk - Crystalline frozen water
 */
export function createWaterIceItem(): THREE.Mesh {
  const geometry = new THREE.OctahedronGeometry(0.3, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    roughness: 0.6,
    metalness: 0.2,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    type: 'water-ice',
    name: 'Water Ice',
    stackable: true,
    maxStack: 100,
    yield: 5,
  };
  return mesh;
}

/**
 * Metal Ingot (Iron) - Smelted iron ore
 */
export function createIronIngotItem(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(0.25, 0.25, 0.35);
  const material = new THREE.MeshStandardMaterial({
    color: 0x888888,
    roughness: 0.4,
    metalness: 0.95,
    emissive: 0x222222,
    emissiveIntensity: 0.3,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    type: 'iron-ingot',
    name: 'Iron Ingot',
    stackable: true,
    maxStack: 50,
    cost: 1,
  };
  return mesh;
}

/**
 * Metal Ingot (Titanium) - Smelted titanium ore
 */
export function createTitaniumIngotItem(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(0.25, 0.25, 0.35);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffa500,
    roughness: 0.3,
    metalness: 0.95,
    emissive: 0x332200,
    emissiveIntensity: 0.4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    type: 'titanium-ingot',
    name: 'Titanium Ingot',
    stackable: true,
    maxStack: 50,
    cost: 1,
  };
  return mesh;
}

/**
 * O2 Canister - Refilled with oxygen
 */
export function createO2CanisterItem(): THREE.Mesh {
  const cylinderGeometry = new THREE.CylinderGeometry(0.15, 0.18, 0.6, 16);
  const cylinderMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ff88,
    roughness: 0.3,
    metalness: 0.85,
    emissive: 0x00aa44,
    emissiveIntensity: 0.4,
  });
  const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
  cylinder.rotation.x = Math.PI / 2;
  cylinder.position.y = 0.3;
  
  // Cap
  const capGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.1, 16);
  const capMaterial = new THREE.MeshStandardMaterial({
    color: 0x006633,
    roughness: 0.5,
    metalness: 0.9,
  });
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.position.y = 0;
  
  const mesh = new THREE.Group();
  mesh.add(cylinder);
  mesh.add(cap);
  
  mesh.userData = {
    type: 'o2-canister',
    name: 'O2 Canister',
    stackable: false,
    effect: '+25 O2',
    refillAmount: 25,
  };
  return mesh;
}

/**
 * H2 Canister - Hydrogen fuel canister
 */
export function createH2CanisterItem(): THREE.Mesh {
  const cylinderGeometry = new THREE.CylinderGeometry(0.15, 0.18, 0.6, 16);
  const cylinderMaterial = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    roughness: 0.3,
    metalness: 0.85,
    emissive: 0xcc6600,
    emissiveIntensity: 0.4,
  });
  const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
  cylinder.rotation.x = Math.PI / 2;
  cylinder.position.y = 0.3;
  
  // Glow stripes
  const stripeGeometry = new THREE.CylinderGeometry(0.16, 0.17, 0.15, 16);
  const stripeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.7,
  });
  const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
  stripe.position.y = 0.3;
  
  // Cap
  const capGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.1, 16);
  const capMaterial = new THREE.MeshStandardMaterial({
    color: 0x664400,
    roughness: 0.5,
    metalness: 0.9,
  });
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.position.y = 0;
  
  const mesh = new THREE.Group();
  mesh.add(cylinder);
  mesh.add(stripe);
  mesh.add(cap);
  
  mesh.userData = {
    type: 'h2-canister',
    name: 'H2 Canister',
    stackable: false,
    effect: '+10 H2',
    refillAmount: 10,
  };
  return mesh;
}

/**
 * Tech Chip - Circuit board for crafting/upgrade
 */
export function createTechChipItem(): THREE.Mesh {
  const chipGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.1, 16);
  const chipMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a2a,
    roughness: 0.3,
    metalness: 0.95,
    emissive: 0x0044ff,
    emissiveIntensity: 0.6,
  });
  const chip = new THREE.Mesh(chipGeometry, chipMaterial);
  chip.rotation.x = Math.PI / 2;
  chip.position.y = 0.05;
  
  // Circuit traces on top
  const traceGeometry = new THREE.BoxGeometry(0.4, 0.02, 0.3);
  const traceMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.6,
  });
  const trace = new THREE.Mesh(traceGeometry, traceMaterial);
  trace.position.y = 0.07;
  
  // Connection ports
  const portGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.15, 8);
  const portMaterial = new THREE.MeshStandardMaterial({
    color: 0x555555,
    metalness: 1.0,
    roughness: 0.3,
  });
  
  const port1 = new THREE.Mesh(portGeometry, portMaterial);
  port1.position.set(-0.12, 0.0, 0.25);
  port1.rotation.x = Math.PI / 2;
  
  const port2 = new THREE.Mesh(portGeometry, portMaterial);
  port2.position.set(0.12, 0.0, 0.25);
  port2.rotation.x = Math.PI / 2;
  
  const mesh = new THREE.Group();
  mesh.add(chip);
  mesh.add(trace);
  mesh.add(port1);
  mesh.add(port2);
  
  mesh.userData = {
    type: 'tech-chip',
    name: 'Tech Chip',
    stackable: true,
    maxStack: 10,
    purpose: 'crafting',
  };
  return mesh;
}

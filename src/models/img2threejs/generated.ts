import * as THREE from 'three';

/**
 * Generated Tool Models from Kenny CC0 reference
 */

/**
 * Mining Drill - Primary mining tool
 */
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
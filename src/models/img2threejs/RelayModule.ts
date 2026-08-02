import * as THREE from 'three';

/**
 * Signal Relay Array Module - Win condition structure
 * Super-antenna for distress broadcasts
 */
export function createRelayModule(
  position: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
  rotation: number = 0,
  scale: number = 1
): THREE.Group {
  const relay = new THREE.Group();
  relay.position.copy(position);
  relay.rotation.y = rotation;
  relay.scale.setScalar(scale);

  // Base platform
  const platformGeometry = new THREE.CylinderGeometry(3, 3.5, 1.5, 16);
  const platformMaterial = new THREE.MeshStandardMaterial({
    color: 0x444444,
    roughness: 0.4,
    metalness: 0.9,
  });

  const platform = new THREE.Mesh(platformGeometry, platformMaterial);
  platform.position.y = -0.75;
  relay.add(platform);

  // Main housing (cylindrical)
  const housingGeometry = new THREE.CylinderGeometry(2, 2, 3, 16);
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.3,
    metalness: 0.8,
  });

  const housing = new THREE.Mesh(housingGeometry, housingMaterial);
  housing.position.y = 0.5;
  relay.add(housing);

  // Interior panels
  const panelGeometry = new THREE.BoxGeometry(4, 1.5, 0.5);
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.4,
    metalness: 0.6,
  });

  const frontPanel = new THREE.Mesh(panelGeometry, panelMaterial);
  frontPanel.position.set(0, 0.5, 2);
  relay.add(frontPanel);

  const backPanel = new THREE.Mesh(panelGeometry, panelMaterial);
  backPanel.position.set(0, 0.5, -2);
  relay.add(backPanel);

  // Signal dish (large parabolic reflector)
  const dishGeometry = new THREE.SphereGeometry(2.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const dishMaterial = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.2,
    metalness: 0.95,
    side: THREE.DoubleSide,
  });

  const dish = new THREE.Mesh(dishGeometry, dishMaterial);
  dish.position.set(0, 2.5, 0);
  dish.rotation.x = Math.PI / 2;
  relay.add(dish);

  // Dish rim
  const rimGeometry = new THREE.TorusGeometry(2.5, 0.15, 8, 32, Math.PI);
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.1,
    metalness: 1.0,
  });

  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.position.set(0, 2.5, 0);
  rim.rotation.x = Math.PI / 2;
  relay.add(rim);

  // Receiver antenna array (multiple vertical masts)
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const mastGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8);
    const mastMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.3,
      metalness: 0.8,
    });

    const mast = new THREE.Mesh(mastGeometry, mastMaterial);
    mast.position.setFromCylindricalCoords(1.8, angle, 2);
    relay.add(mast);

    // Antenna tip
    const tipGeometry = new THREE.ConeGeometry(0.15, 0.3, 8);
    const tipMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 1.0,
    });

    const tip = new THREE.Mesh(tipGeometry, tipMaterial);
    tip.position.setFromCylindricalCoords(1.8, angle, 2.65);
    tip.rotation.x = -Math.PI / 2;
    relay.add(tip);
  }

  // Signal lights (pulsing beacons)
  const lightGeometry = new THREE.SphereGeometry(0.3, 16, 16);
  const pulseLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 0.8,
    toneMapped: false,
  });

  const beacon1 = new THREE.Mesh(lightGeometry, pulseLightMaterial);
  beacon1.position.set(0, 4.5, 0);
  relay.add(beacon1);

  // Add userData for runtime pulsing
  (beacon1.userData as any).type = 'beacon';
  (beacon1.userData as any).baseIntensity = 0.8;
  (beacon1.userData as any).pulsePhase = 0;
  (beacon1.userData as any).frequency = 3; // pulses per second

  // Secondary red lights
  const beacon2 = new THREE.Mesh(lightGeometry, pulseLightMaterial.clone());
  beacon2.position.set(1, 4.5, 1);
  relay.add(beacon2);
  (beacon2.userData as any).type = 'beacon';
  (beacon2.userData as any).baseIntensity = 0.8;
  (beacon2.userData as any).pulsePhase = Math.PI / 4;

  const beacon3 = new THREE.Mesh(lightGeometry, pulseLightMaterial.clone());
  beacon3.position.set(-1, 4.5, 1);
  relay.add(beacon3);
  (beacon3.userData as any).type = 'beacon';
  (beacon3.userData as any).baseIntensity = 0.8;
  (beacon3.userData as any).pulsePhase = Math.PI / 2;

  // Power connectors
  const connectorGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.3);
  const connectorMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.6,
  });

  const powerConnector1 = new THREE.Mesh(connectorGeometry, connectorMaterial);
  powerConnector1.position.set(-2.5, 0.5, 0);
  relay.add(powerConnector1);

  const powerConnector2 = new THREE.Mesh(connectorGeometry, connectorMaterial);
  powerConnector2.position.set(2.5, 0.5, 0);
  relay.add(powerConnector2);

  // Status screen on front panel
  const screenGeometry = new THREE.PlaneGeometry(1.2, 0.8);
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
  });

  const statusScreen = new THREE.Mesh(screenGeometry, screenMaterial);
  statusScreen.position.set(0, 1.3, 2.25);
  relay.add(statusScreen);
  (statusScreen.userData as any).type = 'status-screen';

  // Relay module data
  (relay.userData as any).type = 'signalrelay';
  (relay.userData as any).health = 100;
  (relay.userData as any).maxHealth = 100;
  (relay.userData as any).isRelayActive = false;
  (relay.userData as any).broadcastTimer = 0;
  (relay.userData as any).statusMessage = 'OFFLINE';

  return relay;
}
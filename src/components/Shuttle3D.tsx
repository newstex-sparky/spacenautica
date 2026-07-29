import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

/**
 * Shuttle Pod Component
 *
 * First-person cockpit view for pilotable shuttle.
 * Free 3D flight (6DOF: pitch, yaw, roll, thrust) in the asteroid sector.
 */

// ====================== Constants ======================

const SHUTTLE_SPEED = 15;
const SHUTTLE_TURN_SPEED = 0.02;
const SHUTTLE_THRUST_POWER = 0.8;
const SHUTTLE_ROTATION_DAMPING = 0.95;

// ====================== Component ======================

interface Shuttle3DProps {
  onDock?: () => void;
  onArrive?: () => void;
  onLaunch?: () => void;
  onLand?: () => void;
  onCargoUpdate?: (cargo: any) => void;
  onFuelUpdate?: (fuel: number) => void;
  shuttlePosition?: THREE.Vector3;
  shuttleType?: 'shuttle-mk1' | 'shuttle-rescue';
}

export function Shuttle3D({
  onDock,
  onArrive,
  onLaunch,
  onLand,
  onCargoUpdate,
  onFuelUpdate,
  shuttlePosition = new THREE.Vector3(0, 0, 0),
  shuttleType = 'shuttle-mk1',
}: Shuttle3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Player state for 6DOF flight
  const [flightState, setFlightState] = useState({
    position: shuttlePosition.clone(),
    rotation: new THREE.Euler(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    throttle: 0, // 0-1, forward thrust
    up: false,
    forward: false,
    backward: false,
    left: false,
    right: false,
  });

  // Fuel state (100% max)
  const [fuel, setFuel] = useState(100);

  // Cargo state
  const [cargo, setCargo] = useState({
    iron: 0,
    ice: 0,
    rawOre: 0,
    ironMetal: 0,
    titanium: 0,
    oxygen: 0,
    h2: 0,
  });

  // HUD state
  const [hudVisible, setHudVisible] = useState(true);
  const [stationDistance, setStationDistance] = useState(999);

  // Shuttle status
  const [shuttleStatus, setShuttleStatus] = useState<'docked' | 'launching' | 'flying' | 'landed'>('docked');

  // Track if we're in autopilot mode (return trip)
  const [autopilotMode, setAutopilotMode] = useState(false);

  // Initialize shuttle scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510); // Deep space
    scene.fog = new THREE.FogExp2(0x050510, 0.008);
    sceneRef.current = scene;

    // Create camera (first-person cockpit view)
    const camera = new THREE.PerspectiveCamera(
      70,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0.7, 0); // Cockpit height
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create shuttle group
    const shuttleGroup = createShuttlePodModel(shuttleType);
    shuttleGroup.position.copy(flightState.position);
    scene.add(shuttleGroup);
    (shuttleGroup as any).shuttleCamera = camera;

    // Space background (stars)
    const starsGeometry = new THREE.BufferGeometry();
    const starsCount = 1000;
    const starsPositions = new Float32Array(starsCount * 3);

    for (let i = 0; i < starsCount * 3; i += 3) {
      starsPositions[i] = (Math.random() - 0.5) * 200;
      starsPositions[i + 1] = (Math.random() - 0.2) * 200;
      starsPositions[i + 2] = (Math.random() - 0.5) * 200;
    }

    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starsPositions, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 });
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);

    // Asteroids in shuttle range
    const asteroidGeometry = new THREE.IcosahedronGeometry(0.5, 0);
    const asteroidMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.8,
      metalness: 0.2,
    });

    const asteroids: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const asteroid = new THREE.Mesh(asteroidGeometry, asteroidMaterial);
      asteroid.position.set(
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 50
      );
      asteroid.userData.isAsteroid = true;
      scene.add(asteroid);
      asteroids.push(asteroid);
    }

    // HUD element
    const hudElement = document.createElement('div');
    hudElement.id = 'shuttle-hud';
    hudElement.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      display: ${hudVisible ? 'flex' : 'none'};
      flex-direction: column;
      justify-content: space-between;
      padding: 20px;
      z-index: 100;
      font-family: 'Courier New', monospace;
      font-size: 16px;
      color: #00ff00;
    `;
    mountRef.current.appendChild(hudElement);

    // HUD content
    const speedDisplay = document.createElement('div');
    speedDisplay.style.cssText = `
      position: absolute;
      top: 20px;
      left: 20px;
      text-shadow: 0 0 10px #00ff00;
    `;
    const fuelDisplay = document.createElement('div');
    fuelDisplay.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      text-shadow: 0 0 10px #00ff00;
    `;
    const altitudeDisplay = document.createElement('div');
    altitudeDisplay.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 20px;
      text-shadow: 0 0 10px #00ff00;
    `;
    const headingDisplay = document.createElement('div');
    headingDisplay.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      text-shadow: 0 0 10px #00ff00;
    `;
    const statusDisplay = document.createElement('div');
    statusDisplay.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      text-shadow: 0 0 10px #00ff00;
      font-size: 24px;
      font-weight: bold;
    `;
    statusDisplay.id = 'shuttle-status';

    hudElement.appendChild(speedDisplay);
    hudElement.appendChild(fuelDisplay);
    hudElement.appendChild(altitudeDisplay);
    hudElement.appendChild(headingDisplay);
    hudElement.appendChild(statusDisplay);

    // Handle input changes
    const handleInput = useCallback(() => {
      setFlightState((prev) => ({
        ...prev,
        throttle: flightState.throttle,
        up: flightState.up,
        forward: flightState.forward,
        backward: flightState.backward,
        left: flightState.left,
        right: flightState.right,
      }));
    }, [flightState]);

    // Keyboard handlers
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
      switch (event.code) {
        case 'Space':
          setFlightState((prev) => ({ ...prev, throttle: 1 }));
          break;
        case 'KeyW':
          setFlightState((prev) => ({ ...prev, forward: true }));
          break;
        case 'KeyS':
          setFlightState((prev) => ({ ...prev, backward: true }));
          break;
        case 'KeyA':
          setFlightState((prev) => ({ ...prev, left: true }));
          break;
        case 'KeyD':
          setFlightState((prev) => ({ ...prev, right: true }));
          break;
        case 'KeyE':
          setFlightState((prev) => ({ ...prev, up: true }));
          break;
        case 'KeyQ':
          setFlightState((prev) => ({ ...prev, up: false }));
          break;
        case 'KeyR':
          // Toggle autopilot return
          setAutopilotMode((prev) => !prev);
          break;
      }
    }, []);

    const handleKeyUp = useCallback((event: KeyboardEvent) => {
      switch (event.code) {
        case 'Space':
          setFlightState((prev) => ({ ...prev, throttle: 0 }));
          break;
        case 'KeyW':
          setFlightState((prev) => ({ ...prev, forward: false }));
          break;
        case 'KeyS':
          setFlightState((prev) => ({ ...prev, backward: false }));
          break;
        case 'KeyA':
          setFlightState((prev) => ({ ...prev, left: false }));
          break;
        case 'KeyD':
          setFlightState((prev) => ({ ...prev, right: false }));
          break;
      }
    }, []);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Handle docking
    const checkDocking = useCallback(
      (shuttlePos: THREE.Vector3) => {
        const stationPosition = new THREE.Vector3(0, 0, 0);
        const distance = shuttlePos.distanceTo(stationPosition);

        if (distance < 10 && !flightState.up) {
          setShuttleStatus('docked');
          if (shuttleStatus === 'flying') {
            onDock?.();
          }
        }
      },
      [onDock, flightState.up, shuttleStatus]
    );

    // Handle arrival at station
    const checkArrival = useCallback(
      (shuttlePos: THREE.Vector3) => {
        const stationPosition = new THREE.Vector3(0, 0, 0);
        const distance = shuttlePos.distanceTo(stationPosition);

        if (distance < 5 && shuttleStatus !== 'docked') {
          setShuttleStatus('landed');
          if (shuttleStatus === 'flying') {
            onArrive?.();
          }
        }
      },
      [onArrive, shuttleStatus]
    );

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      const position = flightState.position.clone();
      const rotation = flightState.rotation.clone();
      const velocity = flightState.velocity.clone();
      const angularVelocity = flightState.angularVelocity.clone();

      // Apply thrust in forward direction
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        new THREE.Quaternion().setFromEuler(rotation)
      );
      const up = new THREE.Vector3(0, 1, 0);

      if (flightState.throttle > 0) {
        velocity.add(forward.clone().multiplyScalar(SHUTTLE_THRUST_POWER * flightState.throttle * 0.01));
      }
      if (flightState.up) {
        velocity.add(up.clone().multiplyScalar(SHUTTLE_THRUST_POWER * flightState.throttle * 0.01));
      }
      if (flightState.backward) {
        velocity.sub(forward.clone().multiplyScalar(SHUTTLE_THRUST_POWER * 0.01));
      }
      if (flightState.left) {
        angularVelocity.y -= SHUTTLE_TURN_SPEED;
      }
      if (flightState.right) {
        angularVelocity.y += SHUTTLE_TURN_SPEED;
      }

      // Apply rotation with damping
      rotation.x += angularVelocity.x;
      rotation.y += angularVelocity.y;
      rotation.z += angularVelocity.z;

      angularVelocity.multiplyScalar(SHUTTLE_ROTATION_DAMPING);

      // Apply velocity with damping
      velocity.multiplyScalar(0.99);

      // Update position
      position.add(velocity);

      // Fuel consumption based on distance and throttle
      if (flightState.throttle > 0) {
        const fuelConsumption = flightState.throttle * 0.01;
        setFuel((prev) => {
          const newFuel = Math.max(0, prev - fuelConsumption);
          onFuelUpdate?.(newFuel);
          return newFuel;
        });
      }

      // Docking
      checkDocking(position);

      // Arrival
      checkArrival(position);

      // Update camera and cockpit
      const shuttleGroup = sceneRef.current?.getObjectByProperty('type', 'Group') as THREE.Group | null;
      if (shuttleGroup) {
        shuttleGroup.position.copy(position);
        shuttleGroup.rotation.copy(rotation);

        // Update shuttle camera
        const shuttleCamera = (shuttleGroup as any).shuttleCamera as THREE.PerspectiveCamera | null;
        if (shuttleCamera && cameraRef.current) {
          cameraRef.current.position.copy(position);
          cameraRef.current.quaternion.copy(shuttleGroup.quaternion);
          cameraRef.current.translateZ(1); // Place camera in front of player
        }

        // Update thrust glow
        const thrustNozzle = (shuttleGroup as any).thrustNozzle as THREE.Mesh | null;
        if (thrustNozzle) {
          thrustNozzle.material.opacity = Math.max(0, flightState.throttle * 0.8);
          const glowMesh = (shuttleGroup as any).thrustGlow as THREE.Mesh | null;
          if (glowMesh) {
            glowMesh.material.opacity = Math.max(0, flightState.throttle * 0.5);
          }
        }

        // Update shuttle rotation to match camera
        const shuttleHull = shuttleGroup.children.find(
          (child) => child instanceof THREE.Mesh && child.geometry.type === 'CylinderGeometry'
        ) as THREE.Mesh | null;

        if (shuttleHull) {
          const hullOffset = new THREE.Vector3(0.2, 0, 0);
          hullOffset.applyQuaternion(new THREE.Quaternion().setFromEuler(rotation));
          shuttleHull.position.copy(cameraRef.current?.position.clone().add(hullOffset) || position);
          shuttleHull.rotation.copy(cameraRef.current?.rotation || rotation);
        }
      }

      // Update HUD
      const speed = velocity.length() * 100;
      const stationPos = new THREE.Vector3(0, 0, 0);
      setStationDistance(position.distanceTo(stationPos));

      speedDisplay.textContent = `SPEED: ${speed.toFixed(1)} km/s`;
      fuelDisplay.textContent = `FUEL: ${fuel.toFixed(1)}%`;
      altitudeDisplay.textContent = `ALTITUDE: ${stationDistance.toFixed(1)} m`;
      headingDisplay.textContent = `HEADING: ${Math.floor(Math.atan2(forward.x, forward.z) * (180 / Math.PI))}°`;
      statusDisplay.textContent = shuttleStatus.toUpperCase();

      // Autopilot return trip
      if (autopilotMode && shuttleStatus === 'flying') {
        // Simple autopilot: fly towards station at 0,0,0
        const toStation = stationPos.clone().sub(position);
        const distance = toStation.length();

        if (distance < 20) {
          // Approach and land
          const approachDirection = toStation.clone().normalize();
          velocity.add(approachDirection.multiplyScalar(SHUTTLE_THRUST_POWER * 0.02));
          // Gradually reduce velocity for landing
          velocity.multiplyScalar(0.98);
        } else {
          // Cruise towards station
          const cruiseDirection = toStation.clone().normalize();
          velocity.add(cruiseDirection.multiplyScalar(SHUTTLE_THRUST_POWER * 0.015));
        }
      }

      renderer.render(scene, cameraRef.current!);

      // Update position callback
      onCargoUpdate?.(cargo);
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      if (mountRef.current && camera && renderer) {
        camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    // Toggle HUD with H key
    const handleHKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyH') {
        setHudVisible((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleHKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('keydown', handleHKeyDown);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mountRef.current) {
        mountRef.current.removeChild(hudElement);
        if (renderer) {
          mountRef.current.removeChild(renderer.domElement);
        }
      }
      if (renderer) {
        renderer.dispose();
      }
      if (scene) {
        scene.clear();
      }
    };
  }, [flightState, fuel, cargo, shuttleStatus, autopilotMode, onDock, onArrive, onCargoUpdate, onFuelUpdate]);

  // Expose launch function via ref
  const launchRef = useRef(() => {
    setShuttleStatus('flying');
    onLaunch?.();
  });
  const landRef = useRef(() => {
    setShuttleStatus('landed');
    onLand?.();
  });

  // Update shuttle position when prop changes
  useEffect(() => {
    setFlightState((prev) => ({ ...prev, position: shuttlePosition.clone() }));
  }, [shuttlePosition]);

  // Expose methods for external control
  useEffect(() => {
    (window as any).shuttle3D = {
      launch: launchRef.current,
      land: landRef.current,
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        zIndex: 1000,
        display: 'none',
      }}
    />
  );
}

// ====================== Helper Functions ======================

function createShuttlePodModel(shuttleType: 'shuttle-mk1' | 'shuttle-rescue'): THREE.Group {
  const group = new THREE.Group();
  group.userData.shuttleType = shuttleType;

  // Main hull (elongated teardrop shape)
  const hullGeometry = new THREE.ConeGeometry(2, 6, 8);
  hullGeometry.rotateX(Math.PI / 2);
  hullGeometry.rotateZ(Math.PI / 8);
  const hullMaterial = new THREE.MeshPhongMaterial({
    color: shuttleType === 'shuttle-mk1' ? 0x88ccff : 0xff6b6b,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const hull = new THREE.Mesh(hullGeometry, hullMaterial);
  hull.scale.set(0.6, 1, 0.6);
  group.add(hull);

  // Cockpit canopy (transparent dome)
  const canopyGeometry = new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const canopyMaterial = new THREE.MeshPhongMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.6,
    shininess: 100,
  });
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
  canopy.position.z = 1.5;
  canopy.position.y = 0.3;
  canopy.rotation.x = Math.PI / 6;
  group.add(canopy);

  // Wings
  const wingGeometry = new THREE.BoxGeometry(6, 0.1, 3);
  const wingMaterial = new THREE.MeshPhongMaterial({
    color: shuttleType === 'shuttle-mk1' ? 0x6699cc : 0xffaa55,
  });
  const wings = new THREE.Mesh(wingGeometry, wingMaterial);
  wings.position.z = -1;
  group.add(wings);

  // Engine nozzles
  const engineGeometry = new THREE.CylinderGeometry(0.3, 0.4, 1, 8);
  engineGeometry.rotateX(Math.PI / 2);
  const engineMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const leftEngine = new THREE.Mesh(engineGeometry, engineMaterial);
  leftEngine.position.set(-1.2, 0, -3);
  group.add(leftEngine);
  const rightEngine = new THREE.Mesh(engineGeometry, engineMaterial);
  rightEngine.position.set(1.2, 0, -3);
  group.add(rightEngine);

  // Thruster glow (for engine exhaust)
  const glowGeometry = new THREE.ConeGeometry(0.4, 2, 8);
  glowGeometry.rotateX(-Math.PI / 2);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0,
  });
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.position.set(0, 0, -4);
  glowMesh.scale.set(0.5, 0.5, 0.5);
  group.add(glowMesh);
  (group as any).thrustGlow = glowMesh;

  // Thruster nozzle (visible exhaust port)
  const nozzleGeometry = new THREE.CylinderGeometry(0.3, 0.4, 1, 8);
  nozzleGeometry.rotateX(Math.PI / 2);
  const nozzleMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const nozzleMesh = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
  nozzleMesh.position.set(0, 0, -3.5);
  group.add(nozzleMesh);
  (group as any).thrustNozzle = nozzleMesh;

  return group;
}

export default Shuttle3D;
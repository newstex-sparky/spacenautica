import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

// ====================== Game Constants ======================
const PLAYER_HEIGHT = 1.6;
const PLAYER_SPEED = 5;

// Shuttle pod types
type ShuttleType = 'shuttle-mk1' | 'shuttle-rescue';

interface ShuttlePod {
  type: ShuttleType;
  name: string;
  maxFuel: number;
  currentFuel: number;
  maxSpeed: number;
  minSpeed: number;
  acceleration: number;
  deceleration: number;
  maneuverability: number;
  hudColor: number;
}

const SHUTTLE_PODS: Record<ShuttleType, ShuttlePod> = {
  'shuttle-mk1': {
    type: 'shuttle-mk1',
    name: 'Shuttle MK-1',
    maxFuel: 100,
    currentFuel: 100,
    maxSpeed: 15,
    minSpeed: 5,
    acceleration: 8,
    deceleration: 4,
    maneuverability: 0.03,
    hudColor: 0x00ffff,
  },
  'shuttle-rescue': {
    type: 'shuttle-rescue',
    name: 'Rescue Shuttle',
    maxFuel: 150,
    currentFuel: 100,
    maxSpeed: 12,
    minSpeed: 4,
    acceleration: 6,
    deceleration: 3,
    maneuverability: 0.04,
    hudColor: 0xff6b6b,
  },
};

// Shuttle state (when player is in shuttle)
interface ShuttleState {
  inShuttle: boolean;
  currentShuttleType: ShuttleType;
  shuttlePosition: THREE.Vector3;
  shuttleVelocity: THREE.Vector3;
  throttle: number;
  heading: number;
  pitchAngle: number;
  isEngineOn: boolean;
  isAirbrakeOn: boolean;
}

const SHUTTLE_SPAWN_POSITION = new THREE.Vector3(0, 0, 20);
const SHUTTLE_BAY_OFFSET = new THREE.Vector3(0, 0, 4);
const SHUTTLE_BAY_MODULE_TYPE = 'shuttle-bay';

// ====================== Save/Load Callback Props ======================
export interface Shuttle3DProps {
  onGetState?: () => any;
  onRestoreState?: (state: any) => void;
  newGame?: () => void;
}

export function Shuttle3D({ onGetState, onRestoreState, newGame }: Shuttle3DProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // UI state
  const [gameState, setGameState] = useState({
    inShuttle: false,
    currentShuttleType: 'shuttle-mk1',
    throttle: 0,
    heading: 0,
    pitchAngle: 0,
    fuelPercent: 100,
    hudMessage: '',
    hudMessageTimeout: 0,
  });

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerRef = useRef<THREE.Group | null>(null);
  const shuttleGroupRef = useRef<THREE.Group | null>(null);
  const shuttleHudGroupRef = useRef<THREE.Group | null>(null);
  const shuttleThrustRef = useRef<THREE.Mesh | null>(null);

  // Shuttle state refs
  const shuttleStateRef = useRef<ShuttleState>({
    inShuttle: false,
    currentShuttleType: 'shuttle-mk1',
    shuttlePosition: SHUTTLE_SPAWN_POSITION.clone(),
    shuttleVelocity: new THREE.Vector3(0, 0, 0),
    throttle: 0,
    heading: 0,
    pitchAngle: 0,
    isEngineOn: false,
    isAirbrakeOn: false,
  });

  // Input refs
  const keysRef = useRef<Record<string, boolean>>({});
  const gameLoopRef = useRef<number | null>(null);

  // ====================== Save/Load Helpers ======================
  const buildSaveData = useCallback((): any => {
    if (!sceneRef.current || !playerRef.current || !cameraRef.current) {
      throw new Error('Cannot save: scene or camera not initialized');
    }

    const player = playerRef.current;
    const camera = cameraRef.current;
    const shuttleState = shuttleStateRef.current;

    return {
      version: '1.0.0-shuttle',
      timestamp: Date.now(),
      player: {
        position: [player.position.x, player.position.y, player.position.z],
        rotation: [player.rotation.x, player.rotation.y, player.rotation.z],
      },
      shuttle: {
        inShuttle: shuttleState.inShuttle,
        currentShuttleType: shuttleState.currentShuttleType,
        shuttlePosition: [shuttleState.shuttlePosition.x, shuttleState.shuttlePosition.y, shuttleState.shuttlePosition.z],
        shuttleVelocity: [shuttleState.shuttleVelocity.x, shuttleState.shuttleVelocity.y, shuttleState.shuttleVelocity.z],
        throttle: shuttleState.throttle,
        heading: shuttleState.heading,
        pitchAngle: shuttleState.pitchAngle,
      },
    };
  }, []);

  // Expose current state via callback
  useEffect(() => {
    if (onGetState) {
      try {
        onGetState();
      } catch (e) {
        console.error('Error in onGetState:', e);
      }
    }
  }, [onGetState]);

  // ====================== Initialize Three.js ======================
  useEffect(() => {
    if (!containerRef.current) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000011);
    scene.fog = new THREE.FogExp2(0x000011, 0.015);
    sceneRef.current = scene;

    // Create camera (first-person cockpit view)
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, PLAYER_HEIGHT, 0);
    cameraRef.current = camera;

    // Create renderer with preserveDrawingBuffer for screenshots
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    // Create starfield
    createStarfield(scene);

    // Create player (empty group for camera attachment)
    const player = new THREE.Group();
    player.position.set(0, PLAYER_HEIGHT, 0);
    playerRef.current = player;
    scene.add(player);

    // Create shuttle pod
    createShuttlePod(scene, 'shuttle-mk1');

    // Handle pointer lock
    const handlePointerLock = () => {
      containerRef.current?.requestPointerLock();
    };

    renderer.domElement.addEventListener('click', handlePointerLock);

    // Handle window resize
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Handle input
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Game loop
    const gameLoop = () => {
      updateShuttle(deltaTime);
      renderer.render(scene, camera);
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoop();

    // Cleanup
    return () => {
      renderer.domElement.removeEventListener('click', handlePointerLock);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
      renderer.dispose();
      playerRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
    };
  }, [newGame]);

  // ====================== Helper Functions ======================
  function createStarfield(scene: THREE.Scene) {
    const starsGeometry = new THREE.BufferGeometry();
    const starsCount = 2000;
    const posArray = new Float32Array(starsCount * 3);

    for (let i = 0; i < starsCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 400;
    }

    starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const starsMaterial = new THREE.PointsMaterial({
      size: 0.5,
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    const starsMesh = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starsMesh);
  }

  function createShuttlePod(scene: THREE.Scene, shuttleType: ShuttleType): THREE.Group {
    const shuttle = new THREE.Group();
    shuttle.userData.shuttleType = shuttleType;

    const shuttleInfo = SHUTTLE_PODS[shuttleType];

    // Main hull (elongated teardrop shape)
    const hullGeometry = new THREE.ConeGeometry(2, 6, 8);
    hullGeometry.rotateX(Math.PI / 2);
    hullGeometry.rotateZ(Math.PI / 8); // Slight tilt for aerodynamic look
    const hullMaterial = new THREE.MeshPhongMaterial({
      color: 0x88ccff,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    hull.scale.set(0.6, 1, 0.6); // Flatten it
    shuttle.add(hull);

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
    shuttle.add(canopy);

    // Wings
    const wingGeometry = new THREE.BoxGeometry(6, 0.1, 3);
    const wingMaterial = new THREE.MeshPhongMaterial({ color: 0x6699cc });
    const wings = new THREE.Mesh(wingGeometry, wingMaterial);
    wings.position.z = -1;
    shuttle.add(wings);

    // Engine nozzles
    const engineGeometry = new THREE.CylinderGeometry(0.3, 0.4, 1, 8);
    engineGeometry.rotateX(Math.PI / 2);
    const engineMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
    const leftEngine = new THREE.Mesh(engineGeometry, engineMaterial);
    leftEngine.position.set(-1.2, 0, -3);
    shuttle.add(leftEngine);

    const rightEngine = new THREE.Mesh(engineGeometry, engineMaterial);
    rightEngine.position.set(1.2, 0, -3);
    shuttle.add(rightEngine);

    // Shuttle HUD (holographic display)
    createShuttleHUD(shuttle, shuttleType);

    // Engine thrust particles
    const thrustGeometry = new THREE.ConeGeometry(0.3, 1, 8);
    thrustGeometry.rotateX(-Math.PI / 2);
    const thrustMaterial = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0 });
    shuttleThrustRef.current = new THREE.Mesh(thrustGeometry, thrustMaterial);
    shuttleThrustRef.current.position.set(0, 0, -3.5);
    shuttleThrustRef.current.scale.set(0.5, 0.5, 0.5);
    shuttle.add(shuttleThrustRef.current);

    scene.add(shuttle);
    return shuttle;
  }

  function createShuttleHUD(shuttle: THREE.Group, shuttleType: ShuttleType) {
    const hud = new THREE.Group();
    const shuttleInfo = SHUTTLE_PODS[shuttleType];

    // Main HUD panel (wireframe box)
    const hudGeometry = new THREE.BoxGeometry(4, 3, 0.5);
    const hudMaterial = new THREE.MeshBasicMaterial({
      color: shuttleInfo.hudColor,
      transparent: true,
      opacity: 0.1,
      wireframe: true,
    });
    const hudPanel = new THREE.Mesh(hudGeometry, hudMaterial);
    hudPanel.position.set(0, 0, 4);
    hud.add(hudPanel);

    // Speedometer arc (torus)
    const speedometerGeometry = new THREE.TorusGeometry(1, 0.1, 16, 32, Math.PI);
    const speedometerMaterial = new THREE.MeshBasicMaterial({ color: shuttleInfo.hudColor });
    const speedometer = new THREE.Mesh(speedometerGeometry, speedometerMaterial);
    speedometer.position.set(1.5, 1, 4.5);
    speedometer.rotation.z = Math.PI / 2;
    hud.add(speedometer);

    // Heading indicator (line)
    const headingGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 4.2),
      new THREE.Vector3(0, 0, 5.2),
    ]);
    const headingMaterial = new THREE.LineBasicMaterial({ color: 0xff00ff });
    const headingLine = new THREE.Line(headingGeometry, headingMaterial);
    hud.add(headingLine);

    // Thrust bar (rectangular)
    const thrustGeometry = new THREE.BoxGeometry(1.5, 0.1, 0.4);
    const thrustMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const thrustBar = new THREE.Mesh(thrustGeometry, thrustMaterial);
    thrustBar.position.set(-1.5, 0.6, 4.2);
    hud.add(thrustBar);

    hud.userData.hudElement = thrustBar;
    shuttle.add(hud);
  }

  // ====================== Update Functions ======================
  let deltaTime = 0.016;
  const camera = cameraRef.current || new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

  function updateShuttle(dt: number) {
    deltaTime = dt;
    const keys = keysRef.current;
    const shuttleState = shuttleStateRef.current;
    const shuttleInfo = SHUTTLE_PODS[shuttleState.currentShuttleType];

    if (!shuttleState.inShuttle) return;

    // Handle input
    if (keys['KeyW'] || keys['ArrowUp']) {
      shuttleState.throttle = Math.min(shuttleState.throttle + dt * shuttleInfo.acceleration, 1);
      if (shuttleThrustRef.current) {
        shuttleThrustRef.current.material.opacity = Math.min(shuttleState.throttle * 0.8, 0.8);
        shuttleThrustRef.current.scale.setScalar(0.5 + shuttleState.throttle * 0.5);
      }
    } else if (keys['KeyS'] || keys['ArrowDown']) {
      shuttleState.throttle = Math.max(shuttleState.throttle - dt * shuttleInfo.deceleration, 0);
      if (shuttleThrustRef.current) {
        shuttleThrustRef.current.material.opacity = Math.max(shuttleState.throttle * 0.5, 0);
      }
    } else {
      // Gradual throttle decay
      shuttleState.throttle = Math.max(shuttleState.throttle - dt * shuttleInfo.deceleration * 0.5, 0);
      if (shuttleThrustRef.current) {
        shuttleThrustRef.current.material.opacity = Math.max(shuttleState.throttle * 0.8, 0);
      }
    }

    if (keys['KeyA'] || keys['ArrowLeft']) {
      shuttleState.heading -= dt * shuttleInfo.maneuverability;
    }
    if (keys['KeyD'] || keys['ArrowRight']) {
      shuttleState.heading += dt * shuttleInfo.maneuverability;
    }
    if (keys['KeyQ']) {
      shuttleState.pitchAngle = Math.min(shuttleState.pitchAngle + dt * 0.02, Math.PI / 4);
    }
    if (keys['KeyE']) {
      shuttleState.pitchAngle = Math.max(shuttleState.pitchAngle - dt * 0.02, -Math.PI / 4);
    }
    if (keys['Space']) {
      shuttleState.isAirbrakeOn = true;
    } else {
      shuttleState.isAirbrakeOn = false;
    }

    // Calculate velocity based on throttle
    const targetSpeed = shuttleState.throttle * shuttleInfo.maxSpeed;
    const currentSpeed = shuttleState.shuttleVelocity.length();
    if (currentSpeed < targetSpeed) {
      shuttleState.shuttleVelocity.multiplyScalar(1 + dt * 0.1);
    } else if (currentSpeed > targetSpeed) {
      shuttleState.shuttleVelocity.multiplyScalar(1 - dt * 0.1);
    }

    // Apply airbrake
    if (shuttleState.isAirbrakeOn) {
      shuttleState.shuttleVelocity.multiplyScalar(0.95);
    }

    // Fuel consumption
    if (shuttleState.throttle > 0) {
      shuttleInfo.currentFuel = Math.max(shuttleInfo.currentFuel - dt * shuttleState.throttle * 0.5, 0);
    }

    // Update position (forward vector based on heading and pitch)
    const forward = new THREE.Vector3(
      Math.sin(shuttleState.heading),
      Math.sin(shuttleState.pitchAngle),
      Math.cos(shuttleState.heading)
    ).multiplyScalar(shuttleState.shuttleVelocity.length());

    shuttleState.shuttlePosition.add(forward.multiplyScalar(dt));

    // Auto-strafe to station center
    const toStation = new THREE.Vector3(0, 0, 0).sub(shuttleState.shuttlePosition);
    if (toStation.length() > 30) {
      const strafe = new THREE.Vector3(toStation.y, 0, -toStation.x).normalize();
      shuttleState.shuttlePosition.add(strafe.multiplyScalar(dt * 5));
    }

    // Clamp position
    shuttleState.shuttlePosition.x = Math.max(-40, Math.min(40, shuttleState.shuttlePosition.x));
    shuttleState.shuttlePosition.y = Math.max(-20, Math.min(20, shuttleState.shuttlePosition.y));
    shuttleState.shuttlePosition.z = Math.max(-20, Math.min(60, shuttleState.shuttlePosition.z));

    // Update camera position (cockpit view)
    const cameraOffset = new THREE.Vector3(0, 0.2, 0);
    camera.position.copy(shuttleState.shuttlePosition).add(cameraOffset);

    // Update camera rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = shuttleState.heading;
    camera.rotation.x = -shuttleState.pitchAngle;

    // Update state from ref
    setGameState({
      ...gameState,
      throttle: shuttleState.throttle,
      pitchAngle: shuttleState.pitchAngle,
      fuelPercent: (shuttleInfo.currentFuel / shuttleInfo.maxFuel) * 100,
      heading: (shuttleState.heading * 180 / Math.PI) % 360,
    });
  }

  // ====================== Return UI ======================
  return (
    <div className="shuttle-container" style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
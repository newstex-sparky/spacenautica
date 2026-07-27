import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SHUTTLE_PODS } from './Survival3D';

// ====================== Shuttle Controller ======================
export interface ShuttleControllerProps {
  onFlightUpdate?: (state: any) => void;
  onDocked?: (docked: boolean) => void;
  onCargoTransfer?: (cargo: any) => void;
}

export function ShuttleController({ onFlightUpdate, onDocked, onCargoTransfer }: ShuttleControllerProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // UI state
  const [gameState, setGameState] = useState({
    inShuttle: false,
    currentShuttleType: 'shuttle-mk1' as ShuttleType,
    shuttlePosition: { x: 0, y: 0, z: 20 },
    shuttleVelocity: { x: 0, y: 0, z: 0 },
    throttle: 0,
    heading: 0,
    pitchAngle: 0,
    rollAngle: 0,
    fuelPercent: 100,
    o2Percent: 100,
    isDocked: false,
    cargo: { iron: 0, ice: 0, rawOre: 0, ironMetal: 0, titanium: 0, oxygen: 0, h2: 0 },
  });

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const shuttleGroupRef = useRef<THREE.Group | null>(null);
  const shuttleHudGroupRef = useRef<THREE.Group | null>(null);
  const shuttleThrustRef = useRef<THREE.Mesh | null>(null);
  const shuttleHudThrustRef = useRef<THREE.Mesh | null>(null);

  // Shuttle state refs
  const shuttleStateRef = useRef({
    inShuttle: false,
    currentShuttleType: 'shuttle-mk1' as ShuttleType,
    shuttlePosition: new THREE.Vector3(0, 0, 20),
    shuttleVelocity: new THREE.Vector3(0, 0, 0),
    throttle: 0,
    heading: 0,
    pitchAngle: 0,
    rollAngle: 0,
    isEngineOn: false,
    isAirbrakeOn: false,
    shuttleCargo: { iron: 0, ice: 0, rawOre: 0, ironMetal: 0, titanium: 0, oxygen: 0, h2: 0 },
    maxH2: 50,
    maxO2: 50,
    isDocked: false,
    stationPosition: new THREE.Vector3(0, 0, 0),
  });

  // Input refs
  const keysRef = useRef<Record<string, boolean>>({});
  const mouseMoveRef = useRef({ x: 0, y: 0 });
  const gameLoopRef = useRef<number | null>(null);

  // ====================== Initialize ======================
  useEffect(() => {
    if (!containerRef.current) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000011);
    scene.fog = new THREE.FogExp2(0x000011, 0.015);
    sceneRef.current = scene;

    // Create camera (first-person cockpit view)
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    // Create starfield
    createStarfield(scene);

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
    const handleKeyDown = (e: KeyboardEvent) => { keysRef.current[e.code] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.code] = false; };
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
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      playerRef.current = null;
    };
  }, []);

  // ====================== Helper Functions ======================
  function createStarfield(scene: THREE.Scene) {
    const starsGeometry = new THREE.BufferGeometry();
    const starsCount = 2000;
    const posArray = new Float32Array(starsCount * 3);
    for (let i = 0; i < starsCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 400;
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const starsMaterial = new THREE.PointsMaterial({ size: 0.5, color: 0xffffff, transparent: true, opacity: 0.8 });
    const starsMesh = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starsMesh);
  }

  function createShuttlePod(scene: THREE.Scene, shuttleType: 'shuttle-mk1' | 'shuttle-rescue'): THREE.Group {
    const group = new THREE.Group();
    group.userData.shuttleType = shuttleType;
    const config = SHUTTLE_PODS[shuttleType];

    // Main hull (elongated teardrop shape)
    const hullGeometry = new THREE.ConeGeometry(2, 6, 8);
    hullGeometry.rotateX(Math.PI / 2);
    hullGeometry.rotateZ(Math.PI / 8);
    const hullMaterial = new THREE.MeshPhongMaterial({
      color: 0x88ccff, side: THREE.DoubleSide, flatShading: true,
    });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    hull.scale.set(0.6, 1, 0.6);
    group.add(hull);

    // Cockpit canopy (transparent dome)
    const canopyGeometry = new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopyMaterial = new THREE.MeshPhongMaterial({
      color: 0x00ffff, transparent: true, opacity: 0.6, shininess: 100,
    });
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.z = 1.5;
    canopy.position.y = 0.3;
    canopy.rotation.x = Math.PI / 6;
    group.add(canopy);

    // Wings
    const wingGeometry = new THREE.BoxGeometry(6, 0.1, 3);
    const wingMaterial = new THREE.MeshPhongMaterial({ color: 0x6699cc });
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

    // Shuttle HUD
    createShuttleHUD(group, shuttleType);

    // Engine thrust particles
    const thrustGeometry = new THREE.ConeGeometry(0.3, 1, 8);
    thrustGeometry.rotateX(-Math.PI / 2);
    const thrustMaterial = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0 });
    shuttleThrustRef.current = new THREE.Mesh(thrustGeometry, thrustMaterial);
    shuttleThrustRef.current.position.set(0, 0, -3.5);
    shuttleThrustRef.current.scale.set(0.5, 0.5, 0.5);
    group.add(shuttleThrustRef.current);

    scene.add(group);
    shuttleGroupRef.current = group;
    return group;
  }

  function createShuttleHUD(shuttle: THREE.Group, shuttleType: 'shuttle-mk1' | 'shuttle-rescue') {
    const hud = new THREE.Group();
    const config = SHUTTLE_PODS[shuttleType];

    // Main HUD panel (wireframe box)
    const hudGeometry = new THREE.BoxGeometry(4, 3, 0.5);
    const hudMaterial = new THREE.MeshBasicMaterial({
      color: config.hudColor, transparent: true, opacity: 0.1, wireframe: true,
    });
    const hudPanel = new THREE.Mesh(hudGeometry, hudMaterial);
    hudPanel.position.set(0, 0, 4);
    hud.add(hudPanel);

    // Speedometer arc (torus)
    const speedometerGeometry = new THREE.TorusGeometry(1, 0.1, 16, 32, Math.PI);
    const speedometerMaterial = new THREE.MeshBasicMaterial({ color: config.hudColor });
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
    shuttleHudThrustRef.current = thrustBar;

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
    const shuttle = shuttleGroupRef.current;

    if (!shuttle || !shuttleState.inShuttle) return;

    // Handle input - WASD for thrust and direction
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

    // Mouse look for yaw and pitch
    if (pointerLocked) {
      shuttleState.heading += mouseMoveRef.current.x * 0.001;
      shuttleState.pitchAngle -= mouseMoveRef.current.y * 0.001;
      shuttleState.pitchAngle = Math.max(shuttleState.pitchAngle, -Math.PI / 3);
      shuttleState.pitchAngle = Math.min(shuttleState.pitchAngle, Math.PI / 3);
      shuttleState.rollAngle = mouseMoveRef.current.x * 0.001;
    }

    // Roll control
    if (keys['KeyA']) shuttleState.rollAngle -= dt * 0.1;
    if (keys['KeyD']) shuttleState.rollAngle += dt * 0.1;
    shuttleState.rollAngle *= 0.95; // Auto-level

    // Airbrake
    shuttleState.isAirbrakeOn = keys['Space'];
    if (shuttleState.isAirbrakeOn && shuttle) {
      shuttleState.shuttleVelocity.multiplyScalar(0.98);
    }

    // Fuel consumption
    if (shuttleState.throttle > 0) {
      shuttleInfo.currentFuel = Math.max(shuttleInfo.currentFuel - dt * shuttleState.throttle * 0.5, 0);
    }

    // Clamp pitch
    shuttleState.pitchAngle = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, shuttleState.pitchAngle));

    // Auto-strafe to station center when docked
    if (shuttleState.isDocked) {
      const toStation = shuttleState.stationPosition.clone().sub(shuttleState.shuttlePosition);
      if (toStation.length() > 5) {
        const strafe = new THREE.Vector3(toStation.y, 0, -toStation.x).normalize();
        shuttleState.shuttlePosition.add(strafe.multiplyScalar(dt * 2));
      }
    } else {
      // Auto-strafe in general navigation
      const toStation = shuttleState.stationPosition.clone().sub(shuttleState.shuttlePosition);
      if (toStation.length() > 25) {
        const strafe = new THREE.Vector3(toStation.y, 0, -toStation.x).normalize();
        shuttleState.shuttlePosition.add(strafe.multiplyScalar(dt * 5));
      }
    }

    // Clamp position
    shuttleState.shuttlePosition.x = Math.max(-40, Math.min(40, shuttleState.shuttlePosition.x));
    shuttleState.shuttlePosition.y = Math.max(-20, Math.min(20, shuttleState.shuttlePosition.y));
    shuttleState.shuttlePosition.z = Math.max(-20, Math.min(60, shuttleState.shuttlePosition.z));

    // Update camera position (cockpit view)
    camera.position.copy(shuttleState.shuttlePosition);
    camera.position.y += 0.6;

    // Update camera rotation based on shuttle orientation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = shuttleState.heading - Math.PI;
    camera.rotation.x = shuttleState.pitchAngle;

    // Update shuttle mesh position
    shuttle.position.copy(shuttleState.shuttlePosition);
    shuttle.rotation.order = 'YXZ';
    shuttle.rotation.y = shuttleState.heading;
    shuttle.rotation.x = shuttleState.pitchAngle;
    shuttle.rotation.z = shuttleState.rollAngle;

    // Update HUD
    if (shuttleHudGroupRef.current) {
      shuttleHudGroupRef.current.position.copy(shuttle.position);
      shuttleHudGroupRef.current.rotation.copy(shuttle.rotation);
      if (shuttleHudThrustRef.current) {
        const thrustPercent = (shuttleThrustRef.current?.opacity || 0) / 0.8;
        shuttleHudThrustRef.current.material.color.setHSL(
          0.33 * thrustPercent, 1, 0.5 * thrustPercent
        );
      }
    }

    // Update state callback
    setGameState({
      ...gameState,
      throttle: shuttleState.throttle,
      pitchAngle: shuttleState.pitchAngle * 180 / Math.PI,
      fuelPercent: (shuttleInfo.currentFuel / shuttleInfo.maxFuel) * 100,
      o2Percent: (shuttleState.currentO2 / shuttleInfo.maxO2) * 100,
      heading: (shuttleState.heading * 180 / Math.PI) % 360,
    });

    onFlightUpdate?.({
      inShuttle: shuttleState.inShuttle,
      shuttlePosition: shuttleState.shuttlePosition.toArray(),
      shuttleVelocity: shuttleState.shuttleVelocity.toArray(),
      throttle: shuttleState.throttle,
      heading: shuttleState.heading,
      pitchAngle: shuttleState.pitchAngle,
      isDocked: shuttleState.isDocked,
      cargo: shuttleState.shuttleCargo,
    });
  }

  // Handle pointer lock changes
  useEffect(() => {
    const handlePointerLockChange = () => {
      const pointerLocked = document.pointerLockElement === containerRef.current;
      if (!pointerLocked) {
        keysRef.current = {};
      }
    };
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  // Handle mouse movement for flight control
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseMoveRef.current.x = e.movementX;
      mouseMoveRef.current.y = e.movementY;
    };
    if (pointerLocked) {
      document.addEventListener('mousemove', handleMouseMove);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
    }
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [pointerLocked]);

  // ====================== Return UI ======================
  return (
    <div className="shuttle-container" style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
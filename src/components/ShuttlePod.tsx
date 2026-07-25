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

export function ShuttlePod({ onDock, onArrive }: { onDock?: () => void; onArrive?: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Player state for 6DOF flight
  const [flightState, setFlightState] = useState({
    position: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    thrust: false,
    up: false,
    forward: false,
    backward: false,
    left: false,
    right: false,
  });

  // HUD state
  const [hudVisible, setHudVisible] = useState(true);

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

    // Create cockpit interior
    const cockpitGroup = new THREE.Group();
    cockpitGroup.position.copy(flightState.position);
    cockpitGroup.rotation.copy(flightState.rotation);
    scene.add(cockpitGroup);

    // Cockpit glass front
    const glassGeometry = new THREE.PlaneGeometry(1.2, 0.8);
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.3,
      roughness: 0.1,
      metalness: 0.9,
    });
    const glass = new THREE.Mesh(glassGeometry, glassMaterial);
    glass.position.set(0, 0.7, 0.6);
    glass.lookAt(0, 0.7, 100);
    cockpitGroup.add(glass);

    // Cockpit shell
    const shellGeometry = new THREE.CylinderGeometry(0.6, 0.7, 2, 16);
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.5,
      metalness: 0.8,
    });
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    shell.rotation.z = Math.PI / 2;
    shell.position.x = -0.5;
    cockpitGroup.add(shell);

    // Cockpit side panels
    const sideGeometry = new THREE.BoxGeometry(0.3, 0.6, 2);
    const leftSide = new THREE.Mesh(sideGeometry, shellMaterial);
    leftSide.position.set(-0.7, 0.4, 0);
    cockpitGroup.add(leftSide);

    const rightSide = new THREE.Mesh(sideGeometry, shellMaterial);
    rightSide.position.set(-0.3, 0.4, 0);
    cockpitGroup.add(rightSide);

    // Dashboard
    const dashboardGeometry = new THREE.BoxGeometry(1.5, 0.15, 0.8);
    const dashboardMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.3,
      metalness: 0.7,
    });
    const dashboard = new THREE.Mesh(dashboardGeometry, dashboardMaterial);
    dashboard.position.set(0, 1.3, 0.35);
    cockpitGroup.add(dashboard);

    // Thruster nozzles
    const nozzleGeometry = new THREE.CylinderGeometry(0.15, 0.1, 0.3, 8);
    const nozzleMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.5,
    });

    const nozzleBack = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzleBack.rotation.x = Math.PI / 2;
    nozzleBack.position.set(0.4, 0, -1);
    cockpitGroup.add(nozzleBack);

    const nozzleLeft = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzleLeft.rotation.x = Math.PI / 2;
    nozzleLeft.position.set(-0.8, 0, 0.3);
    nozzleLeft.rotation.y = Math.PI / 4;
    cockpitGroup.add(nozzleLeft);

    const nozzleRight = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzleRight.rotation.x = Math.PI / 2;
    nozzleRight.position.set(-0.8, 0, -0.3);
    nozzleRight.rotation.y = -Math.PI / 4;
    cockpitGroup.add(nozzleRight);

    // Lighting
    const cockpitLight = new THREE.PointLight(0xffffee, 1, 10);
    cockpitLight.position.set(0, 1.5, 0.5);
    cockpitGroup.add(cockpitLight);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    cockpitGroup.add(ambientLight);

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

    hudElement.appendChild(speedDisplay);
    hudElement.appendChild(fuelDisplay);
    hudElement.appendChild(altitudeDisplay);
    hudElement.appendChild(headingDisplay);

    // Handle input changes
    const handleInput = useCallback(() => {
      setFlightState((prev) => ({
        ...prev,
        thrust: flightState.thrust,
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
          setFlightState((prev) => ({ ...prev, thrust: true }));
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
      }
    }, []);

    const handleKeyUp = useCallback((event: KeyboardEvent) => {
      switch (event.code) {
        case 'Space':
          setFlightState((prev) => ({ ...prev, thrust: false }));
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

        if (distance < 10) {
          onDock?.();
        }
      },
      [onDock]
    );

    // Handle arrival at station
    const checkArrival = useCallback(
      (shuttlePos: THREE.Vector3) => {
        const stationPosition = new THREE.Vector3(0, 0, 0);
        const distance = shuttlePos.distanceTo(stationPosition);

        if (distance < 5) {
          onArrive?.();
        }
      },
      [onArrive]
    );

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      const position = flightState.position.clone();
      const rotation = flightState.rotation.clone();
      const velocity = flightState.velocity.clone();
      const angularVelocity = flightState.angularVelocity.clone();

      // Apply thrust
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        new THREE.Quaternion().setFromEuler(rotation)
      );
      const up = new THREE.Vector3(0, 1, 0);

      if (flightState.thrust) {
        velocity.add(forward.multiplyScalar(SHUTTLE_THRUST_POWER * 0.01));
      }
      if (flightState.up) {
        velocity.add(up.multiplyScalar(SHUTTLE_THRUST_POWER * 0.01));
      }
      if (flightState.backward) {
        velocity.sub(forward.multiplyScalar(SHUTTLE_THRUST_POWER * 0.01));
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

      // Collision with station
      checkDocking(position);

      // Update camera and cockpit
      cockpitGroup.position.copy(position);
      cockpitGroup.rotation.copy(rotation);
      camera.position.copy(position);

      // Update shuttle group rotation to match camera
      const shuttleGroup = scene.getObjectByProperty('type', 'Group');
      if (shuttleGroup) {
        // Shuttle hull attached to cockpit
        const hull = shuttleGroup.children.find(
          (child) => child instanceof THREE.Mesh && child.geometry.type === 'CylinderGeometry'
        ) as THREE.Mesh;

        if (hull) {
          // Offset hull from camera
          const hullOffset = new THREE.Vector3(0.2, 0, 0);
          hullOffset.applyQuaternion(new THREE.Quaternion().setFromEuler(rotation));
          hull.position.copy(camera.position).add(hullOffset);
          hull.rotation.copy(camera.rotation);

          // Rotate nozzles opposite to thrust
          const nozzle = shuttleGroup.children.find(
            (child) =>
              child instanceof THREE.Mesh &&
              child.geometry.type === 'CylinderGeometry' &&
              child.position.z < 0
          ) as THREE.Mesh;

          if (nozzle && flightState.thrust) {
            nozzle.rotation.z += 0.1;
          }
        }
      }

      // Update HUD
      const speed = velocity.length() * 100;
      const stationDistance = position.distanceTo(new THREE.Vector3(0, 0, 0));

      speedDisplay.textContent = `SPEED: ${speed.toFixed(1)} km/s`;
      fuelDisplay.textContent = `H2 FUEL: ${Math.random() * 100 + 50}%`;
      altitudeDisplay.textContent = `ALTITUDE: ${stationDistance.toFixed(1)} m`;
      headingDisplay.textContent = `HEADING: ${Math.floor(Math.atan2(forward.x, forward.z) * (180 / Math.PI))}°`;

      // Check arrival
      checkArrival(position);

      renderer.render(scene, camera);
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
  }, [flightState, onDock, onArrive]);

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

export default ShuttlePod;
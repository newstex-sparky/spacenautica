import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

// Game constants
const PLAYER_HEIGHT = 1.6;
const PLAYER_SPEED = 5;
const BULLET_SPEED = 15;
const DRONE_SPEED_BASE = 3;
const MINING_LASER_SPEED = 30;
const DRONE_SPAWN_INTERVAL = 5000;
const PARTICLE_LIFETIME = 1;
const SCREEN_SHAKE_INTENSITY = 0.1;

// Drone types
type DroneType = 'salvager' | 'saboteur' | 'hunter';

interface Drone {
  mesh: THREE.Group;
  type: DroneType;
  health: number;
  speed: number;
  damage: number;
  isDead: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

interface GameState {
  score: number;
  wave: number;
  droneType: DroneType;
  isPaused: boolean;
  gameOver: boolean;
}

export function Survival3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    wave: 1,
    droneType: 'salvager',
    isPaused: false,
    gameOver: false,
  });
  const [uiHealth, setUiHealth] = useState(100);
  const [uiScore, setUiScore] = useState(0);
  const [uiWave, setUiWave] = useState(1);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerRef = useRef<THREE.Group | null>(null);
  const bulletsRef = useRef<THREE.Mesh[]>([]);
  const dronesRef = useRef<Drone[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const miningLaserRef = useRef<THREE.Mesh | null>(null);

  // Input refs
  const keysRef = useRef<Record<string, boolean>>({});
  const mouseRef = useRef<Record<string, number>>({ x: 0, y: 0 });
  const gameLoopRef = useRef<number | null>(null);
  const screenShakeRef = useRef(0);

  // Initialize Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 10, 50);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, PLAYER_HEIGHT, 5);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Create starfield
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      starPositions[i] = (Math.random() - 0.5) * 200;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Create floor grid
    const gridHelper = new THREE.GridHelper(100, 50, 0x00ffff, 0x001133);
    scene.add(gridHelper);

    // Create player
    const player = new THREE.Group();
    player.position.y = PLAYER_HEIGHT;
    scene.add(player);
    playerRef.current = player;

    // Player helmet
    const helmetGeometry = new THREE.CapsuleGeometry(0.4, 1, 8, 16);
    const helmetMaterial = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      metalness: 0.8,
      roughness: 0.2,
    });
    const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
    helmet.castShadow = true;
    player.add(helmet);

    // Player visor
    const visorGeometry = new THREE.BoxGeometry(0.5, 0.25, 0.4);
    const visorMaterial = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      metalness: 0.9,
      roughness: 0.1,
    });
    const visor = new THREE.Mesh(visorGeometry, visorMaterial);
    visor.position.set(0, 0.1, 0.6);
    player.add(visor);

    // Mining laser
    const laserGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.5);
    const laserMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const miningLaser = new THREE.Mesh(laserGeometry, laserMaterial);
    miningLaser.position.set(0, 0.25, 0);
    player.add(miningLaser);
    miningLaserRef.current = miningLaser;

    // Create shield
    const shieldGeometry = new THREE.SphereGeometry(0.8, 16, 16);
    const shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3,
      wireframe: true,
    });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shield.position.y = PLAYER_HEIGHT;
    player.add(shield);

    // Resize handler
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Input handlers
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current[e.code] = true;
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current[e.code] = false;
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    const handleClick = (e: MouseEvent) => {
      if (e.button === 0 && !gameState.gameOver && !gameState.isPaused) {
        shoot();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleClick);

    // Start game loop
    startGameLoop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('resize', handleResize);

      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }

      // Cleanup Three.js
      scene.clear();
      renderer.dispose();
      bulletsRef.current.forEach(b => b.geometry.dispose());
      dronesRef.current.forEach(d => d.mesh.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      }));
      particlesRef.current.forEach(p => {
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      });
    };
  }, [gameState.gameOver, gameState.isPaused]);

  // Drone spawner
  useEffect(() => {
    if (gameState.gameOver || gameState.isPaused) return;

    const spawnDrone = () => {
      if (dronesRef.current.length >= 10) return;

      const scene = sceneRef.current;
      if (!scene || !cameraRef.current) return;

      // Random spawn position away from player
      const angle = Math.random() * Math.PI * 2;
      const distance = 15 + Math.random() * 15;
      const spawnPosition = new THREE.Vector3(
        Math.cos(angle) * distance,
        PLAYER_HEIGHT,
        Math.sin(angle) * distance
      );

      // Create drone mesh
      const droneMesh = new THREE.Group();
      droneMesh.position.copy(spawnPosition);

      // Drone body
      const bodyGeometry = new THREE.ConeGeometry(0.3, 1, 8);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        metalness: 0.7,
        roughness: 0.3,
      });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.rotation.x = Math.PI / 2;
      droneMesh.add(body);

      // Drone rotor rings
      for (let i = 0; i < 4; i++) {
        const ringGeometry = new THREE.TorusGeometry(0.6, 0.05, 8, 16);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = i * Math.PI / 2;
        droneMesh.add(ring);
      }

      scene.add(droneMesh);

      // Drone type stats
      const type = getDroneType();
      const drone: Drone = {
        mesh: droneMesh,
        type,
        health: 100,
        speed: DRONE_SPEED_BASE + getSpeedMultiplier(),
        damage: type === 'hunter' ? 15 : type === 'saboteur' ? 10 : 5,
        isDead: false,
      };

      dronesRef.current.push(drone);

      // Auto-spawn next drone
      setTimeout(spawnDrone, DRONE_SPAWN_INTERVAL / getWaveMultiplier());
    };

    spawnDrone();
  }, [gameState.gameOver, gameState.isPaused]);

  // Game loop
  const startGameLoop = useCallback(() => {
    const loop = (timestamp: number) => {
      if (!gameState.isPaused) {
        updateGame(timestamp);
      }

      if (!gameState.gameOver) {
        gameLoopRef.current = requestAnimationFrame(loop);
      }
    };
    gameLoopRef.current = requestAnimationFrame(loop);
  }, [gameState.isPaused, gameState.gameOver]);

  const updateGame = (timestamp: number) => {
    if (!sceneRef.current || !cameraRef.current || !playerRef.current) return;

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const player = playerRef.current;

    // Screen shake decay
    if (screenShakeRef.current > 0) {
      screenShakeRef.current *= 0.9;
      if (screenShakeRef.current < 0.001) screenShakeRef.current = 0;
    }

    // Screen shake offset
    camera.position.x += (Math.random() - 0.5) * screenShakeRef.current * 10;
    camera.position.y = PLAYER_HEIGHT + (Math.random() - 0.5) * screenShakeRef.current * 5;
    camera.position.z += (Math.random() - 0.5) * screenShakeRef.current * 5;
    camera.lookAt(player.position);

    // Player movement
    const moveDirection = new THREE.Vector3();
    if (keysRef.current['KeyW']) moveDirection.z -= 1;
    if (keysRef.current['KeyS']) moveDirection.z += 1;
    if (keysRef.current['KeyA']) moveDirection.x -= 1;
    if (keysRef.current['KeyD']) moveDirection.x += 1;

    if (moveDirection.length() > 0) {
      moveDirection.normalize().multiplyScalar(PLAYER_SPEED * 0.016);
      player.position.add(moveDirection);

      // Keep player on grid (smooth movement)
      player.position.x = Math.round(player.position.x);
      player.position.z = Math.round(player.position.z);
    }

    // Rotation based on movement and mouse
    if (moveDirection.length() > 0) {
      player.rotation.y = Math.atan2(moveDirection.x, moveDirection.z);
    } else if (keysRef.current['ArrowUp']) {
      player.rotation.y -= 0.02;
    } else if (keysRef.current['ArrowDown']) {
      player.rotation.y += 0.02;
    } else if (keysRef.current['ArrowLeft']) {
      player.rotation.x += 0.02;
    } else if (keysRef.current['ArrowRight']) {
      player.rotation.x -= 0.02;
    }

    // Clamp rotation
    player.rotation.x = Math.max(-0.5, Math.min(0.5, player.rotation.x));

    // Camera follows player with smooth lag
    const targetCameraPos = player.position.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT, 5));
    camera.position.lerp(targetCameraPos, 0.1);
    camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 0, -5)));

    // Update mining laser direction
    if (miningLaserRef.current) {
      miningLaserRef.current.rotation.x = -Math.PI / 2 + player.rotation.x;
      miningLaserRef.current.rotation.z = -player.rotation.y;
    }

    // Update bullets
    updateBullets();

    // Update drones
    updateDrones();

    // Update particles
    updateParticles();

    // Update UI
    setUiHealth(Math.max(0, uiHealth));
    setUiScore(uiScore);
    setUiWave(uiWave);
  };

  const getDroneType = (): DroneType => {
    const rand = Math.random();
    const wave = gameState.wave;
    if (wave >= 4 && rand < 0.25) return 'saboteur';
    if (wave >= 3 && rand < 0.5) return 'hunter';
    return 'salvager';
  };

  const getSpeedMultiplier = (): number => {
    return 1 + (gameState.wave - 1) * 0.15;
  };

  const getWaveMultiplier = (): number => {
    return Math.max(1, gameState.wave * 0.1);
  };

  const shoot = () => {
    const scene = sceneRef.current;
    if (!scene || !playerRef.current || !cameraRef.current) return;

    const direction = new THREE.Vector3();
    direction.subVectors(
      camera.position.clone(),
      playerRef.current.position.clone()
    );
    direction.y = 0;
    direction.normalize();

    const bulletGeometry = new THREE.SphereGeometry(0.1);
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    bullet.position.copy(playerRef.current.position);
    bullet.position.y = PLAYER_HEIGHT;

    bullet.userData = {
      velocity: direction.clone().multiplyScalar(BULLET_SPEED),
    };

    scene.add(bullet);
    bulletsRef.current.push(bullet);

    // Trigger screen shake
    screenShakeRef.current = SCREEN_SHAKE_INTENSITY;
  };

  const updateBullets = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    bulletsRef.current = bulletsRef.current.filter(bullet => {
      const moveStep = bullet.userData.velocity.clone().multiplyScalar(0.016);
      bullet.position.add(moveStep);

      // Check collision with drones
      let hit = false;
      for (let i = dronesRef.current.length - 1; i >= 0; i--) {
        const drone = dronesRef.current[i];
        if (drone.isDead) continue;

        const distance = bullet.position.distanceTo(drone.mesh.position);
        if (distance < 1) {
          // Hit drone
          drone.health -= 25;
          hit = true;

          // Create hit particles
          createParticles(drone.mesh.position.clone(), 5, 0xff6600);

          if (drone.health <= 0) {
            drone.isDead = true;
            createParticles(drone.mesh.position.clone(), 15, 0xff0000);

            // Update score
            const points = drone.type === 'hunter' ? 50 : drone.type === 'saboteur' ? 30 : 20;
            setUiScore(prev => prev + points);

            // Increase wave on kill (simple wave system)
            if (uiScore > gameState.wave * 100) {
              setGameState(prev => ({ ...prev, wave: prev.wave + 1 }));
            }
          }

          break;
        }
      }

      // Remove bullet if too far or hit
      if (bullet.position.length() > 50 || hit) {
        scene.remove(bullet);
        bulletGeometry.dispose(); // Note: reuse geometry instead
        return false;
      }

      return true;
    });
  };

  const updateDrones = () => {
    const scene = sceneRef.current;
    if (!scene || !playerRef.current) return;

    dronesRef.current = dronesRef.current.filter(drone => {
      if (drone.isDead) {
        scene.remove(drone.mesh);
        return false;
      }

      // Chase player
      const chaseDirection = new THREE.Vector3()
        .subVectors(playerRef.current!.position, drone.mesh.position)
        .normalize()
        .multiplyScalar(drone.speed * 0.016);
      drone.mesh.position.add(chaseDirection);

      // Rotate towards player
      drone.mesh.lookAt(playerRef.current.position);
      drone.mesh.rotation.x = Math.max(-0.2, Math.min(0.2, drone.mesh.rotation.x));

      // Player shield defense
      const distanceToPlayer = drone.mesh.position.distanceTo(playerRef.current.position);
      if (distanceToPlayer < 0.8) {
        // Shield deflect
        const deflectDirection = chaseDirection.clone().negate().normalize();
        drone.mesh.position.add(deflectDirection.multiplyScalar(2));

        // Shield visual feedback
        screenShakeRef.current = SCREEN_SHAKE_INTENSITY * 0.5;
      }

      // Player hit (shield broke or too close)
      if (distanceToPlayer < 1.5) {
        if (uiHealth > 0) {
          setUiHealth(prev => Math.max(0, prev - drone.damage));
          screenShakeRef.current = SCREEN_SHAKE_INTENSITY;
          createParticles(playerRef.current.position.clone(), 10, 0x00ffff);

          if (uiHealth <= 0) {
            setGameState(prev => ({
              ...prev,
              gameOver: true,
              isPaused: true,
            }));
          }
        }
      }

      return true;
    });
  };

  const createParticles = (position: THREE.Vector3, count: number, color: number) => {
    const scene = sceneRef.current;
    if (!scene) return;

    const particleGeometry = new THREE.SphereGeometry(0.05);
    const particleMaterial = new THREE.MeshBasicMaterial({ color });

    for (let i = 0; i < count; i++) {
      const particle = new THREE.Mesh(particleGeometry, particleMaterial);
      particle.position.copy(position);

      particle.userData = {
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          Math.random() * 5,
          (Math.random() - 0.5) * 5
        ),
        life: PARTICLE_LIFETIME,
      };

      scene.add(particle);
      particlesRef.current.push(particle);
    }
  };

  const updateParticles = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    particlesRef.current = particlesRef.current.filter(particle => {
      const moveStep = particle.userData.velocity.clone().multiplyScalar(0.016);
      particle.position.add(moveStep);

      particle.userData.velocity.y -= 0.1; // Gravity
      particle.userData.life -= 0.016;

      if (particle.userData.life <= 0) {
        scene.remove(particle);
        particle.geometry.dispose();
        (particle.material as THREE.Material).dispose();
        return false;
      }

      return true;
    });
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100vh', position: 'relative' }}>
      {/* Health bar */}
      <div style={styles.healthBarContainer}>
        <div style={styles.healthBar}>
          <div
            style={{
              ...styles.healthFill,
              width: `${uiHealth}%`,
              backgroundColor: uiHealth > 30 ? '#00ff00' : '#ff0000',
            }}
          />
        </div>
      </div>

      {/* Score and wave */}
      <div style={styles.scorePanel}>
        <div>SCORE: {uiScore}</div>
        <div>WAVE: {uiWave}</div>
        <div>DRONES: {dronesRef.current.length}</div>
      </div>

      {/* Game over overlay */}
      {gameState.gameOver && (
        <div style={styles.gameOverOverlay}>
          <h1 style={styles.gameOverTitle}>WAVE SURVIVED</h1>
          <p style={styles.gameOverScore}>Final Score: {uiScore}</p>
          <p style={styles.gameOverWave}>Wave Reached: {uiWave}</p>
          <button
            onClick={() => {
              setGameState({
                score: 0,
                wave: 1,
                droneType: 'salvager',
                isPaused: false,
                gameOver: false,
              });
              setUiHealth(100);
              setUiScore(0);
              setUiWave(1);
            }}
            style={styles.restartButton}
          >
            CONTINUE TO NEXT WAVE
          </button>
        </div>
      )}

      {/* Pause overlay */}
      {gameState.isPaused && !gameState.gameOver && (
        <div style={styles.gameOverOverlay}>
          <h1>PAUSED</h1>
          <p>Press ESC to continue</p>
        </div>
      )}

      {/* Mobile pause button */}
      <button
        onClick={() =>
          setGameState(prev => ({ ...prev, isPaused: !prev.isPaused }))
        }
        style={styles.pauseButton}
      >
        PAUSE
      </button>
    </div>
  );
}

const styles = {
  healthBarContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 200,
    height: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 10,
    padding: 5,
    border: '2px solid #00ffff',
  },
  healthBar: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  healthFill: {
    height: '100%',
    transition: 'width 0.1s ease',
  },
  scorePanel: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 15,
    borderRadius: 10,
    border: '2px solid #00ff00',
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: 16,
    textAlign: 'right',
  },
  gameOverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#00ffff',
    fontFamily: 'monospace',
  },
  gameOverTitle: {
    fontSize: 48,
    textShadow: '0 0 10px #00ffff',
    marginBottom: 20,
  },
  gameOverScore: {
    fontSize: 24,
    marginBottom: 10,
  },
  gameOverWave: {
    fontSize: 20,
    marginBottom: 30,
  },
  restartButton: {
    padding: '15px 40px',
    fontSize: 18,
    backgroundColor: 'rgba(0, 255, 0, 0.2)',
    border: '2px solid #00ff00',
    color: '#00ff00',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  pauseButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    padding: '10px 20px',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    border: '2px solid #ffff00',
    color: '#ffff00',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'monospace',
    zIndex: 100,
  },
};
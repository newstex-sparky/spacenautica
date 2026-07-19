import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

// ====================== Game Constants ======================
const PLAYER_HEIGHT = 1.6;
const PLAYER_SPEED = 5;

// Oxygen survival
const O2_MAX = 100;
const O2_DEPLETION_PER_SEC = 1;       // 1 O2 per second
const O2_REFILL_CRYSTAL = 25;          // mining an oxygen crystal refills +25

// Asteroid mining
const ASTEROID_COUNT = 40;             // 30-50 asteroids in world
const MINE_RANGE = 5;                  // mine within 5 units
const MINE_RATE_PER_SEC = 0.5;         // asteroid shrinks 0.5/sec while held
const ASTEROID_RESPAWN_DELAY = 10;     // seconds before respawn after fully mined
const WORLD_RADIUS = 45;               // asteroid spawn radius around origin

// Build mode
const BUILD_RANGE = 8;                 // raycast floor within 8 units

// Asteroid types
type AsteroidType = 'iron' | 'ice' | 'oxygen';

interface AsteroidTypeInfo {
  name: string;
  color: number;
  yieldAmount: number; // resources per full mine
}

const ASTEROID_TYPES: Record<AsteroidType, AsteroidTypeInfo> = {
  iron:   { name: 'Iron Ore',         color: 0x888888, yieldAmount: 5 },
  ice:    { name: 'Ice',               color: 0x00aaff, yieldAmount: 5 },
  oxygen: { name: 'Oxygen Crystal',    color: 0x00ff88, yieldAmount: 1 }, // oxygen type refills O2 directly
};

// Buildable structures
type BuildType = 'dome' | 'solar' | 'o2generator' | 'smelter';

interface BuildTypeInfo {
  name: string;
  costIron: number;
  costIce: number;
  costRawOre: number;
  hotkey: string;
}

const BUILD_TYPES: Record<BuildType, BuildTypeInfo> = {
  dome:        { name: 'Habitat Dome',  costIron: 10, costIce: 0, costRawOre: 0, hotkey: '1' },
  solar:       { name: 'Solar Panel',   costIron: 5,  costIce: 0, costRawOre: 0, hotkey: '2' },
  o2generator: { name: 'O2 Generator',  costIron: 0,  costIce: 10, costRawOre: 0, hotkey: '3' },
  smelter:     { name: 'Smelter',       costIron: 0,  costIce: 0, costRawOre: 10, hotkey: '4' },
};

// Smelting constants
const SMELTER_PROCESS_RATE = 1 / 3; // 1/3 ore processed per tick (1 per 3 seconds)
const SMELTER_ORE_TO_METAL = 1; // 1 raw ore produces 0.8 iron + 0.2 titanium
const SMELTER_H2_CONSUMPTION = 1 / 5; // 1 H2 consumed per 5 ore processed
const SMELTER_DEPOSIT_RANGE = 4; // Distance to deposit ore
const SMELTER_DEPOSIT_KEY = 'KeyF'; // Deposit key

// Asteroid runtime object
interface Asteroid {
  mesh: THREE.Mesh;
  type: AsteroidType;
  baseScale: number;
  currentScale: number;   // shrinks from 1 → 0 as mined
  respawnTimer: number;   // seconds remaining until respawn (0 = active)
  isMined: boolean;
  basePosition: THREE.Vector3;
}

// Built structure runtime object
interface BuiltStructure {
  group: THREE.Group;
  type: BuildType;
  inventory: { rawOre: number }; // smelter internal inventory
  isProcessing: boolean;
  processingProgress: number; // 0-1, increments per processing tick
  lastProcessTime: number;
}

// Particle for mining puffs
interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

// ====================== Game State ======================
interface GameState {
  isPaused: boolean;
  gameOver: boolean;
  buildMode: boolean;
  buildType: BuildType;
}

const INITIAL_GAME_STATE: GameState = {
  isPaused: false,
  gameOver: false,
  buildMode: false,
  buildType: 'dome',
};

export function Survival3D() {
  const containerRef = useRef<HTMLDivElement>(null);

  // UI state
  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [uiO2, setUiO2] = useState(O2_MAX);
  const [uiIron, setUiIron] = useState(0);
  const [uiIce, setUiIce] = useState(0);
  const [uiOxygen, setUiOxygen] = useState(0); // oxygen resource count (separate from survival O2)
  const [uiRawOre, setUiRawOre] = useState(0); // raw ore (for smelter)
  const [uiH2, setUiH2] = useState(0); // H2 fuel
  const [uiIronMetal, setUiIronMetal] = useState(0); // smelter output
  const [uiTitaniumMetal, setUiTitaniumMetal] = useState(0); // smelter output
  const [uiHoveredAsteroid, setUiHoveredAsteroid] = useState<string>('');
  const [uiMiningProgress, setUiMiningProgress] = useState(0);
  const [uiBuildMode, setUiBuildMode] = useState(false);
  const [uiBuildType, setUiBuildType] = useState<BuildType>('dome');
  const [uiCompassHeading, setUiCompassHeading] = useState('E');
  const [uiSmelterStatus, setUiSmelterStatus] = useState<string>(''); // hovered smelter status

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerRef = useRef<THREE.Group | null>(null);

  // Game-world refs (mutated by loop, not React state)
  const asteroidsRef = useRef<Asteroid[]>([]);
  const structuresRef = useRef<BuiltStructure[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const miningBeamRef = useRef<THREE.Mesh | null>(null);    // laser beam visual while mining
  const miningRingRef = useRef<THREE.Mesh | null>(null);     // progress ring around mined asteroid
  const buildPreviewRef = useRef<THREE.Group | null>(null); // holographic build preview

  // Resource refs (mirrored to UI state)
  const resourcesRef = useRef({ iron: 0, ice: 0, oxygen: 0, rawOre: 0, h2: 0, ironMetal: 0, titanium: 0 });
  const o2Ref = useRef(O2_MAX);
  const buildModeRef = useRef(false);
  const buildTypeRef = useRef<BuildType>('dome');
  const mouseDownRef = useRef(false);
  const gameOverRef = useRef(false);

  // Input refs
  const keysRef = useRef<Record<string, boolean>>({});
  const yawRef = useRef(0);    // horizontal look angle (radians) — kept from original
  const pitchRef = useRef(0);  // vertical look angle (radians)   — kept from original
  const gameLoopRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // ====================== Build helpers ======================
  const randomAsteroidType = (): AsteroidType => {
    const r = Math.random();
    if (r < 0.45) return 'iron';
    if (r < 0.80) return 'ice';
    return 'oxygen';
  };

  const randomAsteroidPosition = (): THREE.Vector3 => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * (WORLD_RADIUS - 6);
    const y = 0.5 + Math.random() * 6; // float above floor
    return new THREE.Vector3(Math.cos(angle) * dist, y, Math.sin(angle) * dist);
  };

  const createAsteroidMesh = (type: AsteroidType, baseScale: number): THREE.Mesh => {
    const info = ASTEROID_TYPES[type];
    // Irregular rocky mesh using IcosahedronGeometry with noise
    const geometry = new THREE.IcosahedronGeometry(baseScale, 1);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i);
      // Add noise to each vertex for irregular rocky shape
      const noise = 0.7 + Math.random() * 0.5;
      v.multiplyScalar(noise);
      positions.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: info.color,
      metalness: type === 'iron' ? 0.8 : 0.3,
      roughness: type === 'iron' ? 0.4 : 0.6,
      emissive: type === 'oxygen' ? info.color : 0x000000,
      emissiveIntensity: type === 'oxygen' ? 0.4 : 0,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;

    // Add surface veins: thin transparent mesh with same geometry, slight offset
    const surfaceGeo = new THREE.IcosahedronGeometry(baseScale * 1.02, 1);
    const surfacePos = surfaceGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < surfacePos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(surfacePos, i);
      // Slight outward offset for surface layer
      v.normalize().multiplyScalar(1.02);
      surfacePos.setXYZ(i, v.x, v.y, v.z);
    }

    const surfaceMat = new THREE.MeshBasicMaterial({
      color: info.color,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
    surfaceMesh.position.y = mesh.position.y; // same position
    surfaceMesh.userData = { isSurface: true, type };
    mesh.add(surfaceMesh);

    mesh.userData = { isAsteroid: true, type };
    return mesh;
  };

  const spawnAsteroid = (): Asteroid => {
    const type = randomAsteroidType();
    const baseScale = 0.4 + Math.random() * 0.5;
    const mesh = createAsteroidMesh(type, baseScale);
    const pos = randomAsteroidPosition();
    mesh.position.copy(pos);
    // Random rotation for variety
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    sceneRef.current?.add(mesh);
    return {
      mesh,
      type,
      baseScale,
      currentScale: 1,
      respawnTimer: 0,
      isMined: false,
      basePosition: pos.clone(),
    };
  };

  // Deposit ore to smelter (called on F key press)
  const depositOre = (): boolean => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return false;

    // Find all smelters
    const smelters = structuresRef.current.filter(s => s.type === 'smelter');
    if (smelters.length === 0) return false;

    // Check if any smelter is within range (SMELTER_DEPOSIT_RANGE)
    let nearbySmelter = null;
    for (const smelter of smelters) {
      const dist = smelter.group.position.distanceTo(camera.position);
      if (dist <= SMELTER_DEPOSIT_RANGE) {
        nearbySmelter = smelter;
        break;
      }
    }

    if (!nearbySmelter) return false;

    // Check if player has raw ore
    if (resourcesRef.current.rawOre < 1) return false;

    // Deduct raw ore and add to smelter inventory
    resourcesRef.current.rawOre -= 1;
    setUiRawOre(resourcesRef.current.rawOre);
    nearbySmelter.inventory.rawOre += 1;

    // Create deposit particles at smelter intake
    createParticles(nearbySmelter.group.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 5, 0x888888);

    return true;
  };

  const respawnAsteroid = (asteroid: Asteroid) => {
    // Move to new random location and reset
    const pos = randomAsteroidPosition();
    asteroid.mesh.position.copy(pos);
    asteroid.basePosition.copy(pos);
    asteroid.currentScale = 1;
    asteroid.isMined = false;
    asteroid.respawnTimer = 0;
    asteroid.mesh.visible = true;
    asteroid.mesh.scale.set(1, 1, 1);
    asteroid.mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
  };

  // ====================== Build structure meshes ======================
  const createDomeMesh = (): THREE.Group => {
    const group = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(2, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff66,
      metalness: 0.2,
      roughness: 0.3,
      transparent: true,
      opacity: 0.55,
      wireframe: false,
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.position.y = 2;
    // Wireframe overlay for geodesic look
    const wireGeo = new THREE.WireframeGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    wire.position.y = 2;
    group.add(dome);
    group.add(wire);
    return group;
  };

  const createSolarPanelMesh = (): THREE.Group => {
    const group = new THREE.Group();
    // Stand
    const standGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.5, 8);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8, roughness: 0.4 });
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.position.y = 0.75;
    group.add(stand);
    // Panel (blue glass top)
    const panelGeo = new THREE.BoxGeometry(1.8, 0.1, 1.2);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      metalness: 0.6,
      roughness: 0.1,
      transparent: true,
      opacity: 0.8,
      emissive: 0x0033aa,
      emissiveIntensity: 0.3,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.y = 1.5;
    panel.rotation.z = -0.3; // tilt toward "sun"
    group.add(panel);
    // Grid lines on panel
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00aaff });
    for (let i = -2; i <= 2; i++) {
      const pts = [new THREE.Vector3(i * 0.4, 0.06, -0.6), new THREE.Vector3(i * 0.4, 0.06, 0.6)];
      const lg = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(lg, lineMat));
    }
    return group;
  };

  const createO2GeneratorMesh = (): THREE.Group => {
    const group = new THREE.Group();
    // Cylinder body
    const bodyGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.5, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      metalness: 0.7,
      roughness: 0.3,
      transparent: true,
      opacity: 0.7,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.25;
    group.add(body);
    // Glowing top
    const topGeo = new THREE.SphereGeometry(0.7, 16, 12);
    const topMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.7,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 2.6;
    group.add(top);
    // Glow point light
    const light = new THREE.PointLight(0x00ffff, 1, 6);
    light.position.y = 2.6;
    group.add(light);
    return group;
  };

  const createSmelterMesh = (): THREE.Group => {
    const group = new THREE.Group();
    // Main chamber (cylinder)
    const chamberGeo = new THREE.CylinderGeometry(1.2, 1.2, 2.5, 12);
    const chamberMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      metalness: 0.9,
      roughness: 0.3,
    });
    const chamber = new THREE.Mesh(chamberGeo, chamberMat);
    chamber.position.y = 1.25;
    group.add(chamber);
    // Glowing interior (visible when processing)
    const interiorGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.3, 12);
    const interiorMat = new THREE.MeshBasicMaterial({
      color: 0xff6600, // orange
      transparent: true,
      opacity: 0,
    });
    const interior = new THREE.Mesh(interiorGeo, interiorMat);
    interior.position.y = 1.25;
    group.add(interior);
    // Intake funnel at bottom
    const funnelGeo = new THREE.ConeGeometry(0.8, 0.6, 16, 1, true);
    const funnelMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      metalness: 0.8,
      roughness: 0.4,
    });
    const funnel = new THREE.Mesh(funnelGeo, funnelMat);
    funnel.position.y = 0.3;
    funnel.rotation.x = Math.PI; // point down
    group.add(funnel);
    // Pipe leading into chamber
    const pipeGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.0, 8);
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      metalness: 0.9,
      roughness: 0.3,
    });
    const pipe = new THREE.Mesh(pipeGeo, pipeMat);
    pipe.position.y = 0.8;
    pipe.rotation.x = -0.3;
    group.add(pipe);
    // Stack on top
    const stackGeo = new THREE.CylinderGeometry(0.6, 0.8, 0.8, 12);
    const stackMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.7,
      roughness: 0.5,
    });
    const stack = new THREE.Mesh(stackGeo, stackMat);
    stack.position.y = 2.8;
    group.add(stack);
    // Chimney with smoke port
    const chimneyGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.6, 8);
    const chimney = new THREE.Mesh(chimneyGeo, stackMat);
    chimney.position.y = 3.4;
    group.add(chimney);
    // Mesh ref for animation
    (group as any).smelterInterior = interior;
    return group;
  };

  const createStructureMesh = (type: BuildType): THREE.Group => {
    if (type === 'dome') return createDomeMesh();
    if (type === 'solar') return createSolarPanelMesh();
    if (type === 'o2generator') return createO2GeneratorMesh();
    if (type === 'smelter') return createSmelterMesh();
    return new THREE.Group();
  };

  // ====================== Particles ======================
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
          (Math.random() - 0.5) * 5,
        ),
        life: 1,
      };
      scene.add(particle);
      particlesRef.current.push(particle);
    }
  };

  const updateParticles = (dt: number) => {
    const scene = sceneRef.current;
    if (!scene) return;
    particlesRef.current = particlesRef.current.filter(particle => {
      const moveStep = (particle.userData.velocity as THREE.Vector3).clone().multiplyScalar(dt);
      particle.position.add(moveStep);
      particle.userData.velocity.y -= 0.1 * dt * 10;
      particle.userData.life -= dt;
      if (particle.userData.life <= 0) {
        scene.remove(particle);
        particle.geometry.dispose();
        (particle.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  };

  // ====================== Mining ======================
  // Raycast from camera forward, return closest asteroid within MINE_RANGE (or null)
  const getAsteroidInSight = (): Asteroid | null => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!camera || !scene) return null;
    const dir = new THREE.Vector3(
      Math.sin(yawRef.current) * Math.cos(pitchRef.current),
      Math.sin(pitchRef.current),
      Math.cos(yawRef.current) * Math.cos(pitchRef.current),
    ).normalize();
    const raycaster = new THREE.Raycaster(camera.position.clone(), dir, 0, MINE_RANGE + 2);
    const meshes = asteroidsRef.current
      .filter(a => !a.isMined)
      .map(a => a.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const hitMesh = hits[0].object as THREE.Mesh;
    const asteroid = asteroidsRef.current.find(a => a.mesh === hitMesh);
    if (!asteroid || asteroid.isMined) return null;
    if (hits[0].distance > MINE_RANGE) return null;
    return asteroid;
  };

  // Floor raycast for build preview placement
  const getFloorPointInSight = (): THREE.Vector3 | null => {
    const camera = cameraRef.current;
    if (!camera) return null;
    const dir = new THREE.Vector3(
      Math.sin(yawRef.current) * Math.cos(pitchRef.current),
      Math.sin(pitchRef.current),
      Math.cos(yawRef.current) * Math.cos(pitchRef.current),
    ).normalize();
    // Raycast down-looking: intersect y=0 plane
    // P(t) = camera.position + dir * t  → solve y = 0
    if (Math.abs(dir.y) < 0.001) return null;
    const t = (0 - camera.position.y) / dir.y;
    if (t < 0 || t > BUILD_RANGE * 1.5) return null;
    const point = camera.position.clone().add(dir.clone().multiplyScalar(t));
    // Clamp to world radius
    const dist = Math.sqrt(point.x * point.x + point.z * point.z);
    if (dist > WORLD_RADIUS) {
      point.multiplyScalar(WORLD_RADIUS / dist);
    }
    return point;
  };

  // ====================== Build placement ======================
  const tryPlaceStructure = (): boolean => {
    const scene = sceneRef.current;
    if (!scene) return false;
    const point = getFloorPointInSight();
    if (!point) return false;
    const type = buildTypeRef.current;
    const info = BUILD_TYPES[type];
    const r = resourcesRef.current;
    if (r.iron < info.costIron || r.ice < info.costIce || r.rawOre < info.costRawOre) {
      // Not enough resources
      return false;
    }
    // Deduct resources
    r.iron -= info.costIron;
    r.ice -= info.costIce;
    r.rawOre -= info.costRawOre;
    setUiIron(r.iron);
    setUiIce(r.ice);
    setUiRawOre(r.rawOre);
    // Create structure at floor point
    const group = createStructureMesh(type);
    group.position.copy(point);
    scene.add(group);
    let structureType: BuildType = type;
    // Initialize smelter-specific state
    if (type === 'smelter') {
      structureType = 'smelter';
      (group as any).smelterInventory = { rawOre: 0 };
      (group as any).smelterIsProcessing = false;
      (group as any).smelterProcessingProgress = 0;
      (group as any).smelterLastProcessTime = 0;
    }
    structuresRef.current.push({ group, type: structureType });
    // Small particle puff
    createParticles(point.clone().setY(0.5), 8, 0x00ffff);
    return true;
  };

  // ====================== Main init effect ======================
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 10, 60);
    sceneRef.current = scene;

    // Camera — first-person at eye level
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(0, PLAYER_HEIGHT, 0);
    cameraRef.current = camera;

    // Renderer — preserveDrawingBuffer so screenshots can capture the 3D scene
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    // Subtle cyan rim light
    const rim = new THREE.DirectionalLight(0x00aaff, 0.3);
    rim.position.set(-10, 5, -10);
    scene.add(rim);

    // Starfield (kept from original)
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

    // Floor grid (kept from original)
    const gridHelper = new THREE.GridHelper(100, 50, 0x00ffff, 0x001133);
    scene.add(gridHelper);
    // Solid floor plane (for build placement + visual)
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x050510,
      metalness: 0.2,
      roughness: 0.9,
      transparent: true,
      opacity: 0.6,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.userData = { isFloor: true };
    scene.add(floor);

    // Player — invisible in first-person (camera IS the player)
    const player = new THREE.Group();
    player.position.set(0, PLAYER_HEIGHT, 0);
    scene.add(player);
    playerRef.current = player;

    // Spawn initial asteroids
    asteroidsRef.current = [];
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      asteroidsRef.current.push(spawnAsteroid());
    }

    // Mining beam — thin glowing cylinder, hidden until mining
    const beamGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.visible = false;
    scene.add(beam);
    miningBeamRef.current = beam;

    // Mining progress ring — torus around the asteroid being mined
    const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.9,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.visible = false;
    scene.add(ring);
    miningRingRef.current = ring;

    // Build preview — holographic group, hidden by default
    const previewGroup = new THREE.Group();
    previewGroup.visible = false;
    scene.add(previewGroup);
    buildPreviewRef.current = previewGroup;
    // Initialize preview with dome mesh
    const initPreview = createStructureMesh('dome');
    // Make preview materials translucent holographic
    initPreview.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const m = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
        if ('opacity' in m) {
          m.transparent = true;
          m.opacity = 0.4;
        }
      }
    });
    previewGroup.add(initPreview);

    // Resize handler
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // ====================== Input handlers ======================
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
      // ESC to toggle pause
      if (e.code === 'Escape') {
        setGameState(prev => ({ ...prev, isPaused: !prev.isPaused }));
        return;
      }
      if (gameOverRef.current) return;
      // B key: toggle build mode
      if (e.code === 'KeyB') {
        buildModeRef.current = !buildModeRef.current;
        const newMode = buildModeRef.current;
        setGameState(prev => ({ ...prev, buildMode: newMode }));
        setUiBuildMode(newMode);
        // Hide mining visuals when toggling
        if (miningBeamRef.current) miningBeamRef.current.visible = false;
        if (miningRingRef.current) miningRingRef.current.visible = false;
        // Update build preview visibility
        if (buildPreviewRef.current) {
          buildPreviewRef.current.visible = newMode;
        }
        return;
      }
      // F key: deposit ore to smelter
      if (e.code === SMELTER_DEPOSIT_KEY) {
        depositOre();
        return;
      }
      // 1/2/3/4 select build type (only in build mode)
      if (buildModeRef.current) {
        if (e.code === 'Digit1') { buildTypeRef.current = 'dome';        setUiBuildType('dome');        updateBuildPreviewMesh('dome'); }
        if (e.code === 'Digit2') { buildTypeRef.current = 'solar';       setUiBuildType('solar');       updateBuildPreviewMesh('solar'); }
        if (e.code === 'Digit3') { buildTypeRef.current = 'o2generator'; setUiBuildType('o2generator'); updateBuildPreviewMesh('o2generator'); }
        if (e.code === 'Digit4') { buildTypeRef.current = 'smelter';     setUiBuildType('smelter');     updateBuildPreviewMesh('smelter'); }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.code] = false; };

    const handleMouseMove = (e: MouseEvent) => {
      // FPS mouse look — uses movementX/movementY (works with pointer lock)
      if (document.pointerLockElement) {
        yawRef.current -= e.movementX * 0.002;
        pitchRef.current -= e.movementY * 0.002;
        // Clamp pitch to avoid flipping
        pitchRef.current = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitchRef.current));
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Request pointer lock on click (for FPS mouse look)
      if (!document.pointerLockElement && containerRef.current) {
        containerRef.current.requestPointerLock();
        return;
      }
      if (e.button !== 0) return;
      if (gameOverRef.current) return;
      mouseDownRef.current = true;
      // If in build mode, attempt to place a structure on this click
      if (buildModeRef.current) {
        tryPlaceStructure();
        mouseDownRef.current = false; // don't also start mining
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseDownRef.current = false;
    };

    const handlePointerLockChange = () => {
      setPointerLocked(!!document.pointerLockElement);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    // Helper: rebuild the build preview mesh when selection changes
    function updateBuildPreviewMesh(type: BuildType) {
      const group = buildPreviewRef.current;
      if (!group) return;
      // Clear existing children
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        child.traverse(c => {
          if (c instanceof THREE.Mesh) {
            c.geometry.dispose();
            const m = c.material as THREE.Material;
            if (Array.isArray(m)) m.forEach(x => x.dispose()); else m.dispose();
          }
        });
      }
      const mesh = createStructureMesh(type);
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const m = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
          if ('opacity' in m) {
            m.transparent = true;
            m.opacity = 0.4;
          }
        }
      });
      group.add(mesh);
    }

    // ====================== Game loop ======================
    const loop = (timestamp: number) => {
      const dt = lastTimeRef.current === 0 ? 0.016 : (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;
      // Cap dt to avoid huge jumps (tab switch)
      const clampedDt = Math.min(dt, 0.05);

      const state = {
        paused: gameState.isPaused,
        gameOver: gameState.gameOver,
      };
      // Update compass heading based on yaw
      const yawDeg = (yawRef.current * 180 / Math.PI) % 360;
      let heading = 'N';
      if (yawDeg >= 337.5 || yawDeg < 22.5) heading = 'N';
      else if (yawDeg >= 22.5 && yawDeg < 67.5) heading = 'NE';
      else if (yawDeg >= 67.5 && yawDeg < 112.5) heading = 'E';
      else if (yawDeg >= 112.5 && yawDeg < 157.5) heading = 'SE';
      else if (yawDeg >= 157.5 && yawDeg < 202.5) heading = 'S';
      else if (yawDeg >= 202.5 && yawDeg < 247.5) heading = 'SW';
      else if (yawDeg >= 247.5 && yawDeg < 292.5) heading = 'W';
      else if (yawDeg >= 292.5 && yawDeg < 337.5) heading = 'NW';
      setUiCompassHeading(heading);

      // Use refs to avoid stale closure — we re-read each frame via a small closure object
      // (We re-grab from refs below.)
      const isPaused = gameOverRef.current ? true : false; // paused handled via setGameState; check below
      // Actually check React state via a ref mirror we keep updated. Simpler: rely on gameOverRef.
      if (!gameOverRef.current) {
        updateGame(clampedDt, timestamp);
      }
      gameLoopRef.current = requestAnimationFrame(loop);
    };

    const updateGame = (dt: number, timestamp: number) => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const player = playerRef.current;
      if (!scene || !camera || !player) return;

      // Pause check: we mirror pause into a ref-less approach — use gameState via closure.
      // Since gameState changes re-run this effect, but the loop is set once... we handle
      // pause by reading from a ref we keep updated via the effect re-subscription.
      // Simpler: check a module-level paused flag.
      if (pausedRef.current) return;

      // ===== Oxygen depletion =====
      if (!gameOverRef.current) {
        o2Ref.current -= O2_DEPLETION_PER_SEC * dt;
        if (o2Ref.current <= 0) {
          o2Ref.current = 0;
          gameOverRef.current = true;
          setGameState(prev => ({ ...prev, gameOver: true, isPaused: true }));
        }
        setUiO2(Math.max(0, o2Ref.current));
      }

      // ===== WASD movement (kept from original) =====
      const moveDirection = new THREE.Vector3();
      const fwdX = Math.sin(yawRef.current);
      const fwdZ = Math.cos(yawRef.current);
      const rightX = Math.cos(yawRef.current);
      const rightZ = -Math.sin(yawRef.current);
      if (keysRef.current['KeyW']) { moveDirection.x += fwdX; moveDirection.z += fwdZ; }
      if (keysRef.current['KeyS']) { moveDirection.x -= fwdX; moveDirection.z -= fwdZ; }
      if (keysRef.current['KeyA']) { moveDirection.x -= rightX; moveDirection.z -= rightZ; }
      if (keysRef.current['KeyD']) { moveDirection.x += rightX; moveDirection.z += rightZ; }
      if (moveDirection.length() > 0) {
        moveDirection.normalize().multiplyScalar(PLAYER_SPEED * dt);
        player.position.add(moveDirection);
        // Clamp to world radius
        const dist = Math.sqrt(player.position.x ** 2 + player.position.z ** 2);
        if (dist > WORLD_RADIUS) {
          player.position.x = (player.position.x / dist) * WORLD_RADIUS;
          player.position.z = (player.position.z / dist) * WORLD_RADIUS;
        }
      }

      // ===== First-person camera (kept from original) =====
      camera.position.set(player.position.x, PLAYER_HEIGHT, player.position.z);
      const lookDir = new THREE.Vector3(
        Math.sin(yawRef.current) * Math.cos(pitchRef.current),
        Math.sin(pitchRef.current),
        Math.cos(yawRef.current) * Math.cos(pitchRef.current),
      );
      const lookTarget = new THREE.Vector3().copy(camera.position).add(lookDir);
      camera.lookAt(lookTarget);
      player.rotation.y = yawRef.current;

      // ===== Asteroid rotation + respawn timers =====
      for (const asteroid of asteroidsRef.current) {
        if (asteroid.isMined) {
          asteroid.respawnTimer -= dt;
          if (asteroid.respawnTimer <= 0) {
            respawnAsteroid(asteroid);
          }
          continue;
        }
        // Gentle spin for life
        asteroid.mesh.rotation.y += dt * 0.3;
        asteroid.mesh.rotation.x += dt * 0.15;
      }

      // ===== Mining logic (only when NOT in build mode and mouse held) =====
      const beam = miningBeamRef.current;
      const ring = miningRingRef.current;
      if (!buildModeRef.current && mouseDownRef.current && !gameOverRef.current) {
        const target = getAsteroidInSight();
        if (target) {
          // Shrink asteroid
          target.currentScale -= MINE_RATE_PER_SEC * dt;
          const scale = Math.max(0.05, target.currentScale);
          target.mesh.scale.set(scale, scale, scale);

          // Progress for UI (0 → 1)
          setUiMiningProgress(1 - target.currentScale);
          // Hovered asteroid label
          setUiHoveredAsteroid(ASTEROID_TYPES[target.type].name);

          // Mining beam visual: from camera to asteroid
          if (beam) {
            const camPos = camera.position.clone();
            const astPos = target.mesh.position.clone();
            const mid = camPos.clone().add(astPos).multiplyScalar(0.5);
            beam.position.copy(mid);
            const dist = camPos.distanceTo(astPos);
            beam.scale.set(1, dist, 1);
            // Orient cylinder (default Y-axis) to point from cam to asteroid
            const dirVec = astPos.clone().sub(camPos).normalize();
            const quat = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              dirVec,
            );
            beam.quaternion.copy(quat);
            beam.visible = true;
          }

          // Progress ring around asteroid
          if (ring) {
            ring.position.copy(target.mesh.position);
            const ringScale = target.baseScale * 1.6;
            ring.scale.set(ringScale, ringScale, ringScale);
            // Face camera
            ring.lookAt(camera.position);
            // Show progress via scale of torus tube? Use opacity tied to progress.
            const mat = ring.material as THREE.MeshBasicMaterial;
            const prog = 1 - target.currentScale;
            mat.opacity = 0.4 + prog * 0.6;
            mat.color.set(ASTEROID_TYPES[target.type].color);
            ring.visible = true;
          }

          // Spawn occasional mining particles
          if (Math.random() < dt * 8) {
            createParticles(target.mesh.position.clone(), 1, ASTEROID_TYPES[target.type].color);
          }

          // Fully mined?
          if (target.currentScale <= 0.05) {
            target.isMined = true;
            target.mesh.visible = false;
            target.respawnTimer = ASTEROID_RESPAWN_DELAY;
            // Award resources
            const info = ASTEROID_TYPES[target.type];
            const r = resourcesRef.current;
            if (target.type === 'oxygen') {
              // Oxygen crystal refills the survival O2 bar
              o2Ref.current = Math.min(O2_MAX, o2Ref.current + O2_REFILL_CRYSTAL);
              setUiO2(o2Ref.current);
              // Also add to oxygen resource counter (player can stockpile crystals)
              r.oxygen += info.yieldAmount;
              setUiOxygen(r.oxygen);
            } else if (target.type === 'iron') {
              r.iron += info.yieldAmount;
              setUiIron(r.iron);
            } else if (target.type === 'ice') {
              r.ice += info.yieldAmount;
              setUiIce(r.ice);
            }
            // Burst particles
            createParticles(target.mesh.position.clone(), 12, ASTEROID_TYPES[target.type].color);
            // Reset mining visuals
            if (beam) beam.visible = false;
            if (ring) ring.visible = false;
            setUiMiningProgress(0);
            setUiHoveredAsteroid('');
          }
        } else {
          // Not looking at an asteroid
          if (beam) beam.visible = false;
          if (ring) ring.visible = false;
          setUiMiningProgress(0);
          setUiHoveredAsteroid('');
        }
      } else {
        // Mouse not held or build mode active
        if (beam) beam.visible = false;
        if (ring) ring.visible = false;
        if (!buildModeRef.current) {
          setUiMiningProgress(0);
          // Still show hovered asteroid name when looking at one (no mining)
          if (!gameOverRef.current) {
            const target = getAsteroidInSight();
            setUiHoveredAsteroid(target ? ASTEROID_TYPES[target.type].name : '');
          }
        }
      }

      // ===== Build preview update =====
      const preview = buildPreviewRef.current;
      if (preview) {
        if (buildModeRef.current && !gameOverRef.current) {
          const point = getFloorPointInSight();
          if (point) {
            preview.position.copy(point);
            preview.visible = true;
            // Tint preview red if can't afford, green if can
            const info = BUILD_TYPES[buildTypeRef.current];
            const canAfford =
              resourcesRef.current.iron >= info.costIron &&
              resourcesRef.current.ice >= info.costIce &&
              resourcesRef.current.rawOre >= info.costRawOre;
            preview.traverse(child => {
              if (child instanceof THREE.Mesh) {
                const m = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
                if ('color' in m) {
                  m.color.set(canAfford ? 0x00ff88 : 0xff4444);
                }
              }
            });
            // Slow rotation for holographic feel
            preview.rotation.y += dt * 0.5;
          } else {
            preview.visible = false;
          }
        } else {
          preview.visible = false;
        }
      }

      // ===== Particles =====
      updateParticles(clampedDtSafe(clampedDt));

      // ===== Smelter processing =====
      processSmelters();

      // Render
      renderer.render(scene, camera);
    };

    // Smelter processing loop (runs in updateGame)
    const processSmelters = () => {
      const now = Date.now() / 1000;
      for (const smelter of structuresRef.current) {
        if (smelter.type !== 'smelter') continue;

        const { group, inventory, isProcessing, processingProgress, lastProcessTime } = smelter;

        // Animate processing interior glow
        const interiorMat = (group as any).smelterInterior;
        if (isProcessing && interiorMat) {
          const interior = interiorMat as THREE.Mesh;
          // Pulse orange glow based on progress
          const pulseIntensity = 0.6 + Math.sin(now * 10) * 0.3;
          (interior.material as THREE.MeshBasicMaterial).opacity = pulseIntensity * processingProgress;
          (interior.material as THREE.MeshBasicMaterial).color.set(0xff6600);
        } else if (interiorMat) {
          const interior = interiorMat as THREE.Mesh;
          (interior.material as THREE.MeshBasicMaterial).opacity = 0;
        }

        // Process ore when ready
        if (inventory.rawOre > 0 && isProcessing) {
          // Check H2
          if (resourcesRef.current.h2 <= 0) {
            // H2 depleted - stop processing
            smelter.isProcessing = false;
            continue;
          }

          // Process ore at SMELTER_PROCESS_RATE (1 per 3 seconds)
          if (now - lastProcessTime >= SMELTER_PROCESS_RATE) {
            smelter.lastProcessTime = now;
            
            // Consume H2 (1 per 5 ore processed = SMELTER_H2_CONSUMPTION per tick)
            resourcesRef.current.h2 -= SMELTER_H2_CONSUMPTION;
            setUiH2(resourcesRef.current.h2);

            // Process ore
            if (inventory.rawOre > 0) {
              inventory.rawOre -= 1;
              
              // Output: 0.8 Iron + 0.2 Titanium
              const ironOutput = SMELTER_ORE_TO_METAL * 0.8;
              const titaniumOutput = SMELTER_ORE_TO_METAL * 0.2;
              resourcesRef.current.ironMetal += ironOutput;
              resourcesRef.current.titanium += titaniumOutput;
              setUiIronMetal(resourcesRef.current.ironMetal);
              setUiTitaniumMetal(resourcesRef.current.titanium);

              // Spawn smoke particles at chimney
              const chimneyPos = new THREE.Vector3(0, 3.4, 0);
              chimneyPos.applyMatrix4(group.matrixWorld);
              createParticles(chimneyPos, 2, 0x888888);

              // Spawn ore particles at intake
              const intakePos = new THREE.Vector3(0, 0.3, 0);
              intakePos.applyMatrix4(group.matrixWorld);
              createParticles(intakePos, 3, 0xaaaaaa);
            }
          }
        }
      }
    };

    // Start game loop
    gameLoopRef.current = requestAnimationFrame(loop);

    // ===== Cleanup =====
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('resize', handleResize);

      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
      scene.clear();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror paused state into a ref the loop can read without stale closure
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = gameState.isPaused;
  }, [gameState.isPaused]);

  // Sync resources when they change
  useEffect(() => {
    if (resourcesRef.current.h2 !== uiH2) {
      resourcesRef.current.h2 = uiH2;
    }
    if (resourcesRef.current.iron !== uiIron) {
      resourcesRef.current.iron = uiIron;
    }
    if (resourcesRef.current.ice !== uiIce) {
      resourcesRef.current.ice = uiIce;
    }
    if (resourcesRef.current.oxygen !== uiOxygen) {
      resourcesRef.current.oxygen = uiOxygen;
    }
    if (resourcesRef.current.rawOre !== uiRawOre) {
      resourcesRef.current.rawOre = uiRawOre;
    }
  }, [uiH2, uiIron, uiIce, uiOxygen, uiRawOre]);
  // Sync gameOver ref when state changes (e.g. user clicks RESTART)
  useEffect(() => {
    gameOverRef.current = gameState.gameOver;
  }, [gameState.gameOver]);

  // ====================== Minimap rendering ======================
  useEffect(() => {
    if (!containerRef.current) return;
    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas || !cameraRef.current) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);
    
    // Draw compass rose
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', width / 2, 20);
    ctx.fillText('S', width / 2, height - 5);
    ctx.fillText('W', 10, height / 2);
    ctx.fillText('E', width - 10, height / 2);
    
    // Draw asteroids
    ctx.fillStyle = '#ffffff';
    for (const asteroid of asteroidsRef.current) {
      if (asteroid.isMined) continue;

      // Convert world position to minimap coordinates
      const dx = asteroid.mesh.position.x - cameraRef.current.position.x;
      const dz = asteroid.mesh.position.z - cameraRef.current.position.z;
      const scale = 4;
      const mapX = (width / 2) + dx * scale;
      const mapY = (height / 2) + dz * scale;

      // Only draw if on screen
      if (mapX > -10 && mapX < width + 10 && mapY > -10 && mapY < height + 10) {
        const color = asteroid.type === 'iron' ? '#888888' :
                      asteroid.type === 'ice' ? '#00aaff' : '#00ff88';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(mapX, mapY, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw structures
    ctx.fillStyle = '#00ffff';
    for (const structure of structuresRef.current) {
      // Convert world position to minimap coordinates
      const dx = structure.group.position.x - cameraRef.current.position.x;
      const dz = structure.group.position.z - cameraRef.current.position.z;
      const scale = 4;
      const mapX = (width / 2) + dx * scale;
      const mapY = (height / 2) + dz * scale;
      
      // Only draw if on screen
      if (mapX > -10 && mapX < width + 10 && mapY > -10 && mapY < height + 10) {
        ctx.fillRect(mapX - 4, mapY - 4, 8, 8);
      }
    }
  }, [uiH2, uiIron, uiIce, uiOxygen, uiRawOre]);

  // ====================== Restart handler ======================
  const handleRestart = () => {
    // Reset refs
    o2Ref.current = O2_MAX;
    resourcesRef.current = { iron: 0, ice: 0, oxygen: 0, rawOre: 0, h2: 0, ironMetal: 0, titanium: 0 };
    buildModeRef.current = false;
    buildTypeRef.current = 'dome';
    mouseDownRef.current = false;
    gameOverRef.current = false;
    // Reset asteroid scales/positions
    for (const a of asteroidsRef.current) {
      respawnAsteroid(a);
    }
    // Remove all built structures
    const scene = sceneRef.current;
    if (scene) {
      for (const s of structuresRef.current) {
        scene.remove(s.group);
        s.group.traverse(c => {
          if (c instanceof THREE.Mesh) {
            c.geometry.dispose();
            const m = c.material as THREE.Material;
            if (Array.isArray(m)) m.forEach(x => x.dispose()); else m.dispose();
          }
        });
      }
    }
    structuresRef.current = [];
    // Reset player position
    if (playerRef.current) {
      playerRef.current.position.set(0, PLAYER_HEIGHT, 0);
    }
    yawRef.current = 0;
    pitchRef.current = 0;
    // Reset UI
    setUiO2(O2_MAX);
    setUiIron(0);
    setUiIce(0);
    setUiOxygen(0);
    setUiH2(0);
    setUiBuildMode(false);
    setUiBuildType('dome');
    setUiMiningProgress(0);
    setUiHoveredAsteroid('');
    setUiCompassHeading('E');
    setUiIronMetal(0);
    setUiTitaniumMetal(0);
    setGameState(INITIAL_GAME_STATE);
  };

  // ====================== Render JSX ======================
  const o2Pct = (uiO2 / O2_MAX) * 100;
  const o2Color = uiO2 > 30 ? '#00ff88' : uiO2 > 15 ? '#ffaa00' : '#ff3333';

  // ====================== Render JSX ======================
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100vh', position: 'relative' }}>
      {/* First-person crosshair (kept from original) */}
      {!gameState.gameOver && !gameState.isPaused && (
        <div style={styles.crosshair}>
          <div style={styles.crosshairH} />
          <div style={styles.crosshairV} />
          <div style={styles.crosshairDot} />
        </div>
      )}

      {/* Click-to-look hint (shows when pointer not locked) */}
      {!gameState.gameOver && !gameState.isPaused && !pointerLocked && (
        <div
          style={styles.hintOverlay}
          onClick={() => containerRef.current?.requestPointerLock()}
        >
          <div style={styles.hintText}>🖱️ CLICK TO LOOK AROUND</div>
          <div style={styles.hintSubtext}>
            WASD: Move · Mouse: Aim · Hold Click: Mine · B: Build Mode · 1/2/3: Select · ESC: Pause
          </div>
        </div>
      )}

      {/* Compass/heading — top center, above O2 */}
      {!gameState.gameOver && (
        <div style={styles.compassContainer}>
          <span style={styles.compassText}>{uiCompassHeading} / 8</span>
        </div>
      )}

      {/* O2 bar — top center, large, cyan/green */}
      {!gameState.gameOver && (
        <div style={styles.o2Container}>
          <div style={styles.o2Label}>O₂</div>
          <div style={styles.o2BarOuter}>
            <div
              style={{
                ...styles.o2BarFill,
                width: `${o2Pct}%`,
                backgroundColor: o2Color,
                boxShadow: `0 0 12px ${o2Color}`,
              }}
            />
            <div style={styles.o2TextOverlay}>
              {Math.ceil(uiO2)} / {O2_MAX}
            </div>
          </div>
        </div>
      )}

      {/* H2 power bar — top center, below O2, orange */}
      {!gameState.gameOver && (
        <div style={styles.h2Container}>
          <div style={styles.h2Label}>⚡ H₂</div>
          <div style={styles.h2BarOuter}>
            <div
              style={{
                ...styles.h2BarFill,
                width: `${(uiH2 / 100) * 100}%`,
                backgroundColor: uiH2 > 30 ? '#ffaa00' : uiH2 > 15 ? '#ff6600' : '#ff3333',
                boxShadow: `0 0 12px ${uiH2 > 30 ? '#ffaa00' : uiH2 > 15 ? '#ff6600' : '#ff3333'}`,
              }}
            />
            <div style={styles.h2TextOverlay}>
              {Math.ceil(uiH2)} / 100
            </div>
          </div>
        </div>
      )}

      {/* Resource counts — bottom left with colored icons */}
      {!gameState.gameOver && (
        <div style={styles.resourcePanel}>
          <div style={styles.resourceRow}>
            <span style={{ ...styles.resourceIcon, backgroundColor: '#888888' }} />
            <span style={styles.resourceText}>Raw Ore: {uiRawOre}</span>
          </div>
          <div style={styles.resourceRow}>
            <span style={{ ...styles.resourceIcon, backgroundColor: '#00aaff' }} />
            <span style={styles.resourceText}>Water Ice: {uiIce}</span>
          </div>
          <div style={styles.resourceRow}>
            <span style={{ ...styles.resourceIcon, backgroundColor: '#ffaa00' }} />
            <span style={styles.resourceText}>Iron Metal: {uiIronMetal}</span>
          </div>
          <div style={styles.resourceRow}>
            <span style={{ ...styles.resourceIcon, backgroundColor: '#ff6600' }} />
            <span style={styles.resourceText}>Titanium: {uiTitaniumMetal}</span>
          </div>
        </div>
      )}

      {/* Minimap — top-right corner, showing asteroid positions */}
      {!gameState.gameOver && (
        <div style={styles.minimapContainer}>
          <canvas width={200} height={200} style={styles.minimapCanvas} />
        </div>
      )}

      {/* Hovered asteroid label */}
      {uiHoveredAsteroid && !gameState.gameOver && !gameState.isPaused && (
        <div style={styles.hoveredAsteroid}>
          {uiHoveredAsteroid}
          {uiMiningProgress > 0 && (
            <div style={styles.miningProgressBar}>
              <div style={{ ...styles.miningProgressFill, width: `${uiMiningProgress * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Build mode indicator — center bottom when active */}
      {uiBuildMode && !gameState.gameOver && (
        <div style={styles.buildModeIndicator}>
          🔨 BUILD MODE — [{BUILD_TYPES[uiBuildType].hotkey}] {BUILD_TYPES[uiBuildType].name} — Click to place · B to exit
        </div>
      )}

      {/* Build menu — bottom of screen when build mode active */}
      {uiBuildMode && !gameState.gameOver && (
        <div style={styles.buildMenu}>
          <div style={styles.buildMenuTitle}>BUILD MENU</div>
          <div style={styles.buildMenuRow}>
            {(['dome', 'solar', 'o2generator', 'smelter'] as BuildType[]).map((t, idx) => {
              const info = BUILD_TYPES[t];
              const selected = uiBuildType === t;
              const affordable =
                resourcesRef.current.iron >= info.costIron &&
                resourcesRef.current.ice >= info.costIce &&
                resourcesRef.current.rawOre >= info.costRawOre;
              return (
                <div
                  key={t}
                  style={{
                    ...styles.buildMenuItem,
                    borderColor: selected ? '#00ffff' : '#445566',
                    backgroundColor: selected ? 'rgba(0, 80, 80, 0.4)' : 'rgba(0, 0, 0, 0.6)',
                    opacity: affordable ? 1 : 0.5,
                  }}
                >
                  <div style={styles.buildMenuItemHotkey}>[{info.hotkey}]</div>
                  <div style={styles.buildMenuItemName}>{info.name}</div>
                  <div style={styles.buildMenuItemCost}>
                    {info.costIron > 0 && <span style={{ color: '#aaa' }}>🪨 {info.costIron} Iron </span>}
                    {info.costIce > 0 && <span style={{ color: '#00aaff' }}>❄️ {info.costIce} Ice</span>}
                    {info.costRawOre > 0 && <span style={{ color: '#ffaa00' }}>🪨 {info.costRawOre} Ore</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* OXYGEN DEPLETED game over screen */}
      {gameState.gameOver && (
        <div style={styles.gameOverOverlay}>
          <h1 style={styles.gameOverTitle}>OXYGEN DEPLETED</h1>
          <p style={styles.gameOverSubtext}>Your suit ran out of O₂ in the void.</p>
          <div style={styles.gameOverStats}>
            <div>Iron mined: {uiIron}</div>
            <div>Ice mined: {uiIce}</div>
            <div>Structures built: {structuresRef.current.length}</div>
          </div>
          <button onClick={handleRestart} style={styles.restartButton}>
            RESTART
          </button>
        </div>
      )}

      {/* Pause overlay */}
      {gameState.isPaused && !gameState.gameOver && (
        <div style={styles.gameOverOverlay}>
          <h1 style={{ ...styles.gameOverTitle, color: '#ffaa00' }}>PAUSED</h1>
          <p style={styles.gameOverSubtext}>Press ESC to continue</p>
        </div>
      )}

      {/* Mobile pause button */}
      <button
        onClick={() => setGameState(prev => ({ ...prev, isPaused: !prev.isPaused }))}
        style={styles.pauseButton}
      >
        PAUSE
      </button>
    </div>
  );
}

// ====================== Helper ======================
function clampedDtSafe(dt: number): number {
  return Math.min(Math.max(dt, 0.001), 0.05);
}

// ====================== Styles ======================
const styles: Record<string, React.CSSProperties> = {
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 30,
    height: 30,
    pointerEvents: 'none',
    zIndex: 10,
  },
  crosshairH: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 20,
    height: 2,
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'rgba(0, 255, 0, 0.7)',
  },
  crosshairV: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 2,
    height: 20,
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'rgba(0, 255, 0, 0.7)',
  },
  crosshairDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 4,
    height: 4,
    transform: 'translate(-50%, -50%)',
    borderRadius: '50%',
    backgroundColor: 'rgba(0, 255, 0, 0.9)',
  },
  hintOverlay: {
    position: 'absolute',
    top: '60%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '20px 40px',
    borderRadius: 12,
    border: '1px solid rgba(0, 255, 255, 0.4)',
    textAlign: 'center',
    cursor: 'pointer',
    zIndex: 50,
  },
  hintText: {
    color: '#00ffff',
    fontFamily: 'monospace',
    fontSize: 20,
    textShadow: '0 0 8px #00ffff',
    marginBottom: 8,
  },
  hintSubtext: {
    color: 'rgba(0, 255, 255, 0.6)',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  // O2 bar — top center
  o2Container: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    zIndex: 30,
  },
  o2Label: {
    color: '#00ffff',
    fontFamily: 'monospace',
    fontSize: 26,
    fontWeight: 'bold',
    textShadow: '0 0 10px #00ffff',
  },
  o2BarOuter: {
    position: 'relative',
    width: 360,
    height: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 14,
    border: '2px solid #00ffff',
    overflow: 'hidden',
  },
  o2BarFill: {
    height: '100%',
    transition: 'width 0.1s linear, background-color 0.2s',
  },
  o2TextOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
    textShadow: '0 0 6px #000',
    pointerEvents: 'none',
  },
  // Resource panel — bottom left
  resourcePanel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '14px 18px',
    borderRadius: 10,
    border: '2px solid #00ffff',
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: 15,
    zIndex: 20,
  },
  resourceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '6px 0',
  },
  resourceIcon: {
    display: 'inline-block',
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.4)',
  },
  resourceText: {
    color: '#ffffff',
  },
  // Hovered asteroid label
  hoveredAsteroid: {
    position: 'absolute',
    top: 80,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: '10px 20px',
    borderRadius: 10,
    border: '2px solid #00ff88',
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 15,
    textAlign: 'center',
    zIndex: 25,
  },
  miningProgressBar: {
    marginTop: 6,
    width: 180,
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  miningProgressFill: {
    height: '100%',
    backgroundColor: '#00ff88',
    transition: 'width 0.1s linear',
  },
  // Build mode indicator — center bottom
  buildModeIndicator: {
    position: 'absolute',
    bottom: 130,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0, 60, 60, 0.85)',
    padding: '8px 18px',
    borderRadius: 8,
    border: '1px solid #00ffff',
    color: '#00ffff',
    fontFamily: 'monospace',
    fontSize: 14,
    zIndex: 25,
  },
  // Build menu — bottom of screen
  buildMenu: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0, 10, 20, 0.9)',
    padding: '12px 18px',
    borderRadius: 10,
    border: '2px solid #00ffff',
    color: '#ffffff',
    fontFamily: 'monospace',
    zIndex: 30,
  },
  buildMenuTitle: {
    color: '#00ffff',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: '0.15em',
  },
  buildMenuRow: {
    display: 'flex',
    gap: 10,
  },
  buildMenuItem: {
    width: 140,
    padding: '10px',
    borderRadius: 8,
    border: '2px solid #445566',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  buildMenuItemHotkey: {
    color: '#ffaa00',
    fontSize: 12,
    marginBottom: 4,
  },
  buildMenuItemName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  buildMenuItemCost: {
    color: '#aabbcc',
    fontSize: 12,
  },
  // Game over
  gameOverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#00ffff',
    fontFamily: 'monospace',
  },
  gameOverTitle: {
    fontSize: 52,
    color: '#ff4444',
    textShadow: '0 0 16px #ff0000',
    marginBottom: 16,
    letterSpacing: '0.1em',
  },
  gameOverSubtext: {
    fontSize: 18,
    color: '#aabbcc',
    marginBottom: 20,
  },
  gameOverStats: {
    fontSize: 16,
    color: '#00ffff',
    textAlign: 'center',
    lineHeight: 1.8,
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
    letterSpacing: '0.1em',
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
  // Compass/heading — top center
  compassContainer: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 30,
  },
  compassText: {
    color: '#00ffff',
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: 'bold',
    textShadow: '0 0 8px #00ffff',
  },
  // H2 bar — top center, below O2
  h2Container: {
    position: 'absolute',
    top: 65,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    zIndex: 30,
  },
  h2Label: {
    color: '#ffaa00',
    fontFamily: 'monospace',
    fontSize: 20,
    fontWeight: 'bold',
    textShadow: '0 0 10px #ffaa00',
  },
  h2BarOuter: {
    position: 'relative',
    width: 360,
    height: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 14,
    border: '2px solid #ffaa00',
    overflow: 'hidden',
  },
  h2BarFill: {
    height: '100%',
    transition: 'width 0.1s linear, background-color 0.2s',
  },
  h2TextOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
    textShadow: '0 0 6px #000',
    pointerEvents: 'none',
  },
  // Minimap — top-right corner
  minimapContainer: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 200,
    height: 200,
    borderRadius: 12,
    border: '3px solid #00ffff',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    overflow: 'hidden',
    zIndex: 30,
    boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)',
  },
  minimapCanvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
};
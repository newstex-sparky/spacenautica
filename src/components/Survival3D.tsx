import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

// ====================== Game Constants ======================
const PLAYER_HEIGHT = 1.6;
const PLAYER_SPEED = 5;

// Audio context for heartbeat sound
let audioContext: AudioContext | null = null;

// Oxygen survival
const O2_MAX = 100;
const O2_DEPLETION_PER_SEC = 1;       // 1 O2 per second in vacuum
const O2_REFILL_CRYSTAL = 25;          // mining an oxygen crystal refills +25
const O2_LOW_WARNING_THRESHOLD = 20;   // Warning when O2 drops below this
const O2_RESPAWN_AMOUNT = 50;          // O2 restored on respawn
const LOW_O2_WARNING_DURATION = 30;    // seconds of warning before hard fail
const O2_VENT_PARTICLE_RATE = 2;       // particles per second near O2 source
const O2_HEARTBEAT_INTERVAL = 0.8;     // seconds between heartbeat pulses

// Asteroid mining
const ASTEROID_COUNT = 40;             // 30-50 asteroids in world
const MINE_RANGE = 5;                  // mine within 5 units
const MINE_RATE_PER_SEC = 0.5;         // asteroid shrinks 0.5/sec while held
const ASTEROID_RESPAWN_DELAY = 10;     // seconds before respawn after fully mined
const WORLD_RADIUS = 45;               // asteroid spawn radius around origin

// Build mode
const BUILD_RANGE = 8;                 // raycast floor within 8 units
const BUILD_GRID_SIZE = 1;             // 1 meter grid, snap to 1 unit increments
const STORAGE_LOCKER_COST = { costIron: 5, costIce: 0, costRawOre: 0 }; // 1x1 module

// Asteroid types
export type AsteroidType = 'iron' | 'ice' | 'oxygen';

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

// Build structure types (7 module types for M2 — including win condition)
export type BuildableStructureType = 'dome' | 'solar' | 'o2generator' | 'smelter' | 'refinery' | 'storage' | 'signalrelay';

// Structure dimensions (tile-based: BUILD_GRID_SIZE = 4 units)
const STRUCTURE_DIMENSIONS: Record<BuildableStructureType, { width: number; depth: number }> = {
  dome:        { width: 1, depth: 1 },
  solar:       { width: 2, depth: 1 },
  o2generator: { width: 1, depth: 2 },
  smelter:     { width: 2, depth: 2 },
  refinery:    { width: 2, depth: 2 },
  storage:     { width: 1, depth: 1 },
  signalrelay: { width: 4, depth: 4 }, // Win condition structure
};

interface BuildTypeInfo {
  name: string;
  costIron: number;
  costIce: number;
  costRawOre: number;
  costH2: number;
  hotkey: string;
  description: string;
}

const BUILD_TYPES: Record<BuildableStructureType, BuildTypeInfo> = {
  dome:        { name: 'Habitat Dome',    costIron: 10, costIce: 0, costRawOre: 0, costH2: 0, hotkey: '1', description: 'Pressurized living space' },
  solar:       { name: 'Solar Panel',    costIron: 5,  costIce: 0, costRawOre: 0, costH2: 0, hotkey: '2', description: 'Passive power generation' },
  o2generator: { name: 'O2 Generator',   costIron: 0,  costIce: 10, costRawOre: 0, costH2: 0, hotkey: '3', description: 'Generates O2 from H2' },
  smelter:     { name: 'Smelter',        costIron: 10, costIce: 0, costRawOre: 0, costH2: 0, hotkey: '4', description: 'Smelts ore into metals' },
  refinery:    { name: 'Electrolysis Ref', costIron: 0, costIce: 15, costRawOre: 0, costH2: 0, hotkey: '5', description: 'Water ice → O2 + H2' },
  fabricator: { name: 'Fabricator',      costIron: 15, costIce: 0, costRawOre: 0, costH2: 0, hotkey: '6', description: 'Craft tools and upgrades' },
  storage:     { name: 'Storage Locker',  costIron: 5,  costIce: 0, costRawOre: 0, costH2: 0, hotkey: '7', description: 'Stores raw materials' },
  signalrelay: { name: 'Signal Relay',   costIron: 20, costIce: 0, costRawOre: 0, costH2: 10, hotkey: 'R', description: 'Win condition - broadcast distress' },
};

// Smelting constants
const SMELTER_PROCESS_RATE = 1 / 3; // 1/3 ore processed per tick (1 per 3 seconds)
const SMELTER_ORE_TO_METAL = 1; // 1 raw ore produces 0.8 iron + 0.2 titanium
const SMELTER_H2_CONSUMPTION = 1 / 5; // 1 H2 consumed per 5 ore processed
const SMELTER_DEPOSIT_RANGE = 4; // Distance to deposit ore
const SMELTER_DEPOSIT_KEY = 'KeyF'; // Deposit key
const REFINERY_DEPOSIT_KEY = 'KeyG'; // Deposit water ice to refinery

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

// Unified structure runtime object (supports both BuiltStructure and Refinery)
interface BuiltStructure {
  group: THREE.Group;
  type: BuildableStructureType;
  integrity?: number;
  // Smelter-specific properties
  inventory?: { rawOre: number };
  isSmelterProcessing?: boolean;
  smelterLastProcessTime?: number;
  smelterProcessingProgress?: number;
  // Refinery-specific properties
  refineryInventory?: { waterIce: number };
  isRefineryProcessing?: boolean;
  refineryLastProcessTime?: number;
  refineryProcessingProgress?: number;
  // Fabricator-specific properties
  craftingUIOpen?: boolean;
  craftingUIGroup?: THREE.Group;
  selectedCraft?: string;
  craftingStatus?: string;
}

interface Structure extends BuiltStructure {
  isInteriorVisible?: boolean; // When true, show interior and hide exterior shell
  // Airlock/Interior properties
  isInterior?: boolean; // True when player is actively inside
  airlockOpen?: boolean; // Airlock door state
  airlockTimer?: number; // For airlock transition animation
  interiorCameraOffset?: THREE.Vector3; // Camera offset when inside
}

// Tool types (equipped, not stacked)
type ToolType = 'mining-drill-mk1' | 'mining-drill-mk2' | 'repair-tool' | 'scanner' | 'jetpack-mk1' | 'jetpack-mk2';

// Inventory item types
interface InventoryItem {
  name: string;
  type: 'resource' | 'crafted' | 'tool';
  count: number;
  max: number;
}

// Inventory panel runtime object
interface InventoryPanel {
  group: THREE.Group;
  isVisible: boolean;
}

// Equipped tool
let equippedTool: ToolType = 'repair-tool'; // Default tool

// Inventory item types
interface InventoryItem {
  name: string;
  type: 'resource' | 'crafted' | 'tool';
  count: number;
  max: number;
}

// Inventory panel runtime object
interface InventoryPanel {
  group: THREE.Group;
  isVisible: boolean;
}

// 3D holographic inventory panel
const createInventoryPanel = () => {
  const group = new THREE.Group();
  group.visible = false; // Hidden by default, shown when inventory is open

  // Main holographic panel (semi-transparent box)
  const panelGeometry = new THREE.BoxGeometry(6, 4, 0.1);
  const panelMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    wireframe: true,
  });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  group.add(panel);

  // Inner glow effect
  const glowGeometry = new THREE.PlaneGeometry(5.8, 3.8);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  group.add(glow);

  return group;
};

// 3D icons for inventory items
const createInventoryIcon = (itemName: string) => {
  let geometry: THREE.BufferGeometry;
  const material = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });

  if (itemName === 'Raw Ore' || itemName === 'Iron Metal' || itemName === 'Titanium') {
    // Cube for raw materials
    geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  } else if (itemName === 'Water Ice') {
    // Icosahedron for ice
    geometry = new THREE.IcosahedronGeometry(0.3, 0);
  } else if (itemName === 'O2 Canister' || itemName === 'H2 Canister') {
    // Cylindrical canister shape
    geometry = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 16);
  } else if (itemName === 'Tool' || itemName.startsWith('mining-drill')) {
    // Drill tool
    geometry = new THREE.ConeGeometry(0.3, 0.6, 8);
  } else {
    // Default box
    geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  }

  const mesh = new THREE.Mesh(geometry, material.clone());
  return mesh;
};

// Inventory slots for 3D display
interface InventorySlot {
  mesh: THREE.Mesh;
  name: string;
  type: string;
  index: number;
}

const inventorySlots: InventorySlot[] = [];
const iconSpacing = 0.7; // Space between icons

// Inventory items
const INITIAL_INVENTORY: InventoryItem[] = [
  // Resources
  { name: 'Raw Ore', type: 'resource', count: 0, max: 100 },
  { name: 'Water Ice', type: 'resource', count: 0, max: 100 },
  { name: 'Iron Metal', type: 'resource', count: 0, max: 50 },
  { name: 'Titanium', type: 'resource', count: 0, max: 50 },
  // Crafted items
  { name: 'O2 Canister', type: 'crafted', count: 0, max: 10 },
  { name: 'H2 Canister', type: 'crafted', count: 0, max: 10 },
  { name: 'Tech Chips', type: 'crafted', count: 0, max: 99 },
];

// Create slots for each item in INITIAL_INVENTORY
INITIAL_INVENTORY.forEach((item, idx) => {
  const icon = createInventoryIcon(item.name);
  icon.position.x = -2 + (idx % 4) * iconSpacing; // 4 items per row
  icon.position.y = 1 - Math.floor(idx / 4) * iconSpacing; // Multiple rows
  icon.position.z = -0.05; // Slightly in front of panel
  icon.visible = false; // Hidden until count > 0

  inventorySlots.push({ mesh: icon, name: item.name, type: item.type, index: idx });
});

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
  buildType: BuildableStructureType;
}

const INITIAL_GAME_STATE: GameState = {
  isPaused: false,
  gameOver: false,
  buildMode: false,
  buildType: 'dome',
};

// ====================== Save/Load Callback Props ======================
export interface Survival3DProps {
  onGetState?: () => any;
  onRestoreState?: (state: any) => void;
  newGame?: () => void;
}

export function Survival3D({ onGetState, onRestoreState, newGame }: Survival3DProps = {}) {
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
  const [uiBuildType, setUiBuildType] = useState<BuildableStructureType>('dome');
  const [uiCompassHeading, setUiCompassHeading] = useState('E');
  const [uiSmelterStatus, setUiSmelterStatus] = useState<string>(''); // hovered smelter status
  const [uiLowO2Warning, setUiLowO2Warning] = useState(false); // low O2 warning state
  const [uiDeathSequence, setUiDeathSequence] = useState(false); // death sequence playing
  const [uiCrafting, setUiCrafting] = useState(false); // crafting UI shown

  // Inventory UI state
  const [uiInventoryOpen, setUiInventoryOpen] = useState(false);
  const [uiInventoryItems, setUiInventoryItems] = useState<InventoryItem[]>(INITIAL_INVENTORY.slice());
  const [uiEquippedTool, setUiEquippedTool] = useState<ToolType>('repair-tool');

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerRef = useRef<THREE.Group | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null); // Lighting ref for inside/outside adjustment

  // Game-world refs (mutated by loop, not React state)
  const asteroidsRef = useRef<Asteroid[]>([]);
  const structuresRef = useRef<BuiltStructure[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const miningBeamRef = useRef<THREE.Mesh | null>(null);    // laser beam visual while mining
  const miningRingRef = useRef<THREE.Mesh | null>(null);     // progress ring around mined asteroid
  const buildPreviewRef = useRef<THREE.Group | null>(null); // holographic build preview
  const inventoryPanelRef = useRef<InventoryPanel | null>(null); // holographic inventory panel

  // Resource refs (mirrored to UI state)
  const resourcesRef = useRef({ iron: 0, ice: 0, oxygen: 0, rawOre: 0, h2: 0, ironMetal: 0, titanium: 0 });
  const o2Ref = useRef(O2_MAX);
  const buildModeRef = useRef(false);
  const buildTypeRef = useRef<BuildableStructureType>('dome');
  const mouseDownRef = useRef(false);
  const gameOverRef = useRef(false);
  const inventoryOpenRef = useRef(false); // Track if inventory is open via I/Y key

  // Input refs
  const keysRef = useRef<Record<string, boolean>>({});
  const yawRef = useRef(0);    // horizontal look angle (radians) — kept from original
  const pitchRef = useRef(0);  // vertical look angle (radians)   — kept from original
  const gameLoopRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  // Gamepad look sensitivity (configurable)
  const lookSensitivityRef = useRef(1.0);

  // ====================== Save/Load Helpers ======================
  const buildSaveData = useCallback((): any => {
    if (!sceneRef.current || !playerRef.current || !cameraRef.current) {
      throw new Error('Cannot save: scene or camera not initialized');
    }

    const player = playerRef.current;
    const camera = cameraRef.current;

    return {
      version: '0.3.0',
      timestamp: Date.now(),
      player: {
        position: [player.position.x, player.position.y, player.position.z],
        rotation: [player.rotation.x, player.rotation.y, player.rotation.z],
        yaw: yawRef.current,
        pitch: pitchRef.current,
      },
      resources: {
        iron: resourcesRef.current.iron,
        ice: resourcesRef.current.ice,
        oxygen: resourcesRef.current.oxygen,
        rawOre: resourcesRef.current.rawOre,
        h2: resourcesRef.current.h2,
        ironMetal: resourcesRef.current.ironMetal,
        titanium: resourcesRef.current.titanium,
      },
      inventory: uiInventoryItems.map(item => ({
        name: item.name,
        type: item.type,
        count: item.count,
        max: item.max,
      })),
      equippedTool: uiEquippedTool,
      structures: structuresRef.current.map(structure => {
        const group = structure.group;
        return {
          type: structure.type,
          position: [group.position.x, group.position.y, group.position.z],
          rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
          integrity: structure.integrity ?? 100,
          smelterInventory: structure.inventory
            ? { rawOre: (structure.inventory as any).rawOre }
            : undefined,
          smelterProcessing: structure.smelterIsProcessing ?? false,
          smelterLastProcessTime: structure.smelterLastProcessTime ?? 0,
        };
      }),
      asteroids: asteroidsRef.current.map(asteroid => ({
        type: asteroid.type,
        position: [asteroid.mesh.position.x, asteroid.mesh.position.y, asteroid.mesh.position.z],
        rotation: [asteroid.mesh.rotation.x, asteroid.mesh.rotation.y, asteroid.mesh.rotation.z],
        scale: asteroid.mesh.scale.x,
        respawnTimer: asteroid.respawnTimer,
        isMined: asteroid.isMined,
      })),
      uiState: {
        buildMode: buildModeRef.current,
        buildType: buildTypeRef.current,
        lowO2Warning: uiLowO2Warning,
        deathSequence: uiDeathSequence,
      },
    };
  }, [
    uiInventoryItems,
    uiEquippedTool,
    uiLowO2Warning,
    uiDeathSequence,
  ]);

  const restoreSaveData = useCallback((data: any) => {
    if (!sceneRef.current || !playerRef.current) {
      console.error('Cannot restore: scene or player not initialized');
      return;
    }

    console.log('Restoring save data:', data);

    // Restore player state
    const player = playerRef.current;
    const camera = cameraRef.current;

    if (data.player) {
      player.position.set(data.player.position[0], data.player.position[1], data.player.position[2]);
      player.rotation.set(data.player.rotation[0], data.player.rotation[1], data.player.rotation[2]);
      yawRef.current = data.player.yaw ?? 0;
      pitchRef.current = data.player.pitch ?? 0;
      if (camera) {
        camera.position.set(player.position.x, data.player.position[1], player.position.z);
        const dir = new THREE.Vector3(
          Math.sin(yawRef.current) * Math.cos(pitchRef.current),
          Math.sin(pitchRef.current),
          Math.cos(yawRef.current) * Math.cos(pitchRef.current),
        );
        camera.lookAt(player.position.x + dir.x, player.position.y + dir.y, player.position.z + dir.z);
      }
    }

    // Restore resources
    if (data.resources) {
      resourcesRef.current.iron = data.resources.iron ?? 0;
      resourcesRef.current.ice = data.resources.ice ?? 0;
      resourcesRef.current.oxygen = data.resources.oxygen ?? 0;
      resourcesRef.current.rawOre = data.resources.rawOre ?? 0;
      resourcesRef.current.h2 = data.resources.h2 ?? 0;
      resourcesRef.current.ironMetal = data.resources.ironMetal ?? 0;
      resourcesRef.current.titanium = data.resources.titanium ?? 0;
      setUiIron(resourcesRef.current.iron);
      setUiIce(resourcesRef.current.ice);
      setUiOxygen(resourcesRef.current.oxygen);
      setUiRawOre(resourcesRef.current.rawOre);
      setUiH2(resourcesRef.current.h2);
      setUiIronMetal(resourcesRef.current.ironMetal);
      setUiTitaniumMetal(resourcesRef.current.titanium);
    }

    // Restore inventory
    if (data.inventory && Array.isArray(data.inventory)) {
      // Preserve existing inventory items, but update counts
      const itemMap = new Map<string, InventoryItem>();
      for (const item of uiInventoryItems) {
        itemMap.set(item.name, item);
      }
      for (const savedItem of data.inventory) {
        const existing = itemMap.get(savedItem.name);
        if (existing) {
          existing.count = savedItem.count;
          existing.max = savedItem.max;
        } else {
          uiInventoryItems.push({
            name: savedItem.name,
            type: savedItem.type,
            count: savedItem.count,
            max: savedItem.max,
          });
        }
      }
      setUiInventoryItems([...uiInventoryItems]);
    }

    // Restore equipped tool
    if (data.equippedTool) {
      setUiEquippedTool(data.equippedTool);
    }

    // Restore structures
    // Clear existing structures
    for (const structure of structuresRef.current) {
      sceneRef.current?.remove(structure.group);
    }
    structuresRef.current = [];

    if (data.structures && Array.isArray(data.structures)) {
      for (const structData of data.structures) {
        const group = createStructureMesh(structData.type);
        group.position.set(structData.position[0], structData.position[1], structData.position[2]);
        group.rotation.set(structData.rotation[0], structData.rotation[1], structData.rotation[2]);
        sceneRef.current?.add(group);
        let structureType = structData.type;
        if (structData.type === 'smelter') {
          structureType = 'smelter';
          (group as any).smelterInventory = { rawOre: structData.smelterInventory?.rawOre ?? 0 };
          (group as any).smelterIsProcessing = structData.smelterProcessing ?? false;
          (group as any).smelterLastProcessTime = structData.smelterLastProcessTime ?? 0;
        }
        // Initialize smelter-specific state
        if (structData.type === 'smelter') {
          (group as any).smelterInventory = { rawOre: 0 };
          (group as any).smelterIsProcessing = false;
          (group as any).smelterProcessingProgress = 0;
          (group as any).smelterLastProcessTime = 0;
        }
        structuresRef.current.push({ group, type: structureType, integrity: structData.integrity ?? 100 });
      }
    }

    // Restore asteroids
    // Clear existing asteroids
    for (const asteroid of asteroidsRef.current) {
      sceneRef.current?.remove(asteroid.mesh);
      (asteroid.mesh.geometry as THREE.BufferGeometry).dispose();
      (asteroid.mesh.material as THREE.Material).dispose();
    }
    asteroidsRef.current = [];

    if (data.asteroids && Array.isArray(data.asteroids)) {
      for (const astData of data.asteroids) {
        const type = astData.type;
        const baseScale = astData.scale * (0.4 + Math.random() * 0.5);
        const mesh = createAsteroidMesh(type, baseScale);
        mesh.position.set(astData.position[0], astData.position[1], astData.position[2]);
        mesh.rotation.set(astData.rotation[0], astData.rotation[1], astData.rotation[2]);
        sceneRef.current?.add(mesh);
        asteroidsRef.current.push({
          mesh,
          type,
          baseScale,
          currentScale: astData.scale,
          respawnTimer: astData.respawnTimer,
          isMined: astData.isMined,
          basePosition: mesh.position.clone(),
        });
      }
    }

    // Restore UI state
    if (data.uiState) {
      setUiLowO2Warning(data.uiState.lowO2Warning ?? false);
      setUiDeathSequence(data.uiState.deathSequence ?? false);
      setUiBuildMode(data.uiState.buildMode ?? false);
      setUiBuildType(data.uiState.buildType ?? 'dome');
    }

    console.log('Save data restored successfully');
  }, []);

  // Expose game state for save/load callbacks
  useEffect(() => {
    if (onGetState) {
      // Build state object for saving
      const player = playerRef.current;
      const camera = cameraRef.current;
      const state = {
        player: player ? {
          position: [player.position.x, player.position.y, player.position.z],
          rotation: [player.rotation.x, player.rotation.y, player.rotation.z],
          yaw: yawRef.current,
          pitch: pitchRef.current,
        } : null,
        resources: {
          iron: resourcesRef.current.iron,
          ice: resourcesRef.current.ice,
          oxygen: resourcesRef.current.oxygen,
          rawOre: resourcesRef.current.rawOre,
          h2: resourcesRef.current.h2,
          ironMetal: resourcesRef.current.ironMetal,
          titanium: resourcesRef.current.titanium,
        },
        inventory: uiInventoryItems.map(item => ({
          name: item.name,
          type: item.type,
          count: item.count,
          max: item.max,
        })),
        equippedTool: uiEquippedTool,
        structures: structuresRef.current.map(structure => ({
          type: structure.type,
          position: [structure.group.position.x, structure.group.position.y, structure.group.position.z],
          rotation: [structure.group.rotation.x, structure.group.rotation.y, structure.group.rotation.z],
          integrity: structure.integrity ?? 100,
          smelterInventory: structure.inventory
            ? { rawOre: (structure.inventory as any).rawOre }
            : undefined,
          smelterProcessing: structure.smelterIsProcessing ?? false,
          smelterLastProcessTime: structure.smelterLastProcessTime ?? 0,
        })),
        asteroids: asteroidsRef.current.map(asteroid => ({
          type: asteroid.type,
          position: [asteroid.mesh.position.x, asteroid.mesh.position.y, asteroid.mesh.position.z],
          rotation: [asteroid.mesh.rotation.x, asteroid.mesh.rotation.y, asteroid.mesh.rotation.z],
          scale: asteroid.currentScale,
          respawnTimer: asteroid.respawnTimer,
          isMined: asteroid.isMined,
        })),
        uiState: {
          buildMode: buildModeRef.current,
          buildType: buildTypeRef.current,
          lowO2Warning: uiLowO2Warning,
          deathSequence: uiDeathSequence,
        },
      };
      onGetState(state);
    }
  }, [
    uiInventoryItems,
    uiEquippedTool,
    uiLowO2Warning,
    uiDeathSequence,
    playerRef.current,
    cameraRef.current,
    yawRef.current,
    pitchRef.current,
    resourcesRef.current,
    structuresRef.current,
    asteroidsRef.current,
    buildModeRef.current,
    buildTypeRef.current,
  ]);

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

    // Start processing if not already processing
    nearbySmelter.isProcessing = true;
    nearbySmelter.processingProgress = 0;

    // Create deposit particles at smelter intake
    createParticles(nearbySmelter.group.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 5, 0x888888);

    return true;
  };

  // Deposit water ice to refinery (called on G key press)
  const depositWaterIce = (): boolean => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return false;

    // Find all refineries
    const refineries = structuresRef.current.filter(s => s.type === 'refinery');
    if (refineries.length === 0) return false;

    // Check if any refinery is within range (SMELTER_DEPOSIT_RANGE)
    let nearbyRefinery = null;
    for (const refinery of refineries) {
      const dist = refinery.group.position.distanceTo(camera.position);
      if (dist <= SMELTER_DEPOSIT_RANGE) {
        nearbyRefinery = refinery;
        break;
      }
    }

    if (!nearbyRefinery) return false;

    // Check if player has water ice
    if (resourcesRef.current.ice < 1) return false;

    // Deduct water ice and add to refinery inventory
    resourcesRef.current.ice -= 1;
    setUiIce(resourcesRef.current.ice);
    if (nearbyRefinery.refineryInventory) {
      nearbyRefinery.refineryInventory.waterIce += 1;
    }

    // Create deposit particles at refinery intake (blue ice particles)
    createParticles(nearbyRefinery.group.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 5, 0x00aaff);

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

  // ====================== Gamepad Input ======================
  const gamepadIndexRef = useRef<number | null>(null);
  const gamepadEnabledRef = useRef(false);
  const leftStickRef = useRef(new THREE.Vector3(0, 0, 0));
  const rightStickRef = useRef(new THREE.Vector3(0, 0, 0));
  const buttonAPressedRef = useRef(false);
  const buttonBPressedRef = useRef(false);
  const buttonXPressedRef = useRef(false);
  const buttonYPressedRef = useRef(false);
  const lbTriggerRef = useRef(false);
  const rbTriggerRef = useRef(false);
  const dpadUpRef = useRef(false);
  const dpadDownRef = useRef(false);
  const dpadLeftRef = useRef(false);
  const dpadRightRef = useRef(false);

  // Gamepad connected listener
  useEffect(() => {
    const handleGamepadConnect = (e: GamepadEvent) => {
      console.log('Gamepad connected:', e.gamepad.id);
      gamepadIndexRef.current = e.gamepad.index;
      gamepadEnabledRef.current = true;
    };

    const handleGamepadDisconnect = (e: GamepadEvent) => {
      console.log('Gamepad disconnected');
      gamepadEnabledRef.current = false;
      gamepadIndexRef.current = null;
    };

    window.addEventListener('gamepadconnected', handleGamepadConnect);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnect);

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnect);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnect);
    };
  }, []);

  const updateGamepadInput = (dt: number) => {
    if (!gamepadEnabledRef.current || gamepadIndexRef.current === null) {
      // Reset input to keyboard-only if no gamepad
      leftStickRef.current.set(0, 0, 0);
      rightStickRef.current.set(0, 0, 0);
      buttonAPressedRef.current = false;
      buttonBPressedRef.current = false;
      buttonXPressedRef.current = false;
      buttonYPressedRef.current = false;
      lbTriggerRef.current = false;
      rbTriggerRef.current = false;
      dpadUpRef.current = false;
      dpadDownRef.current = false;
      dpadLeftRef.current = false;
      dpadRightRef.current = false;
      return;
    }

    const gamepad = navigator.getGamepads()[gamepadIndexRef.current];
    if (!gamepad) {
      gamepadEnabledRef.current = false;
      gamepadIndexRef.current = null;
      return;
    }

    // Read analog sticks (normalize to -1..1, then scale to movement speed)
    const leftStickX = gamepad.axes[0];
    const leftStickY = gamepad.axes[1];
    const rightStickX = gamepad.axes[2];
    const rightStickY = gamepad.axes[3];

    // Deadzone threshold for sticks
    const deadzone = 0.15;
    const normalizeInput = (val: number) => {
      if (Math.abs(val) < deadzone) return 0;
      return Math.sign(val) * Math.sqrt(val * val);
    };

    leftStickRef.current.set(
      normalizeInput(leftStickX),
      normalizeInput(leftStickY),
      0  // Z not used for left stick
    ).multiplyScalar(PLAYER_SPEED * dt);

    rightStickRef.current.set(
      normalizeInput(rightStickX),
      -normalizeInput(rightStickY),  // Flip Y for natural look
      0
    ).multiplyScalar(2 * lookSensitivityRef.current * dt);  // Apply configurable sensitivity

    // Read buttons
    buttonAPressedRef.current = gamepad.buttons[0]?.pressed ?? false;           // A button
    buttonBPressedRef.current = gamepad.buttons[1]?.pressed ?? false;           // B button
    buttonXPressedRef.current = gamepad.buttons[2]?.pressed ?? false;           // X button
    buttonYPressedRef.current = gamepad.buttons[3]?.pressed ?? false;           // Y button
    lbTriggerRef.current = gamepad.buttons[4]?.pressed ?? false;               // L1 shoulder
    rbTriggerRef.current = gamepad.buttons[5]?.pressed ?? false;               // R1 shoulder
    dpadUpRef.current = gamepad.buttons[12]?.pressed ?? false;                 // D-pad up
    dpadDownRef.current = gamepad.buttons[13]?.pressed ?? false;               // D-pad down
    dpadLeftRef.current = gamepad.buttons[14]?.pressed ?? false;               // D-pad left
    dpadRightRef.current = gamepad.buttons[15]?.pressed ?? false;              // D-pad right
  };

  // ====================== Structure Proximity Detection ======================
  const getNearbyStructure = (): { structure: Structure; distance: number; inside: boolean } | null => {
    const camera = cameraRef.current;
    if (!camera) return null;

    const nearby = structuresRef.current
      .map(s => ({
        structure: s,
        distance: s.group.position.distanceTo(camera.position),
        inside: s.group.position.distanceTo(camera.position) < 4, // Inside if within 4 units
      }))
      .filter(item => item.distance < 10) // Only structures within 10 units
      .sort((a, b) => a.distance - b.distance)[0]; // Closest

    if (!nearby) return null;
    return { ...nearby };
  };

  const isInsidePressurizedStructure = (): boolean => {
    const nearby = getNearbyStructure();
    return nearby?.inside ?? false;
  };

  // ====================== Enter/Exit Structure (Airlock) ======================
  const enterStructure = (structure: Structure, camera: THREE.PerspectiveCamera) => {
    // Check if already inside
    if (structure.isInterior) return;

    // Check airlock
    if (structure.airlockOpen !== true) {
      // Open airlock door
      structure.airlockOpen = true;
      structure.airlockTimer = 0;

      // Animate exterior shell fading (airlock transition)
      structure.group.traverse(child => {
        if (child instanceof THREE.Mesh && child.userData.isExterior) {
          (child.material as THREE.MeshStandardMaterial).transparent = true;
          (child.material as THREE.MeshStandardMaterial).opacity = 0.4;
        }
      });
    }

    // Calculate camera position at airlock entrance
    const entryPosition = structure.group.position.clone();
    entryPosition.x += 5; // Entrance at the front of the structure
    entryPosition.y = PLAYER_HEIGHT;

    // Smoothly move player (camera) to entry position
    const entryTime = 1.5; // seconds for airlock transition
    const startPos = camera.position.clone();
    const progress = { elapsed: 0 };

    const animateAirlock = () => {
      progress.elapsed += 1/60; // Approx 60fps

      if (progress.elapsed < entryTime) {
        const t = progress.elapsed / entryTime;
        // Ease in-out cubic
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        camera.position.lerpVectors(startPos, entryPosition, ease);
        camera.lookAt(entryPosition);
      } else {
        // Completed airlock transition
        camera.position.copy(entryPosition);
        camera.lookAt(entryPosition);
        structure.isInterior = true;
        structure.airlockOpen = true;
        structure.airlockTimer = 0;

        // Set camera offset for inside movement
        structure.interiorCameraOffset = new THREE.Vector3(0, PLAYER_HEIGHT, 0);

        // Update UI
        setUiLowO2Warning(false);

        console.log(`Entered ${structure.type} structure`);
      }
    };

    // Start airlock animation
    const airlockLoop = setInterval(() => {
      animateAirlock();

      if (progress.elapsed >= entryTime) {
        clearInterval(airlockLoop);
      }
    }, 1000 / 60);
  };

  const exitStructure = (structure: Structure) => {
    // Check if already outside
    if (!structure.isInterior) return;

    // Close airlock
    structure.airlockOpen = false;
    structure.isInterior = false;
    structure.airlockTimer = 0;

    // Reset camera offset
    structure.interiorCameraOffset = undefined;

    // Update ambient light
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = 0.6;
    }

    // Make exterior shell visible again
    structure.group.traverse(child => {
      if (child instanceof THREE.Mesh && child.userData.isExterior) {
        (child.material as THREE.MeshStandardMaterial).transparent = true;
        (child.material as THREE.MeshStandardMaterial).opacity = 0.4;
      }
    });

    console.log(`Exited ${structure.type} structure`);
  };

  // Update interior/exterior visibility based on player position
  const updateInteriorVisibility = () => {
    const camera = cameraRef.current;
    if (!camera) return;

    const nearby = getNearbyStructure();
    const inPressurized = nearby?.inside ?? false;

    structuresRef.current.forEach(structure => {
      structure.isInteriorVisible = inPressurized;

      // Update exterior shell visibility (hide when inside)
      structure.group.traverse(child => {
        if (child instanceof THREE.Mesh && child.userData.isExterior) {
          child.visible = !inPressurized;
        }
      });
    });

    // Adjust ambient light based on inside/outside state
    if (ambientLightRef.current) {
      const targetIntensity = inPressurized ? 0.15 : 0.6;
      ambientLightRef.current.intensity += (targetIntensity - ambientLightRef.current.intensity) * 0.5;
    }
  };

  // ====================== Build structure meshes ======================
  const createDomeMesh = (): THREE.Group => {
    const group = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(2, 1);
    // Exteriors dome shell (transparent, visible from outside)
    const exteriorMat = new THREE.MeshStandardMaterial({
      color: 0x00ff66,
      metalness: 0.1,
      roughness: 0.3,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const exterior = new THREE.Mesh(geo, exteriorMat);
    exterior.position.y = 2;
    exterior.userData = { isExterior: true, isDome: true }; // Mark as exterior shell
    group.add(exterior);

    // Wireframe overlay for geodesic look (exterior)
    const wireGeo = new THREE.WireframeGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.6 });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    wire.position.y = 2;
    group.add(wire);

    // Interior dome shell (opaque, visible from inside)
    const interiorMat = new THREE.MeshStandardMaterial({
      color: 0xddffdd,
      metalness: 0.1,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    const interiorShell = new THREE.Mesh(geo, interiorMat);
    interiorShell.position.y = 2;
    group.add(interiorShell);

    // Floor
    const floorGeo = new THREE.CircleGeometry(1.8, 32);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.5,
      roughness: 0.7,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.05;
    group.add(floor);

    // Interior light (warm, ambient)
    const interiorLight = new THREE.PointLight(0xffaa55, 0.8, 8);
    interiorLight.position.set(0, 2, 0);
    interiorLight.name = "domeInteriorLight";
    group.add(interiorLight);
    (group as any).interiorLight = interiorLight;

    // Wall decorations (panels, vents)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const panelGeo = new THREE.BoxGeometry(0.3, 1.5, 0.1);
      const panelMat = new THREE.MeshStandardMaterial({
        color: 0x444444,
        metalness: 0.6,
        roughness: 0.4,
      });
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.set(Math.cos(angle) * 1.5, 1.5, Math.sin(angle) * 1.5);
      panel.rotation.y = angle;
      group.add(panel);
    }

    // Window frames showing exterior stars
    const windowGeo = new THREE.CircleGeometry(0.4, 16);
    const windowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const window1 = new THREE.Mesh(windowGeo, windowMat);
    window1.position.set(0, 2, -1.8);
    group.add(window1);

    // Window glow (stars visible through window)
    const starlightMat = new THREE.MeshBasicMaterial({
      color: 0x6699ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const starlight = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), starlightMat);
    starlight.position.set(0, 2, -1.9);
    group.add(starlight);

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
    body.userData = { isExterior: true }; // Mark as exterior for airlock
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

  const createRefineryMesh = (): THREE.Group => {
    const group = new THREE.Group();
    // Main cylinder body (horizontal for refinery)
    const bodyGeo = new THREE.CylinderGeometry(1.5, 1.5, 3, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      metalness: 0.8,
      roughness: 0.4,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.z = Math.PI / 2; // Horizontal
    body.position.y = 1.5;
    body.userData = { isExterior: true }; // Mark as exterior for airlock
    group.add(body);
    
    // Interior chamber (visible when processing)
    const chamberGeo = new THREE.CylinderGeometry(1.0, 1.0, 2.5, 16);
    const chamberMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0,
    });
    const chamber = new THREE.Mesh(chamberGeo, chamberMat);
    chamber.rotation.z = Math.PI / 2;
    chamber.position.y = 1.5;
    group.add(chamber);
    (group as any).refineryChamber = chamber;
    
    // Intake ports on both ends (water ice in)
    const portGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.6, 12);
    const portMat = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      metalness: 0.8,
      roughness: 0.3,
    });
    const port1 = new THREE.Mesh(portGeo, portMat);
    port1.rotation.z = Math.PI / 2;
    port1.position.set(-1.8, 0.6, 0);
    group.add(port1);
    
    const port2 = new THREE.Mesh(portGeo, portMat);
    port2.rotation.z = Math.PI / 2;
    port2.position.set(1.8, 0.6, 0);
    group.add(port2);
    
    // Output pipes on sides (O2 and H2 out)
    const pipeH2 = new THREE.CylinderGeometry(0.15, 0.15, 1.0, 8);
    const pipeMatH2 = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      metalness: 0.9,
      roughness: 0.2,
    });
    const h2Pipe = new THREE.Mesh(pipeH2, pipeMatH2);
    h2Pipe.rotation.z = Math.PI / 2;
    h2Pipe.position.set(1.8, 2.5, 0);
    group.add(h2Pipe);
    h2Pipe.userData = { type: 'h2' };
    
    const pipeO2 = new THREE.CylinderGeometry(0.15, 0.15, 1.0, 8);
    const pipeMatO2 = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      metalness: 0.9,
      roughness: 0.2,
    });
    const o2Pipe = new THREE.Mesh(pipeO2, pipeMatO2);
    o2Pipe.rotation.z = Math.PI / 2;
    o2Pipe.position.set(1.8, 1.0, 0);
    group.add(o2Pipe);
    o2Pipe.userData = { type: 'o2' };
    
    // Control panel
    const panelGeo = new THREE.BoxGeometry(0.8, 0.5, 0.2);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      metalness: 0.9,
      roughness: 0.3,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 3.0, 0);
    panel.rotation.y = -Math.PI / 2;
    group.add(panel);
    
    return group;
  };

  const createStructureMesh = (type: BuildableStructureType): THREE.Group => {
    if (type === 'dome') return createDomeMesh();
    if (type === 'solar') return createSolarPanelMesh();
    if (type === 'o2generator') return createO2GeneratorMesh();
    if (type === 'smelter') return createSmelterMesh();
    if (type === 'refinery') return createRefineryMesh();
    if (type === 'fabricator') return createFabricatorMesh();
    return new THREE.Group();
  };

  // ====================== Fabricator Module Mesh ======================
  const createFabricatorMesh = (): THREE.Group => {
    const group = new THREE.Group();

    // Main rectangular body
    const bodyGeo = new THREE.BoxGeometry(2, 1.5, 3);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      metalness: 0.9,
      roughness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.25;
    body.userData = { isExterior: true };
    group.add(body);

    // Front workbench surface
    const surfaceGeo = new THREE.BoxGeometry(1.8, 0.1, 0.5);
    const surfaceMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      metalness: 0.8,
      roughness: 0.4,
    });
    const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
    surface.position.set(0, 0.8, 1.5);
    surface.rotation.x = -0.3; // Slight incline
    group.add(surface);

    // Holographic crafting display (3D UI in front)
    const displayGeo = new THREE.PlaneGeometry(1.5, 1);
    const displayMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const display = new THREE.Mesh(displayGeo, displayMat);
    display.position.set(0, 1.0, 1.8);
    (group as any).craftingDisplay = display;
    group.add(display);

    // Glowing frame around display
    const frameGeo = new THREE.EdgesGeometry(displayGeo);
    const frameMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 });
    const frame = new THREE.LineSegments(frameGeo, frameMat);
    frame.position.set(0, 1.0, 1.8);
    group.add(frame);

    // Control panel
    const panelGeo = new THREE.BoxGeometry(1, 0.4, 0.3);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.8,
      roughness: 0.3,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 2.0, 0);
    group.add(panel);

    // Status light
    const lightGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const statusLight = new THREE.Mesh(lightGeo, lightMat);
    statusLight.position.set(0, 2.0, 0.8);
    (group as any).statusLight = statusLight;
    group.add(statusLight);

    return group;
  };

  // ====================== Fabricator Crafting Display ======================
  const createCraftingDisplay = (structure: BuiltStructure) => {
    const group = new THREE.Group();
    group.visible = false; // Hidden by default

    // Background panel
    const panelGeo = new THREE.BoxGeometry(1.6, 1.2, 0.1);
    const panelMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    group.add(panel);

    // Title
    const titleGeo = new THREE.PlaneGeometry(1.4, 0.3);
    const titleMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const title = new THREE.Mesh(titleGeo, titleMat);
    title.position.set(0, 0.5, 0.06);
    title.rotation.x = -0.3;
    group.add(title);

    // Item display slots
    const recipes = [
      { id: 'jetpack-mk1', name: 'Jetpack Mk1', cost: '5 Metals', desc: 'Slow upward thrust' },
      { id: 'jetpack-mk2', name: 'Jetpack Mk2', cost: '10 Metals + 5 H2', desc: 'Faster thrust, longer duration' },
      { id: 'air-tank', name: 'Air Tank', cost: '3 Metals', desc: '+50 O2 capacity (max 150)' },
      { id: 'mining-drill-mk2', name: 'Mining Drill Mk2', cost: '5 Metals', desc: '2x mining speed' },
      { id: 'repair-tool', name: 'Repair Tool', cost: '3 Metals', desc: 'Repair damaged modules' },
      { id: 'scanner', name: 'Scanner', cost: '5 Metals', desc: 'Reveal asteroid types' },
    ];

    const slotSize = 0.3;
    const slotSpacing = 0.5;
    const startY = 0.0;

    recipes.forEach((recipe, idx) => {
      // Item icon (rotating cube representing crafted item)
      const iconGeo = new THREE.BoxGeometry(slotSize, slotSize, slotSize);
      const iconMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.6,
        wireframe: true,
      });
      const icon = new THREE.Mesh(iconGeo, iconMat);
      icon.position.set(-0.4, startY + (idx % 2) * slotSpacing + slotSize, 0.1);
      icon.userData = { recipeId: recipe.id, rotate: true };
      group.add(icon);

      // Item name
      const nameGeo = new THREE.PlaneGeometry(0.4, 0.15);
      const nameMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const name = new THREE.Mesh(nameGeo, nameMat);
      name.position.set(0, startY + (idx % 2) * slotSpacing + slotSize, 0.11);
      name.rotation.x = -0.3;
      name.userData = { recipeId: recipe.id, text: recipe.name };
      group.add(name);

      // Cost text
      const costGeo = new THREE.PlaneGeometry(0.5, 0.1);
      const costMat = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const cost = new THREE.Mesh(costGeo, costMat);
      cost.position.set(0.4, startY + (idx % 2) * slotSpacing + slotSize, 0.11);
      cost.rotation.x = -0.3;
      cost.userData = { recipeId: recipe.id, text: recipe.cost };
      group.add(cost);

      // Description
      const descGeo = new THREE.PlaneGeometry(0.6, 0.1);
      const descMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      });
      const desc = new THREE.Mesh(descGeo, descMat);
      desc.position.set(0, startY + (idx % 2) * slotSpacing - slotSpacing / 2, 0.11);
      desc.rotation.x = -0.3;
      desc.userData = { recipeId: recipe.id, text: recipe.desc };
      group.add(desc);
    });

    // Back button indicator
    const backGeo = new THREE.PlaneGeometry(0.3, 0.15);
    const backMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.set(0, -0.6, 0.06);
    back.rotation.x = -0.3;
    (group as any).backButton = back;
    group.add(back);

    return group;
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

  // ====================== Grid placement helpers ======================

  // Helper: snap coordinates to 4x4 tile grid (BUILD_GRID_SIZE units)
  const snapToGrid = (point: THREE.Vector3): THREE.Vector3 => {
    return new THREE.Vector3(
      Math.round(point.x / BUILD_GRID_SIZE) * BUILD_GRID_SIZE,
      point.y,
      Math.round(point.z / BUILD_GRID_SIZE) * BUILD_GRID_SIZE
    );
  };

  // Helper: check if placement is within 3m of an existing module (adjacency rule)
  const checkAdjacency = (point: THREE.Vector3): boolean => {
    const adjacencyDist = 3;
    for (const structure of structuresRef.current) {
      const dist = structure.group.position.distanceTo(point);
      if (dist < adjacencyDist) {
        return true; // Adjacent to existing module
      }
    }
    return false; // Not adjacent to any module
  };

  // Helper: validate build placement and update preview mesh visibility/color
  const validateBuildPlacement = (point: THREE.Vector3): { valid: boolean; message?: string } => {
    // First module: can be placed anywhere (to start your station)
    if (structuresRef.current.length === 0) {
      return { valid: true, message: 'Start building your station' };
    }

    const adjacent = checkAdjacency(point);
    if (!adjacent) {
      return { valid: false, message: 'Module must connect to existing structure' };
    }

    return { valid: true };
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

    // Snap to grid
    const snappedPoint = snapToGrid(point);
    const validation = validateBuildPlacement(snappedPoint);
    if (!validation.valid) {
      // Show red invalid preview
      const group = buildPreviewRef.current;
      if (group) {
        group.position.copy(snappedPoint);
        group.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const m = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
            if ('transparent' in m && m.transparent && 'opacity' in m) {
              m.opacity = 0.4;
              // Red tint for invalid
              if (m.color) {
                (m as any).originalColor = m.color.getHex();
                m.color.setHex(0xff0000);
              }
            }
          }
        });
      }
      return false; // Don't place
    }

    // Deduct resources
    r.iron -= info.costIron;
    r.ice -= info.costIce;
    r.rawOre -= info.costRawOre;
    setUiIron(r.iron);
    setUiIce(r.ice);
    setUiRawOre(r.rawOre);
    // Create structure at snapped grid point
    const group = createStructureMesh(type);
    group.position.copy(snappedPoint);
    scene.add(group);
    let structureType: BuildableStructureType = type;
    // Initialize smelter-specific state
    if (type === 'smelter') {
      structureType = 'smelter';
      (group as any).smelterInventory = { rawOre: 0 };
      (group as any).smelterIsProcessing = false;
      (group as any).smelterProcessingProgress = 0;
      (group as any).smelterLastProcessTime = 0;
    }
    structuresRef.current.push({ group, type: structureType });
    // Update airlock state if pressurized module (dome, fabricator, o2generator, storage)
    if (type === 'dome' || type === 'fabricator' || type === 'o2generator' || type === 'storage') {
      (group as any).isInteriorVisible = false;
      (group as any).isInterior = false;
    }
    // Small particle puff
    createParticles(snappedPoint.clone().setY(0.5), 8, 0x00ffff);
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

    // Lighting - will be modified when inside pressurized structure
    ambientLightRef.current = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLightRef.current);
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

    // 3D holographic inventory panel — created once, shown/hidden
    const inventoryPanelGroup = createInventoryPanel();
    scene.add(inventoryPanelGroup);
    
    // Add 3D icons for inventory items to panel
    inventorySlots.forEach((slot, idx) => {
      inventoryPanelGroup.add(slot.mesh);
    });
    
    inventoryPanelRef.current = { group: inventoryPanelGroup, isVisible: false };

    // Make preview materials translucent holographic
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
    // Ensure fabricator preview works too
    if (initPreview) {
      (initPreview as any).userData.type = 'fabricator';
    }

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
      // E key: Enter/Exit pressurized station modules
      if (e.code === 'KeyE') {
        const nearby = getNearbyStructure();
        if (nearby && nearby.structure) {
          const structure = nearby.structure;
          if (structure.isInterior) {
            // Exit structure
            exitStructure(structure);
          } else {
            // Enter structure (only pressurized modules: dome, o2generator, storage)
            if (structure.type === 'dome' || structure.type === 'o2generator' || structure.type === 'storage') {
              enterStructure(structure, cameraRef.current!);
            }
          }
        }
        return;
      }
      if (gameOverRef.current) return;
      // I or Y to toggle inventory or craft at fabricator
      if (e.code === 'KeyI' || e.code === 'KeyY') {
        inventoryOpenRef.current = !inventoryOpenRef.current;
        setUiInventoryOpen(inventoryOpenRef.current);
        if (inventoryOpenRef.current) {
          setGameState(prev => ({ ...prev, buildMode: false }));
          setUiBuildMode(false);
          buildModeRef.current = false;
        } else {
          // Check if near fabricator for crafting
          const camera = cameraRef.current;
          if (camera) {
            for (const structure of structuresRef.current) {
              if (structure.type === 'fabricator' && structure.group.position.distanceTo(camera.position) <= BUILD_RANGE) {
                setUiCrafting(true); // Show crafting UI
              }
            }
          }
        }
        return;
      }
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
      // 1/2/3/4/5/6/R select build type (only in build mode)
      if (buildModeRef.current) {
        if (e.code === 'Digit1') { buildTypeRef.current = 'dome';        setUiBuildType('dome');        updateBuildPreviewMesh('dome'); }
        if (e.code === 'Digit2') { buildTypeRef.current = 'solar';       setUiBuildType('solar');       updateBuildPreviewMesh('solar'); }
        if (e.code === 'Digit3') { buildTypeRef.current = 'o2generator'; setUiBuildType('o2generator'); updateBuildPreviewMesh('o2generator'); }
        if (e.code === 'Digit4') { buildTypeRef.current = 'smelter';     setUiBuildType('smelter');     updateBuildPreviewMesh('smelter'); }
        if (e.code === 'Digit5') { buildTypeRef.current = 'refinery';    setUiBuildType('refinery');    updateBuildPreviewMesh('refinery'); }
        if (e.code === 'Digit6') { buildTypeRef.current = 'storage';     setUiBuildType('storage');     updateBuildPreviewMesh('storage'); }
        if (e.code === 'KeyR')   { buildTypeRef.current = 'signalrelay'; setUiBuildType('signalrelay'); updateBuildPreviewMesh('signalrelay'); }
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
    function updateBuildPreviewMesh(type: BuildableStructureType) {
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
            // Default cyan/green for valid, will be overridden to red for invalid
            if (m.color && !('originalColor' in m)) {
              (m as any).originalColor = m.color.getHex();
            }
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
        updateGame(dt, timestamp);
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

      // ===== Inventory panel visibility =====
      if (inventoryPanelRef.current) {
        const panel = inventoryPanelRef.current;
        const shouldShow = inventoryOpenRef.current && !gameOverRef.current;
        
        // Update visibility
        if (panel.isVisible !== shouldShow) {
          panel.group.visible = shouldShow;
          panel.isVisible = shouldShow;
        }

        // Position panel in front of player camera (3D holographic screen)
        if (shouldShow && camera) {
          const panelDist = 3; // Distance from camera
          const panelX = camera.position.x - Math.sin(yawRef.current) * Math.sin(pitchRef.current) * panelDist;
          const panelY = camera.position.y + Math.cos(pitchRef.current) * panelDist;
          const panelZ = camera.position.z - Math.cos(yawRef.current) * Math.sin(pitchRef.current) * panelDist;
          
          panel.group.position.set(panelX, panelY, panelZ);
          panel.group.lookAt(camera.position);
        }
      }

      // ===== Oxygen depletion =====
      if (!gameOverRef.current) {
        const inPressurized = isInsidePressurizedStructure();

        // Adjust ambient light based on inside/outside state
        if (ambientLightRef.current) {
          const targetIntensity = inPressurized ? 0.15 : 0.6;
          ambientLightRef.current.intensity += (targetIntensity - ambientLightRef.current.intensity) * dt * 2;
        }

        // Initialize audio context on first need
        if (audioContext === null && o2Ref.current <= O2_LOW_WARNING_THRESHOLD && !inPressurized) {
          audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        // O2 depletion only happens in vacuum
        if (!inPressurized) {
          o2Ref.current -= O2_DEPLETION_PER_SEC * dt;
          setUiO2(Math.max(0, o2Ref.current));

          // Low O2 warning when below threshold
          const o2Percent = o2Ref.current / O2_MAX;
          setUiLowO2Warning(o2Percent < O2_LOW_WARNING_THRESHOLD / O2_MAX);

          // Audio heartbeat when O2 < 20
          if (audioContext !== null && o2Ref.current <= O2_LOW_WARNING_THRESHOLD) {
            // Create pulsing heartbeat sound
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
              
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(60, audioContext.currentTime); // Low heartbeat
            oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.1);
              
            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.05);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
              
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
              
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
          }

          // Spawn O2 vent particles near O2 sources
          if (Math.random() < dt * O2_VENT_PARTICLE_RATE) {
            // Find nearby O2 sources (refinery output, oxygen crystal)
            let nearbyO2Source = null;
            for (const asteroid of asteroidsRef.current) {
              if (asteroid.type === 'oxygen' && asteroid.isMined) {
                const dist = asteroid.mesh.position.distanceTo(camera.position);
                if (dist < 20) {
                  nearbyO2Source = asteroid.mesh.position;
                  break;
                }
              }
            }
            if (!nearbyO2Source) {
              // Check refinery output
              for (const structure of structuresRef.current) {
                if (structure.type === 'refinery' && structure.refineryInventory && structure.refineryInventory.waterIce > 0) {
                  const dist = structure.group.position.distanceTo(camera.position);
                  if (dist < 15) {
                    nearbyO2Source = structure.group.position;
                    break;
                  }
                }
              }
            }
              
            if (nearbyO2Source) {
              const spawnPos = nearbyO2Source.clone().add(new THREE.Vector3(
                (Math.random() - 0.5) * 4,
                Math.random() * 3,
                (Math.random() - 0.5) * 4
              ));
              createParticles(spawnPos, 1, 0x00ffff); // Cyan particles
            }
          }

          // Death sequence before hitting 0
          if (o2Ref.current <= LOW_O2_WARNING_DURATION && o2Ref.current > 0) {
            const deathProgress = 1 - (o2Ref.current / LOW_O2_WARNING_DURATION);
            cameraRef.current?.position.y = 0.5 + Math.sin(deathProgress * Math.PI) * 0.5; // Float and drift
            cameraRef.current?.rotation.z = deathProgress * 0.5; // Tilt camera
          }
        } else {
          // In pressurized structure - stop heartbeat, restore O2 slowly
          audioContext = null; // Stop audio
          o2Ref.current = Math.min(O2_MAX, o2Ref.current + O2_DEPLETION_PER_SEC * dt * 0.1); // Slowly restore
          setUiO2(o2Ref.current);
          setUiLowO2Warning(false); // No warning inside
        }

        // Game over at 0 O2
        if (o2Ref.current <= 0) {
          o2Ref.current = 0;
          gameOverRef.current = true;
          setGameState(prev => ({ ...prev, gameOver: true, isPaused: true }));
          setUiDeathSequence(true); // Trigger death sequence
        }
      }

      // ===== Movement (keyboard + gamepad) =====
      const moveDirection = new THREE.Vector3();
      const fwdX = Math.sin(yawRef.current);
      const fwdZ = Math.cos(yawRef.current);
      const rightX = Math.cos(yawRef.current);
      const rightZ = -Math.sin(yawRef.current);

      // Keyboard input
      if (keysRef.current['KeyW']) { moveDirection.x += fwdX; moveDirection.z += fwdZ; }
      if (keysRef.current['KeyS']) { moveDirection.x -= fwdX; moveDirection.z -= fwdZ; }
      if (keysRef.current['KeyA']) { moveDirection.x -= rightX; moveDirection.z -= rightZ; }
      if (keysRef.current['KeyD']) { moveDirection.x += rightX; moveDirection.z += rightZ; }

      // Gamepad left stick input (overrides keyboard if gamepad is active)
      // Left stick moves forward/back (negative Y = forward in standard layout, but we used +Y)
      // Our layout: Left stick Y affects X/Z plane relative to camera view
      // Adjust: left stick Y positive = move backward? Check standard controllers
      // Xbox controller: Left stick Y positive = push forward (toward player's nose)?
      // Actually: on most controllers, pushing stick "up" (positive Y) moves you forward toward camera view
      // But we need to check what our math expects...
      // Let's be explicit: gamepad left stick should move character in the direction player is looking
      const gamepadFwdX = leftStickRef.current.x;
      const gamepadFwdZ = -leftStickRef.current.y; // Invert Y for natural feel

      if (gamepadFwdX !== 0 || gamepadFwdZ !== 0) {
        // Gamepad input takes precedence over keyboard for movement
        moveDirection.x = gamepadFwdX;
        moveDirection.z = gamepadFwdZ;

        // Sync yaw/pitch from right stick for look
        yawRef.current += rightStickRef.current.x;
        pitchRef.current = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitchRef.current + rightStickRef.current.y));

        // Clamp to world radius
        const dist = Math.sqrt(player.position.x ** 2 + player.position.z ** 2);
        if (dist > WORLD_RADIUS) {
          player.position.x = (player.position.x / dist) * WORLD_RADIUS;
          player.position.z = (player.position.z / dist) * WORLD_RADIUS;
        }
      } else {
        // Keyboard-only movement
        if (moveDirection.length() > 0) {
          moveDirection.normalize().multiplyScalar(PLAYER_SPEED * dt);
          player.position.add(moveDirection);
        }

        // ===== First-person camera (keyboard + gamepad) =====
        if (cameraRef.current && playerRef.current) {
          const player = playerRef.current;
          const camera = cameraRef.current;

          // Check if inside a pressurized structure
          const nearby = getNearbyStructure();
          const inPressurized = nearby?.inside ?? false;

          if (inPressurized && nearby.structure.isInterior) {
            // Inside structure: camera is at structure position + offset
            camera.position.copy(nearby.structure.group.position);
            camera.position.add(nearby.structure.interiorCameraOffset || new THREE.Vector3(0, PLAYER_HEIGHT, 0));
            // Look at nearby point
            const lookDir = new THREE.Vector3(
              Math.sin(yawRef.current) * Math.cos(pitchRef.current),
              Math.sin(pitchRef.current),
              Math.cos(yawRef.current) * Math.cos(pitchRef.current),
            );
            const lookTarget = camera.clone().add(lookDir);
            camera.lookAt(lookTarget);
          } else {
            // Outside: camera follows player at world level
            camera.position.set(player.position.x, PLAYER_HEIGHT, player.position.z);

            // Clamp to world radius
            const dist = Math.sqrt(player.position.x ** 2 + player.position.z ** 2);
            if (dist > WORLD_RADIUS) {
              player.position.x = (player.position.x / dist) * WORLD_RADIUS;
              player.position.z = (player.position.z / dist) * WORLD_RADIUS;
            }

            const lookDir = new THREE.Vector3(
              Math.sin(yawRef.current) * Math.cos(pitchRef.current),
              Math.sin(pitchRef.current),
              Math.cos(yawRef.current) * Math.cos(pitchRef.current),
            );
            const lookTarget = new THREE.Vector3().copy(camera.position).add(lookDir);
            camera.lookAt(lookTarget);
          }

          player.rotation.y = yawRef.current;
        }

        // Update interior/exterior visibility
        updateInteriorVisibility();
      }

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
      updateParticles(clampedDtSafe(dt));

      // ===== Smelter processing =====
      processSmelters();

      // ===== Gamepad button handlers =====
      // RT (button 5): Mine / use tool (same as left-click mouse)
      if (rbTriggerRef.current && !buildModeRef.current && !gameOverRef.current) {
        // Attempt mining
        const target = getAsteroidInSight();
        if (target) {
          // Shrink asteroid
          target.currentScale -= MINE_RATE_PER_SEC * dt;
          const scale = Math.max(0.05, target.currentScale);
          target.mesh.scale.set(scale, scale, scale);

          // Progress for UI
          setUiMiningProgress(1 - target.currentScale);
          setUiHoveredAsteroid(ASTEROID_TYPES[target.type].name);

          // Mining beam visual
          if (beam) {
            const camPos = camera.position.clone();
            const astPos = target.mesh.position.clone();
            const mid = camPos.clone().add(astPos).multiplyScalar(0.5);
            beam.position.copy(mid);
            const dist = camPos.distanceTo(astPos);
            beam.scale.set(1, dist, 1);
            const dirVec = astPos.clone().sub(camPos).normalize();
            const quat = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              dirVec,
            );
            beam.quaternion.copy(quat);
            beam.visible = true;
          }

          // Progress ring
          if (ring) {
            ring.position.copy(target.mesh.position);
            const ringScale = target.baseScale * 1.6;
            ring.scale.set(ringScale, ringScale, ringScale);
            ring.lookAt(camera.position);
            const mat = ring.material as THREE.MeshBasicMaterial;
            const prog = 1 - target.currentScale;
            mat.opacity = 0.4 + prog * 0.6;
            mat.color.set(ASTEROID_TYPES[target.type].color);
            ring.visible = true;
          }

          // Spawn particles
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
              o2Ref.current = Math.min(O2_MAX, o2Ref.current + O2_REFILL_CRYSTAL);
              setUiO2(o2Ref.current);
              r.oxygen += info.yieldAmount;
              setUiOxygen(r.oxygen);
            } else if (target.type === 'iron') {
              r.iron += info.yieldAmount;
              setUiIron(r.iron);
            } else if (target.type === 'ice') {
              r.ice += info.yieldAmount;
              setUiIce(r.ice);
            }
            createParticles(target.mesh.position.clone(), 12, ASTEROID_TYPES[target.type].color);
            beam && (beam.visible = false);
            ring && (ring.visible = false);
            setUiMiningProgress(0);
            setUiHoveredAsteroid('');
          }
        } else {
          // Not looking at asteroid
          beam && (beam.visible = false);
          ring && (ring.visible = false);
          setUiMiningProgress(0);
          setUiHoveredAsteroid('');
        }
      }

      // B button: Cancel / exit pointer lock or toggle build mode
      if (buttonBPressedRef.current) {
        if (document.pointerLockElement) {
          document.exitPointerLock();
        } else {
          // Toggle build mode if pointer is unlocked
          buildModeRef.current = !buildModeRef.current;
          const newMode = buildModeRef.current;
          setGameState(prev => ({ ...prev, buildMode: newMode }));
          setUiBuildMode(newMode);
          if (miningBeamRef.current) miningBeamRef.current.visible = false;
          if (miningRingRef.current) miningRingRef.current.visible = false;
          if (buildPreviewRef.current) {
            buildPreviewRef.current.visible = newMode;
          }
        }
      }

      // X button: Build menu toggle
      if (buttonXPressedRef.current && !buildModeRef.current && !gameOverRef.current) {
        buildModeRef.current = true;
        setGameState(prev => ({ ...prev, buildMode: true }));
        setUiBuildMode(true);
        if (miningBeamRef.current) miningBeamRef.current.visible = false;
        if (miningRingRef.current) miningRingRef.current.visible = false;
        if (buildPreviewRef.current) {
          buildPreviewRef.current.visible = true;
        }
      }

      // Y button: Inventory toggle (3D holographic panel)
      if (buttonYPressedRef.current && !gameOverRef.current) {
        inventoryOpenRef.current = !inventoryOpenRef.current;
        // Sync with React UI
        setUiInventoryOpen(inventoryOpenRef.current);
      }

      // LT (button 4): Jetpack boost (hold for upward thrust)
      if (lbTriggerRef.current && !gameOverRef.current) {
        const player = playerRef.current;
        if (player) {
          // Upward thrust (opposite to camera pitch)
          const thrustAmount = 2.5 * dt;
          player.position.y += thrustAmount;
          // Create thruster particles
          if (Math.random() < 0.3) {
            createParticles(
              camera.position.clone().add(
                new THREE.Vector3(0, -0.5, 0)
              ),
              1,
              0x00aaff  // blue thruster exhaust
            );
          }
        }
      }

      // LB (button 4) or D-pad left/right: Cycle build type
      if (lbTriggerRef.current && !buttonBPressedRef.current && !gameOverRef.current) {
        // LB cycles build type left
        buildTypeRef.current = (buildTypeRef.current === 'dome' ? 'storage' :
                                 buildTypeRef.current === 'storage' ? 'solar' :
                                 buildTypeRef.current === 'solar' ? 'o2generator' :
                                 buildTypeRef.current === 'o2generator' ? 'smelter' :
                                 buildTypeRef.current === 'smelter' ? 'refinery' : 'dome');
        setUiBuildType(buildTypeRef.current);
      }

      // RB (button 5) or D-pad: Cycle build type
      if (rbTriggerRef.current && !buttonBPressedRef.current && !gameOverRef.current) {
        // RB cycles build type right
        buildTypeRef.current = (buildTypeRef.current === 'dome' ? 'smelter' :
                                 buildTypeRef.current === 'smelter' ? 'refinery' :
                                 buildTypeRef.current === 'refinery' ? 'o2generator' :
                                 buildTypeRef.current === 'o2generator' ? 'solar' :
                                 buildTypeRef.current === 'solar' ? 'storage' : 'dome');
        setUiBuildType(buildTypeRef.current);
      }

      // D-pad: Hotbar selection (cycles through build types)
      if (dpadUpRef.current) {
        // Cycle to next build type
        buildTypeRef.current = (buildTypeRef.current === 'dome' ? 'smelter' :
                                 buildTypeRef.current === 'smelter' ? 'refinery' :
                                 buildTypeRef.current === 'refinery' ? 'o2generator' :
                                 buildTypeRef.current === 'o2generator' ? 'solar' :
                                 buildTypeRef.current === 'solar' ? 'storage' : 'dome');
        setUiBuildType(buildTypeRef.current);
      }
      if (dpadDownRef.current) {
        // Cycle to previous build type
        buildTypeRef.current = (buildTypeRef.current === 'dome' ? 'storage' :
                                 buildTypeRef.current === 'storage' ? 'solar' :
                                 buildTypeRef.current === 'solar' ? 'o2generator' :
                                 buildTypeRef.current === 'o2generator' ? 'refinery' :
                                 buildTypeRef.current === 'refinery' ? 'smelter' : 'dome');
        setUiBuildType(buildTypeRef.current);
      }
      if (dpadLeftRef.current) {
        // Cycle left
        buildTypeRef.current = (buildTypeRef.current === 'dome' ? 'storage' :
                                 buildTypeRef.current === 'storage' ? 'solar' :
                                 buildTypeRef.current === 'solar' ? 'o2generator' :
                                 buildTypeRef.current === 'o2generator' ? 'refinery' :
                                 buildTypeRef.current === 'refinery' ? 'smelter' : 'dome');
        setUiBuildType(buildTypeRef.current);
      }
      if (dpadRightRef.current) {
        // Cycle right
        buildTypeRef.current = (buildTypeRef.current === 'dome' ? 'smelter' :
                                 buildTypeRef.current === 'smelter' ? 'refinery' :
                                 buildTypeRef.current === 'refinery' ? 'o2generator' :
                                 buildTypeRef.current === 'o2generator' ? 'solar' :
                                 buildTypeRef.current === 'solar' ? 'storage' : 'dome');
        setUiBuildType(buildTypeRef.current);
      }

      // A button: Action/Interact (enter structure, use fabricator, craft items)
      if (buttonAPressedRef.current && !gameOverRef.current && buildModeRef.current) {
        const camera = cameraRef.current;
        const scene = sceneRef.current;
        if (!camera || !scene) return;

        // Check for nearby fabricator to open crafting UI
        let nearbyFabricator = null;
        let nearbyStructure = null;
        for (const structure of structuresRef.current) {
          const dist = structure.group.position.distanceTo(camera.position);
          if (dist <= BUILD_RANGE) {
            if (structure.type === 'fabricator') {
              nearbyFabricator = structure;
            } else {
              nearbyStructure = structure;
            }
          }
        }

        // Handle fabricator crafting UI
        if (nearbyFabricator) {
          const fabrication = nearbyFabricator as BuiltStructure;
          if (!fabrication.craftingUIGroup) {
            // Create crafting UI group
            const craftingGroup = createCraftingDisplay(fabrication);
            sceneRef.current?.add(craftingGroup);
            fabrication.craftingUIGroup = craftingGroup;
            fabrication.craftingUIOpen = true;
          } else {
            // Crafting UI already open, close it
            sceneRef.current?.remove(fabrication.craftingUIGroup);
            fabrication.craftingUIGroup.visible = false;
            fabrication.craftingUIOpen = false;
          }
          return; // Done, don't also enter structure
        }

      // Start: Pause menu
      if (buttonAPressedRef.current && !gameOverRef.current && !buildModeRef.current) {
        setGameState(prev => ({ ...prev, isPaused: !prev.isPaused }));
      }

      // ===== Minimap rendering =====
      renderMinimap();

      // Render
      renderer.render(scene, camera);
    };

    // Minimap rendering — top-right canvas
    const renderMinimap = () => {
      const canvas = minimapCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx || !sceneRef.current || !cameraRef.current) return;

      const w = canvas.width;
      const h = canvas.height;
      const scale = 2; // Map world coords to canvas (1 world unit = 2 canvas pixels)

      // Clear with dark transparent background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, w, h);

      // Draw grid lines
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      const gridSize = 20 * scale;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Get player position
      const player = playerRef.current;
      const camera = cameraRef.current;
      if (!player || !camera) return;

      // Camera is at player position, so player.x/z is our center
      const centerX = w / 2;
      const centerY = h / 2;

      // Draw nearby asteroids (within world radius)
      for (const asteroid of asteroidsRef.current) {
        if (asteroid.isMined) continue; // Skip mined asteroids

        const dx = asteroid.mesh.position.x - camera.position.x;
        const dz = asteroid.mesh.position.z - camera.position.z;

        // Check if asteroid is visible on minimap
        const distSq = dx * dx + dz * dz;
        if (distSq > (WORLD_RADIUS * scale) ** 2) continue;

        // Calculate on-canvas position
        const mapX = centerX + dx * scale;
        const mapY = centerY + dz * scale;

        // Draw asteroid based on type
        const typeColor = asteroid.type === 'iron' ? '#888888' : asteroid.type === 'ice' ? '#00aaff' : '#00ff88';
        ctx.fillStyle = typeColor;
        ctx.beginPath();
        ctx.arc(mapX, mapY, 6, 0, Math.PI * 2);
        ctx.fill();

        // Draw warning ring if mining
        if (asteroid.currentScale < 1) {
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(mapX, mapY, 8 + (1 - asteroid.currentScale) * 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Draw player position marker
      ctx.fillStyle = '#ff00ff';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      ctx.fill();

      // Draw player direction indicator
      const heading = yawRef.current;
      const dirLength = 20;
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.sin(heading) * dirLength, centerY + Math.cos(heading) * dirLength);
      ctx.stroke();

      // Draw compass cardinal points around minimap
      ctx.fillStyle = 'rgba(0, 255, 255, 0.6)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // N (center top)
      const compassRadius = 45;
      ctx.fillText('N', centerX, centerY - compassRadius);
      // E (center right)
      ctx.fillText('E', centerX + compassRadius, centerY);
      // S (center bottom)
      ctx.fillText('S', centerX, centerY + compassRadius);
      // W (center left)
      ctx.fillText('W', centerX - compassRadius, centerY);
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

    // ====================== Refinery processing ======================
    const processRefineries = () => {
      const now = Date.now() / 1000;
      for (const refinery of structuresRef.current) {
        if (refinery.type !== 'refinery') continue;

        const { group, refineryInventory, isRefineryProcessing, refineryProcessingProgress, refineryLastProcessTime } = refinery;

        // Animate processing interior glow
        const chamberMat = (group as any).refineryChamber;
        if (isRefineryProcessing && chamberMat) {
          const chamber = chamberMat as THREE.Mesh;
          // Pulse cyan/blue glow based on progress (oxygen processing)
          const pulseIntensity = 0.6 + Math.sin(now * 8) * 0.2;
          (chamber.material as THREE.MeshBasicMaterial).opacity = pulseIntensity * refineryProcessingProgress;
          (chamber.material as THREE.MeshBasicMaterial).color.set(0x00ffff);
        } else if (chamberMat) {
          const chamber = chamberMat as THREE.Mesh;
          (chamber.material as THREE.MeshBasicMaterial).opacity = 0;
        }

        // Process ice when ready
        if (refineryInventory?.waterIce > 0 && isRefineryProcessing) {
          // Output ratio: 1 Ice → 2 O2 + 1 H2 per 2 seconds
          const REFINERY_PROCESS_RATE = 1 / 2; // 0.5 ice per tick (1 per 2 sec)
          
          // Check H2 (refinery needs H2 to bootstrap/start)
          if (resourcesRef.current.h2 <= 0) {
            isRefineryProcessing = false;
            continue;
          }

          // Process ice
          if (now - refineryLastProcessTime >= REFINERY_PROCESS_RATE) {
            refinery.refineryLastProcessTime = now;

            if (refinery.refineryInventory.waterIce > 0) {
              refinery.refineryInventory.waterIce -= 1;

              // Output: 2 O2 + 1 H2 per ice processed
              const o2Output = 2;
              const h2Output = 1;

              // O2 refills player O2 tank
              resourcesRef.current.o2 = Math.min(O2_MAX, resourcesRef.current.o2 + o2Output);
              setUiO2(resourcesRef.current.o2);

              // H2 goes to station power storage
              resourcesRef.current.h2 += h2Output;
              setUiH2(resourcesRef.current.h2);

              // Spawn O2/H2 particles at output pipes
              const outputPipePos = new THREE.Vector3(1.8, 2.5, 0); // H2 pipe (orange)
              outputPipePos.applyMatrix4(group.matrixWorld);
              createParticles(outputPipePos, 2, 0xffaa00);

              const outputO2Pos = new THREE.Vector3(1.8, 1.0, 0); // O2 pipe (cyan)
              outputO2Pos.applyMatrix4(group.matrixWorld);
              createParticles(outputO2Pos, 3, 0x00ffff);

              // Spawn ice particles at intake
              const intakePos = new THREE.Vector3(0, 0.6, 0);
              intakePos.applyMatrix4(group.matrixWorld);
              createParticles(intakePos, 2, 0x00aaff);
            }
          }
        }
      }
    };

    // ====================== Inventory management ======================
    const updateInventoryUI = () => {
      // Update all inventory items from resourcesRef
      const items = uiInventoryItems.map(item => {
        if (item.type === 'resource') {
          let count = 0;
          if (item.name === 'Raw Ore') count = resourcesRef.current.rawOre;
          else if (item.name === 'Water Ice') count = resourcesRef.current.ice;
          else if (item.name === 'Iron Metal') count = resourcesRef.current.ironMetal;
          else if (item.name === 'Titanium') count = resourcesRef.current.titanium;
          return { ...item, count };
        }
        return { ...item }; // Crafted items and tools stay the same
      });
      setUiInventoryItems(items);

      // Sync 3D icons to inventory
      const panel = inventoryPanelRef.current;
      if (panel && panel.group.visible) {
        // Update icon visibility based on count
        inventorySlots.forEach(slot => {
          const item = uiInventoryItems.find(i => i.name === slot.name && i.type === slot.type);
          slot.mesh.visible = item && item.count > 0;
          // Update rotation for visual effect
          slot.mesh.rotation.y += 0.02;
        });
      }
    };

    const equipTool = (toolName: string) => {
      const index = uiInventoryItems.findIndex(item => item.name === toolName);
      if (index !== -1 && uiInventoryItems[index].count > 0) {
        setUiEquippedTool(toolName as ToolType);
        // Show equipped tool in UI
        console.log(`Equipped: ${toolName}`);
      }
    };

    const consumeCanister = (canisterName: string) => {
      const index = uiInventoryItems.findIndex(item => item.name === canisterName);
      if (index !== -1 && uiInventoryItems[index].count > 0) {
        // Consume canister (decrease count)
        setUiInventoryItems(prev => prev.map(item => {
          if (item.name === canisterName) {
            return { ...item, count: item.count - 1 };
          }
          return item;
        }));

        // Apply effect
        if (canisterName === 'O2 Canister') {
          o2Ref.current = Math.min(O2_MAX, o2Ref.current + 25);
          setUiO2(o2Ref.current);
        } else if (canisterName === 'H2 Canister') {
          resourcesRef.current.h2 += 10;
          setUiH2(resourcesRef.current.h2);
        }

        // Keep inventory open after consuming
        setUiInventoryOpen(true);
        inventoryOpenRef.current = true;
      }
    };

    // Sync inventory with resources when they change
    useEffect(() => {
      if (!inventoryOpenRef.current) {
        updateInventoryUI();
      }
    }, [
      resourcesRef.current.rawOre,
      resourcesRef.current.ice,
      resourcesRef.current.ironMetal,
      resourcesRef.current.titanium,
    ]);

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

      {/* Low O2 warning overlay — red screen tint + pulse */}
      {uiLowO2Warning && !gameState.gameOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(255, 0, 0, 0.15)',
            pointerEvents: 'none',
            zIndex: 20,
            animation: 'pulse 1s infinite',
          }}
        />
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

      {/* Crafting status — when near fabricator */}
      {uiCrafting && !gameState.gameOver && !uiBuildMode && (
        <div style={styles.craftingIndicator}>
          🛠️ CRAFTING UI — Near Fabricator · Press A to open/close · Y to craft
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

      {/* Death sequence overlay - SIGNAL LOST */}
      {gameState.gameOver && uiDeathSequence && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'black',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ff0000',
            fontFamily: 'monospace',
            fontSize: 36,
            fontWeight: 'bold',
            textShadow: '0 0 20px #ff0000',
            animation: 'pulse 1s infinite',
            zIndex: 1000,
          }}
        >
          <div style={{ marginBottom: 30, fontSize: 48 }}>"SIGNAL LOST"</div>
          <div style={{ fontSize: 20, opacity: 0.7, marginTop: 20 }}>Player drifting in void...</div>
          <div style={{ fontSize: 16, opacity: 0.5, marginTop: 10 }}>Waiting for respawn...</div>
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

      {/* Inventory toggle hint */}
      {uiInventoryOpen && (
        <div style={styles.inventoryHint}>
          <div style={{ color: '#00ffff', marginBottom: '4px' }}>INVENTORY (I/Y)</div>
          <div style={{ color: '#888', fontSize: '12px' }}>
            Click items to equip • Click canisters to use
          </div>
        </div>
      )}
    </div>
  );

  // ====================== Inventory Panel ======================
  // Inventory panel — holographic 3D overlay in front of player
  if (!uiInventoryOpen) return null;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100 }}>
        <div style={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '600px',
          backgroundColor: 'rgba(0, 20, 40, 0.85)',
          border: '4px solid #00ffff',
          borderRadius: 16,
          padding: 20,
          pointerEvents: 'auto',
          boxShadow: '0 0 20px rgba(0, 255, 255, 0.3)',
          backdropFilter: 'blur(8px)',
        }}>
          <h2 style={{
            color: '#00ffff',
            fontSize: 24,
            textAlign: 'center',
            fontFamily: 'monospace',
            textShadow: '0 0 8px #00ffff',
            marginBottom: 10,
          }}>
            INVENTORY
          </h2>
          <div style={{ marginBottom: 10 }}>
            <div style={{
              color: '#ffaa00',
              fontSize: 18,
              fontFamily: 'monospace',
            }}>
              EQUIPPED: <span style={{ fontWeight: 'bold', color: '#ffffff' }}>{uiEquippedTool}</span>
            </div>
          </div>
          <div style={{
            marginBottom: 10,
            fontSize: 12,
            color: '#00ffff',
            fontFamily: 'monospace',
          }}>
            Press ESC or click outside to close
          </div>
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            border: '2px solid rgba(0, 255, 255, 0.3)',
            borderRadius: 8,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}>
            {uiInventoryItems.map((item, idx) => (
              <div
                key={idx}
                onClick={() => {
                  if (item.type === 'tool') {
                    equipTool(item.name);
                  } else if (item.type === 'crafted' && item.count > 0) {
                    consumeCanister(item.name);
                  }
                }}
                style={{
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: idx < uiInventoryItems.length - 1 ? '1px solid rgba(0, 255, 255, 0.2)' : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span style={{ color: item.type === 'tool' ? '#ffaa00' : item.type === 'resource' ? '#00ff88' : '#aaa', fontFamily: 'monospace' }}>
                  {item.type === 'tool' && '🔧 '}
                  {item.type === 'crafted' && '📦 '}
                  {item.name}
                </span>
                <span style={{
                  color: item.type === 'crafted' ? '#ff6600' : '#ffffff',
                  fontSize: 14,
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  background: item.type === 'tool' ? 'rgba(255, 170, 0, 0.2)' : 'rgba(0, 0, 0, 0.6)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  pointerEvents: 'none',
                }}>
                  {item.type === 'tool' ? (item.count === 1 ? '1' : item.count) : item.count} / {item.max}
                </span>
              </div>
            ))}
          </div>
          {/* Resource bar */}
          <div style={{
            marginTop: 15,
            padding: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            borderRadius: 8,
            border: '2px solid rgba(0, 255, 255, 0.2)',
          }}>
            <div style={{ fontSize: 12, color: '#00ffff', fontFamily: 'monospace', marginBottom: 5 }}>
              RESOURCES
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#888888' }} />
              <span style={{ color: '#ffffff', fontFamily: 'monospace', fontSize: 13 }}>
                Raw Ore: {resourcesRef.current.rawOre} / {uiInventoryItems.find((i) => i.name === 'Raw Ore')?.count || 0}
              </span>
              <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#00aaff' }} />
              <span style={{ color: '#ffffff', fontFamily: 'monospace', fontSize: 13 }}>
                Water Ice: {resourcesRef.current.ice} / {uiInventoryItems.find((i) => i.name === 'Water Ice')?.count || 0}
              </span>
              <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#ffaa00' }} />
              <span style={{ color: '#ffffff', fontFamily: 'monospace', fontSize: 13 }}>
                Iron: {resourcesRef.current.ironMetal} / {uiInventoryItems.find((i) => i.name === 'Iron Metal')?.count || 0}
              </span>
            </div>
          </div>
          </div>
        </div>
      );

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
      color: '#00ffff',
      fontFamily: 'monospace',
      fontSize: 14,
    },
  };

  // O2 bar — top center
  const o2Container: React.CSSProperties = {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    zIndex: 30,
  };

  const o2Label: React.CSSProperties = {
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
  // Inventory toggle hint
  inventoryHint: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0, 255, 255, 0.15)',
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid rgba(0, 255, 255, 0.5)',
    color: '#00ffff',
    fontFamily: 'monospace',
    fontSize: 14,
    textAlign: 'center',
    zIndex: 100,
  },
  // Inventory panel — holographic
  inventoryPanel: {
    position: 'absolute',
    top: '10%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '600px',
    backgroundColor: 'rgba(0, 20, 40, 0.85)',
    border: '4px solid #00ffff',
    borderRadius: 16,
    padding: 20,
    pointerEvents: 'auto',
    boxShadow: '0 0 20px rgba(0, 255, 255, 0.3)',
    backdropFilter: 'blur(8px)',
    animation: 'fadeIn 0.2s ease-out',
  },
  inventoryTitle: {
    color: '#00ffff',
    fontSize: 24,
    textAlign: 'center',
    fontFamily: 'monospace',
    textShadow: '0 0 8px #00ffff',
    marginBottom: 10,
  },
  inventoryEquipped: {
    color: '#ffaa00',
    fontSize: 18,
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  inventoryItemCount: {
    color: '#ff6600',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    background: 'rgba(255, 102, 0, 0.2)',
    padding: '2px 8px',
    borderRadius: 4,
    pointerEvents: 'none',
  },
  inventoryItemCountDefault: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    background: 'rgba(0, 0, 0, 0.6)',
    padding: '2px 8px',
    borderRadius: 4,
    pointerEvents: 'none',
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
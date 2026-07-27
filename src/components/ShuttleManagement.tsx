import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SHUTTLE_PODS } from './Survival3D';

// ====================== Shuttle Management ======================
export interface ShuttleManagementProps {
  structuresRef: React.MutableRefObject<any[]>;
  onShuttleStateChanged?: (state: any) => void;
}

export function ShuttleManagement({ structuresRef, onShuttleStateChanged }: ShuttleManagementProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // State
  const [shuttleState, setShuttleState] = useState({
    isBuilt: false,
    inShuttle: false,
    isDocked: false,
    currentShuttleType: 'shuttle-mk1' as 'shuttle-mk1' | 'shuttle-rescue',
    position: new THREE.Vector3(0, 0, 20),
    velocity: new THREE.Vector3(0, 0, 0),
    cargo: { iron: 0, ice: 0, rawOre: 0, ironMetal: 0, titanium: 0, oxygen: 0, h2: 0 },
    fuelPercent: 100,
    o2Percent: 100,
    stationPosition: new THREE.Vector3(0, 0, 0),
    stationDist: 999,
  });

  // Refs
  const shuttleMeshRef = useRef<THREE.Group | null>(null);
  const stationPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const gameLoopRef = useRef<number | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});

  // ====================== Initialize ======================
  useEffect(() => {
    if (!structuresRef.current) return;

    // Find any shuttle bays
    const shuttleBay = structuresRef.current.find(s => s.type === 'shuttlebay');
    if (shuttleBay) {
      const bay = shuttleBay.group;
      const position = bay.position.clone();

      // Spawn shuttle at bay location
      const shuttle = createShuttleMesh(position.clone(), 'shuttle-mk1');
      shuttle.position.copy(position.clone().add(new THREE.Vector3(0, 0, 4)));
      shuttleMeshRef.current = shuttle;

      // Add to scene
      const scene = bay.group.scene;
      if (scene) scene.add(shuttle);

      setShuttleState(prev => ({ ...prev, isBuilt: true, stationPosition: position }));
    }

    // Listen for build mode changes
    const handleBuildModeChange = () => {
      // Check for new shuttle bays
      const shuttleBay = structuresRef.current.find(s => s.type === 'shuttlebay');
      if (shuttleBay && !shuttleState.isBuilt) {
        const bay = shuttleBay.group;
        const position = bay.position.clone();

        const shuttle = createShuttleMesh(position.clone(), 'shuttle-mk1');
        shuttle.position.copy(position.clone().add(new THREE.Vector3(0, 0, 4)));
        shuttleMeshRef.current = shuttle;

        const scene = bay.group.scene;
        if (scene) scene.add(shuttle);

        setShuttleState(prev => ({ ...prev, isBuilt: true, stationPosition: position }));
      }
    };

    // Game loop for checking docking
    const gameLoop = () => {
      updateShuttleState();
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };
    gameLoop();

    return () => {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, []);

  // ====================== Helper Functions ======================
  function createShuttleMesh(position: THREE.Vector3, shuttleType: 'shuttle-mk1' | 'shuttle-rescue'): THREE.Group {
    const group = new THREE.Group();
    group.userData.shuttleType = shuttleType;

    const config = SHUTTLE_PODS[shuttleType];

    // Main hull
    const hullGeometry = new THREE.ConeGeometry(2, 6, 8);
    hullGeometry.rotateX(Math.PI / 2);
    const hullMaterial = new THREE.MeshPhongMaterial({ color: 0x88ccff, side: THREE.DoubleSide, flatShading: true });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    hull.scale.set(0.6, 1, 0.6);
    group.add(hull);

    // Cockpit
    const canopyGeometry = new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopyMaterial = new THREE.MeshPhongMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6, shininess: 100 });
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.set(0, 0, 1.5);
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

    // Store shuttle config
    (group as any).currentShuttleType = shuttleType;
    (group as any).fuel = config.currentFuel;
    (group as any).oxygen = 100;
    (group as any).maxSpeed = config.maxSpeed;

    return group;
  }

  function updateShuttleState() {
    if (!shuttleMeshRef.current || !structuresRef.current) return;

    const shuttle = shuttleMeshRef.current;
    const shuttleStateObj = shuttleState;
    const stationPos = stationPositionRef.current;
    const dist = shuttle.position.distanceTo(stationPos);

    // Check for docking
    const isDocked = dist < 3;
    if (isDocked !== shuttleStateObj.isDocked) {
      setShuttleState(prev => ({ ...prev, isDocked }));
      onShuttleStateChanged?.({ inShuttle: shuttleStateObj.inShuttle, isDocked });

      // Auto-dock when close to station
      if (isDocked && !shuttleStateObj.isDocked) {
        shuttle.position.copy(stationPos.clone().add(new THREE.Vector3(0, 0, 4)));
        shuttle.rotation.set(0, 0, 0);
      }
    }

    onShuttleStateChanged?.({
      isBuilt: shuttleStateObj.isBuilt,
      inShuttle: shuttleStateObj.inShuttle,
      isDocked,
      position: shuttle.position.toArray(),
      velocity: shuttleStateObj.velocity.toArray(),
      stationDist: dist,
    });
  }

  // Handle exit from shuttle
  const handleExitShuttle = () => {
    setShuttleState(prev => ({ ...prev, inShuttle: false }));

    // Find the shuttle controller component and call exit
    // This is a simplified approach - in production you'd use a proper event system
    setTimeout(() => {
      const event = new CustomEvent('exitShuttle');
      window.dispatchEvent(event);
    }, 100);
  };

  // Handle dock actions
  const handleRefuel = () => {
    // Refuel shuttle from station H2 storage
    setShuttleState(prev => ({ ...prev, fuelPercent: Math.min(prev.fuelPercent + 50, 100) }));
    console.log('Refueled shuttle');
  };

  const handleUnloadCargo = () => {
    // Transfer shuttle cargo to station
    setShuttleState(prev => ({ ...prev, cargo: { iron: 0, ice: 0, rawOre: 0, ironMetal: 0, titanium: 0, oxygen: 0, h2: 0 } }));
    console.log('Unloaded shuttle cargo');
    onShuttleStateChanged?.(shuttleState);
  };

  const handleRefillO2 = () => {
    // Refill shuttle O2
    setShuttleState(prev => ({ ...prev, o2Percent: 100 }));
    console.log('Refilled shuttle O2');
  };

  // ====================== Return UI ======================
  return (
    <div ref={containerRef} style={{ display: 'none' }}>
      {/* Shuttle state and controls managed internally */}
    </div>
  );
}
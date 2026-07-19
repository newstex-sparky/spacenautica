import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

// Hull breach types
export type HullBreachType = 'wall' | 'floor' | 'ceiling' | 'airlock';

// Hull breach state
export interface HullBreach {
  id: string;
  type: HullBreachType;
  position: THREE.Vector3;
  size: number;
  health: number;
  maxHealth: number;
  isRepairing: boolean;
  ventingO2: boolean;
  particles: THREE.Mesh[];
  mesh: THREE.Group;
}

// Breach level for cracks
export interface CrackGeometry {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  size: number;
  depth: number;
}

// Game state for hull integrity
export interface HullState {
  maxIntegrity: number;
  currentIntegrity: number;
  breaches: HullBreach[];
  alarms: { active: boolean; intensity: number };
  warningLights: { position: THREE.Vector3; intensity: number }[];
}

const BREACH_DAMAGE_PER_SEC = 5; // O2 damage per second from breached module
const REPAIR_SPEED = 0.5; // Health restored per second
const VENT_PARTICLE_SPEED = 3;
const VENT_PARTICLE_LIFETIME = 2;
const ALARM_INTERVAL = 2000; // Alarm beeps every 2 seconds

// Crack geometries for different breach types
const CRACK_PATTERNS: Record<HullBreachType, CrackGeometry[]> = {
  wall: [
    { position: new THREE.Vector3(0.3, 0.5, 0), rotation: new THREE.Euler(0, 0.3, 0), size: 0.1, depth: 0.5 },
    { position: new THREE.Vector3(-0.2, 0.4, 0), rotation: new THREE.Euler(0, -0.3, 0), size: 0.08, depth: 0.4 },
    { position: new THREE.Vector3(-0.3, 0.6, 0), rotation: new THREE.Euler(0, 0.5, 0), size: 0.06, depth: 0.3 },
  ],
  floor: [
    { position: new THREE.Vector3(-0.15, -0.2, 0.2), rotation: new THREE.Euler(0, 0.8, 0), size: 0.12, depth: 0.4 },
    { position: new THREE.Vector3(0.2, -0.15, -0.1), rotation: new THREE.Euler(0, -0.6, 0), size: 0.1, depth: 0.3 },
  ],
  ceiling: [
    { position: new THREE.Vector3(0.1, 0.9, 0.3), rotation: new THREE.Euler(0, -0.7, 0), size: 0.1, depth: 0.4 },
    { position: new THREE.Vector3(-0.25, 0.85, 0.1), rotation: new THREE.Euler(0, 0.5, 0), size: 0.08, depth: 0.3 },
  ],
  airlock: [
    { position: new THREE.Vector3(0, 0.5, 0), rotation: new THREE.Euler(0, 0, 0), size: 0.15, depth: 0.6 },
    { position: new THREE.Vector3(0.3, 0.7, 0.2), rotation: new THREE.Euler(0, 0.4, 0), size: 0.1, depth: 0.5 },
    { position: new THREE.Vector3(-0.25, 0.3, 0.1), rotation: new THREE.Euler(0, -0.4, 0), size: 0.08, depth: 0.4 },
    { position: new THREE.Vector3(0, 0.2, -0.3), rotation: new THREE.Euler(0, 0.2, 0), size: 0.06, depth: 0.3 },
  ],
};

interface HullBreach3DProps {
  onExit?: () => void;
}

export function HullBreach3D({ onExit }: HullBreach3DProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hullState, setHullState] = useState<HullState>({
    maxIntegrity: 100,
    currentIntegrity: 100,
    breaches: [],
    alarms: { active: false, intensity: 0 },
    warningLights: [],
  });
  const [repairProgress, setRepairProgress] = useState(0);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const breachMarkersRef = useRef<THREE.Mesh[]>([]);
  const alarmLightsRef = useRef<THREE.PointLight[]>([]);
  const ventParticlesRef = useRef<THREE.Mesh[]>([]);
  const weldEffectRef = useRef<THREE.Mesh | null>(null);
  const alarmSoundRef = useRef<HTMLAudioElement | null>(null);

  // Breach spawner (simulates damage)
  useEffect(() => {
    if (hullState.currentIntegrity < 80 && hullState.breaches.length === 0) {
      spawnBreach();
    }
  }, [hullState.currentIntegrity]);

  // Initialize Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 10, 50);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 4, 8);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404050, 0.4);
    scene.add(ambientLight);

    // Warning lights (initially off)
    const warningLight1 = new THREE.PointLight(0xff0000, 0, 15);
    warningLight1.position.set(-5, 3, -5);
    scene.add(warningLight1);
    alarmLightsRef.current.push(warningLight1);

    const warningLight2 = new THREE.PointLight(0xff0000, 0, 15);
    warningLight2.position.set(5, 3, -5);
    scene.add(warningLight2);
    alarmLightsRef.current.push(warningLight2);

    const warningLight3 = new THREE.PointLight(0xff0000, 0, 15);
    warningLight3.position.set(0, 5, -10);
    scene.add(warningLight3);
    alarmLightsRef.current.push(warningLight3);

    // Create breached module walls
    createBreachModule(scene);

    // Create starfield
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 500;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      starPositions[i] = (Math.random() - 0.5) * 100;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Alarm sound
    alarmSoundRef.current = new Audio();
    alarmSoundRef.current.src = '/sounds/alarm.mp3'; // Would need actual sound file
    alarmSoundRef.current.loop = true;

    // Resize handler
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Breach spawner (random damage)
    const breachSpawner = setInterval(() => {
      if (hullState.currentIntegrity > 20 && Math.random() < 0.3) {
        spawnBreach();
      }
    }, 5000);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(breachSpawner);

      if (alarmSoundRef.current) {
        alarmSoundRef.current.pause();
        alarmSoundRef.current.currentTime = 0;
      }

      scene.clear();
      renderer.dispose();
      breachMarkersRef.current.forEach(b => {
        b.geometry.dispose();
        (b.material as THREE.Material).dispose();
      });
      ventParticlesRef.current.forEach(p => {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      });
    };
  }, [hullState.currentIntegrity]);

  // O2 damage from breaches
  useEffect(() => {
    let o2Interval: NodeJS.Timeout;
    if (hullState.currentIntegrity < 100 && hullState.breaches.length > 0) {
      o2Interval = setInterval(() => {
        setHullState(prev => ({
          ...prev,
          currentIntegrity: Math.max(0, prev.currentIntegrity - BREACH_DAMAGE_PER_SEC * 0.016),
        }));
      }, 16);
    }
    return () => clearInterval(o2Interval);
  }, [hullState.breaches]);

  // Alarm cycle
  useEffect(() => {
    const activeBreaches = hullState.breaches.filter(b => b.health > 0);
    const hasAnyBreach = activeBreaches.length > 0;

    if (hasAnyBreach) {
      setHullState(prev => ({ ...prev, alarms: { active: true, intensity: 1 } }));
    } else {
      setHullState(prev => ({ ...prev, alarms: { active: false, intensity: 0 } }));
    }

    // Alarm beeps
    if (hullState.alarms.active) {
      const beep = setInterval(() => {
        // Visual flash
        alarmLightsRef.current.forEach(light => {
          light.intensity = light.intensity > 0 ? 0 : 3;
        });
      }, ALARM_INTERVAL);

      return () => clearInterval(beep);
    }
  }, [hullState.breaches, hullState.alarms.active]);

  // Start game loop
  useEffect(() => {
    const loop = (timestamp: number) => {
      update(timestamp);
      rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, [hullState.breaches]);

  // Helper functions
  const createBreachModule = (scene: THREE.Scene) => {
    // Main module frame
    const frameGeometry = new THREE.BoxGeometry(8, 6, 8);
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x334455,
      metalness: 0.7,
      roughness: 0.3,
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.castShadow = true;
    frame.receiveShadow = true;
    scene.add(frame);

    // Interior panels
    const panelGeometry = new THREE.PlaneGeometry(7, 5);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x225566,
      metalness: 0.5,
      roughness: 0.5,
    });

    // Floor panel
    const floorPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    floorPanel.rotation.x = -Math.PI / 2;
    floorPanel.position.y = -3;
    floorPanel.receiveShadow = true;
    scene.add(floorPanel);

    // Ceiling panel
    const ceilingPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    ceilingPanel.rotation.x = Math.PI / 2;
    ceilingPanel.position.y = 3;
    scene.add(ceilingPanel);

    // Side panels
    const sidePanel1 = new THREE.Mesh(panelGeometry, panelMaterial);
    sidePanel1.position.set(0, 0, -4.5);
    sidePanel1.receiveShadow = true;
    scene.add(sidePanel1);

    const sidePanel2 = new THREE.Mesh(panelGeometry, panelMaterial);
    sidePanel2.position.set(0, 0, 4.5);
    sidePanel2.receiveShadow = true;
    scene.add(sidePanel2);
  };

  const spawnBreach = () => {
    const breachTypes: HullBreachType[] = ['wall', 'floor', 'ceiling', 'airlock'];
    const breachType = breachTypes[Math.floor(Math.random() * breachTypes.length)];

    // Random position in module
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 4
    );

    // Create breach mesh
    const breachGroup = new THREE.Group();
    breachGroup.position.copy(position);

    // Cracks
    const crackPatterns = CRACK_PATTERNS[breachType];
    const crackMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
    });

    crackPatterns.forEach(crack => {
      const crackGeometry = new THREE.BufferGeometry();
      const points: THREE.Vector3[] = [];

      // Create jagged crack path
      let currentPos = crack.position.clone();
      for (let i = 0; i < 5; i++) {
        points.push(currentPos.clone());
        currentPos.x += (Math.random() - 0.5) * crack.depth;
        currentPos.y += (Math.random() - 0.5) * crack.depth * 0.5;
        currentPos.z += (Math.random() - 0.5) * crack.depth * 0.5;
      }

      crackGeometry.setFromPoints(points);

      // Crack depth simulation (thicker at start)
      const crackMesh = new THREE.Line(crackGeometry, crackMaterial);
      crackMesh.rotation.copy(crack.rotation);
      crackMesh.scale.set(crack.size, crack.size * 1.5, 1);
      breachGroup.add(crackMesh);
    });

    // Create venting particles
    const ventMaterial = new THREE.PointsMaterial({
      color: 0x00aaff,
      size: 0.15,
      transparent: true,
      opacity: 0.6,
    });

    const ventGeometry = new THREE.BufferGeometry();
    const ventParticlesCount = 50;
    const ventPositions = new Float32Array(ventParticlesCount * 3);

    for (let i = 0; i < ventParticlesCount * 3; i += 3) {
      ventPositions[i] = position.x + (Math.random() - 0.5) * 1;
      ventPositions[i + 1] = position.y + (Math.random() - 0.5) * 1;
      ventPositions[i + 2] = position.z + (Math.random() - 0.5) * 0.5;
    }

    ventGeometry.setAttribute('position', new THREE.BufferAttribute(ventPositions, 3));
    const ventParticles = new THREE.Points(ventGeometry, ventMaterial);
    breachGroup.add(ventParticles);

    sceneRef.current?.add(breachGroup);

    // Add marker for repair
    const markerGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(position);
    marker.visible = false;
    sceneRef.current?.add(marker);
    breachMarkersRef.current.push(marker);

    setHullState(prev => ({
      ...prev,
      breaches: [
        ...prev.breaches,
        {
          id: Date.now().toString(),
          type: breachType,
          position,
          size: 0.5,
          health: 100,
          maxHealth: 100,
          isRepairing: false,
          ventingO2: true,
          particles: [ventParticles],
          mesh: breachGroup,
        },
      ],
    }));

    // Screen shake on spawn
    setHullState(prev => ({ ...prev, currentIntegrity: Math.max(0, prev.currentIntegrity - 10) }));
  };

  const update = (timestamp: number) => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Update warning lights
    alarmLightsRef.current.forEach((light, index) => {
      if (hullState.alarms.active) {
        light.intensity = 0.5 + 0.5 * Math.sin(timestamp * 0.003) * (index + 1);
      } else {
        light.intensity = 0;
      }
    });

    // Update vent particles
    ventParticlesRef.current.forEach(particle => {
      const positions = particle.geometry.attributes.position.array as Float32Array;

      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] += (Math.random() * VENT_PARTICLE_SPEED) * 0.016;
        if (positions[i + 1] > 6) {
          positions[i + 1] = -4;
        }
      }

      particle.geometry.attributes.position.needsUpdate = true;
    });

    // Update breach markers visibility
    breachMarkersRef.current.forEach((marker, index) => {
      const breach = hullState.breaches[index];
      if (breach && breach.health > 0) {
        marker.visible = true;
        marker.position.copy(breach.position);
      }
    });
  };

  const startRepair = (breachIndex: number) => {
    const activeBreaches = hullState.breaches.filter(b => b.health > 0);
    if (activeBreaches.length === 0) return;

    const breach = activeBreaches[breachIndex];
    if (!breach || breach.isRepairing) return;

    const breachIndexInState = hullState.breaches.findIndex(b => b.id === breach.id);
    if (breachIndexInState === -1) return;

    setHullState(prev => {
      const updatedBreaches = [...prev.breaches];
      updatedBreaches[breachIndexInState].isRepairing = true;
      return { ...prev, breaches: updatedBreaches };
    });

    // Start welding effect
    if (rendererRef.current) {
      const weldGeometry = new THREE.ConeGeometry(0.3, 1, 8);
      const weldMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      weldEffectRef.current = new THREE.Mesh(weldGeometry, weldMaterial);

      const breachMesh = hullState.breaches[breachIndexInState];
      weldEffectRef.current.position.copy(breachMesh.position);
      weldEffectRef.current.position.y = breachMesh.position.y;
      sceneRef.current?.add(weldEffectRef.current);
    }

    // Repair over time
    let repairTime = 0;
    const repairInterval = setInterval(() => {
      repairTime += 0.016;
      const progress = Math.min(1, repairTime / 3); // 3 seconds to repair

      // Update weld effect
      if (weldEffectRef.current) {
        weldEffectRef.current.rotation.x += 0.1;
        weldEffectRef.current.rotation.z += 0.05;
      }

      setRepairProgress(progress * 100);
      setHullState(prev => {
        const updatedBreaches = [...prev.breaches];
        const breachIdx = updatedBreaches.findIndex(b => b.id === breach.id);
        if (breachIdx !== -1) {
          updatedBreaches[breachIdx].health = Math.max(0, updatedBreaches[breachIdx].maxHealth * (1 - progress));
        }
        return { ...prev, breaches: updatedBreaches };
      });

      if (progress >= 1) {
        clearInterval(repairInterval);

        // Remove repaired breach
        const breachIdx = hullState.breaches.findIndex(b => b.id === breach.id);

        if (weldEffectRef.current) {
          sceneRef.current?.remove(weldEffectRef.current);
          weldEffectRef.current.geometry.dispose();
          weldEffectRef.current.material.dispose();
          weldEffectRef.current = null;
        }

        const updatedBreaches = hullState.breaches.filter(b => b.id !== breach.id);
        setHullState(prev => ({
          ...prev,
          breaches: updatedBreaches,
          currentIntegrity: prev.currentIntegrity + 25, // Restore partial hull
        }));
      }
    }, 16);
  };

  const getHealthPercent = (health: number, maxHealth: number) => {
    return (health / maxHealth) * 100;
  };

  return (
    <div className="hull-breach-container">
      <div ref={containerRef} className="hull-breach-3d" />

      {onExit && (
        <button className="back-to-main" onClick={onExit} style={{ top: 20, left: 20, right: 'auto' }}>
          ← Back to Main Menu
        </button>
      )}

      {/* Breach UI */}
      {hullState.breaches.length > 0 && (
        <div className="hull-breach-ui">
          <h3 className="hull-warning">⚠️ HULL BREACHES DETECTED ⚠️</h3>
          <div className="breach-list">
            {hullState.breaches.map((breach, index) => (
              <div key={breach.id} className="breach-item">
                <div className="breach-info">
                  <span className="breach-type">{breach.type}</span>
                  <span className="breach-health">
                    {Math.round(breach.health)}% integrity
                  </span>
                </div>
                <div className="breach-progress">
                  {breach.isRepairing ? (
                    <>
                      <div className="repair-bar">
                        <div
                          className="repair-fill"
                          style={{ width: `${repairProgress}%` }}
                        />
                      </div>
                      <button
                        className="repair-button"
                        onClick={() => startRepair(index)}
                        disabled={repairProgress > 0}
                      >
                        Welding...
                      </button>
                    </>
                  ) : (
                    <button
                      className="repair-button"
                      onClick={() => startRepair(index)}
                    >
                      Repair Breach
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="hull-integrity">
            <span>Hull Integrity: {hullState.currentIntegrity.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
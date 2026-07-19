// ============ Quest Manager for Narrative Questline ============

import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { HolographicDialog } from './HolographicDialog';

// Quest types for Act 1 and Act 2
export type QuestType = 'mine_iron' | 'build_habitat' | 'craft_tools' | 'salvage_debris' | 'scan_meridian' | 'detect_signal' | 'build_comms' | 'triangulate' | 'discover_ruins' | 'gateway_repair' | 'activate_gateway';

export interface QuestProgress {
  type: QuestType;
  status: 'not_started' | 'in_progress' | 'completed';
  description: string;
  progress: number; // 0-100
}

export interface SignalSource {
  type: 'signal' | 'ruin';
  position: THREE.Vector3;
  intensity: number;
  mesh: THREE.Group;
}

interface NarratorSceneProps {
  onQuestComplete: (questType: QuestType) => void;
  onGameOver: () => void;
}

export const NarratorScene: React.FC<NarratorSceneProps> = ({
  onQuestComplete,
  onGameOver,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [questType, setQuestType] = useState<QuestType | null>(null);
  const [dialogLines, setDialogLines] = useState<string[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [sceneType, setSceneType] = useState<'act1' | 'act2' | 'signal' | 'ruins'>(
    'act1'
  );
  const [signalActive, setSignalActive] = useState(false);
  const [signalVolume, setSignalVolume] = useState(0);

  // Audio context for 3D spatial audio
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorsRef = useRef<Map<string, OscillatorNode>>(new Map());
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());

  // Initialize audio on first interaction
  useEffect(() => {
    if (typeof window !== 'undefined' && audioContextRef.current === null) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }, []);

  // Spatial signal emitter
  const createSignalEmitter = (position: THREE.Vector3, intensity: number) => {
    const scene = containerRef.current;
    if (!scene || !audioContextRef.current) return;

    // Visual emitter
    const emitter = new THREE.Group();
    emitter.position.copy(position);

    // Core (glowing sphere)
    const coreGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.8,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    emitter.add(core);

    // Ripple rings
    const ringGeometry = new THREE.RingGeometry(0.6, 0.7, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    emitter.add(ring);

    scene.appendChild(emitter);

    // Audio: low-frequency pulsing signal
    const oscillator = audioContextRef.current!.createOscillator();
    const gainNode = audioContextRef.current!.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 80;
    gainNode.gain.value = intensity * 0.3;

    oscillator.connect(gainNode);
    gainNode.connect(audioContextRef.current!.destination);

    oscillator.start();
    oscillatorsRef.current.set('signal', oscillator);
    gainNodesRef.current.set('signal', gainNode);

    // Pulsing effect
    const animate = () => {
      const time = Date.now() * 0.002;
      core.scale.setScalar(1 + Math.sin(time) * 0.2);
      ring.scale.setScalar(1 + Math.sin(time) * 0.5);

      if (audioContextRef.current) {
        const signalOsc = oscillatorsRef.current.get('signal');
        const signalGain = gainNodesRef.current.get('signal');
        if (signalOsc && signalGain) {
          signalGain.gain.value = intensity * 0.3 * (0.5 + Math.sin(time) * 0.5);
        }
      }

      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      oscillatorsRef.current.get('signal')?.stop();
      gainNodesRef.current.get('signal')?.disconnect();
      emitter.remove();
    };
  };

  // Narrative Act 1: Iron Mining
  const startAct1Mine = () => {
    setSceneType('act1');
    setDialogLines([
      "The asteroid field contains iron ore deposits. Use your mining laser to extract iron chunks.",
      "Each chunk of raw iron can be refined into ingots using the fabricator.",
      "This is just the first step. You need to establish a permanent habitat before nightfall."
    ]);
    setQuestType('mine_iron');
    setSignalActive(false);
    setShowDialog(true);

    // Create visual representation of iron ore
    const scene = containerRef.current;
    if (!scene) return;

    // Spawn asteroids with iron
    for (let i = 0; i < 5; i++) {
      const geometry = new THREE.DodecahedronGeometry(1 + Math.random() * 1.5);
      const material = new THREE.MeshStandardMaterial({
        color: 0x556677, // Iron gray
        metalness: 0.8,
        roughness: 0.4,
      });
      const asteroid = new THREE.Mesh(geometry, material);

      asteroid.position.set(
        (Math.random() - 0.5) * 20,
        0.5,
        -5 - Math.random() * 10
      );

      scene.appendChild(asteroid);

      // Iron ore veins (inner glow)
      const veinGeometry = new THREE.OctahedronGeometry(0.3, 0);
      const veinMaterial = new THREE.MeshBasicMaterial({
        color: 0x666688,
      });
      const vein = new THREE.Mesh(veinGeometry, veinMaterial);
      vein.position.set(
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5
      );
      asteroid.add(vein);
    }
  };

  // Narrative Act 1: Craft Tools
  const startAct1Craft = () => {
    setDialogLines([
      "The fabricator is ready. Convert raw iron into essential tools.",
      "You'll need a repair tool to fix hull breaches and a scanner to detect resources.",
      "Survival equipment is your lifeline in the vacuum."
    ]);
    setQuestType('craft_tools');
    setShowDialog(true);

    // Fabricator setup
    const scene = containerRef.current;
    if (!scene) return;

    // Fabricator machine
    const machineGroup = new THREE.Group();
    machineGroup.position.set(0, 1, -5);

    const baseGeometry = new THREE.BoxGeometry(2, 1, 3);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x333344,
      metalness: 0.9,
      roughness: 0.3,
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    machineGroup.add(base);

    // Head with screen
    const headGeometry = new THREE.BoxGeometry(1.5, 1.5, 0.5);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0x444466,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1;
    machineGroup.add(head);

    // Screen glow
    const screenGeometry = new THREE.PlaneGeometry(1, 0.7);
    const screenMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8,
    });
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.y = 0.9;
    screen.position.z = 0.26;
    machineGroup.add(screen);

    scene.add(machineGroup);

    // Display ingredients
    const ironGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.5);
    const ironMaterial = new THREE.MeshStandardMaterial({
      color: 0x556677,
    });
    const iron = new THREE.Mesh(ironGeometry, ironMaterial);
    iron.rotation.z = Math.PI / 2;
    iron.position.set(-0.6, 0.5, 0);
    machineGroup.add(iron);
  };

  // Narrative Act 1: Build Habitat
  const startAct1Build = () => {
    setDialogLines([
      "You've gathered enough materials. Time to build your first habitat module.",
      "The habitat provides pressurized air and storage space.",
      "This is the foundation of your survival operation."
    ]);
    setQuestType('build_habitat');
    setShowDialog(true);

    // Habitat module structure
    const scene = containerRef.current;
    if (!scene) return;

    // Habitat base
    const habitatGroup = new THREE.Group();
    habitatGroup.position.set(0, 1, 0);

    // Main hull
    const hullGeometry = new THREE.BoxGeometry(4, 2.5, 4);
    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      metalness: 0.7,
      roughness: 0.3,
    });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    habitatGroup.add(hull);

    // Pressurized seal rings
    const ringGeometry = new THREE.TorusGeometry(2.1, 0.15, 16, 50);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6,
    });
    const ring1 = new THREE.Mesh(ringGeometry, ringMaterial);
    ring1.rotation.x = Math.PI / 2;
    habitatGroup.add(ring1);

    const ring2 = new THREE.Mesh(ringGeometry, ringMaterial);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 2;
    habitatGroup.add(ring2);

    // Interior light
    const lightGeometry = new THREE.BoxGeometry(1, 0.1, 1);
    const lightMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
    });
    const light = new THREE.Mesh(lightGeometry, lightMaterial);
    light.position.y = 1;
    light.position.z = 0;
    habitatGroup.add(light);

    scene.add(habitatGroup);

    // Oxygen indicator
    const oxygenBox = document.createElement('div');
    oxygenBox.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      color: #00ffff;
      font-family: 'Courier New', monospace;
      font-size: 18px;
      background: rgba(0, 0, 0, 0.7);
      padding: 10px 20px;
      border: 2px solid #00ffff;
      border-radius: 5px;
    `;
    oxygenBox.textContent = 'O2: READY';
    containerRef.current?.appendChild(oxygenBox);
  };

  // Narrative Act 1: Salvage Debris
  const startAct1Salvage = () => {
    setDialogLines([
      "Meridian wreckage scattered throughout the sector. Search for salvageable components.",
      "You might find advanced alien tech or useful spare parts.",
      "Every resource counts when you're stranded in deep space."
    ]);
    setQuestType('salvage_debris');
    setShowDialog(true);

    const scene = containerRef.current;
    if (!scene) return;

    // Debris field
    const debrisTypes = [
      { shape: 'box', color: 0x666666, size: [1, 2, 0.5] },
      { shape: 'sphere', color: 0x555555, size: [1.5, 1.5, 1.5] },
      { shape: 'cylinder', color: 0x444444, size: [1, 3, 1] },
    ];

    for (let i = 0; i < 20; i++) {
      const type = debrisTypes[Math.floor(Math.random() * debrisTypes.length)];
      let geometry: THREE.BufferGeometry;

      switch (type.shape) {
        case 'box':
          geometry = new THREE.BoxGeometry(...type.size);
          break;
        case 'sphere':
          geometry = new THREE.SphereGeometry(type.size[0], 16, 16);
          break;
        case 'cylinder':
          geometry = new THREE.CylinderGeometry(type.size[0] / 2, type.size[0] / 2, type.size[1], 16);
          break;
        default:
          geometry = new THREE.BoxGeometry(1, 1, 1);
      }

      const material = new THREE.MeshStandardMaterial({
        color: type.color,
        metalness: 0.8,
        roughness: 0.4,
      });
      const debris = new THREE.Mesh(geometry, material);

      debris.position.set(
        (Math.random() - 0.5) * 40,
        type.size[1] / 2,
        -10 - Math.random() * 20
      );
      debris.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      scene.appendChild(debris);
    }
  };

  // Narrative Act 1: Scan Meridian
  const startAct1Scan = () => {
    setDialogLines([
      "Your scanner detects energy signatures from the derelict colony ship Meridian.",
      "It's drifting through the nebula, partially intact.",
      "Something pulled it off course. Find out what by scanning its components."
    ]);
    setQuestType('scan_meridian');
    setShowDialog(true);

    const scene = containerRef.current;
    if (!scene) return;

    // Meridian wreckage (massive broken ship)
    const meridianGroup = new THREE.Group();
    meridianGroup.position.set(0, 1, -15);

    // Ship hull segments
    for (let i = 0; i < 8; i++) {
      const segmentGeometry = new THREE.BoxGeometry(
        8 + Math.random() * 4,
        3 + Math.random() * 2,
        1 + Math.random() * 1
      );
      const segmentMaterial = new THREE.MeshStandardMaterial({
        color: 0x333355,
        metalness: 0.8,
        roughness: 0.4,
      });
      const segment = new THREE.Mesh(segmentGeometry, segmentMaterial);
      segment.position.set(
        (Math.random() - 0.5) * 15,
        2,
        (Math.random() - 0.5) * 10 - i * 5
      );
      segment.rotation.set(
        Math.random() * Math.PI / 4,
        Math.random() * Math.PI / 4,
        Math.random() * Math.PI / 4
      );
      meridianGroup.add(segment);
    }

    // Energy signature (glowing core)
    const coreGeometry = new THREE.OctahedronGeometry(1.5, 0);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.8,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.set(0, 2, -10);
    meridianGroup.add(core);

    // Scanner beam
    const beamGeometry = new THREE.CylinderGeometry(2, 2, 20, 32);
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.2,
    });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.rotation.x = Math.PI / 2;
    beam.position.set(0, 3, -20);
    meridianGroup.add(beam);

    scene.add(meridianGroup);
  };

  // Narrative Act 2: Detect Signal
  const startAct2Detect = () => {
    setSceneType('signal');
    setDialogLines([
      "A mysterious signal echoes through the void.",
      "It's not natural — it has structure, repeating patterns.",
      "Follow it to its source. It could be the key to your survival."
    ]);
    setQuestType('detect_signal');
    setShowDialog(true);
    setSignalActive(true);

    // Create strong signal emitter
    const scene = containerRef.current;
    if (!scene) return;

    const signalPosition = new THREE.Vector3(0, 2, -15);
    createSignalEmitter(signalPosition, 1.0);

    // Signal visual
    const signalGroup = new THREE.Group();
    signalGroup.position.copy(signalPosition);

    // Core
    const coreGeometry = new THREE.SphereGeometry(0.8, 16, 16);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.9,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    signalGroup.add(core);

    // Rings expanding outward
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.6,
    });

    for (let i = 0; i < 3; i++) {
      const ringGeometry = new THREE.RingGeometry(1 + i * 2, 1.2 + i * 2, 64);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.5 - i * 0.3;
      ring.userData = { expansionSpeed: 0.01 * (i + 1) };
      signalGroup.add(ring);
    }

    scene.add(signalGroup);

    // Animated rings
    const animateRings = () => {
      const rings = signalGroup.children.filter(
        (child) => child.geometry.type === 'RingGeometry'
      ) as THREE.Mesh[];

      rings.forEach((ring) => {
        ring.scale.x += ring.userData.expansionSpeed;
        ring.scale.y += ring.userData.expansionSpeed;
        ring.material.opacity -= 0.005;
      });

      requestAnimationFrame(animateRings);
    };

    animateRings();
  };

  // Narrative Act 2: Build Comms
  const startAct2Comms = () => {
    setDialogLines([
      "The signal is coming from deep in the asteroid belt.",
      "You need to build a comms array to triangulate its location.",
      "Contact other survivors or investigate further."
    ]);
    setQuestType('build_comms');
    setShowDialog(true);

    const scene = containerRef.current;
    if (!scene) return;

    // Comms array components
    const towerGroup = new THREE.Group();
    towerGroup.position.set(0, 3, -8);

    // Antenna tower
    const towerBaseGeometry = new THREE.CylinderGeometry(1.5, 2, 2);
    const towerBaseMaterial = new THREE.MeshStandardMaterial({
      color: 0x333355,
      metalness: 0.9,
    });
    const towerBase = new THREE.Mesh(towerBaseGeometry, towerBaseMaterial);
    towerGroup.add(towerBase);

    const towerTopGeometry = new THREE.CylinderGeometry(0.5, 0.5, 4);
    const towerTop = new THREE.Mesh(towerTopGeometry, towerBaseMaterial);
    towerTop.position.y = 3;
    towerGroup.add(towerTop);

    // Antenna dish
    const dishGeometry = new THREE.ConeGeometry(1.5, 0.2, 64);
    const dishMaterial = new THREE.MeshStandardMaterial({
      color: 0x444466,
    });
    const dish = new THREE.Mesh(dishGeometry, dishMaterial);
    dish.rotation.x = Math.PI / 2;
    dish.position.set(0, 6, 0.1);
    towerGroup.add(dish);

    // Dish glow
    const dishGlowGeometry = new THREE.PlaneGeometry(1.4, 1);
    const dishGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8,
    });
    const dishGlow = new THREE.Mesh(dishGlowGeometry, dishGlowMaterial);
    dishGlow.rotation.x = Math.PI / 2;
    dishGlow.position.set(0, 6, 0.15);
    towerGroup.add(dishGlow);

    scene.add(towerGroup);

    // Coax cables (visual only)
    for (let i = -3; i <= 3; i++) {
      const cableGeometry = new THREE.CylinderGeometry(0.05, 0.05, 4);
      const cable = new THREE.Mesh(cableGeometry, towerBaseMaterial);
      cable.position.set(i * 0.8, 2, -0.1);
      cable.rotation.z = -0.2;
      scene.add(cable);
    }
  };

  // Narrative Act 2: Triangulate
  const startAct2Triangulate = () => {
    setDialogLines([
      "Your scanner detects multiple signal sources now.",
      "You can triangulate their positions to find the primary source.",
      "The alien ruins are nearby. Something is waiting for you."
    ]);
    setQuestType('triangulate');
    setShowDialog(true);

    const scene = containerRef.current;
    if (!scene) return;

    // Multiple signal emitters for triangulation
    const signalPositions = [
      new THREE.Vector3(-8, 1.5, -5),
      new THREE.Vector3(8, 1.5, -5),
      new THREE.Vector3(0, 1.5, -18),
    ];

    signalPositions.forEach((pos, index) => {
      createSignalEmitter(pos, 0.3 + index * 0.2);

      // Emitter visual
      const emitterGroup = new THREE.Group();
      emitterGroup.position.copy(pos);

      const coreGeometry = new THREE.SphereGeometry(0.3, 16, 16);
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: index === 2 ? 0xff00ff : 0x00ffff,
        transparent: true,
        opacity: 0.8,
      });
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      emitterGroup.add(core);

      scene.add(emitterGroup);
    });

    // Draw connection lines (triangulation)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.5,
    });

    signalPositions.forEach((pos1) => {
      signalPositions.forEach((pos2) => {
        if (pos1 !== pos2) {
          const points = [pos1, pos2];
          const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(lineGeometry, lineMaterial);
          scene.add(line);
        }
      });
    });
  };

  // Narrative Act 2: Discover Ruins
  const startAct2Ruins = () => {
    setSceneType('ruins');
    setDialogLines([
      "The ruins emerge from the nebula — a massive alien gateway structure.",
      "The gateway once traveled between stars, now dormant for millennia.",
      "It's what pulled the Meridian off course. You must repair it."
    ]);
    setQuestType('discover_ruins');
    setShowDialog(true);

    const scene = containerRef.current;
    if (!scene) return;

    // Alien ruins gateway
    const ruinsGroup = new THREE.Group();
    ruinsGroup.position.set(0, 0, -25);

    // Outer ring (massive)
    const outerRingGeometry = new THREE.TorusGeometry(8, 1.5, 16, 50);
    const outerRingMaterial = new THREE.MeshStandardMaterial({
      color: 0x886655,
      metalness: 0.7,
      roughness: 0.6,
    });
    const outerRing = new THREE.Mesh(outerRingGeometry, outerRingMaterial);
    outerRing.rotation.x = Math.PI / 2;
    ruinsGroup.add(outerRing);

    // Inner ring (orbs inside)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const orbGeometry = new THREE.SphereGeometry(0.8, 16, 16);
      const orbMaterial = new THREE.MeshBasicMaterial({
        color: 0xaa66ff,
        transparent: true,
        opacity: 0.8,
      });
      const orb = new THREE.Mesh(orbGeometry, orbMaterial);
      orb.position.set(
        Math.cos(angle) * 5,
        0,
        Math.sin(angle) * 5
      );
      orb.rotation.x = angle;
      orb.rotation.z = angle;
      ruinsGroup.add(orb);

      // Orb connection lines
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xaa66ff,
        transparent: true,
        opacity: 0.3,
      });
      const points = [new THREE.Vector3(0, 0, 0), orb.position];
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(lineGeometry, lineMaterial);
      ruinsGroup.add(line);
    }

    // Central portal (open gateway)
    const portalGeometry = new THREE.CylinderGeometry(2, 2, 3, 8);
    const portalMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.4,
    });
    const portal = new THREE.Mesh(portalGeometry, portalMaterial);
    portal.position.set(0, 0, -3);
    ruinsGroup.add(portal);

    // Gate particles
    const particleCount = 300;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = 3 + Math.random() * 4;

      particlePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      particlePositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      particlePositions[i * 3 + 2] = r * Math.cos(phi) - 1.5;
    }

    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3)
    );
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x00ffff,
      size: 0.1,
      transparent: true,
      opacity: 0.8,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    ruinsGroup.add(particles);

    scene.add(ruinsGroup);

    // Animate portal particles
    const animateParticles = () => {
      const positions = particles.geometry.attributes.position.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        positions[idx] *= 0.995;
        positions[idx + 1] *= 0.995;
        positions[idx + 2] *= 0.995;

        // Add slight noise
        positions[idx] += (Math.random() - 0.5) * 0.05;
        positions[idx + 1] += (Math.random() - 0.5) * 0.05;
        positions[idx + 2] += (Math.random() - 0.5) * 0.05;
      }

      particles.geometry.attributes.position.needsUpdate = true;

      requestAnimationFrame(animateParticles);
    };

    animateParticles();
  };

  // Quest Complete Handler
  const handleQuestComplete = () => {
    if (questType) {
      onQuestComplete(questType);
      setShowDialog(false);
    }
  };

  // Close Dialog Handler
  const handleCloseDialog = () => {
    setShowDialog(false);
    // Clear scene
    if (containerRef.current) {
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1000,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Navigation Buttons */}
      {showDialog && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            zIndex: 1001,
          }}
        >
          <button
            onClick={startAct1Mine}
            style={{
              background: 'rgba(0, 255, 0, 0.2)',
              border: '2px solid #00ff00',
              color: '#00ff00',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 1: Mine Iron
          </button>
          <button
            onClick={startAct1Craft}
            style={{
              background: 'rgba(255, 255, 0, 0.2)',
              border: '2px solid #ffff00',
              color: '#ffff00',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 1: Craft Tools
          </button>
          <button
            onClick={startAct1Build}
            style={{
              background: 'rgba(0, 0, 255, 0.2)',
              border: '2px solid #0000ff',
              color: '#0000ff',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 1: Build Habitat
          </button>
          <button
            onClick={startAct1Salvage}
            style={{
              background: 'rgba(255, 100, 100, 0.2)',
              border: '2px solid #ff6464',
              color: '#ff6464',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 1: Salvage Debris
          </button>
          <button
            onClick={startAct1Scan}
            style={{
              background: 'rgba(0, 255, 255, 0.2)',
              border: '2px solid #00ffff',
              color: '#00ffff',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 1: Scan Meridian
          </button>
          <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.2)', margin: '10px 0' }} />
          <button
            onClick={startAct2Detect}
            style={{
              background: 'rgba(255, 165, 0, 0.2)',
              border: '2px solid #ffa500',
              color: '#ffa500',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 2: Detect Signal
          </button>
          <button
            onClick={startAct2Comms}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: '2px solid #ffffff',
              color: '#ffffff',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 2: Build Comms
          </button>
          <button
            onClick={startAct2Triangulate}
            style={{
              background: 'rgba(100, 100, 255, 0.2)',
              border: '2px solid #6666ff',
              color: '#6666ff',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 2: Triangulate
          </button>
          <button
            onClick={startAct2Ruins}
            style={{
              background: 'rgba(200, 0, 255, 0.2)',
              border: '2px solid #aa00ff',
              color: '#aa00ff',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Act 2: Discover Ruins
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'rgba(255, 0, 0, 0.2)',
              border: '2px solid #ff0000',
              color: '#ff0000',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Exit Questline
          </button>
        </div>
      )}

      {/* Holographic Dialog */}
      {showDialog && (
        <HolographicDialog
          type={questType || 'signal'}
          title={`Mission: ${questType || 'Signal'}`}
          lines={dialogLines}
          onClose={handleCloseDialog}
        />
      )}

      {/* Instructions */}
      {!showDialog && (
        <div
          style={{
            color: '#ffffff',
            textAlign: 'center',
            fontFamily: 'Courier New, monospace',
          }}
        >
          <h1 style={{ fontSize: '48px', marginBottom: '20px' }}>
            SIGNAL QUESTLINE
          </h1>
          <p style={{ fontSize: '18px', marginBottom: '10px' }}>
            Navigate the signal through space and uncover the mystery
          </p>
          <p style={{ fontSize: '14px', color: '#00ffff' }}>
            Press any button to begin
          </p>
        </div>
      )}
    </div>
  );
};
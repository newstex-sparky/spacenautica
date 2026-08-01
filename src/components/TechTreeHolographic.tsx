import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// Tech tree node data
interface TechNodeData {
  id: string;
  name: string;
  category: 'mining' | 'o2' | 'power' | 'advanced';
  parent?: string;
  requires?: string;
  cost: { iron: number; h2: number | null; oxygen: number | null };
  description: string;
  unlocks?: string;
  costModifier?: number;
  x: number;
  z: number;
}

const TECH_TREE_NODES: TechNodeData[] = [
  // Mining Tier
  { id: 'mining-basic', name: 'Basic Mining', category: 'mining', cost: { iron: 10, h2: 5, oxygen: 0 }, description: 'Unlocks Smelter technology.', unlocks: 'smelter', costModifier: 0.8, x: 0, z: -5 },
  { id: 'mining-advanced', name: 'Advanced Mining', category: 'mining', requires: 'mining-basic', cost: { iron: 30, h2: 20, oxygen: 0 }, description: 'Unlock titanium drilling.', unlocks: 'titanium', costModifier: 1.0, x: 4, z: -5 },
  { id: 'mining-quantum', name: 'Quantum Materials', category: 'mining', requires: 'mining-advanced', cost: { iron: 80, h2: 50, oxygen: 20 }, description: 'Advanced material synthesis.', unlocks: 'quantum', costModifier: 0.6, x: 8, z: -5 },

  // O2 Tier
  { id: 'o2-basic', name: 'Basic O2 Systems', category: 'o2', cost: { iron: 15, h2: 10, oxygen: 0 }, description: 'Unlocks Electrolysis Refinery.', unlocks: 'refinery', costModifier: 0.8, x: 0, z: 0 },
  { id: 'o2-efficient', name: 'Efficient Refinery', category: 'o2', requires: 'o2-basic', cost: { iron: 40, h2: 30, oxygen: 0 }, description: '50% faster O2 + H2 generation.', unlocks: 'hydrogen', costModifier: 0.5, x: 4, z: 0 },
  { id: 'o2-atmospheric', name: 'Atmospheric Recycling', category: 'o2', requires: 'o2-efficient', cost: { iron: 100, h2: 70, oxygen: 40 }, description: 'Long-term survival air recycling.', unlocks: 'atmospheric', costModifier: 0.3, x: 8, z: 0 },

  // Power Tier
  { id: 'power-basic', name: 'Basic Power', category: 'power', cost: { iron: 20, h2: 15, oxygen: 0 }, description: 'Unlock Solar Panel technology.', unlocks: 'solar', costModifier: 1.0, x: 0, z: 5 },
  { id: 'power-solar-grid', name: 'Solar Grid', category: 'power', requires: 'power-basic', cost: { iron: 60, h2: 40, oxygen: 0 }, description: '25% more H2 generation.', unlocks: 'solar-grid', costModifier: 1.0, x: 4, z: 5 },
  { id: 'power-fusion', name: 'Fusion Reactor', category: 'power', requires: 'power-solar-grid', cost: { iron: 150, h2: 100, oxygen: 60 }, description: 'Infinite power source.', unlocks: 'fusion', costModifier: 0.1, x: 8, z: 5 },

  // Advanced - Signal Relay
  { id: 'signal-relay', name: 'Signal Relay Array', category: 'advanced', requires: 'power-fusion', cost: { iron: 20, h2: 10, oxygen: 0 }, description: 'Win condition - broadcast distress.', unlocks: 'broadcast', costModifier: 1.0, x: 4, z: 0 },
];

interface TechTreeHolographicProps {
  isOpen: boolean;
  onClose: () => void;
  onResearch: (nodeId: string) => void;
  researchProgress: Set<string>;
}

export function TechTreeHolographic({ isOpen, onClose, onResearch, researchProgress }: TechTreeHolographicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const techTreeGroupRef = useRef<THREE.Group | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    // Cleanup on unmount
    const cleanup = () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        const parent = containerRef.current;
        rendererRef.current.domElement.remove();
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };

    // Create scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(60, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
    camera.position.set(0, 4, 10);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create tech tree group
    const techTreeGroup = new THREE.Group();
    scene.add(techTreeGroup);
    techTreeGroupRef.current = techTreeGroup;

    // Holographic background plane
    const bgGeometry = new THREE.PlaneGeometry(20, 15);
    const bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x001133,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const bgPlane = new THREE.Mesh(bgGeometry, bgMaterial);
    bgPlane.position.z = -1;
    techTreeGroup.add(bgPlane);

    // Holographic grid lines
    const gridHelper = new THREE.GridHelper(20, 40, 0x004466, 0x002233);
    gridHelper.position.y = -2;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.4;
    gridHelper.material.color.setHex(0x004466);
    techTreeGroup.add(gridHelper);

    // Create nodes
    const nodeMeshes = new Map<string, THREE.Mesh>();
    const nodeLabels = new Map<string, THREE.Mesh>();
    const links: THREE.Line[] = [];

    TECH_TREE_NODES.forEach(node => {
      const isUnlocked = researchProgress.has(node.id);
      const isAvailable = !isUnlocked && (!node.requires || researchProgress.has(node.requires));

      // Node geometry based on category
      let geometry: THREE.BufferGeometry;
      if (node.category === 'mining') {
        geometry = new THREE.IcosahedronGeometry(0.5, 1);
      } else if (node.category === 'o2') {
        geometry = new THREE.OctahedronGeometry(0.5, 0);
      } else if (node.category === 'power') {
        geometry = new THREE.BoxGeometry(0.8, 0.3, 0.8);
      } else {
        geometry = new THREE.TorusGeometry(0.4, 0.1, 8, 16);
      }

      const color = isUnlocked ? 0x00ffff :
                    isAvailable ? 0x00ff88 :
                    node.requires ? 0x666666 : 0x004466;

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: isUnlocked ? 0.9 : (isAvailable ? 0.6 : 0.3),
        wireframe: true,
      });

      const nodeMesh = new THREE.Mesh(geometry, material);
      nodeMesh.position.set(node.x, 0, node.z);
      nodeMesh.userData = { nodeId: node.id, nodeData: node };
      techTreeGroup.add(nodeMesh);
      nodeMeshes.set(node.id, nodeMesh);

      // Glow effect for unlocked nodes
      if (isUnlocked) {
        const glowGeometry = new THREE.SphereGeometry(0.65);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.copy(nodeMesh.position);
        glow.userData = { type: 'glow', nodeId: node.id };
        techTreeGroup.add(glow);
      }

      // Connection line to parent
      if (node.requires) {
        const parentPos = new THREE.Vector3(
          TECH_TREE_NODES.find(n => n.id === node.requires)!.x,
          0,
          TECH_TREE_NODES.find(n => n.id === node.requires)!.z
        );

        const points = [parentPos, nodeMesh.position];
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: node.requires ? (isUnlocked ? 0x00ffff : 0x666666) : 0x004466,
          transparent: true,
          opacity: isUnlocked ? 0.6 : 0.2,
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        techTreeGroup.add(line);
        links.push(line);
      }

      // Node label (billboarded plane)
      const labelGeometry = new THREE.PlaneGeometry(1.5, 0.3);
      const labelMaterial = new THREE.MeshBasicMaterial({
        color: isUnlocked ? 0xffffff : 0x888888,
        transparent: true,
        opacity: isUnlocked ? 0.9 : 0.5,
        side: THREE.DoubleSide,
      });
      const label = new THREE.Mesh(labelGeometry, labelMaterial);
      label.position.set(node.x, node.z < 0 ? node.z - 1.2 : node.z + 1.2, 0.1);
      label.lookAt(0, node.z < 0 ? node.z - 0.5 : node.z + 0.5, 0);
      label.userData = { text: node.name, nodeId: node.id };
      techTreeGroup.add(label);
      nodeLabels.set(node.id, label);
    });

    // Animation loop
    const animate = () => {
      if (!isOpen || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;

      const time = Date.now() * 0.001;

      // Animate glow effects
      techTreeGroupRef.current?.children.forEach(child => {
        if (child.userData.type === 'glow') {
          const baseScale = 0.65;
          const pulse = 0.8 + Math.sin(time * 2) * 0.15;
          child.scale.setScalar(baseScale * pulse);
        }
      });

      rendererRef.current.render(sceneRef.current, cameraRef.current);
      requestAnimationFrame(animate);
    };

    animate();

    // Raycasting for node hover
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current!);
      const intersects = raycaster.intersectObjects(techTreeGroup.current?.children || []);

      if (intersects.length > 0) {
        const object = intersects[0].object;
        if (object.userData.nodeId) {
          hoveredNodeRef.current = object.userData.nodeId;
          document.body.style.cursor = 'pointer';
        }
      } else {
        hoveredNodeRef.current = null;
        document.body.style.cursor = 'default';
      }
    };

    const onMouseClick = (e: MouseEvent) => {
      if (hoveredNodeRef.current) {
        const node = TECH_TREE_NODES.find(n => n.id === hoveredNodeRef.current);
        if (node) {
          setSelectedNodeId(node.id);
          onResearch(node.id);
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onMouseClick);

    // Initial camera rotation
    let cameraAngle = 0;

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return cleanup;
  }, [isOpen, researchProgress, onResearch]);

  // Close tech tree
  const handleClose = () => {
    if (typeof window !== 'undefined' && document.pointerLockElement) {
      window.document.exitPointerLock();
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="tech-tree-overlay" style={styles.overlay}>
      <div style={styles.container} ref={containerRef}></div>

      <div style={styles.hud}>
        <div style={styles.hudTitle}>TECH RESEARCH INTERFACE</div>
        <div style={styles.hudSubtitle}>Holographic Navigation — Use Mouse to Look</div>

        {/* Selected node info */}
        {selectedNodeId && (
          <div style={styles.nodeInfo}>
            <h3 style={styles.nodeTitle}>Node Details</h3>
            <p style={styles.nodeCategory}>{TECH_TREE_NODES.find(n => n.id === selectedNodeId)?.category}</p>
            <p style={styles.nodeName}>{TECH_TREE_NODES.find(n => n.id === selectedNodeId)?.name}</p>
            <p style={styles.nodeDescription}>{TECH_TREE_NODES.find(n => n.id === selectedNodeId)?.description}</p>
            <p style={styles.nodeCost}>Cost: {TECH_TREE_NODES.find(n => n.id === selectedNodeId)?.cost.iron} Iron, {TECH_TREE_NODES.find(n => n.id === selectedNodeId)?.cost.h2 ?? 0} H2, {TECH_TREE_NODES.find(n => n.id === selectedNodeId)?.cost.oxygen ?? 0} Oxygen</p>
          </div>
        )}

        {/* Instructions */}
        <div style={styles.instructions}>
          <p><strong>Controls:</strong></p>
          <ul>
            <li>Mouse: Look around</li>
            <li>Click node: Research tech</li>
            <li>ESC: Close interface</li>
            <li>Mouse wheel: Zoom in/out</li>
          </ul>
        </div>
      </div>

      <button style={styles.closeBtn} onClick={handleClose}>CLOSE (ESC)</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 17, 51, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  container: {
    width: '100%',
    height: '100%',
    position: 'relative' as const,
  },
  hud: {
    position: 'absolute' as const,
    bottom: '10%',
    left: '5%',
    backgroundColor: 'rgba(0, 100, 150, 0.1)',
    border: '1px solid rgba(0, 255, 255, 0.5)',
    padding: '20px',
    borderRadius: '10px',
    color: '#00ffff',
    width: '300px',
    backdropFilter: 'blur(5px)',
  },
  hudTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#00ffff',
    textShadow: '0 0 10px rgba(0, 255, 255, 0.5)',
  },
  hudSubtitle: {
    fontSize: '12px',
    marginBottom: '15px',
    color: 'rgba(0, 255, 255, 0.7)',
  },
  nodeInfo: {
    marginBottom: '15px',
  },
  nodeTitle: {
    margin: 0,
    color: '#ffffff',
    textShadow: '0 0 5px rgba(0, 255, 255, 0.5)',
  },
  nodeCategory: {
    margin: '5px 0',
    color: '#00ff88',
  },
  nodeName: {
    margin: '5px 0',
    color: '#ffffff',
  },
  nodeDescription: {
    margin: '5px 0',
    fontSize: '12px',
    color: '#cccccc',
  },
  nodeCost: {
    margin: '5px 0',
    fontSize: '11px',
    color: '#00aaff',
  },
  instructions: {
    marginTop: '15px',
    paddingTop: '15px',
    borderTop: '1px solid rgba(0, 255, 255, 0.3)',
  },
  instructions p: {
    margin: 0,
    marginBottom: '5px',
    fontSize: '12px',
  },
  instructions ul: {
    margin: 0,
    paddingLeft: '20px',
    fontSize: '12px',
  },
  instructions li: {
    marginBottom: '3px',
  },
  closeBtn: {
    position: 'absolute' as const,
    bottom: '20px',
    right: '20px',
    backgroundColor: 'rgba(0, 255, 100, 0.2)',
    border: '1px solid #00ff66',
    color: '#00ff66',
    padding: '10px 20px',
    borderRadius: '5px',
    fontSize: '14px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
};
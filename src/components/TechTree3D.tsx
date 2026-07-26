import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

/**
 * Tech Tree 3D Holographic UI Component
 *
 * Displays a 3D holographic tech tree in first-person view.
 * Nodes are 3D icons connected by light beams.
 * Researching unlocks buildable modules and tools.
 */

// ====================== Tech Tree Data ======================

export type ResearchNode = {
  id: string;
  name: string;
  tier: number;
  description: string;
  iconType: 'dome' | 'solar' | 'smelter' | 'drill' | 'jetpack' | 'fabricator' | 'relay' | 'power';
  cost: { iron: number; h2: number };
  researchTime: number;
  dependencies: string[];
  unlocked: boolean;
  researched: boolean;
};

export type ResearchConnection = {
  from: string;
  to: string;
  color: number;
  glowColor: number;
};

// Complete tech tree with all 9 nodes
const TECH_TREE_NODES: ResearchNode[] = [
  // Tier 1 - Starting (all unlocked initially)
  {
    id: 'mining-basic',
    name: 'Basic Mining',
    tier: 1,
    description: 'Unlocks mining drill Mk1 for asteroid mining',
    iconType: 'drill',
    cost: { iron: 0, h2: 0 },
    researchTime: 0,
    dependencies: [],
    unlocked: true,
    researched: true,
  },
  {
    id: 'building-basic',
    name: 'Basic Building',
    tier: 1,
    description: 'Unlocks habitat dome and solar panel placement',
    iconType: 'dome',
    cost: { iron: 0, h2: 0 },
    researchTime: 0,
    dependencies: [],
    unlocked: true,
    researched: true,
  },
  {
    id: 'refining-basic',
    name: 'Basic Refining',
    tier: 1,
    description: 'Unlocks smelter and electrolysis refinery',
    iconType: 'smelter',
    cost: { iron: 10, h2: 0 },
    researchTime: 10,
    dependencies: [],
    unlocked: true,
    researched: false,
  },
  // Tier 2
  {
    id: 'mining-advanced',
    name: 'Advanced Mining',
    tier: 2,
    description: 'Unlocks mining drill Mk2 and scanner for efficiency',
    iconType: 'drill',
    cost: { iron: 20, h2: 0 },
    researchTime: 30,
    dependencies: ['mining-basic'],
    unlocked: false,
    researched: false,
  },
  {
    id: 'pressurization',
    name: 'Pressurization',
    tier: 2,
    description: 'Unlocks airlock and O2 generator for station habitation',
    iconType: 'dome',
    cost: { iron: 15, h2: 0 },
    researchTime: 25,
    dependencies: ['building-basic'],
    unlocked: false,
    researched: false,
  },
  {
    id: 'power-grid',
    name: 'Power Grid',
    tier: 2,
    description: 'Unlocks H2 storage tank and power distribution',
    iconType: 'power',
    cost: { iron: 20, h2: 0 },
    researchTime: 30,
    dependencies: ['mining-basic'],
    unlocked: false,
    researched: false,
  },
  {
    id: 'jetpack',
    name: 'Jetpack',
    tier: 3,
    description: 'Unlocks jetpack Mk1/Mk2 for exploration',
    iconType: 'jetpack',
    cost: { iron: 30, h2: 10 },
    researchTime: 45,
    dependencies: ['mining-advanced'],
    unlocked: false,
    researched: false,
  },
  {
    id: 'fabricator',
    name: 'Fabricator',
    tier: 3,
    description: 'Unlocks crafting station and advanced tools',
    iconType: 'fabricator',
    cost: { iron: 25, h2: 0 },
    researchTime: 40,
    dependencies: ['power-grid'],
    unlocked: false,
    researched: false,
  },
  {
    id: 'signal-tech',
    name: 'Signal Tech',
    tier: 3,
    description: 'Unlocks Signal Relay Array (win condition)',
    iconType: 'relay',
    cost: { iron: 40, h2: 20 },
    researchTime: 60,
    dependencies: ['fabricator'],
    unlocked: false,
    researched: false,
  },
];

// Connection beams between tech nodes
const TECH_TREE_CONNECTIONS: ResearchConnection[] = [
  { from: 'mining-basic', to: 'mining-advanced', color: 0x00ffff, glowColor: 0x008888 },
  { from: 'building-basic', to: 'pressurization', color: 0x00ffff, glowColor: 0x008888 },
  { from: 'mining-basic', to: 'power-grid', color: 0x00ffff, glowColor: 0x008888 },
  { from: 'mining-advanced', to: 'jetpack', color: 0xff00ff, glowColor: 0x880088 },
  { from: 'power-grid', to: 'fabricator', color: 0xff00ff, glowColor: 0x880088 },
  { from: 'power-grid', to: 'signal-tech', color: 0xffaa00, glowColor: 0x886600 },
  { from: 'fabricator', to: 'signal-tech', color: 0xffaa00, glowColor: 0x886600 },
];

// ====================== Visual Config ======================

const NODE_RADIUS = 1;
const HOLOGRAM_Y = 0;
const HOLOGRAM_DIST = 8;

// ====================== Helper Functions ======================

/**
 * Creates a 3D node mesh with holographic glow
 */
function createTechNode(node: ResearchNode): THREE.Group {
  const group = new THREE.Group();
  
  // Base platform
  const platformGeom = new THREE.CylinderGeometry(NODE_RADIUS * 0.4, NODE_RADIUS * 0.5, 0.2, 16);
  const platformMat = new THREE.MeshBasicMaterial({ 
    color: node.unlocked && node.researched ? 0x00ff88 : 0x4488ff,
    transparent: true,
    opacity: 0.6
  });
  const platform = new THREE.Mesh(platformGeom, platformMat);
  group.add(platform);
  
  // Icon cone (represents tech tier)
  const iconGeom = new THREE.ConeGeometry(NODE_RADIUS * 0.6, NODE_RADIUS * 1.5, 6);
  const iconMat = new THREE.MeshBasicMaterial({ 
    color: node.unlocked && node.researched ? 0x00ff88 : 0x4488ff,
    transparent: true,
    opacity: 0.8
  });
  const iconMesh = new THREE.Mesh(iconGeom, iconMat);
  iconMesh.position.y = NODE_RADIUS * 1;
  iconMesh.rotation.x = Math.PI / 6;
  group.add(iconMesh);
  
  // Tech tier number on base
  const tierCanvas = document.createElement('canvas');
  tierCanvas.width = 128;
  tierCanvas.height = 128;
  const tierCtx = tierCanvas.getContext('2d')!;
  tierCtx.fillStyle = node.unlocked && node.researched ? '#00ff88' : '#4488ff';
  tierCtx.font = 'bold 80px Arial';
  tierCtx.textAlign = 'center';
  tierCtx.textBaseline = 'middle';
  tierCtx.fillText(`T${node.tier}`, 64, 64);
  const tierTexture = new THREE.CanvasTexture(tierCanvas);
  const tierSpriteMat = new THREE.SpriteMaterial({ map: tierTexture, transparent: true });
  const tierSprite = new THREE.Sprite(tierSpriteMat);
  tierSprite.scale.set(3, 3, 1);
  tierSprite.position.y = NODE_RADIUS * 1.1;
  group.add(tierSprite);
  
  group.userData = { node: node };
  return group;
}

/**
 * Creates connection beam between two nodes
 */
function createTechConnection(conn: ResearchConnection): THREE.Line {
  const start = new THREE.Vector3(0, NODE_RADIUS * 1.5, 0);
  const end = new THREE.Vector3(0, NODE_RADIUS * 1.5, 0);
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({ 
    color: conn.color, 
    transparent: true, 
    opacity: 0.4 
  });
  return new THREE.Line(geometry, material);
}

/**
 * Creates research progress ring
 */
function createResearchRing(node: ResearchNode): THREE.Group {
  const group = new THREE.Group();
  
  if (node.researched) return group;
  
  // Outer glow
  const glowGeom = new THREE.RingGeometry(NODE_RADIUS * 0.5, NODE_RADIUS * 1.2, 32);
  const glowMat = new THREE.MeshBasicMaterial({ 
    color: 0xffaa00, 
    transparent: true, 
    opacity: 0.3,
    side: THREE.DoubleSide
  });
  const glowMesh = new THREE.Mesh(glowGeom, glowMat);
  glowMesh.position.y = NODE_RADIUS * 1;
  group.add(glowMesh);
  
  // Progress indicator (rotating arcs)
  const progressGeom = new THREE.RingGeometry(NODE_RADIUS * 0.55, NODE_RADIUS * 1.15, 16);
  const progressMat = new THREE.MeshBasicMaterial({ 
    color: 0xffff00, 
    transparent: true, 
    opacity: 0.6,
    side: THREE.DoubleSide
  });
  const progressMesh = new THREE.Mesh(progressGeom, progressMat);
  progressMesh.position.y = NODE_RADIUS * 1;
  progressMesh.rotation.x = Math.PI / 2;
  group.add(progressMesh);
  
  group.userData = { node: node, progressMesh };
  return group;
}

// ====================== Main Component ======================

export function TechTree3D() {
  const techTreeRef = useRef<THREE.Group | null>(null);
  const nodesGroupRef = useRef<THREE.Group[]>([]);
  const connectionsGroupRef = useRef<THREE.Group[]>([]);
  const researchRingsRef = useRef<THREE.Group[]>([]);
  
  // Pointer lock state
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [researchingNode, setResearchingNode] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  
  // Raycaster for mouse interaction
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  
  // Pointer lock handling
  const handlePointerLockChange = useCallback(() => {
    setIsPointerLocked(document.pointerLockElement === techTreeRef.current);
  }, [techTreeRef]);
  
  // Initialize tech tree scene
  useEffect(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, HOLOGRAM_Y, HOLOGRAM_DIST);
    camera.lookAt(0, NODE_RADIUS * 0.5, 0);
    
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0.8);
    
    const container = document.getElementById('tech-tree-container');
    if (container) {
      container.appendChild(renderer.domElement);
    }
    
    // Lighting for hologram effect
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0x00aaff, 1, 20);
    pointLight.position.set(0, 5, 0);
    scene.add(pointLight);
    
    // Create hologram group
    const hologramGroup = new THREE.Group();
    
    // Create nodes at tier-based positions
    const nodePositions: Record<string, { x: number; z: number }> = {
      'mining-basic': { x: -6, z: -3 },
      'building-basic': { x: 0, z: -4 },
      'refining-basic': { x: 6, z: -3 },
      'mining-advanced': { x: -9, z: 0 },
      'pressurization': { x: -3, z: -0.5 },
      'power-grid': { x: 3, z: -0.5 },
      'jetpack': { x: 0, z: 3 },
      'fabricator': { x: 3, z: 2 },
      'signal-tech': { x: 0, z: 6 },
    };
    
    TECH_TREE_NODES.forEach((node, index) => {
      const pos = nodePositions[node.id];
      if (!pos) return;
      
      // Create tech node group
      const nodeGroup = createTechNode(node);
      nodeGroup.position.set(pos.x, HOLOGRAM_Y, pos.z);
      hologramGroup.add(nodeGroup);
      nodesGroupRef.current.push(nodeGroup);
      
      // Create research ring
      const ringGroup = createResearchRing(node);
      ringGroup.position.set(pos.x, HOLOGRAM_Y, pos.z);
      hologramGroup.add(ringGroup);
      researchRingsRef.current.push(ringGroup);
      
      // Create node labels
      createNodeLabel(node, nodeGroup, pos.x, HOGLRAM_Y, pos.z);
    });
    
    // Create connection beams
    TECH_TREE_CONNECTIONS.forEach(conn => {
      const nodeA = TECH_TREE_NODES.find(n => n.id === conn.from);
      const nodeB = TECH_TREE_NODES.find(n => n.id === conn.to);
      
      if (nodeA && nodeB) {
        const posA = nodePositions[nodeA.id];
        const posB = nodePositions[nodeB.id];
        
        if (posA && posB) {
          const start = new THREE.Vector3(posA.x, HOLOGRAM_Y + NODE_RADIUS * 1.5, posA.z);
          const end = new THREE.Vector3(posB.x, HOLOGRAM_Y + NODE_RADIUS * 1.5, posB.z);
          const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
          const material = new THREE.LineBasicMaterial({ 
            color: conn.color, 
            transparent: true, 
            opacity: 0.3 
          });
          const line = new THREE.Line(geometry, material);
          hologramGroup.add(line);
          connectionsGroupRef.current.push(line);
          
          // Add beam glow
          const glowGeom = new THREE.BufferGeometry().setFromPoints([start, end]);
          const glowMat = new THREE.LineBasicMaterial({ 
            color: conn.glowColor, 
            transparent: true, 
            opacity: 0.1 
          });
          const glowLine = new THREE.Line(glowGeom, glowMat);
          hologramGroup.add(glowLine);
          connectionsGroupRef.current.push(glowLine);
        }
      }
    });
    
    // Add hologram platform
    const platformGeom = new THREE.CylinderGeometry(HOLOGRAM_DIST, HOLOGRAM_DIST, 0.1, 64);
    const platformMat = new THREE.MeshBasicMaterial({ 
      color: 0x0044ff, 
      transparent: true, 
      opacity: 0.1,
      side: THREE.DoubleSide
    });
    const hologramPlatform = new THREE.Mesh(platformGeom, platformMat);
    hologramPlatform.position.y = -NODE_RADIUS * 0.5;
    hologramGroup.add(hologramPlatform);
    
    // Add background grid
    const gridHelper = new THREE.GridHelper(15, 15, 0x0044ff, 0x001133);
    gridHelper.position.y = -NODE_RADIUS * 0.3;
    hologramGroup.add(gridHelper);
    
    scene.add(hologramGroup);
    techTreeRef.current = hologramGroup;
    
    // Mouse click handler
    const handleClick = (event: MouseEvent) => {
      if (!isPointerLocked) return;
      
      mouse.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
      
      raycaster.current.setFromCamera(mouse.current, camera);
      const intersects = raycaster.current.intersectObjects(nodesGroupRef.current, true);
      
      if (intersects.length > 0) {
        let clickedGroup = intersects[0].object;
        while (clickedGroup.parent && !clickedGroup.userData.node) {
          clickedGroup = clickedGroup.parent as THREE.Group;
        }
        
        if (clickedGroup.userData.node) {
          setSelectedNode(clickedGroup.userData.node.id);
          
          // Start research if unlocked and not researched
          const node = clickedGroup.userData.node as ResearchNode;
          if (node.unlocked && !node.researched) {
            startResearch(node);
          }
        }
      }
    };
    
    document.addEventListener('mousedown', handleClick);
    
    // Pointer lock change listener
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    
    // Resize handler
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    
    // Animation loop
    const clock = new THREE.Clock();
    
    function animate() {
      requestAnimationFrame(animate);
      
      const delta = clock.getDelta();
      
      // Rotate research rings
      researchRingsRef.current.forEach(ringGroup => {
        if (ringGroup.userData.progressMesh) {
          ringGroup.userData.progressMesh.rotation.z += delta * 0.5;
        }
      });
      
      // Slight hover effect on nodes
      nodesGroupRef.current.forEach((nodeGroup, i) => {
        const time = Date.now() * 0.001;
        nodeGroup.position.y = HOLOGRAM_Y + Math.sin(time + i) * 0.1;
      });
      
      // Research progress animation
      if (researchingNode && progressPercent < 100) {
        progressPercent += delta * (100 / (TECH_TREE_NODES.find(n => n.id === researchingNode)?.researchTime || 1));
        setProgressPercent(Math.min(100, progressPercent));
        
        if (progressPercent >= 100) {
          completeResearch(researchingNode);
        }
      }
      
      renderer.render(scene, camera);
    }
    
    animate();
    
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.innerHTML = '';
      }
      renderer.dispose();
    };
  }, [isPointerLocked]);
  
  // Resume research progress
  useEffect(() => {
    if (researchingNode && progressPercent < 100) {
      const clock = new THREE.Clock();
      function animateProgress() {
        if (researchingNode && progressPercent < 100) {
          progressPercent += clock.getDelta() * (100 / (TECH_TREE_NODES.find(n => n.id === researchingNode)?.researchTime || 1));
          setProgressPercent(Math.min(100, progressPercent));
          
          if (progressPercent >= 100) {
            completeResearch(researchingNode);
          } else {
            requestAnimationFrame(animateProgress);
          }
        }
      }
      animateProgress();
    }
  }, [researchingNode, progressPercent]);
  
  const startResearch = (node: ResearchNode) => {
    // Check if all dependencies are researched
    const allDependenciesResearched = node.dependencies.every(
      depId => TECH_TREE_NODES.find(n => n.id === depId)?.researched === true
    );
    
    if (!allDependenciesResearched) {
      alert(`Research ${node.name} requires all dependencies researched first!\n\nRequired: ${node.dependencies.join(', ')}`);
      return;
    }
    
    // Check resources
    const resources = { iron: 50, h2: 20 }; // Mock resources - replace with actual resource check
    if (node.cost.iron > resources.iron || node.cost.h2 > resources.h2) {
      alert(`Insufficient resources for ${node.name}!\n\nRequired: ${node.cost.iron} iron, ${node.cost.h2} H2`);
      return;
    }
    
    setResearchingNode(node.id);
    setProgressPercent(0);
  };
  
  const completeResearch = (nodeId: string) => {
    const node = TECH_TREE_NODES.find(n => n.id === nodeId);
    if (node) {
      node.researched = true;
      node.unlocked = true;
      setResearchingNode(null);
      setProgressPercent(0);
      alert(`${node.name} has been researched!\n\nUnlocked: ${node.description}`);
    }
  };
  
  return (
    <div id="tech-tree-container" className="fixed inset-0 bg-black z-50">
      {!isPointerLocked && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90">
          <div className="text-center p-8">
            <h2 className="text-4xl font-bold text-blue-400 mb-4">3D Tech Tree</h2>
            <p className="text-gray-300 mb-8">Press ESC to release mouse, click to lock and navigate</p>
            <p className="text-gray-400 text-sm">
              WASD to move • Mouse to look • Click node to research
            </p>
          </div>
        </div>
      )}
      
      {researchingNode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 border border-yellow-500 px-6 py-3 rounded">
          <p className="text-yellow-400 text-sm">
            Researching: <span className="font-bold">
              {TECH_TREE_NODES.find(n => n.id === researchingNode)?.name}
            </span>
          </p>
        </div>
      )}
      
      {selectedNode && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/80 border border-cyan-500 px-6 py-3 rounded">
          <p className="text-cyan-400 text-sm">
            Selected: <span className="font-bold">
              {TECH_TREE_NODES.find(n => n.id === selectedNode)?.name}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

// Helper for Hologram Y
const HOGLRAM_Y = HOLOGRAM_Y;

// ====================== Component Interface ======================

export type {
  ResearchNode,
  ResearchConnection,
};

export default TechTree3D;
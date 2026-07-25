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
  iconType: 'dome' | 'solar' | 'smelter' | 'drill' | 'jetpack' | 'fabricator' | 'relay';
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
};

const TECH_TREE_NODES: ResearchNode[] = [
  // Tier 1 - Starting
  {
    id: 'mining-basic',
    name: 'Basic Mining',
    tier: 1,
    description: 'Unlocks mining drill Mk1',
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
    description: 'Unlocks habitat dome and solar panel',
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
    description: 'Unlocks mining drill Mk2 and scanner',
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
    description: 'Unlocks airlock and O2 generator',
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
    iconType: 'solar',
    cost: { iron: 20, h2: 0 },
    researchTime: 30,
    dependencies: ['mining-basic'],
    unlocked: false,
    researched: false,
  },
  // Tier 3
  {
    id: 'jetpack',
    name: 'Jetpack',
    tier: 3,
    description: 'Unlocks jetpack Mk1/Mk2',
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
    description: 'Unlocks Signal Relay Array',
    iconType: 'relay',
    cost: { iron: 40, h2: 20 },
    researchTime: 60,
    dependencies: ['fabricator'],
    unlocked: false,
    researched: false,
  },
];

const TECH_TREE_CONNECTIONS: ResearchConnection[] = [
  { from: 'mining-basic', to: 'mining-advanced', color: 0x00ffff },
  { from: 'building-basic', to: 'pressurization', color: 0x00ffff },
  { from: 'mining-basic', to: 'power-grid', color: 0x00ffff },
  { from: 'mining-advanced', to: 'jetpack', color: 0x00ff00 },
  { from: 'power-grid', to: 'fabricator', color: 0x00ff00 },
  { from: 'fabricator', to: 'signal-tech', color: 0x00ff00 },
];

// ====================== Constants ======================

const TECH_TREE_CONTAINER_ID = 'tech-tree-container';
const TECH_TREE_SCALE = 1.5;
const NODE_RADIUS = 0.8;

// ====================== Research Management ======================

interface PlayerResources {
  iron: number;
  h2: number;
}

interface TechTreeState {
  resources: PlayerResources;
  selectedNode: ResearchNode | null;
  researching: ResearchNode | null;
  researchProgress: number;
}

// ====================== Component ======================

export function TechTree3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2(0, 0));
  const mouseRaycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const [techTreeState, setTechTreeState] = useState<TechTreeState>({
    resources: { iron: 50, h2: 50 },
    selectedNode: null,
    researching: null,
    researchProgress: 0,
  });

  // Research function
  const startResearch = useCallback(
    (node: ResearchNode) => {
      if (techTreeState.resources.iron >= node.cost.iron &&
          techTreeState.resources.h2 >= node.cost.h2) {
        setTechTreeState((prev) => ({
          ...prev,
          researching: node,
          researchProgress: 0,
        }));
      }
    },
    [techTreeState.resources]
  );

  // Cancel research
  const cancelResearch = useCallback(() => {
    setTechTreeState((prev) => ({
      ...prev,
      researching: null,
      researchProgress: 0,
    }));
  }, []);

  // Research update (called in game loop)
  const updateResearch = useCallback(
    (deltaTime: number) => {
      setTechTreeState((prev) => {
        if (!prev.researching) return prev;

        const progress = prev.researchProgress + deltaTime;
        if (progress >= prev.researching.researchTime) {
          // Research complete
          const newNode = {
            ...prev.researching,
            researched: true,
            unlocked: true,
          };

          // Update dependencies
          TECH_TREE_NODES.forEach((node) => {
            if (newNode.dependencies.includes(node.id)) {
              TECH_TREE_NODES[node.id] = node;
            }
          });

          return {
            ...prev,
            researching: null,
            researchProgress: 0,
            resources: {
              iron: prev.resources.iron - newNode.cost.iron,
              h2: prev.resources.h2 - newNode.cost.h2,
            },
            selectedNode: newNode,
          };
        }

        return {
          ...prev,
          researchProgress: progress,
        };
      });
    },
    []
  );

  // Initialize tech tree scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000810); // Deep space blue
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 8, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create tech tree group
    const techTreeGroup = new THREE.Group();
    techTreeGroup.position.set(0, 4, 0);
    scene.add(techTreeGroup);

    // Create node geometries (3D icons)
    const nodeMeshes: Record<string, THREE.Mesh> = {};
    const nodePositions: Record<string, THREE.Vector3> = {};

    // Tier 1 nodes
    nodePositions['mining-basic'] = new THREE.Vector3(-6, 0, 0);
    nodePositions['building-basic'] = new THREE.Vector3(-3, 0, 0);
    nodePositions['refining-basic'] = new THREE.Vector3(0, 0, 0);

    // Tier 2 nodes
    nodePositions['mining-advanced'] = new THREE.Vector3(-4, 0, 4);
    nodePositions['pressurization'] = new THREE.Vector3(-7, 0, 4);
    nodePositions['power-grid'] = new THREE.Vector3(-1, 0, 4);

    // Tier 3 nodes
    nodePositions['jetpack'] = new THREE.Vector3(-4, 0, 8);
    nodePositions['fabricator'] = new THREE.Vector3(-7, 0, 8);
    nodePositions['signal-tech'] = new THREE.Vector3(-1, 0, 8);

    // Create node meshes with holographic appearance
    const createNodeMesh = (
      id: string,
      iconType: ResearchNode['iconType'],
      position: THREE.Vector3,
      unlocked: boolean,
      researched: boolean
    ): THREE.Group => {
      const group = new THREE.Group();
      group.position.copy(position);

      const baseColor = researched ? 0x00ff00 : unlocked ? 0x00ffff : 0x333333;
      const emissiveColor = researched ? 0x00ff00 : 0x0044aa;

      // Node base
      const baseGeometry = new THREE.CylinderGeometry(NODE_RADIUS * 0.5, NODE_RADIUS * 0.5, 0.3, 16);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: emissiveColor,
        emissiveIntensity: researched ? 0.8 : 0.4,
        transparent: true,
        opacity: 0.8,
        roughness: 0.3,
        metalness: 0.8,
      });
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      base.rotation.x = Math.PI / 2;
      base.position.y = -0.5;
      group.add(base);

      // Node icon (3D representation of tech)
      let iconGeometry: THREE.BufferGeometry;
      switch (iconType) {
        case 'drill':
          iconGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.4);
          break;
        case 'dome':
          iconGeometry = new THREE.SphereGeometry(0.4, 16, 8);
          break;
        case 'smelter':
          iconGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.6, 8);
          break;
        case 'jetpack':
          iconGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
          break;
        case 'fabricator':
          iconGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.8);
          break;
        case 'relay':
          iconGeometry = new THREE.ConeGeometry(0.4, 1, 8);
          break;
        default:
          iconGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
      }

      const iconMaterial = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: emissiveColor,
        emissiveIntensity: researched ? 1 : 0.6,
        transparent: true,
        opacity: 0.9,
        roughness: 0.2,
        metalness: 1.0,
      });

      const icon = new THREE.Mesh(iconGeometry, iconMaterial);
      group.add(icon);

      // Holographic ring around node
      const ringGeometry = new THREE.TorusGeometry(NODE_RADIUS, 0.1, 8, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.5,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.5;
      group.add(ring);

      // Add user data for raycasting
      (group as any).userData = {
        id,
        iconType,
        type: 'node',
      };

      return group;
    };

    // Create all nodes
    TECH_TREE_NODES.forEach((node) => {
      const mesh = createNodeMesh(
        node.id,
        node.iconType,
        nodePositions[node.id],
        node.unlocked,
        node.researched
      );
      techTreeGroup.add(mesh);
      nodeMeshes[node.id] = mesh;
    });

    // Create connection beams
    const createConnection = (
      fromId: string,
      toId: string,
      color: number
    ): THREE.Line => {
      const from = nodePositions[fromId];
      const to = nodePositions[toId];

      const points = [from, to];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
      });

      return new THREE.Line(geometry, material);
    };

    TECH_TREE_CONNECTIONS.forEach((conn) => {
      const line = createConnection(conn.from, conn.to, conn.color);
      line.visible = TECH_TREE_NODES[conn.from].researched;
      techTreeGroup.add(line);
    });

    // Store node meshes and connections in userData for updates
    (techTreeGroup as any).nodeMeshes = nodeMeshes;
    (techTreeGroup as any).connections: { from: string; to: string; line: THREE.Line }[] =
      TECH_TREE_CONNECTIONS.map((conn) => ({
        from: conn.from,
        to: conn.to,
        line: createConnection(conn.from, conn.to, conn.color),
      }));

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      // Rotate tech tree slowly
      techTreeGroup.rotation.y += 0.002;

      // Animate researching node
      if (techTreeState.researching) {
        (techTreeGroup as any).nodeMeshes[techTreeState.researching.id].rotation.y += 0.01;
      }

      // Pulse research beam
      TECH_TREE_CONNECTIONS.forEach((conn) => {
        const line = (techTreeGroup as any).connections?.find(
          (c: { from: string; to: string }) => c.from === conn.from && c.to === conn.to
        );
        if (line) {
          line.line.material.opacity = 0.3 + Math.sin(Date.now() * 0.003) * 0.2;
        }
      });

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

    // Handle mouse movement for raycasting
    const handleMouseMove = (event: MouseEvent) => {
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect) return;

      mouseRef.current.x =
        ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y =
        -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Raycast to find hovered node
      mouseRaycasterRef.current.setFromCamera(mouseRef.current, camera);
      const intersects = mouseRaycasterRef.current.intersectObjects(
        techTreeGroup.children,
        true
      );

      let hoveredNode = null;
      if (intersects.length > 0) {
        const parent = intersects[0].object.parent;
        if (parent && (parent as any).userData?.id) {
          hoveredNode = (parent as any).userData.id;
        } else if ((intersects[0].object as any).userData?.id) {
          hoveredNode = (intersects[0].object as any).userData.id;
        }
      }

      // Update cursor
      document.body.style.cursor = hoveredNode ? 'pointer' : 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mountRef.current && renderer) {
        mountRef.current.removeChild(renderer.domElement);
      }
      if (renderer) {
        renderer.dispose();
      }
      if (scene) {
        scene.clear();
      }
    };
  }, [techTreeState]);

  // Update scene after resource changes
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const techTreeGroup = scene.getObjectByProperty('type', 'Group');

    if (!techTreeGroup) return;

    // Update node colors based on research state
    TECH_TREE_NODES.forEach((node) => {
      const mesh = (techTreeGroup as any).nodeMeshes?.[node.id];
      if (mesh) {
        const baseColor = node.researched ? 0x00ff00 : node.unlocked ? 0x00ffff : 0x333333;
        const emissiveColor = node.researched ? 0x00ff00 : 0x0044aa;

        mesh.children.forEach((child: THREE.Mesh) => {
          if (child.material) {
            child.material.color.setHex(baseColor);
            child.material.emissive.setHex(emissiveColor);
            child.material.emissiveIntensity = node.researched ? 1 : 0.6;
          }
        });

        // Update connections
        TECH_TREE_CONNECTIONS.forEach((conn) => {
          if (conn.from === node.id) {
            const connection = (techTreeGroup as any).connections?.find(
              (c: { from: string; to: string }) => c.from === conn.from && c.to === conn.to
            );
            if (connection) {
              connection.line.material.opacity = node.researched ? 1 : 0.2;
              connection.line.visible = node.researched;
            }
          }
        });
      }
    });
  }, [techTreeState]);

  return (
    <div
      id={TECH_TREE_CONTAINER_ID}
      ref={mountRef}
      style={{
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        display: 'none', // Hidden by default, shown with key press
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    />
  );
}

export default TechTree3D;
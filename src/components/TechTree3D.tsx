import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { TechTreeNode, TECH_TREE_NODES, canResearchNode, researchNode, TECH_TREE_CONFIG } from '../models/techtree/data';
import './TechTree.css';

export default function TechTree3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const [researchProgress, setResearchProgress] = useState<Set<string>>(new Set());
  const [resources, setResources] = useState({ iron: 100, h2: 100 });
  const [availableNodes, setAvailableNodes] = useState<TechTreeNode[]>([]);
  const [lockedNodes, setLockedNodes] = useState<TechTreeNode[]>([]);

  const techTreeGroupRef = useRef<THREE.Group | null>(null);
  const nodeMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const connectionBeamsRef = useRef<Map<string, THREE.Line>>(new Map());

  const [cameraDistance, setCameraDistance] = useState(12);
  const [cameraHeight, setCameraHeight] = useState(5);
  const [cameraYaw, setCameraYaw] = useState(0);
  const [targetCameraDistance, setTargetCameraDistance] = useState(12);
  const [targetCameraHeight, setTargetCameraHeight] = useState(5);
  const [targetCameraYaw, setTargetCameraYaw] = useState(0);

  const init = useCallback(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x001a33);
    scene.fog = new THREE.Fog(0x001a33, 10, 50);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, cameraHeight, cameraDistance);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setAnimationLoop(renderGame);
    renderer.domElement.id = 'tech-tree-canvas';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const centerLight = new THREE.PointLight(0x00ffff, 2, 20);
    centerLight.position.set(0, 2, 0);
    scene.add(centerLight);

    createTechTreePanel(scene);
    createTechTreeNodes();
    createConnectionBeams();
    updateTechUI();

    const handleResize = () => {
      if (!containerRef.current || !camera || !renderer) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') researchNodeAtCursor();
      if (e.code === 'Escape') window.location.href = '/';
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
    };
  }, [cameraHeight, cameraDistance]);

  useEffect(() => {
    const cleanUp = init();
    return cleanUp;
  }, [init]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCameraDistance(prev => prev + (targetCameraDistance - prev) * 0.1);
      setCameraHeight(prev => prev + (targetCameraHeight - prev) * 0.1);
      setCameraYaw(prev => prev + (targetCameraYaw - prev) * 0.1);
    }, 16);
    return () => clearInterval(interval);
  }, [targetCameraDistance, targetCameraHeight, targetCameraYaw]);

  useEffect(() => {
    updateTechTreeAppearance();
  }, [researchProgress]);

  useEffect(() => {
    updateTechUI();
  }, [researchProgress, resources]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setTargetCameraYaw(prev => prev - (e.clientX - previousMousePosition.x) * 0.005);
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => { isDragging = false; };
    const onMouseLeave = () => { isDragging = false; };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mouseleave', onMouseLeave);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTargetCameraDistance(prev => Math.max(5, Math.min(25, prev + e.deltaY * 0.01)));
    };
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const delta = 0.1;
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          setTargetCameraYaw(prev => prev + delta);
          break;
        case 'ArrowRight':
        case 'KeyD':
          setTargetCameraYaw(prev => prev - delta);
          break;
        case 'ArrowUp':
        case 'KeyW':
          setTargetCameraHeight(prev => Math.max(-0.5, prev + delta));
          break;
        case 'ArrowDown':
        case 'KeyS':
          setTargetCameraHeight(prev => Math.min(1.5, prev - delta));
          break;
        case '+':
        case '=':
          setTargetCameraDistance(prev => Math.max(5, prev - 1));
          break;
        case '-':
        case '_':
          setTargetCameraDistance(prev => Math.min(25, prev + 1));
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const renderGame = useCallback((time: number) => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!camera || !renderer || !scene) return;

    camera.position.x = Math.sin(cameraYaw) * cameraDistance;
    camera.position.z = Math.cos(cameraYaw) * cameraDistance;
    camera.position.y = cameraHeight;
    camera.lookAt(0, 0, 0);

    if (techTreeGroupRef.current) {
      techTreeGroupRef.current.rotation.y = time * 0.00005;
    }

    renderer.render(scene, camera);
  }, [cameraYaw, cameraDistance, cameraHeight]);

  const createTechTreePanel = (scene: THREE.Scene) => {
    const group = new THREE.Group();

    const panelGeometry = new THREE.CylinderGeometry(8, 8, 0.2, 32);
    const panelMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    group.add(panel);

    const glowGeometry = new THREE.TorusGeometry(7.5, 0.1, 16, 50);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.rotation.x = Math.PI / 2;
    group.add(glow);

    const hubGeometry = new THREE.SphereGeometry(1, 32, 32);
    const hubMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
    });
    const hub = new THREE.Mesh(hubGeometry, hubMaterial);
    group.add(hub);

    scene.add(group);
    techTreeGroupRef.current = group;
  };

  const createTechTreeNodes = () => {
    let currentTierIndex = 0;
    TECH_TREE_NODES.forEach(node => {
      let geometry;

      if (node.category.toLowerCase().includes('mining')) {
        geometry = new THREE.OctahedronGeometry(0.5, 0);
      } else if (node.category.toLowerCase().includes('building') || node.category.toLowerCase().includes('power')) {
        geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
      } else if (node.category.toLowerCase().includes('movement')) {
        geometry = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
      } else {
        geometry = new THREE.IcosahedronGeometry(0.5, 0);
      }

      const material = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: node.unlocked && !node.researched ? 0.9 : 0.3,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { nodeId: node.id, isTechNode: true };

      const nodesInTier = TECH_TREE_NODES.filter(n => n.tier === node.tier);
      mesh.position.x = ((nodesInTier.indexOf(node) - nodesInTier.length / 2) + 0.5) * 2.5;
      mesh.position.y = (node.tier - 1) * 1.5;
      mesh.position.z = 0;

      sceneRef.current?.add(mesh);
      nodeMeshesRef.current.set(node.id, mesh);
    });
  };

  const createConnectionBeams = () => {
    TECH_TREE_NODES.forEach(node => {
      if (!node.prerequisites || node.prerequisites.length === 0) return;

      node.prerequisites.forEach(prereqId => {
        const parentMesh = nodeMeshesRef.current.get(prereqId);
        if (parentMesh) {
          const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            parentMesh.position.clone(),
            nodeMeshesRef.current.get(node.id)!.position.clone(),
          ]);

          const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.3,
          });

          const line = new THREE.Line(lineGeometry, lineMaterial);
          sceneRef.current?.add(line);
          connectionBeamsRef.current.set(`${node.id}-${prereqId}`, line);
        }
      });
    });
  };

  const updateTechTreeAppearance = () => {
    nodeMeshesRef.current.forEach((mesh, nodeId) => {
      const node = TECH_TREE_NODES.find(n => n.id === nodeId);
      if (!node) return;

      if (node.researched) {
        mesh.material.color.setHex(0x00ff00);
        mesh.material.opacity = 1;
      } else if (node.unlocked) {
        const allParentsResearched = node.prerequisites && node.prerequisites.length > 0 &&
          node.prerequisites.every(pId => researchProgress.has(pId));

        if (allParentsResearched) {
          mesh.material.color.setHex(0x00ffff);
          mesh.material.opacity = 0.9;
        } else {
          mesh.material.color.setHex(0x555555);
          mesh.material.opacity = 0.3;
        }
      } else {
        mesh.material.color.setHex(0x333333);
        mesh.material.opacity = 0.2;
      }
    });
  };

  const researchNodeAtCursor = () => {
    const camera = cameraRef.current;
    if (!camera) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const meshArray = Array.from(nodeMeshesRef.current.values());
    const intersects = raycaster.intersectObjects(meshArray);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object as THREE.Mesh;
      const nodeId = clickedMesh.userData.nodeId;

      if (nodeId && !researchProgress.has(nodeId)) {
        if (canResearchNode(nodeId, resources, researchProgress)) {
          const result = researchNode(nodeId, resources, researchProgress);

          if (result.success) {
            setResources(result.resourcesRemaining);
            setResearchProgress(prev => new Set([...prev, nodeId]));
            alert(result.message);
            unlockTechNode(nodeId);
          } else {
            alert(result.message);
          }
        }
      }
    }
  };

  const unlockTechNode = (nodeId: string) => {
    switch (nodeId) {
      case 'mining-advanced':
        console.log('Unlocking: Mining Drill Mk2, Scanner');
        break;
      case 'refining-basic':
        console.log('Unlocking: Smelter, Electrolysis Refinery');
        break;
      case 'building-pressurization':
        console.log('Unlocking: Airlock, O2 Generator');
        break;
      case 'power-grid':
        console.log('Unlocking: H2 Storage Tank, Power Distribution');
        break;
      case 'movement-jetpack':
        console.log('Unlocking: Jetpack');
        break;
      case 'building-fabricator':
        console.log('Unlocking: Fabricator');
        break;
      case 'utility-signal':
        console.log('Unlocking: Signal Relay Array');
        break;
    }
  };

  const updateTechUI = () => {
    const researched = new Set<string>();
    const available: TechTreeNode[] = [];
    const locked: TechTreeNode[] = [];

    TECH_TREE_NODES.forEach(node => {
      if (node.researched) {
        researched.add(node.id);
      } else if (canResearchNode(node.id, resources, researched)) {
        available.push(node);
      } else {
        locked.push(node);
      }
    });

    setResearchProgress(researched);
    setAvailableNodes(available);
    setLockedNodes(locked);
  };

  return (
    <div ref={containerRef} className="tech-tree-container" style={{ height: '100vh', width: '100vw' }}>
      <div className="tech-tree-overlay">
        <h2>🔬 Tech Tree</h2>
        <div className="tech-info">
          <div className="tech-stat">
            <span className="tech-label">Resources:</span>
            <span>Iron: {resources.iron}</span>
            <span>H2: {resources.h2}</span>
          </div>
          <div className="tech-stat">
            <span className="tech-label">Available Research:</span>
            <span>{availableNodes.length} nodes</span>
          </div>
          <div className="tech-stat">
            <span className="tech-label">Total Researched:</span>
            <span>{researchProgress.size} nodes</span>
          </div>
          <div className="tech-controls">
            <div>🖱️ Mouse drag: Rotate view</div>
            <div>⚙️ WASD/Arrow keys: Rotate</div>
            <div>🔍 Scroll: Zoom in/out</div>
            <div>⌨️ R: Research selected node</div>
            <div>⌨️ ESC: Exit to menu</div>
          </div>
        </div>

        {availableNodes.length > 0 && (
          <div className="tech-nodes-panel">
            <h3>Available Research ({availableNodes.length})</h3>
            <div className="tech-nodes-list">
              {availableNodes.map(node => (
                <div key={node.id} className="tech-node-item">
                  <div className="tech-node-name">{node.name}</div>
                  <div className="tech-node-desc">{node.description}</div>
                  <div className="tech-node-cost">
                    Iron: {node.cost.iron} | H2: {node.cost.h2}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {lockedNodes.length > 0 && (
          <div className="tech-locked-panel">
            <h3>Locked ({lockedNodes.length})</h3>
            <div className="tech-nodes-list">
              {lockedNodes.map(node => (
                <div key={node.id} className="tech-node-item locked">
                  <div className="tech-node-name">{node.name}</div>
                  <div className="tech-node-desc">Prerequisites not met</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
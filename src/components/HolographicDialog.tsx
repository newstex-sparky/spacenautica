import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export interface HolographicDialogProps {
  type: 'mine' | 'craft' | 'build' | 'salvage' | 'scan' | 'signal' | 'ruins';
  title: string;
  lines: string[];
  onClose: () => void;
}

export const HolographicDialog: React.FC<HolographicDialogProps> = ({
  type,
  title,
  lines,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup with sci-fi environment
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x001133);
    scene.fog = new THREE.Fog(0x001133, 5, 25);
    sceneRef.current = scene;

    // Camera positioned for dialog view
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 2, 6);
    camera.lookAt(0, 1.5, -2);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Holographic emitter (sparks)
    const emitterGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const emitterMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6,
    });
    const emitter = new THREE.Mesh(emitterGeometry, emitterMaterial);
    emitter.position.set(0, 1.5, -2);
    scene.add(emitter);

    // Grid floor (holographic projection surface)
    const gridHelper = new THREE.GridHelper(20, 20, 0x00ffff, 0x004466);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Holographic text plane (procedural texture)
    const textGroup = new THREE.Group();
    const planeGeometry = new THREE.PlaneGeometry(6, 4);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    const textPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    textGroup.add(textPlane);

    // Text lines (scanned effect)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8,
    });

    const lineHeight = 0.6;
    const startY = 1.5;

    lines.forEach((text, index) => {
      const textGeometry = new THREE.PlaneGeometry(5.5, lineHeight * text.length * 0.15);
      const textMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.9,
      });
      const textMesh = new THREE.Mesh(textGeometry, textMaterial);
      textMesh.position.set(0, startY - index * lineHeight * 0.15, 0.01);
      textGroup.add(textMesh);

      // Add "scanning" effect lines
      for (let line = 0; line < text.length * 0.15; line += 0.15) {
        if (line * lineHeight * 0.15 > 4) break;
        const lineGeo = new THREE.BufferGeometry();
        const points = [
          new THREE.Vector3(-2.5, startY - (index * lineHeight * 0.15) + line, 0.02),
          new THREE.Vector3(2.5, startY - (index * lineHeight * 0.15) + line, 0.02),
        ];
        lineGeo.setFromPoints(points);
        const line = new THREE.Line(lineGeo, lineMaterial);
        textGroup.add(line);
      }
    });

    scene.add(textGroup);

    // Add ambient particles (sparks around the emitter)
    const particleGeometry = new THREE.BufferGeometry();
    const particleCount = 200;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleVelocities: THREE.Vector3[] = [];

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 4;
      particlePositions[i * 3 + 1] = Math.random() * 3;
      particlePositions[i * 3 + 2] = -1 - Math.random() * 4;
      particleVelocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.01,
          (Math.random() - 0.5) * 0.01,
          (Math.random() - 0.5) * 0.01
        )
      );
    }

    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3)
    );
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x00ffff,
      size: 0.03,
      transparent: true,
      opacity: 0.6,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.userData = { velocities: particleVelocities };
    scene.add(particles);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x222244, 0.5);
    scene.add(ambientLight);

    // Blue point light at emitter position
    const pointLight = new THREE.PointLight(0x00ffff, 1, 10);
    pointLight.position.set(0, 1.5, -2);
    scene.add(pointLight);

    // Fade in effect
    setTimeout(() => setVisible(true), 100);

    // Animation loop
    const animate = () => {
      const positions = particles.geometry.attributes.position.array as Float32Array;
      const velocities = particles.userData.velocities as THREE.Vector3[];

      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] += velocities[i].x;
        positions[i * 3 + 1] += velocities[i].y;
        positions[i * 3 + 2] += velocities[i].z;

        // Return to center if too far
        if (Math.abs(positions[i * 3]) > 4) velocities[i].x *= -1;
        if (positions[i * 3 + 1] > 4) velocities[i].y -= 0.005;
        if (positions[i * 3 + 1] < 0) velocities[i].y += 0.005;
        if (Math.abs(positions[i * 3 + 2] + 1) > 4) velocities[i].z *= -1;
      }

      particles.geometry.attributes.position.needsUpdate = true;

      // Rotate grid slightly
      gridHelper.rotation.y = Math.sin(Date.now() * 0.0005) * 0.02;

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };

    animate();

    // Resize handler
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animate);
      if (renderer) {
        if (renderer.domElement && containerRef.current) {
          containerRef.current.removeChild(renderer.domElement);
        }
        renderer.dispose();
      }
      scene.clear();
    };
  }, [type, title, lines]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 2000,
        background: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          right: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 style={{ color: '#00ffff', margin: 0, fontSize: '24px' }}>
          {title}
        </h2>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(0, 255, 255, 0.2)',
            border: '2px solid #00ffff',
            color: '#00ffff',
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          CLOSE [ESC]
        </button>
      </div>

      {visible && (
        <div style={{ position: 'relative', width: '100%', height: '100%' }} />
      )}
    </div>
  );
};
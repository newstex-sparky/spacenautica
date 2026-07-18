// ============ 3D Scene Component ============

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export interface CinematicSceneProps {
  type: 'home' | 'aliens';
  onTransition: () => void;
}

export const CinematicScene: React.FC<CinematicSceneProps> = ({ type, onTransition }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(type === 'home' ? 0x000022 : 0x111122);
    scene.fog = new THREE.FogExp2(
      scene.background,
      type === 'home' ? 0.02 : 0.008
    );
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 3, 8);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Add starfield
    const starsGeometry = new THREE.BufferGeometry();
    const starsCount = 2000;
    const starPositions = new Float32Array(starsCount * 3);
    for (let i = 0; i < starsCount * 3; i++) {
      starPositions[i] = (Math.random() - 0.5) * 100;
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);

    // Add gateway structure
    const gatewayGroup = new THREE.Group();
    const gateGeometry = new THREE.TorusGeometry(2, 0.1, 16, 50);
    const gateMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const gate = new THREE.Mesh(gateGeometry, gateMaterial);
    gate.rotation.y = Math.PI / 2;
    gatewayGroup.add(gate);

    const gateGeometry2 = new THREE.TorusGeometry(1.5, 0.1, 16, 50);
    const gate2 = new THREE.Mesh(gateGeometry2, gateMaterial);
    gate2.rotation.y = Math.PI / 2;
    gatewayGroup.add(gate2);

    const gateGeometry3 = new THREE.CylinderGeometry(0.5, 0.5, 4, 8);
    const gateMaterial3 = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
    const gate3 = new THREE.Mesh(gateGeometry3, gateMaterial3);
    gatewayGroup.add(gate3);

    // Add particle effects
    const particlesGeometry = new THREE.BufferGeometry();
    const particleCount = 500;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleVelocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = 0;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 6;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 6;

      particleVelocities[i * 3] = (Math.random() - 0.5) * 0.02;
      particleVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: type === 'home' ? 0x00ff00 : 0xff00ff, size: 0.05 });
    const particles = new THREE.Points(particlesGeometry, particleMaterial);
    particles.userData = { velocities: particleVelocities };
    gatewayGroup.add(particles);
    scene.userData.particles = particles;

    scene.add(gatewayGroup);

    // Animation loop
    let animationId: number;
    let startTime: number = Date.now();

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const elapsed = (Date.now() - startTime) / 1000;
      const progress = Math.min(elapsed / 8, 1); // 8 second transition

      // Rotate gateway
      gatewayGroup.rotation.x = Math.sin(elapsed * 0.5) * 0.1;
      gatewayGroup.rotation.y += 0.005;

      // Animate camera for dramatic effect
      camera.position.x = Math.sin(progress * Math.PI) * 6;
      camera.position.z = 8 - Math.cos(progress * Math.PI) * 2;
      camera.lookAt(0, 0, 0);

      // Animate particles
      const positions = scene.userData.particles.geometry.attributes.position.array as Float32Array;
      const velocities = scene.userData.particles.userData.velocities as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] += velocities[i * 3];
        positions[i * 3 + 1] += velocities[i * 3 + 1];
        positions[i * 3 + 2] += velocities[i * 3 + 2];

        // Boundary check
        if (Math.abs(positions[i * 3]) > 5) velocities[i * 3] *= -1;
        if (Math.abs(positions[i * 3 + 1]) > 3) velocities[i * 3 + 1] *= -1;
        if (Math.abs(positions[i * 3 + 2]) > 5) velocities[i * 3 + 2] *= -1;
      }

      scene.userData.particles.geometry.attributes.position.needsUpdate = true;

      setProgress(progress);

      if (progress >= 1) {
        onTransition();
      }

      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      if (containerRef.current && renderer) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (renderer.domElement) {
        renderer.domElement.remove();
      }
    };
  }, [type, onTransition]);

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
      }}
    />
  );
};
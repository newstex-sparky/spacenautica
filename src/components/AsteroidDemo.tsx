import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createAsteroid, updateAsteroid, AsteroidType } from '../models/AsteroidModel';
import { ExtendedGroup } from '../models/Types';

export function AsteroidDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const asteroidsRef = useRef<ReturnType<typeof createAsteroid>[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 20, 80);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 10, 25);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Create starfield
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

    // Create multiple asteroid types
    const asteroidTypes: AsteroidType[] = [
      'iron',
      'gold',
      'crystal',
      'silicon',
      'uranium',
      'alien_alloy'
    ];

    const asteroids: ReturnType<typeof createAsteroid>[] = [];

    // Create 6 asteroids (one of each type)
    asteroidTypes.forEach((type, index) => {
      const asteroid = createAsteroid(
        new THREE.Vector3(
          (index - 2.5) * 12,
          0,
          -10 + index * 3
        ),
        type,
        2 + Math.random() * 2
      );
      scene.add(asteroid.mesh);
      asteroids.push(asteroid);
    });

    asteroidsRef.current = asteroids;

    // FPS counter
    const fpsElement = document.createElement('div');
    fpsElement.style.cssText = 'position: absolute; top: 10px; left: 10px; color: white; font-family: monospace; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 5px;';
    document.body.appendChild(fpsElement);

    const fpsElementRef = useRef(fpsElement);
    fpsElementRef.current = fpsElement;

    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = lastTime;

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      const currentTime = performance.now();
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Update all asteroids
      asteroids.forEach((asteroid) => {
        updateAsteroid(asteroid, deltaTime);
      });

      // Render
      renderer.render(scene, camera);

      // FPS counter
      frameCount++;
      if (currentTime - lastFpsUpdate >= 1000) {
        const fps = Math.round(frameCount / ((currentTime - lastFpsUpdate) / 1000));
        fpsElementRef.current.textContent = `FPS: ${fps} | Asteroids: ${asteroids.length} | Total objects: ${countTotalObjects(scene)}`;
        frameCount = 0;
        lastFpsUpdate = currentTime;
      }
    };

    animate();

    // Resize handler
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);

      // Cleanup asteroids
      asteroids.forEach((asteroid) => {
        scene.remove(asteroid.mesh);
        asteroid.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
      });

      scene.clear();
      renderer.dispose();
      document.body.removeChild(fpsElementRef.current);
    };
  }, []);

  return (
    <div>
      <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />
      <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white', fontFamily: 'monospace', background: 'rgba(0,0,0,0.5)', padding: '15px', borderRadius: '10px' }}>
        <h3>Asteroid Models Demo</h3>
        <p>Irregular geometry with ore deposits</p>
        <p>Procedural rotation and drift in space</p>
        <p>Destructible chunks when depleted</p>
        <p>6 types: iron, gold, crystal, silicon, uranium, alien_alloy</p>
      </div>
    </div>
  );
}

// Helper function to count total objects in scene
function countTotalObjects(scene: THREE.Scene): number {
  let count = 0;
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      count++;
    }
  });
  return count;
}
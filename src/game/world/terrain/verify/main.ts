/**
 * Terrain smoke harness. Boots ONLY the engine, the texture library and the
 * terrain system, renders directly (no post stack), and exposes a small API so a
 * headless browser can drive the camera to fixed vantage points and screenshot
 * them. This isolates terrain shader/streaming problems from the rest of the
 * project, which is being rewritten in parallel.
 *
 *   npx vite build --config src/game/world/terrain/verify/vite.terrain.config.mjs
 *   node <harness> --dist dist-terrain-verify
 */
import * as THREE from 'three';
import { Engine } from '../../../core/Engine';
import { Settings } from '../../../core/Settings';
import { TextureLibrary } from '../../../assets/TextureLibrary';
import { TerrainSystem } from '../TerrainSystem';

declare global {
  interface Window {
    __GAME__?: Engine;
    __READY__?: boolean;
    __TERRAIN__?: TerrainSystem;
    __TVIEW__?: (x: number, y: number, z: number, yaw: number, pitch: number) => void;
    __TPROBE__?: () => string;
    __TTEX__?: () => string;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loader = document.getElementById('loading');
  const hud = document.getElementById('hud');

  const settings = new Settings();
  settings.applyPreset('high');
  settings.graphics.targetFrameMs = 0; // no adaptive resolution while capturing

  const engine = new Engine({ canvas, settings });
  window.__GAME__ = engine;

  const terrain = new TerrainSystem();
  engine.register(new TextureLibrary());
  engine.register(terrain);
  window.__TERRAIN__ = terrain;

  // Minimal lighting so the PBR material has something to work with.
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.96, 0.88), 3.1);
  sun.position.set(120, 280, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  const sc = sun.shadow.camera;
  sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120;
  sc.updateProjectionMatrix();
  engine.scene.add(sun, sun.target);
  engine.scene.add(new THREE.HemisphereLight(0x9fd8e6, 0x2b3a2a, 0.6));

  await engine.boot((_f, label) => {
    const l = document.getElementById('loading-label');
    if (l) l.textContent = label;
  });

  window.__TVIEW__ = (x, y, z, yaw, pitch) => {
    engine.camera.position.set(x, y, z);
    engine.camera.rotation.set(0, 0, 0, 'YXZ');
    engine.camera.rotation.order = 'YXZ';
    engine.camera.rotation.y = yaw;
    engine.camera.rotation.x = pitch;
    engine.camera.updateMatrixWorld();
    sun.target.position.set(x, y - 30, z);
    sun.position.set(x + 120, y + 260, z + 90);
    sun.target.updateMatrixWorld();
  };

  window.__TTEX__ = () =>
    JSON.stringify({
      lod0: terrain.debugProbeTextures(0),
      lod3: terrain.debugProbeTextures(3),
    });

  window.__TPROBE__ = () => {
    const p = engine.camera.position;
    const h = terrain.heightAt(p.x, p.z);
    const b = terrain.biomeAt(p.x, p.z);
    const n = new THREE.Vector3();
    terrain.normalAt(p.x, p.z, n);
    let meshes = 0;
    let tris = 0;
    engine.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      meshes++;
      const idx = m.geometry.getIndex();
      tris += idx ? idx.count / 3 : 0;
    });
    return JSON.stringify({
      cam: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
      floor: +h.toFixed(2),
      clearance: +(p.y - h).toFixed(2),
      normalY: +n.y.toFixed(3),
      biome: b.id,
      biomeWeight: +b.weight.toFixed(2),
      bounds: [+terrain.bounds.min.toFixed(0), +terrain.bounds.max.toFixed(0)],
      visibleMeshes: meshes,
      triangles: Math.round(tris),
      frameMs: +engine.frameMs.toFixed(2),
    });
  };

  engine.start();

  let frames = 0;
  const mark = () => {
    if (++frames < 4) {
      requestAnimationFrame(mark);
      return;
    }
    window.__READY__ = true;
    loader?.classList.add('done');
  };
  requestAnimationFrame(mark);

  setInterval(() => {
    if (hud) hud.textContent = window.__TPROBE__ ? window.__TPROBE__().replace(/,"/g, ',\n"') : '';
  }, 250);
}

boot().catch((err) => {
  const l = document.getElementById('loading-label');
  if (l) l.textContent = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  console.error('[terrain-verify] fatal', err);
});

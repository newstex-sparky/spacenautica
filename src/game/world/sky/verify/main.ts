/**
 * Standalone smoke harness for `world.sky`.
 *
 * It boots the real `SkySystem` against minimal stand-ins and renders straight
 * to the default framebuffer, so what you photograph is the dome shader plus the
 * engine's ACES tonemap and nothing else — no auto-exposure hunting, no bloom,
 * no wet-lens overlay, no terrain streaming. That makes it the only place the
 * sky's absolute calibration can actually be judged, and it boots in a second
 * instead of a minute.
 *
 * Driven exactly like the real game by `scripts/capture.mjs`
 * (`window.__GAME__`, `window.__READY__`, `player.position`, `sky.timeOfDay`).
 *
 * This is a test fixture, not part of the shipped game: nothing in the main
 * bundle imports it.
 */
import * as THREE from 'three';
import { Engine } from '../../../core/Engine';
import { Settings } from '../../../core/Settings';
import { Phase } from '../../../core/Types';
import type { GameContext, GameSystem } from '../../../core/Types';
import { SkySystem } from '../SkySystem';

class StubTextures implements GameSystem {
  readonly name = 'assets.textures';
  readonly phase = Phase.PreUpdate;
  blueNoise!: THREE.Texture;

  init(): void {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      // R2 low-discrepancy sequence: cheap, well distributed, no texture asset.
      data[i * 4] = ((i * 0.7548776662) % 1) * 255;
      data[i * 4 + 1] = ((i * 0.5698402909) % 1) * 255;
      data[i * 4 + 2] = ((i * 0.8191725134) % 1) * 255;
      data[i * 4 + 3] = 255;
    }
    this.blueNoise = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    this.blueNoise.wrapS = this.blueNoise.wrapT = THREE.RepeatWrapping;
    this.blueNoise.needsUpdate = true;
  }

  dispose(): void {
    this.blueNoise?.dispose();
  }
}

class StubPlayer implements GameSystem {
  readonly name = 'player';
  readonly phase = Phase.Physics;
  readonly position = new THREE.Vector3(0, 2.6, 0);
  readonly velocity = new THREE.Vector3();
  yaw = 0.9;
  pitch = -0.06;
  submerged = false;
  depth = 0;
  surfaceY = 0;
}

class StubRig implements GameSystem {
  readonly name = 'player.camera';
  readonly phase = Phase.Camera;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  update(_dt: number, ctx: GameContext): void {
    const p = ctx.get<StubPlayer>('player');
    this.euler.set(p.pitch, p.yaw, 0);
    ctx.camera.quaternion.setFromEuler(this.euler);
    ctx.camera.position.copy(p.position);
  }
}

/**
 * A matte grey ground disc a little below sea level. It is not the ocean — it is
 * there purely so the frame has one lit, shadow-receiving surface, which is how
 * you can see whether the sun colour, intensity and the shadow rig are sane.
 */
class StubGround implements GameSystem {
  readonly name = 'world.terrain';
  readonly phase = Phase.World;
  private mesh: THREE.Mesh | null = null;

  init(ctx: GameContext): void {
    const geo = new THREE.CircleGeometry(600, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c8f86, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = -0.6;
    this.mesh.receiveShadow = true;
    ctx.scene.add(this.mesh);

    // A few blocks so the cascade rig has something to cast with.
    for (let i = 0; i < 7; i++) {
      const h = 3 + i * 1.4;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, h, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x6f7268, roughness: 0.85 }),
      );
      const a = i * 1.7;
      box.position.set(Math.cos(a) * (10 + i * 5), -0.6 + h * 0.5, Math.sin(a) * (10 + i * 5));
      box.castShadow = true;
      box.receiveShadow = true;
      ctx.scene.add(box);
    }
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
  }
}

declare global {
  interface Window {
    __GAME__?: Engine;
    __READY__?: boolean;
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const settings = new Settings({ graphics: { ...new Settings().graphics, tier: 'ultra', taa: false } });
  const engine = new Engine({ canvas, settings });
  engine.register(new StubTextures());
  engine.register(new StubPlayer());
  engine.register(new StubRig());
  engine.register(new StubGround());
  engine.register(new SkySystem());
  window.__GAME__ = engine;
  await engine.boot();
  engine.start();
  document.getElementById('loading')?.classList.add('done');
  window.__READY__ = true;
}

void main();

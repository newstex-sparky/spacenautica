import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import type { TextureId } from './TextureIds';

export interface PbrMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
  displacementMap?: THREE.Texture;
}

/**
 * Runtime-generated PBR texture library. Every map in the game comes from here;
 * nothing is loaded from disk or network.
 *
 * BASELINE IMPLEMENTATION — replaced by the procedural-materials agent.
 */
export class TextureLibrary implements GameSystem {
  readonly name = 'assets.textures';
  readonly phase = Phase.PreUpdate;

  white!: THREE.Texture;
  flatNormal!: THREE.Texture;
  blueNoise!: THREE.Texture;

  protected cache = new Map<string, PbrMaps>();
  protected anisotropy = 4;

  init(ctx: GameContext): void {
    this.anisotropy = Math.min(
      ctx.settings.graphics.anisotropy,
      ctx.renderer.capabilities.getMaxAnisotropy(),
    );
    this.white = solid(255, 255, 255);
    this.flatNormal = solid(128, 128, 255);
    this.blueNoise = makeBlueNoise(128);
  }

  get(id: TextureId, size = 512): PbrMaps {
    const key = `${id}@${size}`;
    let maps = this.cache.get(key);
    if (!maps) {
      maps = this.generate(id, size);
      this.cache.set(key, maps);
    }
    return maps;
  }

  /** Overridden by the full implementation. */
  protected generate(_id: TextureId, _size: number): PbrMaps {
    return { map: this.white, normalMap: this.flatNormal, roughnessMap: this.white, aoMap: this.white };
  }

  dispose(): void {
    for (const m of this.cache.values()) {
      m.map.dispose();
      m.normalMap.dispose();
      m.roughnessMap.dispose();
      m.aoMap.dispose();
      m.displacementMap?.dispose();
    }
    this.cache.clear();
    this.white?.dispose();
    this.flatNormal?.dispose();
    this.blueNoise?.dispose();
  }
}

function solid(r: number, g: number, b: number): THREE.Texture {
  const data = new Uint8Array([r, g, b, 255]);
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

/** Void-and-cluster-ish blue noise; good enough for dithering and jitter. */
function makeBlueNoise(size: number): THREE.Texture {
  const n = size * size;
  const data = new Uint8Array(n * 4);
  // Start from white noise then relax toward blue by swapping high-energy pairs.
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) vals[i] = Math.random();
  const energy = (i: number) => {
    const x = i % size;
    const y = (i / size) | 0;
    let e = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        const j = ((y + dy + size) % size) * size + ((x + dx + size) % size);
        const d2 = dx * dx + dy * dy;
        e += Math.exp(-d2 / 4.5) * (1 - Math.abs(vals[i] - vals[j]));
      }
    }
    return e;
  };
  for (let iter = 0; iter < n * 3; iter++) {
    const a = (Math.random() * n) | 0;
    const b = (Math.random() * n) | 0;
    const before = energy(a) + energy(b);
    const t = vals[a];
    vals[a] = vals[b];
    vals[b] = t;
    if (energy(a) + energy(b) > before) {
      vals[b] = vals[a];
      vals[a] = t;
    }
  }
  for (let i = 0; i < n; i++) {
    const v = (vals[i] * 255) | 0;
    data[i * 4] = v;
    data[i * 4 + 1] = (vals[(i * 7 + 13) % n] * 255) | 0;
    data[i * 4 + 2] = (vals[(i * 31 + 5) % n] * 255) | 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

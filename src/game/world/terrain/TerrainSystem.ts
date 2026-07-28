import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { BiomeSample, GameContext, GameSystem, WorldQuery } from '../../core/Types';
import { Noise } from '../../core/Noise';
import { BIOMES, BIOME_MAP } from './Biomes';
import type { BiomeDef } from './Biomes';

/** BASELINE — replaced by the terrain agent with chunked LOD + triplanar PBR. */
export class TerrainSystem implements GameSystem, WorldQuery {
  readonly name = 'world.terrain';
  readonly phase = Phase.World;
  readonly seed = 20260728;
  readonly bounds = { min: -900, max: -4 };
  readonly biomes: ReadonlyMap<string, BiomeDef> = BIOME_MAP;

  protected noise = new Noise(this.seed);
  protected group = new THREE.Group();
  protected mesh: THREE.Mesh | null = null;

  init(ctx: GameContext): void {
    ctx.world = this;
    this.group.name = 'terrain';
    ctx.scene.add(this.group);

    const size = 900;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8b489, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  heightAt(x: number, z: number): number {
    const n = this.noise;
    const base = -26 - 42 * n.fbm2(x * 0.0016, z * 0.0016, 5);
    const ridges = -70 * n.ridged2(x * 0.0035, z * 0.0035, 4);
    const detail = 2.2 * n.fbm2(x * 0.05, z * 0.05, 3);
    const basin = -160 * Math.max(0, n.fbm2(x * 0.0006 + 40, z * 0.0006 - 20, 3));
    return base + ridges * 0.55 + detail + basin;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.75;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  biomeAt(x: number, z: number): BiomeSample {
    const depth = -this.heightAt(x, z);
    const variety = this.noise.fbm2(x * 0.0009 + 100, z * 0.0009 - 60, 3);
    const weights: Record<string, number> = {};
    let best: BiomeDef = BIOMES[0];
    let bestW = -1;
    for (const b of BIOMES) {
      const [a, c] = b.depthRange;
      const mid = (a + c) * 0.5;
      const half = Math.max(1, (c - a) * 0.5);
      let w = Math.max(0, 1 - Math.abs(depth - mid) / (half * 1.35));
      w *= 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(variety * 9 + b.id.length));
      if (w > 0.001) weights[b.id] = w;
      if (w > bestW) { bestW = w; best = b; }
    }
    return { id: best.id, weight: bestW, weights };
  }

  isSolid(x: number, y: number, z: number): boolean {
    return y < this.heightAt(x, z);
  }

  waterHeightAt(): number { return 0; }

  currentAt(x: number, y: number, z: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const s = 0.004;
    const a = this.noise.fbm3(x * s, y * s * 2, z * s + t * 0.02, 2);
    const b = this.noise.fbm3(x * s + 31, y * s * 2 - 7, z * s + t * 0.02 + 11, 2);
    return out.set(a, b * 0.35, b).multiplyScalar(0.55);
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): THREE.Vector3 | null {
    const p = origin.clone();
    const step = dir.clone().normalize().multiplyScalar(0.5);
    for (let d = 0; d < maxDist; d += 0.5) {
      p.add(step);
      if (p.y < this.heightAt(p.x, p.z)) return p;
    }
    return null;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
  }
}

import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { GameContext, GameSystem } from '../../core/Types';

/** BASELINE — replaced by the ocean/volumetrics agent. */
export class WaterSystem implements GameSystem {
  readonly name = 'world.water';
  readonly phase = Phase.PreRender;

  underwater = true;
  cameraDepth = 12;
  causticsTexture: THREE.Texture | null = null;

  readonly sharedUniforms: Record<string, THREE.IUniform> = {
    uwExtinction: { value: new THREE.Vector3(0.42, 0.09, 0.045) },
    uwInscatter: { value: new THREE.Color(0.06, 0.30, 0.38) },
    uwSurfaceY: { value: 0 },
    uwDensity: { value: 1 },
    uwSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3) },
    uwSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
    uwTime: { value: 0 },
    uwCameraDepth: { value: 0 },
  };

  private surface: THREE.Mesh | null = null;

  init(ctx: GameContext): void {
    const geo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d3f52, roughness: 0.06, metalness: 0.0,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.name = 'water.surface';
    ctx.scene.add(this.surface);
    ctx.scene.fog = new THREE.FogExp2(0x0a3a48, 0.018);
  }

  update(_dt: number, ctx: GameContext): void {
    const y = ctx.camera.position.y;
    const wasUnder = this.underwater;
    this.underwater = y < this.surfaceHeightAt(ctx.camera.position.x, ctx.camera.position.z, ctx.time);
    this.cameraDepth = Math.max(0, -y);
    if (wasUnder !== this.underwater) ctx.bus.emit('water:transition', { underwater: this.underwater });
    this.sharedUniforms.uwTime.value = ctx.time;
    this.sharedUniforms.uwCameraDepth.value = this.cameraDepth;
    if (this.surface) this.surface.position.set(ctx.camera.position.x, 0, ctx.camera.position.z);
  }

  surfaceHeightAt(_x: number, _z: number, _t: number): number { return 0; }

  scatteringAt(depth: number, out: { extinction: THREE.Vector3; inscatter: THREE.Color }): void {
    out.extinction.set(0.42, 0.09, 0.045);
    const f = Math.exp(-depth * 0.008);
    out.inscatter.setRGB(0.06 * f, 0.30 * f, 0.38 * f);
  }

  dispose(): void {
    this.surface?.geometry.dispose();
    (this.surface?.material as THREE.Material | undefined)?.dispose();
    this.causticsTexture?.dispose();
  }
}

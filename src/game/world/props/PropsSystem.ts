import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { GameContext, GameSystem } from '../../core/Types';

/** BASELINE — replaced by its owning agent. */
export class PropsSystem implements GameSystem {
  readonly name = 'world.props';
  readonly phase = Phase.World;
  protected group = new THREE.Group();

  init(ctx: GameContext): void {
    this.group.name = 'world.props';
    ctx.scene.add(this.group);
  }

  update(_dt: number, _ctx: GameContext): void {}

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }
}

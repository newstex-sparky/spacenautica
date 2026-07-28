import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';

/** BASELINE — base building. Replaced by the RPG-systems agent. */
export class BuildSystem implements GameSystem {
  readonly name = 'game.build';
  readonly phase = Phase.Gameplay;
  protected group = new THREE.Group();

  init(ctx: GameContext): void {
    this.group.name = 'buildings';
    ctx.scene.add(this.group);
  }

  update(_dt: number, _ctx: GameContext): void {}
  dispose(): void { this.group.removeFromParent(); }
}

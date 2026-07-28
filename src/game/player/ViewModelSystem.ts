import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';

/** BASELINE — first-person hands/tools. Replaced by the player agent. */
export class ViewModelSystem implements GameSystem {
  readonly name = 'player.viewmodel';
  readonly phase = Phase.Camera;
  protected group = new THREE.Group();

  init(ctx: GameContext): void {
    this.group.name = 'viewmodel';
    this.group.renderOrder = 10;
    ctx.camera.add(this.group);
  }

  update(_dt: number, _ctx: GameContext): void {}

  dispose(): void {
    this.group.removeFromParent();
  }
}

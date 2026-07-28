import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import type { PlayerSystem } from './PlayerSystem';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _target = new THREE.Vector3();

/**
 * Resolves the final camera transform from the player state: head bob, speed
 * FOV kick, roll on strafe, and additive trauma shake.
 * BASELINE — extended by the player agent.
 */
export class CameraRig implements GameSystem {
  readonly name = 'player.camera';
  readonly phase = Phase.Camera;

  private bobPhase = 0;
  private trauma = 0;
  private roll = 0;
  private fovCurrent = 70;
  private player!: PlayerSystem;

  init(ctx: GameContext): void {
    this.player = ctx.get<PlayerSystem>('player');
    this.fovCurrent = ctx.settings.graphics.fov;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, ctx: GameContext): void {
    const p = this.player;
    const cam = ctx.camera;
    const g = ctx.settings;

    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    this.bobPhase += dt * (2.2 + speed * 1.35);
    const bobAmt = Math.min(1, speed / 4) * 0.045 * g.gameplay.headBob;
    const bobY = Math.sin(this.bobPhase * 2) * bobAmt;
    const bobX = Math.cos(this.bobPhase) * bobAmt * 0.6;

    // Roll into strafes; small, but it sells momentum underwater.
    const strafe = p.velocity.dot(_target.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw)));
    this.roll += (THREE.MathUtils.clamp(-strafe * 0.012, -0.05, 0.05) - this.roll) * Math.min(1, 4 * dt);

    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const shake = this.trauma * this.trauma * g.gameplay.cameraShake;
    const t = ctx.time * 27;
    const shakeX = Math.sin(t * 1.7) * shake * 0.035;
    const shakeY = Math.sin(t * 2.3 + 1.1) * shake * 0.035;
    const shakeZ = Math.sin(t * 1.3 + 2.7) * shake * 0.02;

    _euler.set(p.pitch + bobY * 0.4 + shakeY, p.yaw + bobX * 0.3 + shakeX, this.roll + shakeZ);
    cam.quaternion.setFromEuler(_euler);
    cam.position.set(p.position.x + bobX * 0.35, p.position.y + bobY, p.position.z);

    const targetFov = g.graphics.fov + (p.sprinting ? 6 : 0) + shake * 4;
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, 5 * dt);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
  }
}

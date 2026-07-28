import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';

const _scratch = new THREE.Vector3();
const _current = new THREE.Vector3();
const _wish = new THREE.Vector3();

export interface Vitals {
  oxygen: number;
  maxOxygen: number;
  health: number;
  food: number;
  water: number;
}

/**
 * First-person swim controller. Buoyancy, quadratic drag, added-mass inertia
 * and terrain collision. BASELINE — the player agent extends this with
 * vehicles, ladders, seabases and precise Subnautica-style feel.
 */
export class PlayerSystem implements GameSystem {
  readonly name = 'player';
  readonly phase = Phase.Physics;

  readonly position = new THREE.Vector3(0, -14, 0);
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  depth = 14;
  inVehicle: string | null = null;
  swimming = true;
  sprinting = false;
  grounded = false;

  readonly vitals: Vitals = { oxygen: 45, maxOxygen: 45, health: 100, food: 100, water: 100 };

  /** Radius of the collision capsule. */
  readonly radius = 0.42;
  /** Eye height above the feet when standing on the floor. */
  readonly eyeHeight = 1.62;

  private impulse = new THREE.Vector3();
  private oxygenTickAccum = 0;

  init(ctx: GameContext): void {
    const h = ctx.world.heightAt(0, 0);
    this.position.set(0, h + 8, 0);
  }

  addImpulse(v: THREE.Vector3): void {
    this.impulse.add(v);
  }

  damage(amount: number, source: string): void {
    if (amount <= 0) return;
    this.vitals.health = Math.max(0, this.vitals.health - amount);
    this.busRef?.emit('player:damage', { amount, source });
    if (this.vitals.health <= 0) this.busRef?.emit('player:died', { cause: source });
  }

  teleport(pos: THREE.Vector3): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
  }

  private busRef: GameContext['bus'] | null = null;

  update(dt: number, ctx: GameContext): void {
    this.busRef = ctx.bus;
    const input = ctx.input;
    const g = ctx.settings.gameplay;

    // --- look ---
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);

    // --- wish direction in world space ---
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    // Forward follows the camera pitch when swimming: you go where you look.
    const fwd = _scratch.set(-sy * cp, this.swimming ? sp : 0, -cy * cp).normalize();
    const right = _wish.set(cy, 0, -sy);

    const wish = new THREE.Vector3()
      .addScaledVector(fwd, -input.moveZ)
      .addScaledVector(right, input.moveX);
    if (this.swimming) wish.y += input.moveY * 0.9;
    if (wish.lengthSq() > 1) wish.normalize();

    this.sprinting = input.down('sprint') && wish.lengthSq() > 0.01 && this.vitals.oxygen > 3;

    const baseSpeed = this.swimming ? 4.2 : 4.6;
    const speed = baseSpeed * (this.sprinting ? 1.75 : 1);

    // --- forces ---
    const accel = this.swimming ? 12 : 34;
    this.velocity.addScaledVector(wish, accel * speed * dt * 0.25);

    if (this.swimming) {
      // Buoyancy: slightly negative so you sink imperceptibly when idle.
      this.velocity.y -= 0.55 * dt;
      // Quadratic drag — the reason swimming feels heavy and deliberate.
      const sp2 = this.velocity.length();
      if (sp2 > 1e-4) {
        const drag = Math.min(1, (0.9 + 0.18 * sp2) * dt);
        this.velocity.addScaledVector(this.velocity, -drag);
      }
      // Ambient current pushes the player around.
      ctx.world.currentAt(this.position.x, this.position.y, this.position.z, ctx.time, _current);
      this.velocity.addScaledVector(_current, dt * 0.6);
    } else {
      this.velocity.y -= 9.81 * dt;
      const damp = Math.min(1, 9 * dt);
      this.velocity.x -= this.velocity.x * damp;
      this.velocity.z -= this.velocity.z * damp;
    }

    this.velocity.add(this.impulse);
    this.impulse.set(0, 0, 0);

    // --- integrate + collide ---
    this.position.addScaledVector(this.velocity, dt);

    const floor = ctx.world.heightAt(this.position.x, this.position.z);
    const feet = this.position.y - this.eyeHeight;
    if (feet < floor + this.radius) {
      this.position.y = floor + this.radius + this.eyeHeight;
      if (this.velocity.y < 0) this.velocity.y *= -0.05;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    const surfaceY = ctx.world.waterHeightAt(this.position.x, this.position.z, ctx.time);
    this.swimming = this.position.y < surfaceY - 0.15;
    this.depth = Math.max(0, surfaceY - this.position.y);

    // --- vitals ---
    if (ctx.settings.gameplay.mode !== 'creative') {
      this.oxygenTickAccum += dt;
      if (this.oxygenTickAccum >= 0.25) {
        const step = this.oxygenTickAccum;
        this.oxygenTickAccum = 0;
        if (this.swimming) {
          const rate = (this.sprinting ? 1.8 : 1) * (1 + this.depth / 400);
          this.vitals.oxygen = Math.max(0, this.vitals.oxygen - step * rate);
          if (this.vitals.oxygen <= 0) this.damage(step * 12, 'drowning');
          else if (this.vitals.oxygen < 10) ctx.bus.emit('vitals:critical', { kind: 'oxygen', value: this.vitals.oxygen });
        } else {
          this.vitals.oxygen = Math.min(this.vitals.maxOxygen, this.vitals.oxygen + step * 12);
        }
        if (g.mode === 'survival' || g.mode === 'hardcore') {
          this.vitals.food = Math.max(0, this.vitals.food - step * 0.14);
          this.vitals.water = Math.max(0, this.vitals.water - step * 0.19);
          if (this.vitals.food <= 0 || this.vitals.water <= 0) this.damage(step * 1.5, 'starvation');
        }
      }
    }
  }
}

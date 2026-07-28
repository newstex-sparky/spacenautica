import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import type { PlayerSystem } from './PlayerSystem';
import { Spring1, Spring3, expDamp, expDampAngle, smoothstep } from './PlayerTypes';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _lagTarget = new THREE.Vector3();

interface PostLike extends GameSystem {
  setFocusDistance(d: number): void;
  addScreenShake(amount: number, duration: number): void;
}

/**
 * Resolves the final camera transform from the player state.
 *
 * The head is treated as a mass on a spring hung off the body: it lags in
 * position and in orientation, so accelerating forward pushes the view back
 * slightly and whipping the mouse arrives a frame or two late. On top of that
 * sit head bob, idle breathing, roll/lean into turns and strafes, additive
 * trauma shake, directional damage kicks, a depth- and speed-graded FOV, and a
 * short cinematic punch when the eye crosses the water line.
 *
 * It also owns the autofocus: a cheap ray march down the reticle drives
 * `PostStack.setFocusDistance()` through a damped focus-pull, so depth of field
 * settles on whatever you are actually looking at.
 */
export class CameraRig implements GameSystem {
  readonly name = 'player.camera';
  readonly phase = Phase.Camera;

  /** Extra additive shake, 0..1, decays on its own. */
  private trauma = 0;
  private fovCurrent = 70;
  private player!: PlayerSystem;
  private post: PostLike | null = null;

  private bobPhase = 0;
  private camYaw = 0;
  private camPitch = 0;
  private rollSpring = new Spring1(120, 15);
  private pitchKick = new Spring1(150, 14);
  private yawKick = new Spring1(150, 14);
  private lag = new Spring3(150, 21);
  private fovKick = new Spring1(90, 12);

  private focusDistance = 12;
  private focusRaw = 12;
  private lastCross = 0;
  private crossPunch = 0;
  private swaySeed = Math.random() * 100;
  private prevPos = new THREE.Vector3();
  private initialised = false;

  init(ctx: GameContext): void {
    this.player = ctx.get<PlayerSystem>('player');
    this.fovCurrent = ctx.settings.graphics.fov;
    this.camYaw = this.player.yaw;
    this.camPitch = this.player.pitch;
    this.prevPos.copy(this.player.position);
    this.lastCross = this.player.surfaceCrossings;
  }

  /** Additive camera trauma, 0..1. Used by damage, impacts and creatures. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * A directional hit: rotates the view away from the impact and rolls into it,
   * so you can tell where the bite came from without looking at the HUD.
   */
  addDamageKick(dir: THREE.Vector3, amount: number): void {
    // `dir` points from the attacker toward the player; work in view space.
    _right.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const side = _dir.copy(dir).normalize().dot(_right);
    const vertical = _dir.y;
    const a = THREE.MathUtils.clamp(amount, 0, 1);
    this.pitchKick.kick((0.5 + vertical * 0.6) * a * 3.2);
    this.yawKick.kick(-side * a * 3.6);
    this.rollSpring.kick(-side * a * 2.4);
    this.fovKick.kick(a * 6);
  }

  /** Called by the view model when a tool lands a hit. */
  addToolRecoil(pitch: number, yaw: number): void {
    this.pitchKick.kick(pitch);
    this.yawKick.kick(yaw);
  }

  update(dt: number, ctx: GameContext): void {
    const p = this.player;
    const cam = ctx.camera;
    const s = ctx.settings;
    if (!this.post) this.post = ctx.tryGet<PostLike>('render.post') ?? null;

    // A teleport (or the capture harness moving us) must not be smoothed.
    const jump = _tmp.copy(p.position).sub(this.prevPos).length();
    if (!this.initialised || jump > 5) {
      this.initialised = true;
      this.camYaw = p.yaw;
      this.camPitch = p.pitch;
      this.lag.reset();
      this.rollSpring.reset();
      this.pitchKick.reset();
      this.yawKick.reset();
      this.fovKick.reset();
      this.trauma = 0;
      this.crossPunch = 0;
      this.lastCross = p.surfaceCrossings;
      this.focusRaw = this.focusDistance = 12;
    }
    this.prevPos.copy(p.position);

    const horizSpeed = Math.hypot(p.velocity.x, p.velocity.z);
    const speedNorm = Math.min(1, horizSpeed / 5.5);
    const walking = p.mode === 'walk';
    const submerged = p.submerged;

    /* ---------------- orientation: the head lags the body ---------- */
    // Water resists head rotation, so the lag is stronger while submerged.
    const angLambda = submerged ? 17 : 34;
    this.camYaw = expDampAngle(this.camYaw, p.yaw, angLambda, dt);
    this.camPitch = expDamp(this.camPitch, p.pitch, angLambda * 1.15, dt);

    /* ---------------- head bob / footfalls ------------------------ */
    const bobRate = walking ? 2.4 + horizSpeed * 2.6 : 1.1 + horizSpeed * 0.9;
    this.bobPhase += dt * bobRate;
    const bobScale = s.gameplay.headBob * (walking ? 0.052 : 0.026);
    const bobAmt = Math.min(1, horizSpeed / (walking ? 3.2 : 4.5)) * bobScale;
    const bobY = Math.sin(this.bobPhase * 2) * bobAmt;
    const bobX = Math.cos(this.bobPhase) * bobAmt * 0.62;

    /* ---------------- idle breathing ------------------------------ */
    // Amplitude fades out as you start swimming hard, and rises when the
    // oxygen gauge is low (fast, shallow panic breathing).
    const idle = 1 - Math.min(1, horizSpeed / 1.6);
    const breath = Math.sin(p.breathPhase);
    const breath2 = Math.sin(p.breathPhase * 2 + 1.1);
    const breathAmp = (0.5 + p.breathRate) * idle * s.gameplay.headBob;
    const breathY = breath * 0.011 * breathAmp;
    const breathPitch = breath2 * 0.0042 * breathAmp;

    /* ---------------- slow underwater drift ----------------------- */
    // Low-frequency wander so a stationary submerged camera is never dead.
    const t = ctx.time;
    const driftAmt = submerged ? 1 : 0.25;
    const driftX = (Math.sin(t * 0.27 + this.swaySeed) + Math.sin(t * 0.41 + 2.1) * 0.6) * 0.0075 * driftAmt;
    const driftY = (Math.sin(t * 0.19 + 1.7) + Math.sin(t * 0.33 + 4.2) * 0.5) * 0.0065 * driftAmt;
    const driftRoll = Math.sin(t * 0.23 + 0.7) * 0.006 * driftAmt;

    /* ---------------- lean into turns and strafes ----------------- */
    _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const strafe = p.velocity.dot(_right);
    const turnLean = THREE.MathUtils.clamp(p.yawRate * 0.035, -0.075, 0.075);
    const strafeLean = THREE.MathUtils.clamp(-strafe * 0.014, -0.055, 0.055);
    const rollTarget = (turnLean + strafeLean) * (submerged ? 1 : 0.55);
    this.rollSpring.step(dt, rollTarget);

    /* ---------------- surface crossing punch ---------------------- */
    if (p.surfaceCrossings !== this.lastCross) {
      this.lastCross = p.surfaceCrossings;
      const strength = THREE.MathUtils.clamp(0.25 + p.lastCrossSpeed * 0.12, 0.25, 1);
      this.crossPunch = strength;
      // Breaking upward: the head snaps up and the view widens as air hits it.
      // Diving down: a short dip and a narrowing, then the water closes over.
      const dir = p.lastCrossDown ? -1 : 1;
      this.pitchKick.kick(dir * strength * 1.5);
      this.rollSpring.kick(strength * 0.9 * (Math.random() < 0.5 ? -1 : 1));
      this.lag.kick(0, -dir * strength * 0.55, 0);
      this.fovKick.kick(dir * strength * 7);
      this.trauma = Math.min(1, this.trauma + strength * 0.18);
    }
    this.crossPunch = Math.max(0, this.crossPunch - dt * 1.6);

    /* ---------------- trauma shake -------------------------------- */
    this.trauma = Math.max(0, this.trauma - dt * 0.95);
    const shake = this.trauma * this.trauma * s.gameplay.cameraShake;
    const st = t * 27;
    const shakeX = (Math.sin(st * 1.7) + Math.sin(st * 3.9) * 0.4) * shake * 0.03;
    const shakeY = (Math.sin(st * 2.3 + 1.1) + Math.sin(st * 4.7 + 0.3) * 0.4) * shake * 0.03;
    const shakeZ = Math.sin(st * 1.3 + 2.7) * shake * 0.018;

    /* ---------------- positional lag ------------------------------ */
    // Target offset trails the velocity, clamped hard so the camera can never
    // leave the collision capsule and clip the sea floor.
    _lagTarget.copy(p.velocity).multiplyScalar(-0.016);
    const maxLag = 0.11;
    if (_lagTarget.lengthSq() > maxLag * maxLag) _lagTarget.setLength(maxLag);
    this.lag.step(dt, _lagTarget);
    const lag = this.lag.value;
    if (lag.lengthSq() > 0.09) lag.setLength(0.3);

    /* ---------------- compose ------------------------------------- */
    const kickP = this.pitchKick.step(dt, 0) * 0.06;
    const kickY = this.yawKick.step(dt, 0) * 0.06;

    _euler.set(
      this.camPitch + bobY * 0.4 + breathPitch + driftY + shakeY + kickP,
      this.camYaw + bobX * 0.3 + driftX + shakeX + kickY,
      this.rollSpring.value + driftRoll + shakeZ,
    );
    cam.quaternion.setFromEuler(_euler);
    cam.position.set(
      p.position.x + lag.x + bobX * 0.35,
      p.position.y + lag.y + bobY + breathY,
      p.position.z + lag.z,
    );

    /* ---------------- FOV ----------------------------------------- */
    let targetFov = s.graphics.fov;
    // A dive mask narrows the view; pressure/depth narrows it further, which
    // reads as the world closing in as you descend.
    if (submerged) targetFov -= 2.5 + 2.2 * smoothstep(0, 260, p.depth);
    targetFov += (p.sprinting ? 6 : 0) * (0.5 + 0.5 * speedNorm);
    targetFov += speedNorm * 2.2;
    targetFov += shake * 4;
    targetFov += breath * 0.16 * breathAmp;
    targetFov += this.fovKick.step(dt, 0);
    this.fovCurrent = expDamp(this.fovCurrent, targetFov, 5.5, dt);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }

    /* ---------------- autofocus ----------------------------------- */
    this.updateFocus(dt, ctx);
  }

  /**
   * Reticle autofocus. Marches the view ray against the world every few frames
   * (cheap: ~24 height samples) and pulls focus toward the hit with a damped
   * response, so the DOF plane follows what you look at instead of snapping.
   */
  private updateFocus(dt: number, ctx: GameContext): void {
    const p = this.player;
    const every = ctx.settings.at('high') ? 2 : 5;
    if (ctx.frame % every === 0) {
      p.viewDirection(_dir);
      const hit = p.collider.raymarch(p.position, _dir, 90, ctx.world, 26);
      // No geometry down the barrel: focus at the water's visibility horizon so
      // near-field particulate and the hands stay readable.
      const visibility = THREE.MathUtils.clamp(46 - p.depth * 0.06, 12, 60);
      this.focusRaw = hit > 0 ? hit : visibility;
    }
    // Focus pull: fast when racking closer, slower when racking out.
    const closer = this.focusRaw < this.focusDistance;
    this.focusDistance = expDamp(this.focusDistance, this.focusRaw, closer ? 5.5 : 3.2, dt);
    // Never focus inside the view model: the hands live at ~0.5 m.
    this.post?.setFocusDistance(Math.max(1.4, this.focusDistance));
  }

  /** Current autofocus distance in metres (the HUD reticle can read this). */
  get focus(): number {
    return this.focusDistance;
  }

  /** 0..1 intensity of the ongoing surface-crossing transition. */
  get surfacePunch(): number {
    return this.crossPunch;
  }
}

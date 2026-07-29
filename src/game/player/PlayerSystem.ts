import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import { CapsuleCollider, makeSweepResult } from './CapsuleCollider';
import type { CapsuleSweepResult } from './CapsuleCollider';
import {
  DEFAULT_EQUIPMENT,
  SUIT_INSULATION,
  TANK_OXYGEN,
  ambientWaterTemp,
  smoothstep,
} from './PlayerTypes';
import type { LocomotionMode, PlayerEquipment, Vitals } from './PlayerTypes';

/* ------------------------------------------------------------------ *
 * Module-scope scratch. Nothing in update() allocates.
 * ------------------------------------------------------------------ */
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _current = new THREE.Vector3();
const _thrust = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _slope = new THREE.Vector3();

/** Tuning block, all SI. Kept in one place so the feel is easy to tweak. */
const TUNE = {
  /** Thrust accelerations in the body frame, m/s². */
  swimThrust: { fwd: 7.2, lat: 4.2, vert: 5.0 },
  /** Quadratic drag coefficients per metre, body frame. Higher = less glide. */
  swimDrag: { fwd: 0.55, lat: 1.1, vert: 0.95 },
  /** Sprint multiplies thrust and drag differently, so top speed rises. */
  sprintThrust: 2.4,
  /** Fins. */
  finThrust: 1.22,
  finDrag: 0.9,
  /** Surface swim (head out of the water). */
  surfaceThrust: 6.0,
  surfaceDrag: 0.9,
  /** Walking. */
  walkSpeed: 3.0,
  walkSpeedSubmerged: 1.9,
  walkAccel: 32,
  walkDamp: 9,
  /** Sea-floor gravity is offset by buoyancy so walking underwater is floaty. */
  gravity: 9.81,
  /** Impact speed above which the player is hurt, m/s. */
  impactThreshold: 11,
  impactDamagePerMs: 3.4,
} as const;

export type { Vitals } from './PlayerTypes';

/** Structural views of the systems we poke without importing them. */
interface PostLike extends GameSystem {
  addScreenShake(amount: number, duration: number): void;
  setFocusDistance(d: number): void;
}
interface RigLike extends GameSystem {
  addTrauma(amount: number): void;
  addDamageKick(dir: THREE.Vector3, amount: number): void;
}

/**
 * First-person swim controller.
 *
 * Three locomotion modes with hysteresis between them:
 *  - `swim`    — fully submerged. Anisotropic added-mass inertia and quadratic
 *                drag in the body frame (streamlined forward, draggy sideways),
 *                depth- and equipment-dependent buoyancy, advected by currents.
 *  - `surface` — head at the water line: bobs on the Gerstner wave field via a
 *                tread-water PD controller, spray on breaking through.
 *  - `walk`    — feet on the sea floor: slope projection, step-up, reduced
 *                effective gravity because buoyancy still applies.
 *
 * Collision is a sub-stepped capsule sweep (see `CapsuleCollider`), so external
 * impulses (propulsion cannon, creature rams, explosions) cannot tunnel and do
 * not take control away — thrust remains fully authoritative because drag is
 * evaluated on velocity *relative to the water*.
 */
export class PlayerSystem implements GameSystem {
  readonly name = 'player';
  readonly phase = Phase.Physics;

  /** Eye position, world space. */
  readonly position = new THREE.Vector3(0, -14, 0);
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  inVehicle: string | null = null;
  /** True while the body is in the water and not standing on the floor. */
  swimming = true;
  sprinting = false;
  grounded = false;

  /**
   * Metres below the water surface, >= 0.
   *
   * Derived on read, never cached. `position` is written from outside this class
   * — `teleport()`, vehicles, and the capture harness all poke it directly — and
   * `Engine.tick` skips every system in the World..Gameplay phase band while
   * `engine.paused` is true, which includes this one. A stored copy therefore
   * goes stale the moment anything moves the player while a menu is open, and
   * then reports the depth of wherever the player used to be. That is exactly how
   * a HUD can end up reading 130 m while the zone label says SURFACE.
   */
  get depth(): number {
    return Math.max(0, this.surfaceY - this.position.y);
  }

  /** True when the eye is below the water line. Derived, for the same reason. */
  get submerged(): boolean {
    return this.position.y < this.surfaceY - 0.06;
  }

  readonly vitals: Vitals = {
    oxygen: 45,
    maxOxygen: 45,
    health: 100,
    food: 100,
    water: 100,
    temperature: 37,
  };

  /** Worn kit. Mutate through `setEquipment` so derived values refresh. */
  readonly equipment: PlayerEquipment = { ...DEFAULT_EQUIPMENT };

  /** Radius of the collision capsule. */
  readonly radius = 0.42;
  /** Eye height above the feet when standing on the floor. */
  readonly eyeHeight = 1.62;

  /* --- state other systems (camera, view model, HUD, audio) read --- */

  /** Current locomotion mode. */
  mode: LocomotionMode = 'swim';
  /** 0..1 fraction of the body below the water line. */
  submergedFraction = 1;
  /** World Y of the water surface above the player right now. */
  surfaceY = 0;
  /** Breathing cycle phase in radians; drives camera sway and bubbles. */
  breathPhase = 0;
  /** Breaths per second right now (exertion + low-oxygen panic raise it). */
  breathRate = 0.22;
  /** Look rate this frame, rad/s — the camera leans into it. */
  yawRate = 0;
  pitchRate = 0;
  /** Signed speed along the view axis, m/s. */
  forwardSpeed = 0;
  /** Incremented every time the eye crosses the water line. */
  surfaceCrossings = 0;
  /** `ctx.time` of the last crossing, and which way it went. */
  lastCrossTime = -100;
  lastCrossDown = true;
  /** Vertical speed at the moment of the last crossing, m/s. */
  lastCrossSpeed = 0;
  /** 0..1 hypothermia pressure, for HUD/vignette use. */
  chill = 0;
  /** Ambient water temperature at the player, °C. */
  ambientTemp = 24;
  /** Last damage direction in world space (unit, or zero). */
  readonly lastDamageDir = new THREE.Vector3();
  /** Collision summary from this frame. */
  readonly contact: CapsuleSweepResult = makeSweepResult();

  readonly collider = new CapsuleCollider({
    radius: 0.42,
    height: 1.8,
    eyeHeight: 1.62,
    stepHeight: 0.55,
    maxSlope: THREE.MathUtils.degToRad(52),
  });

  private impulse = new THREE.Vector3();
  private oxygenTickAccum = 0;
  private busRef: GameContext['bus'] | null = null;
  private modeTimer = 0;
  private walkLatch = false;
  private footAccum = 0;
  private o2WarnLevel = 3;
  private shiverCooldown = 0;
  private post: PostLike | null = null;
  private rig: RigLike | null = null;
  private lastSpeed = 0;
  private world: GameContext['world'] | null = null;

  init(ctx: GameContext): void {
    this.busRef = ctx.bus;
    this.world = ctx.world;
    this.applyEquipment();
    const h = ctx.world.heightAt(0, 0);
    this.position.set(0, Math.min(-6, h + 9), 0);
    this.surfaceY = ctx.world.waterHeightAt(this.position.x, this.position.z, ctx.time);
    this.vitals.oxygen = this.vitals.maxOxygen;
  }

  /* ---------------------------------------------------------------- *
   * Public API (frozen surface + additions)
   * ---------------------------------------------------------------- */

  addImpulse(v: THREE.Vector3): void {
    this.impulse.add(v);
  }

  damage(amount: number, source: string, direction?: THREE.Vector3): void {
    if (amount <= 0 || this.vitals.health <= 0) return;
    this.vitals.health = Math.max(0, this.vitals.health - amount);
    if (direction) this.lastDamageDir.copy(direction).normalize();
    else this.lastDamageDir.set(0, 0, 0);

    this.busRef?.emit('player:damage', {
      amount,
      source,
      direction: [this.lastDamageDir.x, this.lastDamageDir.y, this.lastDamageDir.z],
    });
    this.busRef?.emit('audio:cue', { id: 'player.hurt', gain: Math.min(1, 0.25 + amount / 40) });

    // Camera trauma + screen shake scale with the bite, not linearly.
    const t = Math.min(1, amount / 28);
    this.rig?.addTrauma(0.28 + t * 0.6);
    if (direction) this.rig?.addDamageKick(direction, t);
    this.post?.addScreenShake(0.2 + t * 0.8, 0.25 + t * 0.4);

    if (this.vitals.health <= 0) {
      this.busRef?.emit('player:died', { cause: source });
      this.busRef?.emit('audio:cue', { id: 'player.death', gain: 1 });
    } else if (this.vitals.health < 25) {
      this.busRef?.emit('vitals:critical', { kind: 'health', value: this.vitals.health });
    }
  }

  teleport(pos: THREE.Vector3): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.impulse.set(0, 0, 0);
    // Resample here rather than waiting for the next update: a teleport may
    // happen while the engine is paused, in which case update() will not run at
    // all and every consumer of `depth` would see the old location's surface.
    this.refreshSurface();
  }

  /**
   * Re-reads the water height at the current position. Cheap (one Gerstner
   * evaluation) and safe to call from outside the frame loop.
   */
  refreshSurface(time = 0): void {
    if (!this.world) return;
    this.surfaceY = this.world.waterHeightAt(this.position.x, this.position.z, time);
  }

  /** Change kit; recomputes oxygen capacity and buoyancy trim. */
  setEquipment(patch: Partial<PlayerEquipment>): void {
    Object.assign(this.equipment, patch);
    this.applyEquipment();
  }

  private applyEquipment(): void {
    const cap = TANK_OXYGEN[this.equipment.tank];
    const ratio = this.vitals.maxOxygen > 0 ? this.vitals.oxygen / this.vitals.maxOxygen : 1;
    this.vitals.maxOxygen = cap;
    this.vitals.oxygen = Math.min(cap, cap * ratio);
  }

  /** Unit view direction, written into `out`. */
  viewDirection(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    this.busRef = ctx.bus;
    if (!this.post) this.post = ctx.tryGet<PostLike>('render.post') ?? null;
    if (!this.rig) this.rig = ctx.tryGet<RigLike>('player.camera') ?? null;
    if (this.inVehicle) {
      // A vehicle owns the transform; only vitals keep ticking.
      this.updateVitals(dt, ctx);
      return;
    }

    const input = ctx.input;
    // Snapshot before anything is resampled: `submerged` is derived from live
    // position and surface height, so the "previous" value has to be taken now
    // or the water-line crossing test below compares a value against itself.
    const wasSubmerged = this.submerged;

    /* --- look ------------------------------------------------------ */
    this.yawRate = dt > 0 ? -input.lookX / dt : 0;
    this.pitchRate = dt > 0 ? -input.lookY / dt : 0;
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - input.lookY,
      -Math.PI / 2 + 0.02,
      Math.PI / 2 - 0.02,
    );

    /* --- environment sample --------------------------------------- */
    this.surfaceY = ctx.world.waterHeightAt(this.position.x, this.position.z, ctx.time);
    const feetY = this.position.y - this.eyeHeight;
    const crownY = this.position.y + 0.2;
    this.submergedFraction = THREE.MathUtils.clamp(
      (this.surfaceY - feetY) / (crownY - feetY),
      0,
      1,
    );

    /* --- body basis ------------------------------------------------ */
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    _right.set(cy, 0, -sy);

    /* --- mode selection with hysteresis --------------------------- */
    this.modeTimer += dt;
    const wantsUp = input.moveY > 0.2;
    const nearSurface = this.position.y > this.surfaceY - 0.85;
    const inWater = this.submergedFraction > 0.05;
    if (this.contact.grounded && !wantsUp && this.velocity.y > -2.5) {
      if (!this.walkLatch && this.modeTimer > 0.12) {
        this.walkLatch = true;
        this.modeTimer = 0;
      }
    } else if (this.walkLatch && (wantsUp || (!this.contact.grounded && this.modeTimer > 0.22))) {
      this.walkLatch = false;
      this.modeTimer = 0;
    }
    const next: LocomotionMode = this.walkLatch && this.contact.grounded
      ? 'walk'
      : inWater && nearSurface
        ? 'surface'
        : 'swim';
    if (next !== this.mode) {
      this.mode = next;
      this.modeTimer = 0;
    }
    this.swimming = this.submerged && this.mode !== 'walk';
    this.grounded = this.contact.grounded && this.mode === 'walk';

    /* --- wish + sprint -------------------------------------------- */
    // Swimming follows the look pitch (you go where you look); walking does not.
    if (this.mode === 'swim') _fwd.set(-sy * cp, sp, -cy * cp).normalize();
    else _fwd.set(-sy, 0, -cy).normalize();
    _up.copy(_right).cross(_fwd).normalize();

    const inFwd = -input.moveZ;
    const inLat = input.moveX;
    const inVert = this.mode === 'swim' || this.mode === 'surface' ? input.moveY : 0;
    const wishMag = Math.min(1, Math.hypot(inFwd, inLat, inVert));
    const moving = wishMag > 0.05;
    const canSprint = this.vitals.oxygen > 2.5 && this.vitals.health > 5;
    this.sprinting = input.down('sprint') && moving && canSprint && this.mode !== 'walk';

    const fins = this.equipment.fins;
    const thrustScale =
      (this.sprinting ? TUNE.sprintThrust : 1) * (fins ? TUNE.finThrust : 1) * (wishMag > 0 ? 1 : 0);

    /* --- per-mode forces ------------------------------------------ */
    ctx.world.currentAt(this.position.x, this.position.y, this.position.z, ctx.time, _current);
    // Currents fade out above the surface and where the body is aground.
    _current.multiplyScalar(this.submergedFraction * (this.mode === 'walk' ? 0.35 : 1));

    if (this.mode === 'walk') {
      this.stepWalk(dt, ctx, inFwd, inLat);
    } else if (this.mode === 'surface') {
      this.stepSurface(dt, thrustScale, inFwd, inLat, inVert);
    } else {
      this.stepSwim(dt, thrustScale, inFwd, inLat, inVert);
    }

    /* --- buoyancy / gravity --------------------------------------- */
    this.velocity.y += this.buoyancyAccel() * dt;

    /* --- external impulses ---------------------------------------- */
    if (this.impulse.lengthSq() > 0) {
      this.velocity.add(this.impulse);
      this.impulse.set(0, 0, 0);
    }

    /* --- integrate + collide -------------------------------------- */
    this.lastSpeed = this.velocity.length();
    this.collider.move(
      this.position,
      this.velocity,
      dt,
      ctx.world,
      this.contact,
      this.mode === 'walk',
    );

    // Impact damage: how much speed the world took away this frame. Water
    // cushions, so the threshold is higher when fully submerged.
    const lost = this.lastSpeed - this.velocity.length();
    const impactThreshold = this.submergedFraction > 0.9 ? 16 : TUNE.impactThreshold;
    if (lost > impactThreshold) {
      this.damage((lost - impactThreshold) * TUNE.impactDamagePerMs, 'impact');
    }

    // Foot snap while walking keeps the eye glued to the floor over rubble.
    if (this.mode === 'walk' && this.contact.groundGap > 0 && this.contact.groundGap < 0.32) {
      this.position.y -= Math.min(this.contact.groundGap, dt * 6);
    }

    /* --- post-integration state ----------------------------------- */
    this.surfaceY = ctx.world.waterHeightAt(this.position.x, this.position.z, ctx.time);
    this.viewDirection(_tmp);
    this.forwardSpeed = this.velocity.dot(_tmp);

    if (this.submerged !== wasSubmerged) {
      this.surfaceCrossings++;
      this.lastCrossTime = ctx.time;
      this.lastCrossDown = this.submerged;
      this.lastCrossSpeed = Math.abs(this.velocity.y);
      ctx.bus.emit('audio:cue', {
        id: this.submerged ? 'player.dive.enter' : 'player.surface.break',
        gain: THREE.MathUtils.clamp(0.3 + this.lastCrossSpeed * 0.12, 0.3, 1),
      });
    }

    this.updateBreathing(dt, ctx);
    this.updateVitals(dt, ctx);
    this.updateFootsteps(dt, ctx);
  }

  /* ---------------------------------------------------------------- *
   * Locomotion
   * ---------------------------------------------------------------- */

  /**
   * Fully submerged. Thrust in the body frame, then implicit anisotropic
   * quadratic drag evaluated on velocity *relative to the current*, which is
   * what lets a current carry you without stealing control authority.
   */
  private stepSwim(dt: number, thrustScale: number, inFwd: number, inLat: number, inVert: number): void {
    const airborne = this.submergedFraction < 0.15;
    if (!airborne) {
      _thrust
        .set(0, 0, 0)
        .addScaledVector(_fwd, inFwd * TUNE.swimThrust.fwd)
        .addScaledVector(_right, inLat * TUNE.swimThrust.lat);
      _thrust.y += inVert * TUNE.swimThrust.vert;
      this.velocity.addScaledVector(_thrust, thrustScale * dt);
    }

    if (airborne) {
      // In air: light aerodynamic drag only, gravity handled by buoyancy().
      const k = Math.exp(-0.25 * dt);
      this.velocity.x *= k;
      this.velocity.z *= k;
      return;
    }

    const dragScale = (this.equipment.fins ? TUNE.finDrag : 1) * (this.sprinting ? 0.92 : 1);
    this.applyBodyDrag(
      dt,
      TUNE.swimDrag.fwd * dragScale,
      TUNE.swimDrag.lat * dragScale,
      TUNE.swimDrag.vert * dragScale,
    );
  }

  /**
   * Head at the water line. Horizontal thrust only, plus a tread-water PD term
   * that tracks the wave surface — that tracking *is* the bob, because the
   * surface height comes from the animated Gerstner field.
   */
  private stepSurface(dt: number, thrustScale: number, inFwd: number, inLat: number, inVert: number): void {
    _thrust
      .set(0, 0, 0)
      .addScaledVector(_fwd, inFwd * TUNE.surfaceThrust)
      .addScaledVector(_right, inLat * TUNE.surfaceThrust * 0.7);
    this.velocity.addScaledVector(_thrust, thrustScale * dt);

    // Diving from the surface: pressing descend disables the tread controller.
    const diving = inVert < -0.2;
    if (!diving) {
      const targetY = this.surfaceY + 0.1;
      const err = targetY - this.position.y;
      // Stiff but well damped so it settles in ~0.8 s and rides swell smoothly.
      this.velocity.y += (err * 11 - this.velocity.y * 3.4) * dt;
    } else {
      this.velocity.y += inVert * TUNE.swimThrust.vert * thrustScale * dt;
    }

    const d = TUNE.surfaceDrag * (this.equipment.fins ? TUNE.finDrag : 1);
    this.applyBodyDrag(dt, d, d * 1.7, 1.5);
  }

  /** Feet on the floor: slope projection, ground friction, floaty gravity. */
  private stepWalk(dt: number, ctx: GameContext, inFwd: number, inLat: number): void {
    const speed = this.submerged ? TUNE.walkSpeedSubmerged : TUNE.walkSpeed;
    const sprint = this.sprinting ? 1.5 : 1;

    _thrust.set(0, 0, 0).addScaledVector(_fwd, inFwd).addScaledVector(_right, inLat);
    if (_thrust.lengthSq() > 1) _thrust.normalize();

    // Project the wish onto the ground plane so uphill/downhill keeps its speed.
    const n = this.contact.groundNormal;
    _slope.copy(_thrust).addScaledVector(n, -_thrust.dot(n));
    if (_slope.lengthSq() > 1e-6) _slope.normalize().multiplyScalar(_thrust.length());
    // Steep slopes cost speed.
    const slopePenalty = 1 - smoothstep(0.35, 0.95, this.contact.groundSlope) * 0.65;

    this.velocity.addScaledVector(_slope, TUNE.walkAccel * speed * sprint * slopePenalty * dt * 0.25);

    // Ground friction on the tangential components only.
    const damp = Math.exp(-TUNE.walkDamp * dt);
    this.velocity.x *= damp;
    this.velocity.z *= damp;
    if (this.velocity.y > 0) this.velocity.y *= damp;

    // Jump / push off the floor.
    if (ctx.input.pressed('ascend')) {
      this.velocity.y += this.submerged ? 3.0 : 4.2;
      this.walkLatch = false;
    }

    // Current still nudges a walking diver, but only a little.
    this.velocity.addScaledVector(_current, dt * 0.5);
  }

  /**
   * Implicit quadratic drag in the body frame. Solved per axis as
   * `v' = v / (1 + k|v|dt)`, which is unconditionally stable and never
   * overshoots into a jitter at low frame rates.
   */
  private applyBodyDrag(dt: number, kf: number, kl: number, kv: number): void {
    _rel.copy(this.velocity).sub(_current);
    let a = _rel.dot(_fwd);
    let b = _rel.dot(_right);
    let c = _rel.dot(_up);
    a /= 1 + kf * Math.abs(a) * dt;
    b /= 1 + kl * Math.abs(b) * dt;
    c /= 1 + kv * Math.abs(c) * dt;
    this.velocity
      .copy(_current)
      .addScaledVector(_fwd, a)
      .addScaledVector(_right, b)
      .addScaledVector(_up, c);
  }

  /**
   * Net vertical acceleration from displaced water. Fully submerged near the
   * surface the diver is slightly positive; suit and lung compression make him
   * negative past ~7 m, so idling deep means a slow sink — Subnautica's exact
   * behaviour. Above the water line the submerged fraction goes to zero and the
   * same expression becomes plain gravity.
   */
  private buoyancyAccel(): number {
    const eq = this.equipment;
    let rho = 1.062;
    rho -= 0.104 * smoothstep(0, 7, this.depth);
    if (eq.weightBelt) rho -= 0.045;
    if (eq.suit === 'reinforced') rho -= 0.014;
    if (eq.suit === 'coldsuit') rho += 0.008;
    if (eq.tank === 'high_capacity') rho += 0.012;
    if (eq.tank === 'ultra_capacity') rho += 0.02;
    rho -= eq.cargoMass * 0.00045;
    return TUNE.gravity * (this.submergedFraction * rho - 1);
  }

  /* ---------------------------------------------------------------- *
   * Vitals
   * ---------------------------------------------------------------- */

  private updateBreathing(dt: number, ctx: GameContext): void {
    const exertion = this.sprinting ? 1 : Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / 3.4);
    const panic = 1 - THREE.MathUtils.clamp(this.vitals.oxygen / Math.max(1, this.vitals.maxOxygen * 0.35), 0, 1);
    const target = 0.2 + exertion * 0.24 + panic * 0.5 + this.chill * 0.18;
    this.breathRate += (target - this.breathRate) * Math.min(1, dt * 1.5);
    const prev = this.breathPhase;
    this.breathPhase += dt * this.breathRate * Math.PI * 2;
    // One exhale cue per cycle, only underwater (that is where bubbles come from).
    if (this.submerged && Math.floor(prev / (Math.PI * 2)) !== Math.floor(this.breathPhase / (Math.PI * 2))) {
      ctx.bus.emit('audio:cue', { id: 'player.breath.out', gain: 0.22 + exertion * 0.3 });
    }
    if (this.breathPhase > Math.PI * 200) this.breathPhase -= Math.PI * 200;
  }

  private updateVitals(dt: number, ctx: GameContext): void {
    const g = ctx.settings.gameplay;
    if (g.mode === 'creative') {
      this.vitals.oxygen = this.vitals.maxOxygen;
      return;
    }

    this.oxygenTickAccum += dt;
    if (this.oxygenTickAccum < 0.2) return;
    const step = this.oxygenTickAccum;
    this.oxygenTickAccum = 0;

    /* --- temperature (drives the cold biomes) --------------------- */
    const biome = ctx.world.biomeAt(this.position.x, this.position.z);
    this.ambientTemp = ambientWaterTemp(biome.id, this.depth);
    if (this.submergedFraction > 0.3) {
      const insulation = SUIT_INSULATION[this.equipment.suit];
      // Convective loss rises with speed through the water.
      const flow = 1 + Math.min(1.4, this.velocity.length() * 0.22);
      const k = 0.055 * (1 - insulation) * flow;
      this.vitals.temperature += (this.ambientTemp - this.vitals.temperature) * Math.min(0.6, k * step);
    } else {
      this.vitals.temperature += (36.8 - this.vitals.temperature) * Math.min(0.6, 0.09 * step);
    }
    this.chill = THREE.MathUtils.clamp((35.6 - this.vitals.temperature) / 3.2, 0, 1);
    if (this.vitals.temperature < 35) {
      this.damage(step * (1.1 + this.chill * 2.6), 'hypothermia');
      this.shiverCooldown -= step;
      if (this.shiverCooldown <= 0) {
        this.shiverCooldown = 4.5;
        ctx.bus.emit('audio:cue', { id: 'player.shiver', gain: 0.4 + this.chill * 0.4 });
        ctx.bus.emit('vitals:critical', { kind: 'health', value: this.vitals.health });
        ctx.bus.emit('ui:notify', { text: 'Core temperature falling', kind: 'warn', ttl: 3 });
      }
    } else if (this.vitals.temperature > 44) {
      this.damage(step * (this.vitals.temperature - 44) * 0.5, 'heat');
    }

    /* --- oxygen --------------------------------------------------- */
    if (this.submerged) {
      // Gas use scales with ambient pressure. Clamped so deep diving is hard,
      // not impossible.
      const pressure = Math.min(3.2, 1 + this.depth / 55);
      const exertion = this.sprinting ? 1.9 : Math.hypot(this.velocity.x, this.velocity.z) > 1.2 ? 1.15 : 0.85;
      const cold = 1 + this.chill * 0.3;
      const rebreather = this.equipment.tank === 'rebreather' ? 0.62 : 1;
      const rate = pressure * exertion * cold * rebreather;
      this.vitals.oxygen = Math.max(0, this.vitals.oxygen - step * rate);
      const frac = this.vitals.oxygen / Math.max(1, this.vitals.maxOxygen);
      if (this.vitals.oxygen <= 0) {
        this.damage(step * 12, 'drowning');
        ctx.bus.emit('vitals:critical', { kind: 'oxygen', value: 0 });
      } else {
        const level = frac < 0.06 ? 0 : frac < 0.15 ? 1 : frac < 0.3 ? 2 : 3;
        if (level < this.o2WarnLevel) {
          this.o2WarnLevel = level;
          ctx.bus.emit('vitals:critical', { kind: 'oxygen', value: this.vitals.oxygen });
          ctx.bus.emit('audio:cue', { id: 'player.oxygen.low', gain: 0.5 + (3 - level) * 0.15 });
        }
      }
    } else {
      const before = this.vitals.oxygen;
      this.vitals.oxygen = Math.min(this.vitals.maxOxygen, this.vitals.oxygen + step * 14);
      if (before < this.vitals.maxOxygen * 0.5 && this.vitals.oxygen > this.vitals.maxOxygen * 0.5) {
        this.o2WarnLevel = 3;
      }
      if (this.vitals.oxygen >= this.vitals.maxOxygen) this.o2WarnLevel = 3;
    }

    /* --- food / water --------------------------------------------- */
    if (g.mode === 'survival' || g.mode === 'hardcore') {
      const burn = this.sprinting ? 1.6 : 1;
      this.vitals.food = Math.max(0, this.vitals.food - step * 0.14 * burn);
      this.vitals.water = Math.max(0, this.vitals.water - step * 0.19 * burn);
      if (this.vitals.food <= 0 || this.vitals.water <= 0) this.damage(step * 1.5, 'starvation');
      if (this.vitals.food < 20) ctx.bus.emit('vitals:critical', { kind: 'food', value: this.vitals.food });
      if (this.vitals.water < 20) ctx.bus.emit('vitals:critical', { kind: 'water', value: this.vitals.water });
    }

    /* --- slow regeneration when healthy otherwise ----------------- */
    if (
      this.vitals.health > 0 &&
      this.vitals.health < 100 &&
      this.vitals.food > 35 &&
      this.vitals.water > 35 &&
      this.chill < 0.2
    ) {
      this.vitals.health = Math.min(100, this.vitals.health + step * 0.35);
    }
  }

  private updateFootsteps(dt: number, ctx: GameContext): void {
    if (this.mode !== 'walk') {
      this.footAccum = 0.6;
      return;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < 0.35) return;
    this.footAccum += dt * speed * 0.62;
    if (this.footAccum >= 1) {
      this.footAccum = 0;
      ctx.bus.emit('audio:cue', {
        id: this.submerged ? 'player.footstep.wet' : 'player.footstep',
        position: [this.position.x, this.position.y - this.eyeHeight, this.position.z],
        gain: 0.3 + Math.min(0.4, speed * 0.1),
      });
    }
  }
}

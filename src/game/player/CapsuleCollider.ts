/**
 * Capsule sweep against `WorldQuery`.
 *
 * The world is exposed to physics as a height field (`heightAt`/`normalAt`) plus
 * a volumetric solidity test (`isSolid`, which becomes meaningful once caves and
 * overhangs exist). This collider uses both:
 *
 *  1. the swept motion is split into sub-steps no longer than half a radius, so
 *     a 40 m/s propulsion-cannon yank cannot tunnel through a ridge;
 *  2. each sub-step resolves penetration by finding the *deepest* contact among
 *     a ring of samples taken around both capsule spheres, pushing out along
 *     that contact normal and removing only the into-surface part of the
 *     velocity (slide, never bounce);
 *  3. a skin width means a capsule resting against a wall stops being corrected
 *     once it is out by a fraction of a millimetre — that is what kills the
 *     classic jitter when you hold "forward" into a cliff;
 *  4. an `isSolid` gradient push catches ceilings/caves the height field cannot
 *     express.
 *
 * Everything is allocation-free: scratch vectors are module scope.
 */
import * as THREE from 'three';
import type { WorldQuery } from '../core/Types';

/** Unit ring used to sample the world around a capsule sphere. */
const RING_COUNT = 8;
const RING_X = new Float32Array(RING_COUNT);
const RING_Z = new Float32Array(RING_COUNT);
for (let i = 0; i < RING_COUNT; i++) {
  const a = (i / RING_COUNT) * Math.PI * 2;
  RING_X[i] = Math.cos(a);
  RING_Z[i] = Math.sin(a);
}

const _n = new THREE.Vector3();
const _bestN = new THREE.Vector3();
const _grad = new THREE.Vector3();
const _step = new THREE.Vector3();
const _probe = new THREE.Vector3();

export interface CapsuleSweepResult {
  /** Standing on walkable ground this frame. */
  grounded: boolean;
  /** Ground normal under the capsule (valid when a floor sample was found). */
  readonly groundNormal: THREE.Vector3;
  /** Highest floor height sampled beneath the capsule. */
  groundHeight: number;
  /** Gap between the feet and that floor (negative = interpenetrating). */
  groundGap: number;
  /** True when a non-walkable surface was pushed against this frame. */
  hitWall: boolean;
  /** Normal of the last wall contact. */
  readonly wallNormal: THREE.Vector3;
  /** Metres of automatic step-up applied this frame. */
  stepUp: number;
  /** Slope of the ground under the capsule, radians. */
  groundSlope: number;
}

export function makeSweepResult(): CapsuleSweepResult {
  return {
    grounded: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    groundHeight: -Infinity,
    groundGap: Infinity,
    hitWall: false,
    wallNormal: new THREE.Vector3(0, 1, 0),
    stepUp: 0,
    groundSlope: 0,
  };
}

export interface CapsuleOptions {
  /** Capsule radius, metres. */
  radius: number;
  /** Total capsule height (feet to crown), metres. */
  height: number;
  /** Offset from the feet to the eye, metres. */
  eyeHeight: number;
  /** Maximum climbable step, metres. */
  stepHeight: number;
  /** Steepest walkable slope, radians. */
  maxSlope: number;
}

export class CapsuleCollider {
  /** Contact tolerance. Correction stops inside this band, which prevents jitter. */
  readonly skin = 0.012;
  /** Penetration-resolution iterations per sub-step. */
  readonly iterations = 3;

  constructor(public opts: CapsuleOptions) {}

  /**
   * Integrate `eye` by `velocity * dt` with collision. `eye` and `velocity` are
   * mutated in place; `out` receives the contact summary.
   */
  move(
    eye: THREE.Vector3,
    velocity: THREE.Vector3,
    dt: number,
    world: WorldQuery,
    out: CapsuleSweepResult,
    allowStepUp: boolean,
  ): void {
    out.hitWall = false;
    out.stepUp = 0;

    const dist = velocity.length() * dt;
    const maxStep = this.opts.radius * 0.5;
    const sub = Math.max(1, Math.min(12, Math.ceil(dist / maxStep)));
    const h = dt / sub;

    for (let s = 0; s < sub; s++) {
      _step.copy(velocity).multiplyScalar(h);
      if (allowStepUp) this.tryStepUp(eye, _step, world, out);
      eye.add(_step);
      this.resolve(eye, velocity, world, out);
    }

    this.probeGround(eye, world, out);
  }

  /**
   * Looks one radius ahead along the horizontal motion; if the floor there is
   * higher than the feet but within `stepHeight`, lift the capsule so walking
   * over rubble and reef shelves does not stall.
   */
  private tryStepUp(
    eye: THREE.Vector3,
    step: THREE.Vector3,
    world: WorldQuery,
    out: CapsuleSweepResult,
  ): void {
    const hx = step.x;
    const hz = step.z;
    const len = Math.hypot(hx, hz);
    if (len < 1e-5) return;
    const ahead = this.opts.radius + Math.min(0.35, len * 4);
    const px = eye.x + (hx / len) * ahead;
    const pz = eye.z + (hz / len) * ahead;
    const feet = eye.y - this.opts.eyeHeight;
    const target = world.heightAt(px, pz);
    const rise = target - feet;
    if (rise <= this.skin || rise > this.opts.stepHeight) return;
    // Only step where the surface we are climbing onto is itself walkable.
    world.normalAt(px, pz, _n);
    if (_n.y < Math.cos(this.opts.maxSlope)) return;
    eye.y += rise + this.skin;
    out.stepUp += rise;
  }

  /**
   * Push the capsule out of the world. Returns after at most `iterations`
   * deepest-contact corrections, which converges for height fields and is
   * stable in concave corners.
   */
  private resolve(
    eye: THREE.Vector3,
    velocity: THREE.Vector3,
    world: WorldQuery,
    out: CapsuleSweepResult,
  ): void {
    const r = this.opts.radius;
    const feetToLower = r;
    const feetToUpper = Math.max(r, this.opts.height - r);

    for (let iter = 0; iter < this.iterations; iter++) {
      let bestDepth = 0;
      _bestN.set(0, 1, 0);

      // Two spheres: hips/feet and chest/head.
      for (let sphere = 0; sphere < 2; sphere++) {
        const cy = eye.y - this.opts.eyeHeight + (sphere === 0 ? feetToLower : feetToUpper);
        // Centre sample first — the common case.
        const depthCentre = cy - r - world.heightAt(eye.x, eye.z);
        if (depthCentre < 0) {
          const d = -depthCentre;
          if (d > bestDepth) {
            bestDepth = d;
            world.normalAt(eye.x, eye.z, _bestN);
          }
        }
        // Ring samples catch edges, spires and corners the centre misses.
        for (let i = 0; i < RING_COUNT; i++) {
          const ox = RING_X[i] * r * 0.86;
          const oz = RING_Z[i] * r * 0.86;
          const px = eye.x + ox;
          const pz = eye.z + oz;
          const py = world.heightAt(px, pz);
          // Vector from the surface point to the sphere centre.
          const dx = eye.x - px;
          const dy = cy - py;
          const dz = eye.z - pz;
          const l2 = dx * dx + dy * dy + dz * dz;
          if (l2 >= r * r || dy < -this.opts.height) continue;
          const l = Math.sqrt(Math.max(l2, 1e-8));
          const depth = r - l;
          if (depth > bestDepth) {
            bestDepth = depth;
            if (l > 1e-4) _bestN.set(dx / l, dy / l, dz / l);
            else world.normalAt(px, pz, _bestN);
            // Blend toward the analytic surface normal so shallow contacts on a
            // smooth slope do not produce a wobbly per-sample normal.
            world.normalAt(px, pz, _n);
            _bestN.lerp(_n, 0.5).normalize();
          }
        }
      }

      if (bestDepth <= this.skin) break;

      eye.addScaledVector(_bestN, bestDepth - this.skin * 0.5);
      const into = velocity.dot(_bestN);
      if (into < 0) velocity.addScaledVector(_bestN, -into);

      if (_bestN.y < Math.cos(this.opts.maxSlope)) {
        out.hitWall = true;
        out.wallNormal.copy(_bestN);
      }
    }

    this.resolveVolumetric(eye, velocity, world);
  }

  /**
   * Height fields cannot describe a ceiling. `isSolid` can, so sample it at the
   * capsule spheres and push out along the finite-difference gradient. This is
   * a no-op for a pure height field world because the height-field pass above
   * has already cleared the spheres.
   */
  private resolveVolumetric(eye: THREE.Vector3, velocity: THREE.Vector3, world: WorldQuery): void {
    const r = this.opts.radius;
    const feet = eye.y - this.opts.eyeHeight;
    for (let sphere = 0; sphere < 2; sphere++) {
      const cy = feet + (sphere === 0 ? r : Math.max(r, this.opts.height - r));
      if (!world.isSolid(eye.x, cy, eye.z)) continue;
      const e = 0.45;
      const gx =
        (world.isSolid(eye.x + e, cy, eye.z) ? 1 : 0) - (world.isSolid(eye.x - e, cy, eye.z) ? 1 : 0);
      const gy =
        (world.isSolid(eye.x, cy + e, eye.z) ? 1 : 0) - (world.isSolid(eye.x, cy - e, eye.z) ? 1 : 0);
      const gz =
        (world.isSolid(eye.x, cy, eye.z + e) ? 1 : 0) - (world.isSolid(eye.x, cy, eye.z - e) ? 1 : 0);
      _grad.set(-gx, -gy, -gz);
      if (_grad.lengthSq() < 1e-6) _grad.set(0, 1, 0);
      _grad.normalize();
      eye.addScaledVector(_grad, 0.14);
      const into = velocity.dot(_grad);
      if (into < 0) velocity.addScaledVector(_grad, -into);
    }
  }

  /**
   * Ground query: takes the *highest* floor sample inside the capsule footprint
   * so you stand on a ridge instead of sinking beside it.
   */
  private probeGround(eye: THREE.Vector3, world: WorldQuery, out: CapsuleSweepResult): void {
    const r = this.opts.radius;
    let best = world.heightAt(eye.x, eye.z);
    let bx = eye.x;
    let bz = eye.z;
    for (let i = 0; i < RING_COUNT; i += 2) {
      const px = eye.x + RING_X[i] * r * 0.7;
      const pz = eye.z + RING_Z[i] * r * 0.7;
      const hh = world.heightAt(px, pz);
      if (hh > best) {
        best = hh;
        bx = px;
        bz = pz;
      }
    }
    world.normalAt(bx, bz, out.groundNormal);
    out.groundHeight = best;
    out.groundGap = eye.y - this.opts.eyeHeight - best;
    out.groundSlope = Math.acos(THREE.MathUtils.clamp(out.groundNormal.y, -1, 1));
    out.grounded = out.groundGap <= 0.2 && out.groundSlope <= this.opts.maxSlope;
  }

  /**
   * Cheap ray march against the world for reticle focus, tool reach and the
   * flashlight. Returns the hit distance or -1. Uses geometric step growth so
   * 60 m costs ~24 height samples.
   */
  raymarch(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    world: WorldQuery,
    steps = 28,
  ): number {
    let t = 0.4;
    let prev = t;
    for (let i = 0; i < steps && t < maxDist; i++) {
      _probe.copy(dir).multiplyScalar(t).add(origin);
      if (_probe.y < world.heightAt(_probe.x, _probe.z) || world.isSolid(_probe.x, _probe.y, _probe.z)) {
        // Binary refine between the last free sample and this one.
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) * 0.5;
          _probe.copy(dir).multiplyScalar(mid).add(origin);
          if (_probe.y < world.heightAt(_probe.x, _probe.z)) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prev = t;
      t *= 1.22;
      t += 0.35;
    }
    return -1;
  }
}

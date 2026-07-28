/**
 * Agent pool, spatial hash and shared integration.
 *
 * Agents are pooled objects allocated once at boot; nothing in the simulation
 * path allocates. Everything the steering code needs is either on the agent or
 * in module-scope scratch vectors.
 */
import * as THREE from 'three';
import type { WorldQuery } from '../core/Types';

/* --- simulation LOD tiers --- */
export const LOD_FULL = 0;
export const LOD_CHEAP = 1;
export const LOD_FROZEN = 2;

/* --- predator states --- */
export const ST_PATROL = 0;
export const ST_INVESTIGATE = 1;
export const ST_STALK = 2;
export const ST_CHARGE = 3;
export const ST_BITE = 4;
export const ST_RETREAT = 5;
export const ST_FETCH = 6;

export const STATE_NAMES = [
  'patrol',
  'investigate',
  'stalk',
  'charge',
  'bite',
  'retreat',
  'fetch',
] as const;

export class Agent {
  active = false;
  species = 0;
  variant = 0;
  cellKey = 0;

  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly fwd = new THREE.Vector3(0, 0, -1);
  readonly accum = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly tint = new THREE.Color(1, 1, 1);

  /** Uniform size multiplier plus non-uniform silhouette jitter. */
  scale = 1;
  stretch = 1;
  girth = 1;

  phase = 0;
  /** Stable 0..1 per-individual hash, drives pattern + glow variation. */
  hash = 0;
  glow = 1;
  roughJitter = 0;

  beat = 1;
  amp = 0.1;
  lean = 0;
  yawRate = 0;
  speed = 0;

  state = ST_PATROL;
  stateT = 0;
  awareness = 0;
  aggro = 0;
  startle = 0;
  biteCd = 0;
  growlCd = 0;

  altitude = 5;
  wanderT = 0;
  bubbleT = 0;
  carrying = -1;
  carryT = 0;

  lod = LOD_FULL;
  dist = 0;
  onScreen = false;
  /** Distance to the sea floor directly below, refreshed at full/cheap LOD. */
  floorY = -1000;
}

/* ------------------------------------------------------------------ *
 * Spatial hash
 * ------------------------------------------------------------------ */

const HASH_X = 92837111;
const HASH_Y = 689287499;
const HASH_Z = 283923481;

/** Uniform-grid neighbour lookup over a fixed agent capacity. */
export class SpatialHash {
  private heads: Int32Array;
  private next: Int32Array;
  private readonly inv: number;

  constructor(
    private readonly cell: number,
    private readonly buckets: number,
    capacity: number,
  ) {
    this.heads = new Int32Array(buckets).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.inv = 1 / cell;
  }

  clear(): void {
    this.heads.fill(-1);
  }

  private bucket(ix: number, iy: number, iz: number): number {
    const h = (Math.imul(ix, HASH_X) ^ Math.imul(iy, HASH_Y) ^ Math.imul(iz, HASH_Z)) >>> 0;
    return h % this.buckets;
  }

  insert(index: number, x: number, y: number, z: number): void {
    const b = this.bucket(
      Math.floor(x * this.inv),
      Math.floor(y * this.inv),
      Math.floor(z * this.inv),
    );
    this.next[index] = this.heads[b];
    this.heads[b] = index;
  }

  /**
   * Gathers agent indices in the 3x3x3 cell neighbourhood around a point into
   * `out`, returning how many were written. Never allocates.
   */
  query(x: number, y: number, z: number, out: Int32Array): number {
    const cx = Math.floor(x * this.inv);
    const cy = Math.floor(y * this.inv);
    const cz = Math.floor(z * this.inv);
    let n = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          let i = this.heads[this.bucket(cx + dx, cy + dy, cz + dz)];
          while (i !== -1) {
            if (n >= out.length) return n;
            out[n++] = i;
            i = this.next[i];
          }
        }
      }
    }
    return n;
  }
}

/* ------------------------------------------------------------------ *
 * Shared integration
 * ------------------------------------------------------------------ */

const _dir = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _look = new THREE.Vector3();
const _zero = new THREE.Vector3();

/**
 * Integrates one agent from its accumulated steering vector, then resolves
 * heading, bank angle and the animation drive values the shader reads.
 */
export function integrate(
  a: Agent,
  desiredSpeed: number,
  maxAccel: number,
  turnRate: number,
  dt: number,
): void {
  if (a.accum.lengthSq() > 1e-8) {
    _dir.copy(a.accum).normalize().multiplyScalar(desiredSpeed).sub(a.vel);
    const l = _dir.length();
    if (l > maxAccel) _dir.multiplyScalar(maxAccel / l);
    a.vel.add(_dir.multiplyScalar(dt));
  } else {
    a.vel.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
  }

  const sp = a.vel.length();
  const cap = desiredSpeed * 1.45;
  if (sp > cap) a.vel.multiplyScalar(cap / sp);
  a.speed = Math.min(sp, cap);

  a.pos.addScaledVector(a.vel, dt);

  // Heading: chase the velocity direction at a bounded turn rate so nothing
  // snaps around instantly.
  if (a.speed > 0.02) {
    _prev.copy(a.fwd);
    _dir.copy(a.vel).multiplyScalar(1 / a.speed);
    const k = Math.min(1, turnRate * dt);
    a.fwd.lerp(_dir, k);
    if (a.fwd.lengthSq() < 1e-6) a.fwd.copy(_dir);
    a.fwd.normalize();
    // Signed yaw change → bank into the turn.
    const cross = _prev.x * a.fwd.z - _prev.z * a.fwd.x;
    const rate = dt > 1e-5 ? cross / dt : 0;
    a.yawRate += (rate - a.yawRate) * Math.min(1, 6 * dt);
  } else {
    a.yawRate *= Math.max(0, 1 - 3 * dt);
  }

  a.lean = THREE.MathUtils.clamp(-a.yawRate * 0.55, -0.55, 0.55);

  _look.copy(a.pos).add(a.fwd);
  _m.lookAt(a.pos, _look, _up);
  a.quat.setFromRotationMatrix(_m);
  void _zero;
}

/** Keeps an agent inside its preferred altitude band above the sea floor. */
export function altitudeSteer(
  a: Agent,
  world: WorldQuery,
  lo: number,
  hi: number,
  surfaceY: number,
  weight: number,
): void {
  const floor = world.heightAt(a.pos.x, a.pos.z);
  a.floorY = floor;
  const alt = a.pos.y - floor;
  if (alt < lo) a.accum.y += weight * (1 + (lo - alt) * 0.6);
  else if (alt > hi) a.accum.y -= weight * (1 + (alt - hi) * 0.12);
  // Never breach the surface.
  const ceiling = surfaceY - 0.9;
  if (a.pos.y > ceiling) a.accum.y -= weight * (2 + (a.pos.y - ceiling));
}

/**
 * Pushes an agent away from terrain it is about to swim into. Probes the
 * heightfield a body-length ahead, which is cheap and good enough underwater.
 */
export function avoidTerrain(a: Agent, world: WorldQuery, probe: number, weight: number): void {
  const px = a.pos.x + a.fwd.x * probe;
  const pz = a.pos.z + a.fwd.z * probe;
  const h = world.heightAt(px, pz);
  const clear = a.pos.y + a.fwd.y * probe - h;
  if (clear < probe * 0.5) {
    const push = (probe * 0.5 - clear) / (probe * 0.5);
    a.accum.y += weight * push * 1.6;
    // Slide sideways too so schools split around walls instead of stalling.
    a.accum.x += -a.fwd.z * weight * push * 0.8;
    a.accum.z += a.fwd.x * weight * push * 0.8;
  }
}

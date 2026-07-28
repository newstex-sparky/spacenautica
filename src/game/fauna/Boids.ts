/**
 * Boid flocking for the small schooling species.
 *
 * Separation / alignment / cohesion over a uniform spatial hash, plus terrain
 * avoidance, predator flee, player split and a curl-noise wander so schools
 * never settle into a rigid lattice. Everything is CPU-side but budgeted: only
 * agents at LOD_FULL run neighbour queries, and the neighbour scan is capped.
 */
import * as THREE from 'three';
import type { WorldQuery } from '../core/Types';
import { Agent, SpatialHash, altitudeSteer, avoidTerrain, integrate } from './Agents';
import type { SpeciesDef } from './Species';

export interface SimEnv {
  world: WorldQuery;
  time: number;
  dt: number;
  playerPos: THREE.Vector3;
  playerVel: THREE.Vector3;
  /** 0..1 how much noise the player is making (sprinting, vehicles). */
  playerNoise: number;
  /** 0..1 flashlight/vehicle light pointed roughly at the creature. */
  playerLight: number;
  playerInVehicle: boolean;
  surfaceY: number;
}

const _v = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _ali = new THREE.Vector3();
const _coh = new THREE.Vector3();
const _cur = new THREE.Vector3();

/** Cheap curl-ish wander field: divergence-free enough to look like water. */
function wander(a: Agent, t: number, out: THREE.Vector3): THREE.Vector3 {
  const p = a.phase;
  const s = t * 0.35 + p * 6.283;
  return out.set(
    Math.sin(s * 0.9) * Math.cos(s * 0.41 + p * 3.1),
    Math.sin(s * 0.53 + p * 2.2) * 0.45,
    Math.cos(s * 0.77 + p * 5.7),
  );
}

/**
 * Full-fidelity flocking step for one agent.
 * `scratch` is a reusable index buffer sized by the caller.
 */
export function steerSchool(
  a: Agent,
  agents: Agent[],
  hash: SpatialHash,
  sp: SpeciesDef,
  env: SimEnv,
  predators: Agent[],
  scratch: Int32Array,
): void {
  const acc = a.accum.set(0, 0, 0);
  const R = sp.school.radius;
  const R2 = R * R;
  const sepR = R * 0.34;
  const sepR2 = sepR * sepR;

  let nAli = 0;
  let nCoh = 0;
  _sep.set(0, 0, 0);
  _ali.set(0, 0, 0);
  _coh.set(0, 0, 0);

  const n = hash.query(a.pos.x, a.pos.y, a.pos.z, scratch);
  for (let i = 0; i < n; i++) {
    const o = agents[scratch[i]];
    if (o === a || !o.active) continue;
    const dx = o.pos.x - a.pos.x;
    const dy = o.pos.y - a.pos.y;
    const dz = o.pos.z - a.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2 || d2 < 1e-6) continue;
    if (d2 < sepR2) {
      // Inverse-square push so crowding resolves hard but distant fish are free.
      const inv = 1 / d2;
      _sep.x -= dx * inv;
      _sep.y -= dy * inv;
      _sep.z -= dz * inv;
    }
    if (o.species === a.species) {
      _ali.add(o.vel);
      nAli++;
      _coh.x += dx;
      _coh.y += dy;
      _coh.z += dz;
      nCoh++;
    }
  }

  if (_sep.lengthSq() > 1e-8) acc.addScaledVector(_sep.normalize(), sp.school.separation);
  if (nAli > 0) acc.addScaledVector(_ali.multiplyScalar(1 / nAli).normalize(), sp.school.align);
  if (nCoh > 0) acc.addScaledVector(_coh.multiplyScalar(1 / nCoh).normalize(), sp.school.cohere);

  // --- wander -------------------------------------------------------
  acc.addScaledVector(wander(a, env.time, _v), 0.55);

  // --- water current ------------------------------------------------
  env.world.currentAt(a.pos.x, a.pos.y, a.pos.z, env.time, _cur);
  acc.addScaledVector(_cur, 0.5);

  // --- flee predators ----------------------------------------------
  let flee = 0;
  for (let i = 0; i < predators.length; i++) {
    const p = predators[i];
    if (!p.active) continue;
    const d2 = p.pos.distanceToSquared(a.pos);
    const range = 20 + p.scale * 6;
    if (d2 > range * range) continue;
    const d = Math.sqrt(Math.max(d2, 0.04));
    _v.subVectors(a.pos, p.pos).multiplyScalar(1 / d);
    const w = (1 - d / range) * 4.5;
    acc.addScaledVector(_v, w);
    flee = Math.max(flee, 1 - d / range);
  }

  // --- split around the player -------------------------------------
  const pd2 = env.playerPos.distanceToSquared(a.pos);
  const shy = 3.2 + sp.length * 3 + env.playerNoise * 3.5 + a.startle * 4;
  if (pd2 < shy * shy) {
    const d = Math.sqrt(Math.max(pd2, 0.04));
    _v.subVectors(a.pos, env.playerPos).multiplyScalar(1 / d);
    // Add a tangential component so the school parts and streams around the
    // diver instead of bunching up and reversing into itself. The side is
    // chosen from the individual's hash, which is what makes a school split.
    const tx = -_v.z;
    const tz = _v.x;
    const side = a.hash > 0.5 ? 0.85 : -0.85;
    _v.x += tx * side;
    _v.z += tz * side;
    acc.addScaledVector(_v.normalize(), (1 - d / shy) * 5.5);
    flee = Math.max(flee, (1 - d / shy) * 0.9);
  }

  // --- keep in the depth band + off the floor ----------------------
  altitudeSteer(a, env.world, sp.altitude[0], sp.altitude[1], env.surfaceY, 1.4);
  avoidTerrain(a, env.world, Math.max(1.2, sp.length * 3), 1.6);

  const burst = Math.max(flee, a.startle);
  const speed = THREE.MathUtils.lerp(sp.cruise, sp.burst, burst);
  integrate(a, speed, speed * 5.5, sp.turnRate * (1 + burst), env.dt);
}

/**
 * Cheap mid-distance step: current advection, wander and altitude only. No
 * neighbour queries — schools still drift and undulate, they just stop
 * negotiating with each other where you cannot see it.
 */
export function steerCheap(a: Agent, sp: SpeciesDef, env: SimEnv): void {
  const acc = a.accum.set(0, 0, 0);
  acc.addScaledVector(wander(a, env.time, _v), 0.9);
  env.world.currentAt(a.pos.x, a.pos.y, a.pos.z, env.time, _cur);
  acc.addScaledVector(_cur, 0.6);
  acc.addScaledVector(a.fwd, 0.8);
  altitudeSteer(a, env.world, sp.altitude[0], sp.altitude[1], env.surfaceY, 1.2);
  integrate(a, sp.cruise * 0.85, sp.cruise * 3, sp.turnRate * 0.6, env.dt);
}

/**
 * Frozen step for far agents: straight-line advection at a coarse cadence so
 * they are roughly where you expect when you look back, at near-zero cost.
 */
export function steerFrozen(a: Agent, sp: SpeciesDef, dt: number): void {
  a.pos.addScaledVector(a.vel, dt);
  a.speed = a.vel.length();
  if (a.speed < sp.cruise * 0.4) {
    a.vel.addScaledVector(a.fwd, sp.cruise * 0.5);
  }
}

/**
 * Slow drifters (rays): a long lazy circuit around a home point with vertical
 * wallow. They never school; they just glide.
 */
export function steerDrifter(a: Agent, sp: SpeciesDef, env: SimEnv): void {
  const acc = a.accum.set(0, 0, 0);
  a.wanderT -= env.dt;
  if (a.wanderT <= 0) {
    a.wanderT = 9 + a.hash * 12;
    const ang = (a.hash * 6.283 + env.time * 0.07) % 6.283;
    const r = 26 + a.hash * 40;
    a.target.set(
      a.home.x + Math.cos(ang) * r,
      0,
      a.home.z + Math.sin(ang) * r,
    );
    const floor = env.world.heightAt(a.target.x, a.target.z);
    a.target.y = floor + THREE.MathUtils.lerp(sp.altitude[0], sp.altitude[1], 0.25 + a.hash * 0.5);
  }
  _v.subVectors(a.target, a.pos);
  if (_v.lengthSq() > 1e-6) acc.addScaledVector(_v.normalize(), 1.2);
  acc.addScaledVector(wander(a, env.time * 0.35, _v), 0.35);
  env.world.currentAt(a.pos.x, a.pos.y, a.pos.z, env.time, _cur);
  acc.addScaledVector(_cur, 0.8);
  // A gentle vertical wallow, the thing that makes rays read as weightless.
  acc.y += Math.sin(env.time * 0.23 + a.phase * 6.283) * 0.35;

  // Rays give the player a wide berth but do not panic.
  const pd = env.playerPos.distanceTo(a.pos);
  const shy = 5 + sp.length * 0.9;
  if (pd < shy) {
    _v.subVectors(a.pos, env.playerPos).normalize();
    acc.addScaledVector(_v, (1 - pd / shy) * 2.2);
  }

  altitudeSteer(a, env.world, sp.altitude[0], sp.altitude[1], env.surfaceY, 1.1);
  avoidTerrain(a, env.world, Math.max(3, sp.length * 1.6), 1.5);
  const burst = a.startle;
  integrate(
    a,
    THREE.MathUtils.lerp(sp.cruise, sp.burst, burst),
    sp.cruise * 2.4,
    sp.turnRate * (1 + burst * 0.6),
    env.dt,
  );
}

/**
 * Predator behaviour: a utility state machine with hysteresis.
 *
 *   patrol -> investigate -> stalk -> charge -> bite -> retreat
 *
 * Awareness is driven by player distance, the noise the player makes
 * (sprinting / vehicles), whether a light is on them, and line of sight through
 * the heightfield. Scavengers (stalkers) additionally divert to loose metal
 * when they are not interested in the player.
 *
 * Each state scores itself; the current state gets a stickiness bonus and a
 * minimum dwell time, which is what stops the classic "AI vibrating between two
 * states" failure without hard-coding a transition table.
 */
import * as THREE from 'three';
import {
  Agent,
  ST_BITE,
  ST_CHARGE,
  ST_FETCH,
  ST_INVESTIGATE,
  ST_PATROL,
  ST_RETREAT,
  ST_STALK,
  altitudeSteer,
  avoidTerrain,
  integrate,
} from './Agents';
import type { SimEnv } from './Boids';
import type { SpeciesDef } from './Species';

export interface PredatorHooks {
  /** Land a bite on the player. */
  bite(a: Agent, sp: SpeciesDef, dir: THREE.Vector3): void;
  /** Announce an aggro transition (music stingers, HUD). */
  aggro(a: Agent, sp: SpeciesDef, dist: number): void;
  /** Index of the nearest unclaimed loose-metal object, or -1. */
  findSalvage(a: Agent, range: number): number;
  /** Writes a salvage position; false if it vanished. */
  salvagePos(index: number, out: THREE.Vector3): boolean;
  claimSalvage(a: Agent, index: number): boolean;
  releaseSalvage(a: Agent): void;
}

const _v = new THREE.Vector3();
const _to = new THREE.Vector3();
const _side = new THREE.Vector3();
const _sal = new THREE.Vector3();

/** Minimum time in a state before it may be re-evaluated away, seconds. */
const DWELL = [1.6, 1.2, 1.4, 0.55, 0.3, 2.4, 2.0];

/**
 * Cheap line-of-sight through the heightfield: five samples along the segment.
 * Underwater sight lines are short anyway, so this is plenty.
 */
function hasLineOfSight(a: Agent, env: SimEnv, dist: number): boolean {
  const steps = 5;
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const x = a.pos.x + (env.playerPos.x - a.pos.x) * f;
    const z = a.pos.z + (env.playerPos.z - a.pos.z) * f;
    const y = a.pos.y + (env.playerPos.y - a.pos.y) * f;
    if (y < env.world.heightAt(x, z)) return false;
  }
  void dist;
  return true;
}

export function steerPredator(
  a: Agent,
  sp: SpeciesDef,
  env: SimEnv,
  hooks: PredatorHooks,
): void {
  const dt = env.dt;
  const acc = a.accum.set(0, 0, 0);
  const bodyLen = sp.length * a.scale;
  const biteRange = bodyLen * 0.62 + 1.1;

  _to.subVectors(env.playerPos, a.pos);
  const dist = Math.max(0.05, _to.length());
  _to.multiplyScalar(1 / dist);

  /* ---------------- awareness ---------------- */
  let detect = 0;
  if (dist < sp.senseRange && hasLineOfSight(a, env, dist)) {
    const near = 1 - dist / sp.senseRange;
    const cue =
      0.3 +
      0.5 * env.playerNoise +
      0.35 * env.playerLight +
      (env.playerInVehicle ? 0.3 : 0);
    detect = near * near * cue * (0.55 + 0.9 * sp.aggression);
  }
  a.awareness = THREE.MathUtils.clamp(
    a.awareness + (detect * 2.2 - a.awareness * (a.state === ST_RETREAT ? 1.6 : 0.5)) * dt,
    0,
    1,
  );
  a.biteCd = Math.max(0, a.biteCd - dt);
  a.growlCd = Math.max(0, a.growlCd - dt);
  a.stateT += dt;

  /* ---------------- utility scoring ---------------- */
  const salvageIdx = sp.scavenger && a.carrying < 0 && a.awareness < 0.35
    ? hooks.findSalvage(a, 26)
    : -1;

  const u = [0, 0, 0, 0, 0, 0, 0];
  u[ST_PATROL] = 0.34 - a.awareness * 0.5;
  u[ST_INVESTIGATE] = a.awareness * 1.15 - 0.16 - (dist < sp.senseRange * 0.35 ? 0.35 : 0);
  u[ST_STALK] = a.awareness * 1.05 - 0.3 + (dist < sp.senseRange * 0.6 ? 0.25 : -0.2);
  u[ST_CHARGE] =
    a.awareness * 1.5 - 0.85 + (dist < sp.senseRange * 0.55 ? 0.4 : -0.5) + sp.aggression * 0.3;
  u[ST_BITE] = dist < biteRange * 1.35 && a.awareness > 0.4 && a.biteCd <= 0 ? 3 : -1;
  u[ST_RETREAT] = a.state === ST_BITE ? 2.5 : -1;
  u[ST_FETCH] = salvageIdx >= 0 ? 0.55 - a.awareness : a.carrying >= 0 ? 0.9 : -1;

  if (a.state === ST_RETREAT && a.stateT < 4 + a.hash * 3) u[ST_RETREAT] = 2.2;
  u[a.state] += 0.14;

  if (a.stateT >= DWELL[a.state]) {
    let best = a.state;
    for (let i = 0; i < u.length; i++) if (u[i] > u[best]) best = i;
    if (best !== a.state) {
      if (best === ST_FETCH && salvageIdx >= 0 && !hooks.claimSalvage(a, salvageIdx)) {
        best = a.state;
      }
      if (best !== a.state) {
        if ((best === ST_STALK || best === ST_CHARGE) && a.growlCd <= 0) {
          hooks.aggro(a, sp, dist);
          a.growlCd = 6;
        }
        if (a.state === ST_FETCH && best !== ST_FETCH) hooks.releaseSalvage(a);
        a.state = best;
        a.stateT = 0;
      }
    }
  }

  a.aggro = a.state === ST_CHARGE || a.state === ST_BITE ? 1 : a.state === ST_STALK ? 0.6 : 0;

  /* ---------------- act ---------------- */
  let speed = sp.cruise * 0.7;
  let turn = sp.turnRate;

  switch (a.state) {
    case ST_PATROL: {
      a.wanderT -= dt;
      if (a.wanderT <= 0) {
        a.wanderT = 6 + a.hash * 7;
        const ang = (a.hash * 12.9 + env.time * 0.11) % 6.283;
        const r = 18 + a.hash * 32;
        a.target.set(a.home.x + Math.cos(ang) * r, 0, a.home.z + Math.sin(ang) * r);
        a.target.y =
          env.world.heightAt(a.target.x, a.target.z) +
          THREE.MathUtils.lerp(sp.altitude[0], sp.altitude[1], 0.3 + a.hash * 0.4);
      }
      _v.subVectors(a.target, a.pos);
      if (_v.lengthSq() > 1) acc.addScaledVector(_v.normalize(), 1.1);
      acc.y += Math.sin(env.time * 0.31 + a.phase * 6.283) * 0.25;
      speed = sp.cruise * 0.72;
      turn = sp.turnRate * 0.7;
      break;
    }
    case ST_INVESTIGATE: {
      acc.addScaledVector(_to, 1.0);
      // Weave while closing — a straight approach reads as a homing missile.
      _side.set(-_to.z, 0, _to.x);
      acc.addScaledVector(_side, Math.sin(env.time * 0.9 + a.phase * 6.28) * 0.55);
      speed = sp.cruise;
      break;
    }
    case ST_STALK: {
      const ring = biteRange * 3.2 + 4;
      const radial = (dist - ring) / ring;
      acc.addScaledVector(_to, THREE.MathUtils.clamp(radial * 2.2, -1.4, 1.4));
      _side.set(-_to.z, 0, _to.x).normalize();
      acc.addScaledVector(_side, a.hash > 0.5 ? 1.15 : -1.15);
      acc.y += (env.playerPos.y - a.pos.y) * 0.06;
      speed = sp.cruise * 1.05;
      turn = sp.turnRate * 1.1;
      break;
    }
    case ST_CHARGE: {
      // Lead the player's movement slightly; makes the charge feel intentional.
      _v.copy(env.playerPos).addScaledVector(env.playerVel, 0.35).sub(a.pos).normalize();
      acc.addScaledVector(_v, 2.4);
      speed = sp.burst;
      turn = sp.turnRate * 1.5;
      break;
    }
    case ST_BITE: {
      acc.addScaledVector(_to, 2.0);
      speed = sp.burst * 0.75;
      turn = sp.turnRate * 2;
      if (dist < biteRange && a.biteCd <= 0) {
        a.biteCd = 2.4 + a.hash;
        hooks.bite(a, sp, _to);
        a.state = ST_RETREAT;
        a.stateT = 0;
      }
      break;
    }
    case ST_RETREAT: {
      acc.addScaledVector(_to, -1.8);
      acc.y += 0.4;
      speed = sp.burst * 0.6;
      turn = sp.turnRate * 1.2;
      break;
    }
    case ST_FETCH: {
      const idx = a.carrying >= 0 ? a.carrying : salvageIdx;
      if (idx >= 0 && hooks.salvagePos(idx, _sal)) {
        if (a.carrying >= 0) {
          // Carrying: haul it back toward the home territory, then drop it.
          _v.subVectors(a.home, a.pos);
          if (_v.lengthSq() > 4) acc.addScaledVector(_v.normalize(), 1.0);
          a.carryT -= dt;
          if (a.carryT <= 0) {
            hooks.releaseSalvage(a);
            a.state = ST_PATROL;
            a.stateT = 0;
          }
        } else {
          _v.subVectors(_sal, a.pos);
          const d = _v.length();
          if (d < biteRange * 0.9) {
            if (hooks.claimSalvage(a, idx)) a.carryT = 8 + a.hash * 8;
          } else if (d > 1e-4) {
            acc.addScaledVector(_v.multiplyScalar(1 / d), 1.5);
          }
        }
      } else {
        hooks.releaseSalvage(a);
        a.state = ST_PATROL;
        a.stateT = 0;
      }
      speed = sp.cruise * 0.9;
      break;
    }
    default:
      break;
  }

  // Startle from a light snapping on: a brief flinch away, then back to plan.
  if (a.startle > 0.01) {
    acc.addScaledVector(_to, -a.startle * 1.4);
    a.startle = Math.max(0, a.startle - dt * 0.8);
  }

  env.world.currentAt(a.pos.x, a.pos.y, a.pos.z, env.time, _v);
  acc.addScaledVector(_v, 0.25);
  altitudeSteer(a, env.world, sp.altitude[0], sp.altitude[1], env.surfaceY, 1.3);
  avoidTerrain(a, env.world, Math.max(3, bodyLen * 1.4), 1.8);

  integrate(a, speed, speed * 4.2, turn, dt);
}

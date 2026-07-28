/**
 * 3D positioning. The WebAudio listener is slaved to the camera transform every
 * frame, and world sounds get a `PannerNode` plus a distance-absorption filter
 * (high frequencies vanish over distance in water long before the level does).
 */
import * as THREE from 'three';
import type { QualityTier } from '../core/Types';
import { qualityAtLeast } from '../core/Types';
import { biquad, clamp, gain, Voice } from './Dsp';

/** Module-scope scratch — nothing in here allocates per frame. */
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

export type Vec3Like = readonly [number, number, number] | THREE.Vector3;

export interface PlaceOptions {
  /** Distance at which no attenuation is applied. */
  refDistance?: number;
  rolloff?: number;
  maxDistance?: number;
  /** Apply distance-dependent high-frequency absorption. Default true. */
  absorb?: boolean;
  /** Directional cone, for creature calls facing away. */
  cone?: { inner: number; outer: number; outerGain: number };
}

/** Speed of sound in seawater, m/s — used for far-away creature pre-delay. */
export const SPEED_OF_SOUND = 1500;

function readVec(v: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

export class Spatial {
  /** Last known listener position (world space, metres). */
  readonly listenerPos = new THREE.Vector3();

  private panning: PanningModelType = 'HRTF';

  constructor(
    private readonly ac: AudioContext,
    tier: QualityTier,
  ) {
    this.setTier(tier);
  }

  setTier(tier: QualityTier): void {
    // HRTF convolution per source is the single most expensive audio feature
    // available; equal-power is nearly free and still gives left/right.
    this.panning = qualityAtLeast(tier, 'high') ? 'HRTF' : 'equalpower';
  }

  /** Slave the listener to the camera. Called once per frame. */
  updateListener(camera: THREE.Camera): void {
    const l = this.ac.listener;
    camera.getWorldPosition(_pos);
    camera.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.listenerPos.copy(_pos);

    const t = this.ac.currentTime;
    if (l.positionX) {
      // Slight smoothing kills zipper noise when the camera shakes.
      l.positionX.setTargetAtTime(_pos.x, t, 0.02);
      l.positionY.setTargetAtTime(_pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(_pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(_fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(_fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(_fwd.z, t, 0.02);
      l.upX.setTargetAtTime(_up.x, t, 0.02);
      l.upY.setTargetAtTime(_up.y, t, 0.02);
      l.upZ.setTargetAtTime(_up.z, t, 0.02);
    } else {
      // Safari < 14 and friends.
      const legacy = l as AudioListener & {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
      };
      legacy.setPosition?.(_pos.x, _pos.y, _pos.z);
      legacy.setOrientation?.(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }
  }

  distanceTo(pos: Vec3Like): number {
    return readVec(pos, _pos).distanceTo(this.listenerPos);
  }

  /** Extra travel time for a distant sound, seconds. */
  propagationDelay(distance: number): number {
    return clamp(distance / SPEED_OF_SOUND, 0, 0.4);
  }

  /**
   * Builds the tail of a voice: `head -> [absorption] -> [panner] -> voice.out`
   * and returns the node the synth should connect into. Every node created is
   * owned by the voice, so it is torn down automatically.
   */
  place(v: Voice, pos?: Vec3Like, opts: PlaceOptions = {}): AudioNode {
    const head = v.add(gain(this.ac, 1));
    let node: AudioNode = head;

    if (pos) {
      const dist = this.distanceTo(pos);
      if (opts.absorb !== false) {
        // ~28 m e-folding distance: at 60 m a sound is already muffled, at
        // 150 m it is a distant thud with no detail left.
        const fc = 620 + 14000 * Math.exp(-dist / 30);
        const f = v.add(biquad(this.ac, 'lowpass', fc, 0.7));
        node.connect(f);
        node = f;
      }

      const p = v.add(this.ac.createPanner());
      p.panningModel = this.panning;
      p.distanceModel = 'exponential';
      p.refDistance = opts.refDistance ?? 3;
      p.rolloffFactor = opts.rolloff ?? 1.1;
      p.maxDistance = opts.maxDistance ?? 600;
      if (opts.cone) {
        p.coneInnerAngle = opts.cone.inner;
        p.coneOuterAngle = opts.cone.outer;
        p.coneOuterGain = opts.cone.outerGain;
      }
      readVec(pos, _pos);
      if (p.positionX) {
        p.positionX.value = _pos.x;
        p.positionY.value = _pos.y;
        p.positionZ.value = _pos.z;
      } else {
        (p as PannerNode & { setPosition?: (x: number, y: number, z: number) => void }).setPosition?.(
          _pos.x,
          _pos.y,
          _pos.z,
        );
      }
      node.connect(p);
      node = p;
    }

    node.connect(v.out);
    return head;
  }
}

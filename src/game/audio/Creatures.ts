/**
 * Creature vocalisations, driven by the `creature:aggro` bus event (and by
 * `audio:cue` ids of the form `creature.<species>`).
 *
 * A predator roar is built from four stacked layers — sub, growl-modulated
 * formant body, snarl distortion and a breath/noise tail — then filtered by
 * distance and pre-delayed by the real travel time of sound in seawater. Far
 * away it is a dark, ominous groan; at ten metres it is genuinely unpleasant.
 */
import * as THREE from 'three';
import type { AudioEnv } from './Env';
import { biquad, clamp, gain, NoiseBank, padEnv, percEnv, rand, softClipCurve } from './Dsp';

const _p = new THREE.Vector3();

interface Profile {
  /** Fundamental range, Hz. */
  f0: [number, number];
  /** Duration range, seconds. */
  dur: [number, number];
  /** Growl (amplitude modulation) rate, Hz. 0 disables. */
  growl: number;
  /** Formant centres — what makes a species recognisable. */
  formants: readonly number[];
  /** Distortion drive. */
  drive: number;
  /** Pitch bend factor over the call. */
  bend: [number, number];
  /** Sub-oscillator level. */
  sub: number;
  /** Breath-noise level. */
  breath: number;
  /** Overall gain. */
  level: number;
  /** Extra clicking/chattering grains. */
  chatter?: number;
}

const PROFILES: Record<string, Profile> = {
  // Apex predator. Long, loud, descending, with a hard 18 Hz growl.
  reaper: {
    f0: [46, 62],
    dur: [2.2, 3.4],
    growl: 17,
    formants: [190, 430, 980, 2100],
    drive: 1.5,
    bend: [1.35, 0.55],
    sub: 1,
    breath: 0.5,
    level: 1.25,
  },
  leviathan: {
    f0: [38, 54],
    dur: [2.6, 4.2],
    growl: 13,
    formants: [150, 360, 820, 1700],
    drive: 1.3,
    bend: [1.2, 0.5],
    sub: 1.15,
    breath: 0.55,
    level: 1.3,
  },
  ghostleviathan: {
    f0: [30, 44],
    dur: [3.2, 5.0],
    growl: 8,
    formants: [120, 300, 700, 1500],
    drive: 0.8,
    bend: [1.1, 0.62],
    sub: 1.2,
    breath: 0.7,
    level: 1.2,
  },
  stalker: {
    f0: [180, 300],
    dur: [0.7, 1.4],
    growl: 26,
    formants: [520, 1250, 2600, 4200],
    drive: 1.1,
    bend: [1.5, 0.8],
    sub: 0.25,
    breath: 0.35,
    level: 0.95,
    chatter: 6,
  },
  sandshark: {
    f0: [120, 190],
    dur: [0.9, 1.7],
    growl: 21,
    formants: [340, 780, 1600, 3100],
    drive: 1.2,
    bend: [1.25, 0.7],
    sub: 0.5,
    breath: 0.4,
    level: 1,
  },
  crabsquid: {
    f0: [64, 96],
    dur: [1.6, 2.8],
    growl: 6.5,
    formants: [210, 520, 1150, 2400],
    drive: 0.7,
    bend: [0.9, 1.25],
    sub: 0.8,
    breath: 0.3,
    level: 1.05,
    chatter: 10,
  },
  crabsnake: {
    f0: [150, 240],
    dur: [0.8, 1.5],
    growl: 32,
    formants: [600, 1400, 2900, 5200],
    drive: 1.4,
    bend: [1.4, 0.75],
    sub: 0.2,
    breath: 0.6,
    level: 0.9,
  },
  jellyray: {
    f0: [88, 140],
    dur: [1.2, 2.2],
    growl: 3.5,
    formants: [260, 600, 1300, 2600],
    drive: 0.3,
    bend: [1.05, 0.92],
    sub: 0.4,
    breath: 0.2,
    level: 0.6,
  },
  peeper: {
    f0: [420, 720],
    dur: [0.22, 0.5],
    growl: 0,
    formants: [900, 1900, 3400, 5600],
    drive: 0.2,
    bend: [1.6, 0.9],
    sub: 0,
    breath: 0.15,
    level: 0.5,
  },
  default: {
    f0: [90, 170],
    dur: [1.0, 1.9],
    growl: 14,
    formants: [300, 700, 1500, 3000],
    drive: 0.9,
    bend: [1.2, 0.8],
    sub: 0.5,
    breath: 0.35,
    level: 0.9,
  },
};

function profileFor(species: string): Profile {
  const s = species.toLowerCase().replace(/[^a-z]/g, '');
  if (PROFILES[s]) return PROFILES[s];
  for (const key of Object.keys(PROFILES)) {
    if (key !== 'default' && (s.includes(key) || key.includes(s))) return PROFILES[key];
  }
  if (/leviathan|reaper|ghost/.test(s)) return PROFILES.leviathan;
  return PROFILES.default;
}

export class Creatures {
  private rng: () => number;
  private lastRoar = new Map<string, number>();

  constructor(private readonly env: AudioEnv) {
    this.rng = env.rng;
  }

  /**
   * `creature:aggro` handler. `distance` is metres; when no world position is
   * known the call is placed on a random bearing at that distance so it still
   * localises.
   */
  aggro(species: string, distance: number, pos?: THREE.Vector3): void {
    const now = this.env.now();
    const key = species.toLowerCase();
    const last = this.lastRoar.get(key) ?? -99;
    // A creature does not roar twice in a second, no matter how the AI ticks.
    if (now - last < 1.4) return;
    this.lastRoar.set(key, now);
    this.roar(species, clamp(distance, 1, 400), pos);
  }

  /** The vocalisation itself. */
  roar(species: string, distance: number, pos?: THREE.Vector3): void {
    const env = this.env;
    const ac = env.ac;
    const rng = this.rng;
    const p = profileFor(species);

    // Place it: explicit position, else a random bearing at the given distance.
    let where: THREE.Vector3;
    if (pos) {
      where = _p.copy(pos);
    } else {
      const a = rng() * Math.PI * 2;
      where = _p.set(
        env.spatial.listenerPos.x + Math.cos(a) * distance,
        env.spatial.listenerPos.y + rand(rng, -0.25, 0.15) * distance,
        env.spatial.listenerPos.z + Math.sin(a) * distance,
      );
    }

    const h = env.head('sfx', {
      world: true,
      pos: where,
      // A leviathan announcing itself is never dropped for polyphony.
      priority: 2,
      place: { refDistance: 12, rolloff: 0.85, maxDistance: 1200 },
    });
    if (!h) return;
    const { v, out } = h;

    const t = env.now() + 0.02 + env.spatial.propagationDelay(distance);
    const dur = rand(rng, p.dur[0], p.dur[1]);
    const f0 = rand(rng, p.f0[0], p.f0[1]);
    const near = clamp(1 - distance / 90, 0, 1);

    // --- growl: amplitude modulation shared by every tonal layer ---
    const growlBus = v.add(gain(ac, 1));
    if (p.growl > 0) {
      const lfo = ac.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(p.growl * rand(rng, 0.85, 1.15), t);
      lfo.frequency.linearRampToValueAtTime(p.growl * rand(rng, 0.55, 0.9), t + dur);
      const amt = v.add(gain(ac, 0.42));
      lfo.connect(amt);
      amt.connect(growlBus.gain);
      v.play(lfo, t, t + dur + 1.5);
    }

    // --- body: two detuned saws through a formant bank, then soft clipping ---
    const shaper = v.add(ac.createWaveShaper());
    shaper.curve = softClipCurve(p.drive * (0.5 + 0.9 * near));
    shaper.oversample = '2x';
    const pre = v.add(gain(ac, 1.5));
    pre.connect(shaper);

    for (let i = 0; i < 2; i++) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * p.bend[0], t);
      o.frequency.exponentialRampToValueAtTime(Math.max(18, f0 * p.bend[1]), t + dur);
      o.detune.value = (i === 0 ? -1 : 1) * rand(rng, 8, 26);
      o.connect(pre);
      v.play(o, t, t + dur + 0.3);
    }

    const formantBus = v.add(gain(ac, 1));
    for (let i = 0; i < p.formants.length; i++) {
      const f = p.formants[i] * rand(rng, 0.93, 1.08);
      const bp = v.add(biquad(ac, 'bandpass', f, 4 + i * 1.5));
      // Formants drift as the mouth/siphon changes shape.
      bp.frequency.setValueAtTime(f, t);
      bp.frequency.linearRampToValueAtTime(f * rand(rng, 0.8, 1.25), t + dur);
      const g = v.add(gain(ac, 1 / (1 + i * 0.55)));
      shaper.connect(bp);
      bp.connect(g);
      g.connect(formantBus);
    }
    formantBus.connect(growlBus);

    // --- sub layer: the part you feel more than hear ---
    if (p.sub > 0) {
      const o = ac.createOscillator();
      o.type = 'sine';
      const sf = f0 * 0.5;
      o.frequency.setValueAtTime(sf * p.bend[0], t);
      o.frequency.exponentialRampToValueAtTime(Math.max(16, sf * p.bend[1] * 0.85), t + dur);
      const lp = v.add(biquad(ac, 'lowpass', 160, 0.9));
      const e = padEnv(ac, t, 0.38 * p.sub * p.level, dur * 0.12, dur * 0.4, dur * 0.6);
      o.connect(lp);
      lp.connect(e.node);
      e.node.connect(out);
      v.add(e.node);
      v.play(o, t, e.end);
    }

    // --- breath / cavitation noise ---
    if (p.breath > 0) {
      const src = env.noise.source('brown', rng, rand(rng, 0.8, 1.2));
      const bp = v.add(biquad(ac, 'bandpass', 400, 1.1));
      bp.frequency.setValueAtTime(rand(rng, 260, 420), t);
      bp.frequency.linearRampToValueAtTime(rand(rng, 700, 1500), t + dur * 0.6);
      bp.frequency.linearRampToValueAtTime(rand(rng, 200, 380), t + dur);
      const e = padEnv(ac, t, 0.3 * p.breath * p.level, dur * 0.2, dur * 0.3, dur * 0.7);
      src.connect(bp);
      bp.connect(e.node);
      e.node.connect(growlBus);
      v.add(e.node);
      v.play(src, t, e.end, NoiseBank.offsetOf(src));
    }

    // --- chatter grains (mandibles, siphons) ---
    if (p.chatter) {
      for (let i = 0; i < p.chatter; i++) {
        const ct = t + rand(rng, 0, dur * 0.9);
        const src = env.noise.source('white', rng, rand(rng, 0.7, 1.5));
        const bp = v.add(biquad(ac, 'bandpass', rand(rng, 1800, 5200), 7));
        const e = percEnv(ac, ct, rand(rng, 0.08, 0.22) * p.level, 0.002, rand(rng, 0.01, 0.035));
        src.connect(bp);
        bp.connect(e.node);
        e.node.connect(out);
        v.add(e.node);
        v.play(src, ct, e.end, NoiseBank.offsetOf(src));
      }
    }

    // --- main envelope: fast-ish attack, long tail ---
    const bodyEnv = padEnv(ac, t, 0.55 * p.level, dur * 0.14, dur * 0.45, dur * 0.75);
    growlBus.connect(bodyEnv.node);
    v.add(bodyEnv.node);

    // Distance tone shaping on top of the generic spatial absorption: a distant
    // leviathan is almost pure low-mid, a close one is full-band and nasty.
    const tone = v.add(biquad(ac, 'lowpass', 400 + 6200 * near, 0.8));
    const tilt = v.add(biquad(ac, 'highpass', 40 + 90 * (1 - near), 0.7));
    bodyEnv.node.connect(tone);
    tone.connect(tilt);
    tilt.connect(out);
  }

  dispose(): void {
    this.lastRoar.clear();
  }
}

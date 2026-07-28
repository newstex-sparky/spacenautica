/**
 * Procedural ambience beds.
 *
 * Each biome gets a continuous layer stack (filtered noise for water movement, a
 * brown-noise rumble bed, a faint tonal drone) plus a set of sparse event
 * generators (distant creature calls via FM and granular synthesis, bubble
 * streams, thermal-vent chuffs, groaning hull metal). Biome changes crossfade
 * two complete stacks over several seconds.
 *
 * All slow motion inside a bed is driven by LFO oscillator nodes wired straight
 * into filter/gain params, so the bed costs *zero* JavaScript per frame. The only
 * per-frame work is a look-ahead scheduler for the sparse events.
 */
import * as THREE from 'three';
import type { AudioEnv } from './Env';
import {
  biquad,
  clamp,
  gain,
  harmonicWave,
  NoiseBank,
  padEnv,
  percEnv,
  pick,
  rand,
  softClipCurve,
} from './Dsp';
import type { NoiseKind } from './Dsp';

const _p = new THREE.Vector3();

type CallKind = 'moan' | 'whale' | 'screech' | 'click' | 'thrum' | 'wail';

interface BedDef {
  /** Band-passed noise "water movement" layer. */
  swell: { kind: NoiseKind; freq: number; q: number; sweep: number; rate: number; gain: number };
  /** Low brown-noise pressure bed. */
  rumble: { freq: number; gain: number };
  /** Airy high band — current sizzle, sand hiss, distant surf. */
  hiss: { freq: number; gain: number };
  /** Faint sustained tone (bioluminescence, mineral resonance). Optional. */
  tone?: { freq: number; gain: number; detune: number };
  /** Events per second. */
  callRate: number;
  calls: readonly CallKind[];
  bubbleRate: number;
  ventRate: number;
  creakRate: number;
  /** Overall bed level. */
  level: number;
}

const DEFAULT_BED: BedDef = {
  swell: { kind: 'pink', freq: 340, q: 0.9, sweep: 180, rate: 0.06, gain: 0.16 },
  rumble: { freq: 110, gain: 0.2 },
  hiss: { freq: 2600, gain: 0.03 },
  callRate: 1 / 26,
  calls: ['moan', 'wail'],
  bubbleRate: 1 / 14,
  ventRate: 0,
  creakRate: 1 / 40,
  level: 1,
};

/**
 * Per-biome beds. Tuned so the depth progression is audible on its own: bright
 * and busy in the shallows, dark and sparse with big distant voices down deep.
 */
const BEDS: Record<string, Partial<BedDef>> = {
  shallows: {
    swell: { kind: 'pink', freq: 520, q: 0.7, sweep: 300, rate: 0.09, gain: 0.2 },
    rumble: { freq: 130, gain: 0.14 },
    hiss: { freq: 4200, gain: 0.055 },
    callRate: 1 / 12,
    calls: ['click', 'wail'],
    bubbleRate: 1 / 6,
    creakRate: 0,
    level: 1,
  },
  kelp_forest: {
    swell: { kind: 'pink', freq: 380, q: 1.1, sweep: 260, rate: 0.075, gain: 0.22 },
    rumble: { freq: 105, gain: 0.18 },
    hiss: { freq: 3200, gain: 0.05 },
    tone: { freq: 146.8, gain: 0.014, detune: 9 },
    callRate: 1 / 14,
    calls: ['moan', 'click', 'screech'],
    bubbleRate: 1 / 9,
    creakRate: 1 / 55,
    level: 1.02,
  },
  grassy_plateau: {
    swell: { kind: 'pink', freq: 300, q: 0.9, sweep: 200, rate: 0.055, gain: 0.19 },
    rumble: { freq: 96, gain: 0.2 },
    hiss: { freq: 2600, gain: 0.038 },
    callRate: 1 / 16,
    calls: ['moan', 'wail', 'click'],
    bubbleRate: 1 / 12,
    creakRate: 1 / 50,
    level: 1,
  },
  red_grass: {
    swell: { kind: 'pink', freq: 250, q: 1.0, sweep: 150, rate: 0.05, gain: 0.19 },
    rumble: { freq: 84, gain: 0.23 },
    hiss: { freq: 2100, gain: 0.03 },
    tone: { freq: 110, gain: 0.016, detune: 12 },
    callRate: 1 / 18,
    calls: ['moan', 'wail', 'thrum'],
    bubbleRate: 1 / 16,
    ventRate: 1 / 70,
    creakRate: 1 / 45,
    level: 1,
  },
  mushroom_forest: {
    swell: { kind: 'pink', freq: 210, q: 1.2, sweep: 120, rate: 0.042, gain: 0.18 },
    rumble: { freq: 76, gain: 0.24 },
    hiss: { freq: 1700, gain: 0.026 },
    tone: { freq: 98, gain: 0.02, detune: 14 },
    callRate: 1 / 15,
    calls: ['thrum', 'moan', 'whale'],
    bubbleRate: 1 / 13,
    ventRate: 1 / 90,
    creakRate: 1 / 40,
    level: 1.02,
  },
  blood_kelp: {
    swell: { kind: 'brown', freq: 170, q: 1.3, sweep: 90, rate: 0.035, gain: 0.2 },
    rumble: { freq: 62, gain: 0.3 },
    hiss: { freq: 1300, gain: 0.02 },
    tone: { freq: 87.3, gain: 0.024, detune: 17 },
    callRate: 1 / 11,
    calls: ['whale', 'thrum', 'moan'],
    bubbleRate: 1 / 8,
    ventRate: 1 / 60,
    creakRate: 1 / 30,
    level: 1.05,
  },
  lost_river: {
    swell: { kind: 'brown', freq: 140, q: 1.5, sweep: 70, rate: 0.028, gain: 0.21 },
    rumble: { freq: 52, gain: 0.34 },
    hiss: { freq: 1050, gain: 0.018 },
    tone: { freq: 73.4, gain: 0.028, detune: 21 },
    callRate: 1 / 9,
    calls: ['whale', 'moan', 'thrum'],
    bubbleRate: 1 / 10,
    ventRate: 1 / 40,
    creakRate: 1 / 26,
    level: 1.06,
  },
  lava_zone: {
    swell: { kind: 'brown', freq: 120, q: 1.4, sweep: 60, rate: 0.024, gain: 0.22 },
    rumble: { freq: 44, gain: 0.4 },
    hiss: { freq: 900, gain: 0.03 },
    tone: { freq: 65.4, gain: 0.03, detune: 24 },
    callRate: 1 / 14,
    calls: ['thrum', 'whale'],
    bubbleRate: 1 / 7,
    ventRate: 1 / 9,
    creakRate: 1 / 34,
    level: 1.1,
  },
};

function bedFor(id: string): BedDef {
  const p = BEDS[id];
  if (!p) return DEFAULT_BED;
  return { ...DEFAULT_BED, ...p };
}

/* ------------------------------------------------------------------ *
 * A single continuous bed
 * ------------------------------------------------------------------ */

/**
 * Global bed trim. The three noise layers plus their LFO modulation sum to close
 * to full scale on their own; measured against the event layer and the score,
 * beds want to sit ~20 dB down so a creature call or a hull groan still lands.
 */
const BED_TRIM = 0.4;

class BedVoice {
  readonly out: GainNode;
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  private dead = false;

  constructor(env: AudioEnv, readonly def: BedDef, rng: () => number) {
    const ac = env.ac;
    const t = ac.currentTime + 0.02;
    this.out = gain(ac, 0.0001);
    this.out.connect(env.mixer.input('ambience', true));

    const level = def.level * BED_TRIM;

    // --- water movement: band-passed noise with an LFO'd centre frequency ---
    this.noiseLayer(env, def.swell.kind, rng, (n) => {
      const bp = this.keep(biquad(ac, 'bandpass', def.swell.freq, def.swell.q));
      const lfo = this.osc(ac, 'sine', def.swell.rate, rng() * 4);
      const lfoAmt = this.keep(gain(ac, def.swell.sweep));
      lfo.connect(lfoAmt).connect(bp.frequency);
      // Slow amplitude swell so the bed breathes.
      const amp = this.keep(gain(ac, def.swell.gain * level));
      const alfo = this.osc(ac, 'sine', def.swell.rate * 0.61, rng() * 4);
      const aAmt = this.keep(gain(ac, def.swell.gain * level * 0.45));
      alfo.connect(aAmt).connect(amp.gain);
      n.connect(bp).connect(amp).connect(this.out);
    });

    // --- pressure rumble ---
    this.noiseLayer(env, 'brown', rng, (n) => {
      const lp = this.keep(biquad(ac, 'lowpass', def.rumble.freq, 0.8));
      const amp = this.keep(gain(ac, def.rumble.gain * level));
      const alfo = this.osc(ac, 'sine', rand(rng, 0.015, 0.05), rng() * 4);
      const aAmt = this.keep(gain(ac, def.rumble.gain * level * 0.4));
      alfo.connect(aAmt).connect(amp.gain);
      n.connect(lp).connect(amp).connect(this.out);
    });

    // --- airy high band ---
    this.noiseLayer(env, 'pink', rng, (n) => {
      const hp = this.keep(biquad(ac, 'highpass', def.hiss.freq, 0.5));
      const amp = this.keep(gain(ac, def.hiss.gain * level));
      const alfo = this.osc(ac, 'sine', rand(rng, 0.03, 0.09), rng() * 4);
      const aAmt = this.keep(gain(ac, def.hiss.gain * level * 0.6));
      alfo.connect(aAmt).connect(amp.gain);
      n.connect(hp).connect(amp).connect(this.out);
    });

    // --- optional tonal drone: two detuned partial stacks, very slow beating ---
    if (def.tone) {
      const wave = harmonicWave(ac, [1, 0.42, 0.18, 0.09, 0.04]);
      for (let i = 0; i < 2; i++) {
        const o = ac.createOscillator();
        o.setPeriodicWave(wave);
        o.frequency.value = def.tone.freq;
        o.detune.value = (i === 0 ? -1 : 1) * def.tone.detune;
        const lp = this.keep(biquad(ac, 'lowpass', def.tone.freq * 8, 0.8));
        const amp = this.keep(gain(ac, def.tone.gain * level));
        const alfo = this.osc(ac, 'sine', rand(rng, 0.008, 0.03), rng() * 4);
        const aAmt = this.keep(gain(ac, def.tone.gain * level * 0.7));
        alfo.connect(aAmt).connect(amp.gain);
        o.connect(lp).connect(amp).connect(this.out);
        o.start(t);
        this.srcs.push(o);
        this.nodes.push(o);
      }
    }

    this.out.gain.setValueAtTime(0.0001, t);
  }

  private keep<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private osc(ac: AudioContext, type: OscillatorType, freq: number, phaseOffset: number): OscillatorNode {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    // No phase control in WebAudio, so stagger start times instead.
    o.start(ac.currentTime + 0.02 + phaseOffset * 0.05);
    this.srcs.push(o);
    this.nodes.push(o);
    return o;
  }

  private noiseLayer(
    env: AudioEnv,
    kind: NoiseKind,
    rng: () => number,
    wire: (n: AudioBufferSourceNode) => void,
  ): void {
    const src = env.noise.source(kind, rng, rand(rng, 0.92, 1.08));
    this.srcs.push(src);
    this.nodes.push(src);
    wire(src);
    src.start(env.ac.currentTime + 0.02, NoiseBank.offsetOf(src));
  }

  fade(to: number, dur: number): void {
    const t = this.out.context.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, to), t + Math.max(0.01, dur));
  }

  release(): void {
    if (this.dead) return;
    this.dead = true;
    const t = this.out.context.currentTime;
    for (const s of this.srcs) {
      try {
        s.stop(t + 0.02);
      } catch {
        /* never started */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* detached */
      }
    }
    this.out.disconnect();
    this.nodes.length = 0;
    this.srcs.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Sparse event synthesis
 * ------------------------------------------------------------------ */

/** Random world point around the listener, biased to the horizontal plane. */
function nearbyPoint(env: AudioEnv, rng: () => number, min: number, max: number): THREE.Vector3 {
  const a = rng() * Math.PI * 2;
  const d = rand(rng, min, max);
  const y = rand(rng, -0.35, 0.25) * d;
  return _p.set(
    env.spatial.listenerPos.x + Math.cos(a) * d,
    env.spatial.listenerPos.y + y,
    env.spatial.listenerPos.z + Math.sin(a) * d,
  );
}

/**
 * Distant creature call. FM for the sustained kinds, true granular scheduling
 * for clicks and thrums.
 */
export function creatureCall(env: AudioEnv, at: number, kind: CallKind, rng: () => number, level = 1): void {
  const pos = nearbyPoint(env, rng, 25, 130);
  const dist = env.spatial.distanceTo(pos);
  const h = env.head('ambience', {
    pos,
    priority: 0,
    place: { refDistance: 10, rolloff: 0.75, maxDistance: 900 },
  });
  if (!h) return;
  const { v, out } = h;
  const ac = env.ac;
  const t = at + env.spatial.propagationDelay(dist);

  if (kind === 'click' || kind === 'thrum') {
    // --- granular: a burst of short grains read from the noise bank ---
    const grains = kind === 'click' ? Math.round(rand(rng, 4, 11)) : Math.round(rand(rng, 14, 26));
    const spacing = kind === 'click' ? rand(rng, 0.045, 0.13) : rand(rng, 0.055, 0.1);
    const baseF = kind === 'click' ? rand(rng, 1400, 3600) : rand(rng, 90, 260);
    const bp = v.add(biquad(ac, 'bandpass', baseF, kind === 'click' ? 6 : 3.5));
    const body = v.add(gain(ac, 1));
    bp.connect(body);
    body.connect(out);
    for (let i = 0; i < grains; i++) {
      const gt = t + i * spacing * rand(rng, 0.8, 1.2);
      const dur = kind === 'click' ? rand(rng, 0.008, 0.02) : rand(rng, 0.05, 0.12);
      const src = env.noise.source(kind === 'click' ? 'white' : 'brown', rng, rand(rng, 0.7, 1.4));
      const e = percEnv(ac, gt, rand(rng, 0.25, 0.75) * level * (1 - i / (grains * 1.6)), 0.004, dur);
      src.connect(e.node);
      e.node.connect(bp);
      v.add(e.node);
      v.play(src, gt, e.end, NoiseBank.offsetOf(src));
    }
    // Thrums also carry a low pulsing tone under the grains.
    if (kind === 'thrum') {
      const o = ac.createOscillator();
      o.type = 'sine';
      const f0 = baseF * 0.5;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * rand(rng, 0.8, 1.25), t + grains * spacing);
      const e = padEnv(ac, t, 0.3 * level, 0.5, grains * spacing * 0.6, 1.4);
      o.connect(e.node);
      e.node.connect(out);
      v.add(e.node);
      v.play(o, t, e.end);
    }
    return;
  }

  // --- FM voices ---
  const spec: Record<'moan' | 'whale' | 'screech' | 'wail', {
    f: [number, number];
    ratio: [number, number];
    index: [number, number];
    dur: [number, number];
    bend: [number, number];
    vib: number;
    lp: number;
  }> = {
    moan: { f: [58, 120], ratio: [1.5, 2.5], index: [1.2, 3.4], dur: [1.6, 3.2], bend: [0.78, 1.06], vib: 3.2, lp: 900 },
    whale: { f: [42, 84], ratio: [1.01, 1.5], index: [2, 5.5], dur: [2.6, 5.5], bend: [1.05, 1.9], vib: 1.4, lp: 700 },
    screech: { f: [280, 620], ratio: [2.4, 4.2], index: [1.5, 4], dur: [0.5, 1.3], bend: [0.6, 1.5], vib: 9, lp: 3200 },
    wail: { f: [140, 300], ratio: [1.4, 2.05], index: [1, 2.8], dur: [1.1, 2.4], bend: [0.85, 1.35], vib: 5, lp: 1800 },
  };
  const s = spec[kind];
  const f0 = rand(rng, s.f[0], s.f[1]);
  const dur = rand(rng, s.dur[0], s.dur[1]);
  const bend = rand(rng, s.bend[0], s.bend[1]);

  const carrier = ac.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(f0, t);
  carrier.frequency.exponentialRampToValueAtTime(Math.max(20, f0 * bend), t + dur);

  const mod = ac.createOscillator();
  mod.type = 'sine';
  const ratio = rand(rng, s.ratio[0], s.ratio[1]);
  mod.frequency.setValueAtTime(f0 * ratio, t);
  mod.frequency.exponentialRampToValueAtTime(Math.max(20, f0 * ratio * bend), t + dur);

  const index = v.add(gain(ac, 0));
  const idx = rand(rng, s.index[0], s.index[1]) * f0;
  index.gain.setValueAtTime(idx * 0.15, t);
  index.gain.linearRampToValueAtTime(idx, t + dur * 0.35);
  index.gain.linearRampToValueAtTime(idx * 0.25, t + dur);
  mod.connect(index);
  index.connect(carrier.frequency);

  // Vibrato — the thing that separates a living voice from a test tone.
  const vib = ac.createOscillator();
  vib.type = 'sine';
  vib.frequency.value = s.vib * rand(rng, 0.7, 1.4);
  const vibAmt = v.add(gain(ac, f0 * 0.035));
  vib.connect(vibAmt);
  vibAmt.connect(carrier.frequency);

  const lp = v.add(biquad(ac, 'lowpass', s.lp, 0.9));
  const e = padEnv(ac, t, rand(rng, 0.22, 0.44) * level, dur * 0.3, dur * 0.35, dur * 0.7);
  v.add(e.node);
  carrier.connect(lp);
  lp.connect(e.node);
  e.node.connect(out);

  v.play(carrier, t, e.end);
  v.play(mod, t, e.end);
  v.play(vib, t, e.end);
}

/** A rising stream of bubbles. Each bubble is a sine with an upward pitch glide. */
export function bubbleStream(env: AudioEnv, at: number, rng: () => number, level = 1, pos?: THREE.Vector3): void {
  const p = pos ?? nearbyPoint(env, rng, 3, 26);
  const h = env.head('ambience', { pos: p, priority: 0, place: { refDistance: 2.5, rolloff: 1.3 } });
  if (!h) return;
  const { v, out } = h;
  const ac = env.ac;
  const count = Math.round(rand(rng, 7, 20));
  const spread = rand(rng, 0.5, 2.4);

  const lp = v.add(biquad(ac, 'lowpass', 6000, 0.7));
  lp.connect(out);

  for (let i = 0; i < count; i++) {
    const bt = at + rng() * spread;
    const f0 = rand(rng, 380, 2100);
    const dur = rand(rng, 0.03, 0.085);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, bt);
    // Bubbles rise in pitch as they shrink — the entire character of the sound.
    o.frequency.exponentialRampToValueAtTime(f0 * rand(rng, 1.35, 2.1), bt + dur);
    const e = percEnv(ac, bt, rand(rng, 0.1, 0.32) * level, 0.002, dur);
    o.connect(e.node);
    e.node.connect(lp);
    v.add(e.node);
    v.play(o, bt, e.end);
  }

  // Fizz: the broadband hiss of the whole column.
  const fizz = env.noise.source('white', rng, 1);
  const bp = v.add(biquad(ac, 'bandpass', rand(rng, 1800, 4200), 1.2));
  const fe = percEnv(ac, at, 0.05 * level, 0.12, spread * 0.9);
  fizz.connect(bp);
  bp.connect(fe.node);
  fe.node.connect(out);
  v.add(fe.node);
  v.play(fizz, at, fe.end, NoiseBank.offsetOf(fizz));
}

/** Thermal vent: sub-bass rumble, steam hiss, and periodic chuffs. */
export function ventRumble(env: AudioEnv, at: number, rng: () => number, level = 1): void {
  const pos = nearbyPoint(env, rng, 8, 60);
  const h = env.head('ambience', { pos, priority: 0, place: { refDistance: 6, rolloff: 1.0 } });
  if (!h) return;
  const { v, out } = h;
  const ac = env.ac;
  const dur = rand(rng, 2.2, 5.5);

  const rumble = env.noise.source('brown', rng, rand(rng, 0.7, 1.1));
  const lp = v.add(biquad(ac, 'lowpass', rand(rng, 90, 170), 1.1));
  const re = padEnv(ac, at, 0.34 * level, 0.8, dur * 0.5, dur * 0.6);
  rumble.connect(lp);
  lp.connect(re.node);
  re.node.connect(out);
  v.add(re.node);
  v.play(rumble, at, re.end, NoiseBank.offsetOf(rumble));

  const steam = env.noise.source('white', rng, 1);
  const bp = v.add(biquad(ac, 'bandpass', rand(rng, 2400, 5200), 0.9));
  const se = padEnv(ac, at + 0.2, 0.09 * level, 0.5, dur * 0.4, dur * 0.5);
  steam.connect(bp);
  bp.connect(se.node);
  se.node.connect(out);
  v.add(se.node);
  v.play(steam, at + 0.2, se.end, NoiseBank.offsetOf(steam));

  const chuffs = Math.round(rand(rng, 2, 6));
  for (let i = 0; i < chuffs; i++) {
    const ct = at + rand(rng, 0.1, dur * 0.8);
    const src = env.noise.source('pink', rng, rand(rng, 0.8, 1.3));
    const cbp = v.add(biquad(ac, 'bandpass', rand(rng, 220, 520), 2.2));
    const ce = percEnv(ac, ct, rand(rng, 0.14, 0.34) * level, 0.02, rand(rng, 0.18, 0.45));
    src.connect(cbp);
    cbp.connect(ce.node);
    ce.node.connect(out);
    v.add(ce.node);
    v.play(src, ct, ce.end, NoiseBank.offsetOf(src));
  }
}

/** Groaning hull metal: drifting low sawtooth through metal modes, plus a creak. */
export function hullGroan(env: AudioEnv, at: number, rng: () => number, level = 1): void {
  const pos = nearbyPoint(env, rng, 4, 34);
  const h = env.head('ambience', { pos, priority: 0, place: { refDistance: 4, rolloff: 1.2 } });
  if (!h) return;
  const { v, out } = h;
  const ac = env.ac;
  const dur = rand(rng, 1.8, 4.2);

  const o = ac.createOscillator();
  o.type = 'sawtooth';
  const f0 = rand(rng, 38, 92);
  o.frequency.setValueAtTime(f0, at);
  o.frequency.linearRampToValueAtTime(f0 * rand(rng, 1.02, 1.12), at + dur * 0.7);
  o.frequency.linearRampToValueAtTime(f0 * rand(rng, 0.94, 1.0), at + dur);

  const shaper = v.add(ac.createWaveShaper());
  shaper.curve = softClipCurve(0.5);
  const preGain = v.add(gain(ac, 1.6));
  o.connect(preGain);
  preGain.connect(shaper);

  // Three plate resonances give it "big sheet of stressed steel".
  const bus = v.add(gain(ac, 1));
  for (const [f, q, g] of [
    [rand(rng, 150, 220), 11, 5],
    [rand(rng, 380, 520), 14, 4],
    [rand(rng, 950, 1350), 9, 3],
  ] as const) {
    const pk = v.add(biquad(ac, 'peaking', f, q, g));
    shaper.connect(pk);
    pk.connect(bus);
  }
  const lp = v.add(biquad(ac, 'lowpass', 2200, 0.8));
  const e = padEnv(ac, at, 0.3 * level, dur * 0.3, dur * 0.2, dur * 0.6);
  bus.connect(lp);
  lp.connect(e.node);
  e.node.connect(out);
  v.add(e.node);
  v.play(o, at, e.end);

  // Stick-slip creak: noise through an extremely resonant, gliding band-pass.
  if (rng() < 0.7) {
    const ct = at + rand(rng, 0.1, dur * 0.5);
    const cdur = rand(rng, 0.35, 1.2);
    const src = env.noise.source('white', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', 700, 26));
    bp.frequency.setValueAtTime(rand(rng, 500, 900), ct);
    bp.frequency.linearRampToValueAtTime(rand(rng, 1100, 1900), ct + cdur);
    const trem = ac.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = rand(rng, 14, 34);
    const tremAmt = v.add(gain(ac, 0.5));
    const ce = percEnv(ac, ct, 0.22 * level, 0.05, cdur);
    trem.connect(tremAmt);
    tremAmt.connect(ce.node.gain);
    src.connect(bp);
    bp.connect(ce.node);
    ce.node.connect(out);
    v.add(ce.node);
    v.play(src, ct, ce.end, NoiseBank.offsetOf(src));
    v.play(trem, ct, ce.end);
  }
}

/* ------------------------------------------------------------------ *
 * The ambience manager
 * ------------------------------------------------------------------ */

const LOOKAHEAD = 1.6;

export class Ambience {
  private current: BedVoice | null = null;
  private currentId = '';
  private dying: Array<{ bed: BedVoice; at: number }> = [];
  private next = { call: 0, bubble: 0, vent: 0, creak: 0 };
  private surf: BedVoice | null = null;
  private surfGainTarget = 0;
  private rng: () => number;

  constructor(private readonly env: AudioEnv) {
    this.rng = env.rng;
  }

  start(biome: string): void {
    this.setBiome(biome || 'shallows', 0.8);
    // A permanent surface layer: wave wash heard from below, dominant above.
    this.surf = new BedVoice(
      this.env,
      {
        ...DEFAULT_BED,
        swell: { kind: 'white', freq: 900, q: 0.5, sweep: 600, rate: 0.11, gain: 0.26 },
        rumble: { freq: 200, gain: 0.1 },
        hiss: { freq: 5200, gain: 0.09 },
        tone: undefined,
        level: 1,
      },
      this.rng,
    );
    this.surf.fade(0.15, 1.5);
  }

  setBiome(id: string, crossfade = 5): void {
    if (!id || id === this.currentId) return;
    this.currentId = id;
    const bed = new BedVoice(this.env, bedFor(id), this.rng);
    bed.fade(1, crossfade);
    if (this.current) {
      const old = this.current;
      old.fade(0, crossfade);
      // Only ever one bed dying at a time; anything older goes immediately.
      for (const d of this.dying) d.bed.release();
      this.dying.length = 0;
      this.dying.push({ bed: old, at: this.env.now() + crossfade + 0.25 });
    }
    this.current = bed;
    // Re-roll event timers so a new biome speaks up promptly.
    const t = this.env.now();
    this.next.call = t + rand(this.rng, 1.5, 6);
    this.next.bubble = t + rand(this.rng, 0.5, 4);
    this.next.vent = t + rand(this.rng, 2, 12);
    this.next.creak = t + rand(this.rng, 3, 14);
  }

  update(_dt: number): void {
    const env = this.env;
    const t = env.now();
    const s = env.state;
    const def = this.current?.def ?? DEFAULT_BED;

    // Reap finished crossfades.
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (t >= this.dying[i].at) {
        this.dying[i].bed.release();
        this.dying.splice(i, 1);
      }
    }

    // Surface wash: loud in air, audible near the surface, gone by 25 m.
    const target = s.underwater ? 0.42 * Math.exp(-s.depth / 11) + 0.02 : 0.85;
    if (Math.abs(target - this.surfGainTarget) > 0.01) {
      this.surfGainTarget = target;
      this.surf?.fade(target, 0.7);
    }

    // Density scaling: the low tier keeps the beds but thins the event layer.
    const density = env.tier === 'low' ? 0.45 : env.tier === 'medium' ? 0.75 : 1;
    const quiet = s.inVehicle ? 0.5 : 1;

    // --- look-ahead scheduling ---
    const horizon = t + LOOKAHEAD;
    let guard = 0;
    while (this.next.call < horizon && guard++ < 8) {
      const rate = def.callRate * density;
      if (rate > 0 && s.underwater) {
        creatureCall(env, Math.max(t, this.next.call), pick(this.rng, def.calls), this.rng, 0.9 * quiet);
      }
      this.next.call = Math.max(t, this.next.call) + this.poisson(rate);
    }
    guard = 0;
    while (this.next.bubble < horizon && guard++ < 8) {
      const rate = def.bubbleRate * density;
      if (rate > 0 && s.underwater) bubbleStream(env, Math.max(t, this.next.bubble), this.rng, 0.75 * quiet);
      this.next.bubble = Math.max(t, this.next.bubble) + this.poisson(rate);
    }
    guard = 0;
    while (this.next.vent < horizon && guard++ < 4) {
      const rate = def.ventRate * density;
      if (rate > 0 && s.underwater) ventRumble(env, Math.max(t, this.next.vent), this.rng, 0.9 * quiet);
      this.next.vent = Math.max(t, this.next.vent) + this.poisson(rate);
    }
    guard = 0;
    while (this.next.creak < horizon && guard++ < 4) {
      // Hull metal only speaks when there is metal around: enclosure (inside a
      // wreck/base) raises the rate hard, open water keeps it rare.
      const rate = def.creakRate * density * (0.35 + 2.6 * clamp(s.enclosure, 0, 1));
      if (rate > 0) hullGroan(env, Math.max(t, this.next.creak), this.rng, 0.8 + 0.4 * s.enclosure);
      this.next.creak = Math.max(t, this.next.creak) + this.poisson(rate);
    }
  }

  /** Exponentially-distributed gap so events never sound metronomic. */
  private poisson(rate: number): number {
    if (rate <= 0) return 30;
    const u = Math.max(1e-4, this.rng());
    return clamp(-Math.log(u) / rate, 0.35, 240);
  }

  /** One-shot bubble burst other systems can request (e.g. player exhale). */
  bubblesAt(pos: THREE.Vector3, level = 1): void {
    bubbleStream(this.env, this.env.now(), this.rng, level, pos);
  }

  dispose(): void {
    this.current?.release();
    this.surf?.release();
    for (const d of this.dying) d.bed.release();
    this.dying.length = 0;
    this.current = null;
    this.surf = null;
  }
}

export type { CallKind };

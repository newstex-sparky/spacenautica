/**
 * Generative ambient score.
 *
 * Three permanent layers plus two generators:
 *   drone    – detuned low partial stacks that glide to a new root when the
 *              biome changes (never re-triggered, so the score never restarts)
 *   pads     – 20–35 s chords from stacks of slightly-detuned oscillators with
 *              5–9 s attacks and slow filter motion
 *   plucks   – sparse additive-synthesis notes (per-partial decay, slight
 *              inharmonicity) drowned in reverb
 *   tension  – a dissonant cluster + noise riser that fades in on aggro
 *
 * Everything is fed by a procedurally generated hall impulse response. The
 * design rules that keep it out of chiptune territory: no note shorter than
 * ~1.5 s, attacks measured in seconds, no fixed tempo grid, and every pitch
 * choice drawn from a per-biome mode rather than a chromatic scale.
 */
import type { QualityTier } from '../core/Types';
import type { AudioEnv } from './Env';
import {
  biquad,
  clamp,
  gain,
  harmonicWave,
  makeIR,
  midiToFreq,
  NoiseBank,
  padEnv,
  percEnv,
  rand,
  Voice,
} from './Dsp';

interface ModeDef {
  /** MIDI root of the mode. */
  root: number;
  /** Semitone offsets. */
  scale: readonly number[];
  /** Pad density multiplier. */
  density: number;
  /** Brightness of the pad filter, Hz. */
  bright: number;
}

/** Keyed by both biome id and `BiomeDef.music`, so either works. */
const MODES: Record<string, ModeDef> = {
  shallows: { root: 62, scale: [0, 2, 4, 7, 9, 11], density: 1, bright: 1500 },
  kelp: { root: 57, scale: [0, 2, 3, 5, 7, 9, 10], density: 0.95, bright: 1250 },
  kelp_forest: { root: 57, scale: [0, 2, 3, 5, 7, 9, 10], density: 0.95, bright: 1250 },
  plateau: { root: 55, scale: [0, 2, 4, 5, 7, 9, 10], density: 0.9, bright: 1150 },
  grassy_plateau: { root: 55, scale: [0, 2, 4, 5, 7, 9, 10], density: 0.9, bright: 1150 },
  reef: { root: 52, scale: [0, 2, 3, 5, 7, 8, 10], density: 0.85, bright: 980 },
  red_grass: { root: 52, scale: [0, 2, 3, 5, 7, 8, 10], density: 0.85, bright: 980 },
  mushroom: { root: 60, scale: [0, 2, 4, 6, 7, 9, 11], density: 0.9, bright: 1100 },
  mushroom_forest: { root: 60, scale: [0, 2, 4, 6, 7, 9, 11], density: 0.9, bright: 1100 },
  bloodkelp: { root: 54, scale: [0, 1, 3, 5, 7, 8, 10], density: 0.7, bright: 760 },
  blood_kelp: { root: 54, scale: [0, 1, 3, 5, 7, 8, 10], density: 0.7, bright: 760 },
  lostriver: { root: 50, scale: [0, 2, 3, 5, 7, 8, 11], density: 0.6, bright: 640 },
  lost_river: { root: 50, scale: [0, 2, 3, 5, 7, 8, 11], density: 0.6, bright: 640 },
  lava: { root: 53, scale: [0, 1, 3, 4, 6, 8, 10], density: 0.55, bright: 560 },
  lava_zone: { root: 53, scale: [0, 1, 3, 4, 6, 8, 10], density: 0.55, bright: 560 },
};

const DEFAULT_MODE: ModeDef = MODES.shallows;

const IR_SECONDS: Record<QualityTier, number> = { low: 1.4, medium: 2.4, high: 3.4, ultra: 4.4 };

export class Music {
  /** Everything the score produces passes through here. */
  private readonly out: GainNode;
  private readonly duckNode: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly dry: GainNode;
  private readonly send: GainNode;
  private readonly conv: ConvolverNode;
  private readonly revTone: BiquadFilterNode;

  private mode: ModeDef = DEFAULT_MODE;
  private rng: () => number;

  private droneOscs: OscillatorNode[] = [];
  private droneNodes: AudioNode[] = [];
  private droneVoice: Voice | null = null;

  private tensionGain: GainNode | null = null;
  private tensionVoice: Voice | null = null;
  private tensionOscs: OscillatorNode[] = [];
  private tensionLevel = 0;

  private pads: Array<{ v: Voice; until: number }> = [];
  private nextPad = 0;
  private nextPluck = 0;
  private tier: QualityTier;

  constructor(private readonly env: AudioEnv) {
    const ac = env.ac;
    this.rng = env.rng;
    this.tier = env.tier;

    this.out = gain(ac, 1);
    this.tone = biquad(ac, 'lowpass', 2600, 0.7);
    this.duckNode = gain(ac, 1);
    this.dry = gain(ac, 0.72);
    this.send = gain(ac, 0.85);
    this.conv = ac.createConvolver();
    this.conv.normalize = true;
    this.conv.buffer = makeIR(ac, { kind: 'hall', seconds: IR_SECONDS[this.tier], rng: this.rng });
    this.revTone = biquad(ac, 'lowpass', 4200, 0.7);

    // Music is deliberately *not* routed through the underwater chain: the score
    // is non-diegetic. Depth colours it through `tone` instead.
    const busIn = env.mixer.input('music', false);
    this.out.connect(this.tone);
    this.tone.connect(this.duckNode);
    this.duckNode.connect(this.dry);
    this.dry.connect(busIn);
    this.duckNode.connect(this.send);
    this.send.connect(this.conv);
    this.conv.connect(this.revTone);
    this.revTone.connect(busIn);
  }

  start(biomeOrMusic: string): void {
    this.mode = MODES[biomeOrMusic] ?? DEFAULT_MODE;
    this.buildDrone();
    this.buildTension();
    const t = this.env.now();
    this.nextPad = t + rand(this.rng, 1.5, 5);
    this.nextPluck = t + rand(this.rng, 6, 18);
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.conv.buffer = makeIR(this.env.ac, { kind: 'hall', seconds: IR_SECONDS[tier], rng: this.rng });
  }

  /** Biome change: glide the drone, re-key the generators. No restart. */
  setBiome(biomeOrMusic: string): void {
    const m = MODES[biomeOrMusic];
    if (!m || m === this.mode) return;
    this.mode = m;
    this.retuneDrone(8);
    this.retuneTension();
  }

  /* ---------------------------------------------------------------- *
   * Layers
   * ---------------------------------------------------------------- */

  private buildDrone(): void {
    const env = this.env;
    const ac = env.ac;
    const t = env.now() + 0.05;
    const v = new Voice(ac, this.out);
    this.droneVoice = v;
    const wave = harmonicWave(ac, [1, 0.5, 0.22, 0.1, 0.05, 0.02]);

    const lp = v.add(biquad(ac, 'lowpass', 420, 1.2));
    const master = v.add(gain(ac, 0.0001));
    master.gain.setValueAtTime(0.0001, t);
    master.gain.linearRampToValueAtTime(0.3, t + 12);
    lp.connect(master);
    master.connect(this.out);
    this.droneNodes.push(lp, master);

    // Very slow filter motion — the reason the drone never feels static.
    const flfo = ac.createOscillator();
    flfo.type = 'sine';
    flfo.frequency.value = 0.017;
    const fAmt = v.add(gain(ac, 180));
    flfo.connect(fAmt);
    fAmt.connect(lp.frequency);
    v.play(flfo, t, t + 1e6);

    const offsets = [-24, -12, -12 + 7, -5];
    for (let i = 0; i < offsets.length; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = midiToFreq(this.mode.root + offsets[i]);
      o.detune.value = rand(this.rng, -9, 9);
      const g = v.add(gain(ac, 0.34 / (1 + i * 0.5)));
      // Independent amplitude drift per partial stack = slow beating.
      const alfo = ac.createOscillator();
      alfo.type = 'sine';
      alfo.frequency.value = rand(this.rng, 0.01, 0.045);
      const aAmt = v.add(gain(ac, 0.18 / (1 + i * 0.5)));
      alfo.connect(aAmt);
      aAmt.connect(g.gain);
      o.connect(g);
      g.connect(lp);
      v.play(o, t, t + 1e6);
      v.play(alfo, t, t + 1e6);
      this.droneOscs.push(o);
    }

    // A breath of noise under it all so the low end is not purely synthetic.
    const src = env.noise.source('brown', this.rng, 0.85);
    const nlp = v.add(biquad(ac, 'lowpass', 190, 0.9));
    const ng = v.add(gain(ac, 0.05));
    src.connect(nlp);
    nlp.connect(ng);
    ng.connect(this.out);
    v.play(src, t, t + 1e6, NoiseBank.offsetOf(src));
  }

  private retuneDrone(seconds: number): void {
    const t = this.env.now();
    const offsets = [-24, -12, -12 + 7, -5];
    for (let i = 0; i < this.droneOscs.length; i++) {
      const f = midiToFreq(this.mode.root + offsets[i % offsets.length]);
      const p = this.droneOscs[i].frequency;
      p.cancelScheduledValues(t);
      p.setValueAtTime(Math.max(8, p.value), t);
      p.exponentialRampToValueAtTime(f, t + seconds);
    }
  }

  private buildTension(): void {
    const ac = this.env.ac;
    const t = this.env.now() + 0.05;
    const v = new Voice(ac, this.out);
    this.tensionVoice = v;
    const g = v.add(gain(ac, 0.0001));
    this.tensionGain = g;
    g.connect(this.out);

    // Dissonant cluster: root, minor 2nd, tritone. Tremolo'd, band-limited.
    const bp = v.add(biquad(ac, 'bandpass', 420, 1.1));
    bp.connect(g);
    const trem = ac.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = 5.2;
    const tremAmt = v.add(gain(ac, 0.35));
    const tremBus = v.add(gain(ac, 0.65));
    trem.connect(tremAmt);
    tremAmt.connect(tremBus.gain);
    tremBus.connect(bp);
    v.play(trem, t, t + 1e6);

    for (const semi of [0, 1, 6]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToFreq(this.mode.root - 12 + semi);
      o.detune.value = rand(this.rng, -14, 14);
      const og = v.add(gain(ac, 0.2));
      o.connect(og);
      og.connect(tremBus);
      v.play(o, t, t + 1e6);
      this.tensionOscs.push(o);
    }

    // Noise riser adds air and menace without any tonal content.
    const src = this.env.noise.source('pink', this.rng, 1);
    const hp = v.add(biquad(ac, 'highpass', 900, 0.7));
    const ng = v.add(gain(ac, 0.1));
    src.connect(hp);
    hp.connect(ng);
    ng.connect(g);
    v.play(src, t, t + 1e6, NoiseBank.offsetOf(src));
  }

  private retuneTension(): void {
    const t = this.env.now();
    const semis = [0, 1, 6];
    for (let i = 0; i < this.tensionOscs.length; i++) {
      const f = midiToFreq(this.mode.root - 12 + semis[i % semis.length]);
      const p = this.tensionOscs[i].frequency;
      p.cancelScheduledValues(t);
      p.setValueAtTime(Math.max(8, p.value), t);
      p.exponentialRampToValueAtTime(f, t + 6);
    }
  }

  /* ---------------------------------------------------------------- *
   * Generators
   * ---------------------------------------------------------------- */

  private spawnPad(at: number): void {
    if (this.pads.length >= 3) return;
    const env = this.env;
    const ac = env.ac;
    const rng = this.rng;
    const v = new Voice(ac, this.out);

    const dur = rand(rng, 16, 30);
    const attack = rand(rng, 5, 9);
    const release = rand(rng, 7, 12);
    const octave = pickOctave(rng);
    const scale = this.mode.scale;

    // Chord: root plus two to three colour tones from the mode.
    const degrees = [0];
    while (degrees.length < 3 + (rng() < 0.4 ? 1 : 0)) {
      const d = Math.floor(rng() * scale.length);
      if (!degrees.includes(d)) degrees.push(d);
    }

    const lp = v.add(biquad(ac, 'lowpass', this.mode.bright * 0.5, 1.4));
    lp.frequency.setValueAtTime(this.mode.bright * 0.42, at);
    lp.frequency.linearRampToValueAtTime(this.mode.bright * rand(rng, 0.9, 1.35), at + dur * 0.6);
    lp.frequency.linearRampToValueAtTime(this.mode.bright * 0.5, at + dur + release);

    const e = padEnv(ac, at, rand(rng, 0.1, 0.17), attack, Math.max(1, dur - attack), release);
    lp.connect(e.node);
    e.node.connect(this.out);
    v.add(e.node);

    const wave = harmonicWave(ac, [1, 0.34, 0.19, 0.09, 0.05, 0.03, 0.015]);
    for (const d of degrees) {
      const midi = this.mode.root + scale[d] + octave;
      // Two oscillators per note, detuned a few cents: chorus without an effect.
      for (let k = 0; k < 2; k++) {
        const o = ac.createOscillator();
        if (rng() < 0.6) o.setPeriodicWave(wave);
        else o.type = 'triangle';
        o.frequency.value = midiToFreq(midi);
        o.detune.value = (k === 0 ? -1 : 1) * rand(rng, 3, 13);
        const g = v.add(gain(ac, 0.5 / degrees.length));
        o.connect(g);
        g.connect(lp);
        v.play(o, at, e.end);
      }
    }

    this.pads.push({ v, until: e.end });
  }

  private spawnPluck(at: number): void {
    const env = this.env;
    const ac = env.ac;
    const rng = this.rng;
    const v = new Voice(ac, this.out);
    const scale = this.mode.scale;
    const midi = this.mode.root + scale[Math.floor(rng() * scale.length)] + (rng() < 0.5 ? 12 : 24);
    const f0 = midiToFreq(midi);
    const dur = rand(rng, 2.2, 4.5);
    const level = rand(rng, 0.06, 0.13);

    // Additive: per-partial amplitude and decay, slight inharmonicity. This is
    // what gives a "piano-ish" attack without a sampled piano.
    const lp = v.add(biquad(ac, 'lowpass', clamp(f0 * 14, 1200, 9000), 0.8));
    const wet = v.add(gain(ac, 1));
    lp.connect(wet);
    wet.connect(this.out);

    const partials = this.tier === 'low' ? 5 : 8;
    for (let n = 1; n <= partials; n++) {
      const f = f0 * n * Math.pow(1.0009, n * n);
      if (f > ac.sampleRate * 0.45) break;
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const amp = level / Math.pow(n, 1.35);
      const d = dur / Math.pow(n, 0.55);
      const e = percEnv(ac, at, amp, 0.012 + n * 0.001, d);
      o.connect(e.node);
      e.node.connect(lp);
      v.add(e.node);
      v.play(o, at, e.end);
    }

    // Soft mallet noise on the attack.
    const src = env.noise.source('pink', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', f0 * 3, 2));
    const ne = percEnv(ac, at, level * 0.35, 0.002, 0.09);
    src.connect(bp);
    bp.connect(ne.node);
    ne.node.connect(lp);
    v.add(ne.node);
    v.play(src, at, ne.end, NoiseBank.offsetOf(src));
  }

  /* ---------------------------------------------------------------- *
   * Control
   * ---------------------------------------------------------------- */

  /** 0..1 tension; ramps smoothly, so calling it every frame is fine. */
  setTension(x: number): void {
    const target = clamp(x, 0, 1);
    if (!this.tensionGain) return;
    if (Math.abs(target - this.tensionLevel) < 0.01) return;
    // Rising fast (1.5 s), falling slow (9 s) — dread lingers.
    const dur = target > this.tensionLevel ? 1.5 : 9;
    this.tensionLevel = target;
    const t = this.env.now();
    const g = this.tensionGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, target * 0.5), t + dur);
  }

  /** Momentarily pull the score down, e.g. under a leviathan roar. */
  duck(amount: number, seconds: number): void {
    const t = this.env.now();
    const g = this.duckNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(clamp(1 - amount, 0.05, 1), t + 0.25);
    g.linearRampToValueAtTime(1, t + 0.25 + Math.max(0.2, seconds));
  }

  update(_dt: number): void {
    const env = this.env;
    const t = env.now();
    const s = env.state;

    // Depth darkens the score; the tension layer brightens it again.
    const bright = clamp(3000 * Math.exp(-s.depth / 260) + 420 + s.threat * 900, 300, 6000);
    this.tone.frequency.setTargetAtTime(bright, t, 0.8);

    // Reap finished pads.
    for (let i = this.pads.length - 1; i >= 0; i--) {
      if (t > this.pads[i].until) {
        this.pads[i].v.release();
        this.pads.splice(i, 1);
      }
    }

    const density = this.mode.density * (env.tier === 'low' ? 0.6 : 1);
    if (t + 0.4 > this.nextPad) {
      this.spawnPad(Math.max(t + 0.1, this.nextPad));
      this.nextPad = t + rand(this.rng, 9, 22) / Math.max(0.2, density);
    }
    if (t + 0.4 > this.nextPluck) {
      // Plucks thin out when tension is high — leave room for the dread.
      if (this.rng() < 0.75 - 0.45 * this.tensionLevel) this.spawnPluck(Math.max(t + 0.1, this.nextPluck));
      this.nextPluck = t + rand(this.rng, 5, 16) / Math.max(0.2, density);
    }

    this.setTension(clamp(s.threat, 0, 1));
  }

  dispose(): void {
    for (const p of this.pads) p.v.release();
    this.pads.length = 0;
    this.droneVoice?.release();
    this.tensionVoice?.release();
    this.droneOscs.length = 0;
    this.tensionOscs.length = 0;
    for (const n of [this.out, this.tone, this.duckNode, this.dry, this.send, this.conv, this.revTone]) {
      try {
        n.disconnect();
      } catch {
        /* detached */
      }
    }
    for (const n of this.droneNodes) {
      try {
        n.disconnect();
      } catch {
        /* detached */
      }
    }
    this.droneNodes.length = 0;
    this.conv.buffer = null;
  }
}

function pickOctave(rng: () => number): number {
  const r = rng();
  return r < 0.45 ? 0 : r < 0.8 ? 12 : -12;
}

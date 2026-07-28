/**
 * Low-level WebAudio synthesis toolkit. Everything the audio module makes is
 * built from these primitives — there are no audio files anywhere in the
 * project, so every buffer here is filled by code at runtime.
 *
 * Nothing in this file touches the game context; it is pure DSP so it can be
 * unit-reasoned about and reused by every voice builder.
 */
import { mulberry32 } from '../core/Noise';

export type NoiseKind = 'white' | 'pink' | 'brown';

/* ------------------------------------------------------------------ *
 * Scalar helpers
 * ------------------------------------------------------------------ */

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function rand(rng: () => number, a: number, b: number): number {
  return a + (b - a) * rng();
}

export function randInt(rng: () => number, a: number, b: number): number {
  return Math.floor(rand(rng, a, b + 1 - 1e-6));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

/** Equal-power-ish gaussian-ish jitter in [-1,1], flatter than a single rng(). */
export function jitter(rng: () => number): number {
  return (rng() + rng() + rng()) * (2 / 3) - 1;
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function centsRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Deterministic child RNG so every subsystem gets its own reproducible stream. */
export function childRng(seed: number): () => number {
  return mulberry32(seed >>> 0);
}

/* ------------------------------------------------------------------ *
 * Buffer fills — procedural noise
 * ------------------------------------------------------------------ */

export function fillNoise(out: Float32Array, kind: NoiseKind, rng: () => number): void {
  const n = out.length;
  if (kind === 'white') {
    for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
    return;
  }
  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1;
      last = (last + 0.022 * w) / 1.022;
      out[i] = clamp(last * 3.6, -1, 1);
    }
    return;
  }
  // Pink — Paul Kellet's refined 7-pole approximation. -3 dB/octave, which is
  // what most natural water/air movement actually measures at.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.115;
    b6 = w * 0.115926;
    out[i] = clamp(v, -1, 1);
  }
}

/** In-place one-pole low-pass. Used to shape generated buffers offline. */
export function lp1(data: Float32Array, cutoff: number, sr: number): void {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += a * (data[i] - y);
    data[i] = y;
  }
}

/** In-place one-pole high-pass (complement of `lp1`). */
export function hp1(data: Float32Array, cutoff: number, sr: number): void {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += a * (data[i] - y);
    data[i] -= y;
  }
}

export function normalisePeak(data: Float32Array, target: number): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return;
  const k = target / peak;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

/**
 * A pool of long procedural noise buffers. One-shots read a *random slice* of
 * these instead of generating fresh noise, which keeps per-sound cost at zero
 * allocation of sample data while still sounding non-repetitive.
 */
export class NoiseBank {
  private buffers = new Map<NoiseKind, AudioBuffer>();

  constructor(
    private readonly ac: AudioContext,
    rng: () => number,
    scale = 1,
  ) {
    const spec: Array<[NoiseKind, number]> = [
      ['white', 2.0 * scale],
      ['pink', 4.0 * scale],
      ['brown', 4.0 * scale],
    ];
    for (const [kind, seconds] of spec) {
      const len = Math.max(2048, Math.floor(ac.sampleRate * seconds));
      const buf = ac.createBuffer(2, len, ac.sampleRate);
      for (let c = 0; c < 2; c++) fillNoise(buf.getChannelData(c), kind, rng);
      this.buffers.set(kind, buf);
    }
  }

  get(kind: NoiseKind): AudioBuffer {
    // The map is fully populated in the constructor, so this is always defined.
    return this.buffers.get(kind) as AudioBuffer;
  }

  /** A looping source starting at a random offset — cheap "fresh" noise. */
  source(kind: NoiseKind, rng: () => number, playbackRate = 1): AudioBufferSourceNode {
    const src = this.ac.createBufferSource();
    const buf = this.get(kind);
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;
    src.playbackRate.value = playbackRate;
    // Random read offset so two simultaneous layers never phase-lock.
    src.detune.value = 0;
    (src as AudioBufferSourceNode & { __offset?: number }).__offset = rng() * buf.duration;
    return src;
  }

  /** Offset chosen by `source`; pass to `start(when, offset)`. */
  static offsetOf(src: AudioBufferSourceNode): number {
    return (src as AudioBufferSourceNode & { __offset?: number }).__offset ?? 0;
  }
}

/* ------------------------------------------------------------------ *
 * Impulse responses — procedurally generated, no files
 * ------------------------------------------------------------------ */

export type IrKind = 'openwater' | 'enclosed' | 'hall';

export interface IrOptions {
  kind: IrKind;
  seconds: number;
  rng: () => number;
}

/**
 * Builds a stereo impulse response from scratch.
 *
 *  - `openwater`  Water is a poor reverberator over open ground: a very short,
 *                 extremely dark diffuse tail with a single surface reflection.
 *  - `enclosed`   A wreck/base interior: dense discrete early reflections, a
 *                 band-limited tail, plus decaying metal plate modes that give
 *                 the "inside a hull" ring.
 *  - `hall`       The music reverb: long, smooth, slow build, rolled-off top.
 */
export function makeIR(ac: AudioContext, o: IrOptions): AudioBuffer {
  const sr = ac.sampleRate;
  const len = Math.max(512, Math.floor(sr * o.seconds));
  const buf = ac.createBuffer(2, len, sr);
  const rng = o.rng;

  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const preDelay = o.kind === 'enclosed' ? 0.003 : o.kind === 'hall' ? 0.018 : 0.006;
    const pre = Math.floor(preDelay * sr);
    const rt = o.seconds * (o.kind === 'openwater' ? 0.55 : 0.92);
    const decay = 6.9 / Math.max(0.05, rt);

    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      let env = Math.exp(-t * decay);
      if (o.kind === 'hall') env *= 1 - Math.exp(-t * 26);
      if (o.kind === 'enclosed') env *= 0.55 + 0.45 * (1 - Math.exp(-t * 90));

      // Time-varying damping: high frequencies die faster than lows, as they do
      // in every real space (and dramatically so in water).
      const fc =
        o.kind === 'openwater'
          ? 1500 * Math.exp(-t * 2.2) + 260
          : o.kind === 'enclosed'
            ? 4200 * Math.exp(-t * 1.5) + 380
            : 6500 * Math.exp(-t * 0.55) + 700;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      y += a * ((rng() * 2 - 1) * env - y);
      d[i] = y;
    }

    if (o.kind === 'openwater') {
      // One bright-ish reflection off the underside of the surface.
      const tap = Math.floor(rand(rng, 0.026, 0.042) * sr);
      for (let i = 0; i < Math.min(600, len - tap - 1); i++) {
        d[tap + i] += (rng() * 2 - 1) * 0.5 * Math.exp(-i / 220);
      }
    }

    if (o.kind === 'enclosed') {
      // Discrete early reflections — the cue the ear uses for "small room".
      const taps = 26;
      for (let k = 0; k < taps; k++) {
        const tt = rand(rng, 0.0015, 0.058);
        const idx = pre + Math.floor(tt * sr);
        if (idx >= len - 2) continue;
        const amp = (rng() < 0.5 ? -1 : 1) / (1 + tt * 55);
        d[idx] += amp * 0.85;
        d[idx + 1] += amp * 0.4;
      }
      // Hull plate modes: a handful of decaying sines low in the spectrum.
      const modes = [88, 137, 211, 329, 466, 611];
      for (const m of modes) {
        const f = m * rand(rng, 0.96, 1.05);
        const md = rand(rng, 1.4, 3.4);
        const amp = rand(rng, 0.05, 0.12);
        const ph = rng() * Math.PI * 2;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / sr;
          d[i] += Math.sin(t * f * Math.PI * 2 + ph) * amp * Math.exp(-t * md);
        }
      }
      hp1(d, 90, sr);
    }

    if (o.kind === 'hall') hp1(d, 60, sr);
    normalisePeak(d, o.kind === 'enclosed' ? 0.85 : 0.7);
  }

  return buf;
}

/* ------------------------------------------------------------------ *
 * Node helpers
 * ------------------------------------------------------------------ */

export function biquad(
  ac: AudioContext,
  type: BiquadFilterType,
  freq: number,
  q = 0.707,
  gainDb = 0,
): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(freq, 10, Math.min(21000, ac.sampleRate * 0.48));
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

export function gain(ac: AudioContext, value = 1): GainNode {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

/** tanh-ish soft clip curve; used for limiting and for creature snarl. */
export function softClipCurve(drive = 1, n = 1024): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * (1 + drive * 3)) / Math.tanh(1 + drive * 3);
  }
  return c;
}

const MIN_GAIN = 1e-4;

/**
 * Percussive envelope: fast ramp to `peak`, exponential fall to silence.
 * Returns the gain node and the time it is finished.
 */
export function percEnv(
  ac: AudioContext,
  t0: number,
  peak: number,
  attack: number,
  decay: number,
): { node: GainNode; end: number } {
  const g = ac.createGain();
  const p = Math.max(MIN_GAIN * 2, peak);
  g.gain.setValueAtTime(MIN_GAIN, t0);
  g.gain.linearRampToValueAtTime(p, t0 + Math.max(0.0008, attack));
  const end = t0 + attack + decay;
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
  g.gain.setValueAtTime(0, end + 0.001);
  return { node: g, end: end + 0.01 };
}

/**
 * Sustained envelope with a genuinely long attack — the reason nothing in this
 * score reads as a chiptune.
 */
export function padEnv(
  ac: AudioContext,
  t0: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): { node: GainNode; end: number } {
  const g = ac.createGain();
  const p = Math.max(MIN_GAIN * 2, peak);
  g.gain.setValueAtTime(MIN_GAIN, t0);
  g.gain.exponentialRampToValueAtTime(p, t0 + attack);
  g.gain.setValueAtTime(p, t0 + attack + hold);
  const end = t0 + attack + hold + release;
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
  g.gain.setValueAtTime(0, end + 0.001);
  return { node: g, end: end + 0.02 };
}

/** Exponential parameter glide that tolerates zero/negative endpoints. */
export function glide(param: AudioParam, t0: number, from: number, to: number, dur: number): void {
  const a = Math.max(MIN_GAIN, Math.abs(from)) * Math.sign(from || 1);
  const b = Math.max(MIN_GAIN, Math.abs(to)) * Math.sign(to || 1);
  param.setValueAtTime(a, t0);
  if (a > 0 && b > 0) param.exponentialRampToValueAtTime(b, t0 + Math.max(0.001, dur));
  else param.linearRampToValueAtTime(to, t0 + Math.max(0.001, dur));
}

/** Sets a param immediately with no ramp — used for hard environment switches. */
export function hardSet(param: AudioParam, value: number, t: number): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(value, t);
}

export function smoothTo(param: AudioParam, value: number, t: number, tau: number): void {
  param.setTargetAtTime(value, t, Math.max(0.005, tau));
}

/** Additive harmonic wavetable — used for pads, plucks and bells. */
export function harmonicWave(
  ac: AudioContext,
  amps: readonly number[],
  phases?: readonly number[],
): PeriodicWave {
  const n = amps.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const a = amps[i - 1];
    const ph = phases ? phases[i - 1] : 0;
    real[i] = a * Math.cos(ph);
    imag[i] = a * Math.sin(ph);
  }
  return ac.createPeriodicWave(real, imag, { disableNormalization: false });
}

/* ------------------------------------------------------------------ *
 * Voice — a self-cleaning bundle of nodes for one sound
 * ------------------------------------------------------------------ */

/**
 * Owns every node of a single sound and disconnects them all once the last
 * scheduled source has finished, so nothing accumulates in the graph. Every
 * one-shot in the game is built through one of these.
 */
export class Voice {
  private nodes: AudioNode[] = [];
  private pending = 0;
  private released = false;
  private started = false;

  constructor(
    readonly ac: AudioContext,
    /** Node the synth should connect *into*. */
    readonly out: AudioNode,
    private readonly onRelease?: () => void,
  ) {}

  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  /** Schedule a source and take ownership of it. */
  play(src: AudioScheduledSourceNode, t0: number, t1: number, offset?: number): void {
    this.add(src);
    this.pending++;
    this.started = true;
    src.onended = () => {
      this.pending--;
      if (this.pending <= 0) this.release();
    };
    const start = Math.max(this.ac.currentTime + 0.004, t0);
    const stop = Math.max(start + 0.01, t1);
    try {
      if (offset !== undefined && src instanceof AudioBufferSourceNode) src.start(start, offset);
      else src.start(start);
      src.stop(stop);
    } catch {
      // Already-started source (should not happen); fail silent rather than
      // taking the whole frame down.
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    const now = this.ac.currentTime;
    for (const n of this.nodes) {
      // Long-running sources (drones, beds) must actually be stopped, not just
      // unplugged, or they keep burning CPU until the GC notices.
      const s = n as AudioNode & { stop?: (when?: number) => void };
      if (typeof s.stop === 'function') {
        try {
          s.stop(now);
        } catch {
          /* not started / already stopped */
        }
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already detached */
      }
    }
    this.nodes.length = 0;
    this.onRelease?.();
  }

  /** True when nothing was ever scheduled (so the caller must release it). */
  get idle(): boolean {
    return !this.started;
  }
}

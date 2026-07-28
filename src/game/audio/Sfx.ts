/**
 * Tools, gadgets and UI. Every cue is a noise burst or an oscillator stack shaped
 * by an envelope and a resonant filter — there is not a single sample anywhere.
 *
 * Cue ids are normalised (`ui:click`, `ui/click`, `UI.Click` all resolve to
 * `ui.click`) and a small alias table covers the obvious short names, so other
 * systems can emit `audio:cue` without memorising this file.
 */
import type { AudioEnv } from './Env';
import type { BusName } from './Mixer';
import type { Vec3Like } from './Spatial';
import {
  biquad,
  clamp,
  gain,
  harmonicWave,
  midiToFreq,
  NoiseBank,
  padEnv,
  percEnv,
  rand,
  softClipCurve,
  Voice,
} from './Dsp';

interface CueCtx {
  env: AudioEnv;
  ac: AudioContext;
  v: Voice;
  out: AudioNode;
  t: number;
  rng: () => number;
  level: number;
}

type Builder = (c: CueCtx) => void;

interface Route {
  bus: BusName;
  /** Route through the underwater processor. */
  world: boolean;
  priority: number;
}

/* ------------------------------------------------------------------ *
 * Shared synthesis helpers
 * ------------------------------------------------------------------ */

/** Additive bell/pluck: inharmonic partials with per-partial decay. */
function pluck(c: CueCtx, freq: number, dur: number, level: number, partials = 6, inharm = 1.0025): void {
  const { ac, v, out, t, rng } = c;
  const lp = v.add(biquad(ac, 'lowpass', Math.min(14000, freq * 12), 0.8));
  lp.connect(out);
  for (let n = 1; n <= partials; n++) {
    const f = freq * n * Math.pow(inharm, n * n);
    if (f > ac.sampleRate * 0.45) break;
    const amp = (level * 0.9) / Math.pow(n, 1.45);
    const d = dur / Math.pow(n, 0.62);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * rand(rng, 0.999, 1.001);
    const e = percEnv(ac, t, amp, 0.006, d);
    o.connect(e.node);
    e.node.connect(lp);
    v.add(e.node);
    v.play(o, t, e.end);
  }
}

/** Short tonal blip. */
function blip(c: CueCtx, freq: number, dur: number, level: number, type: OscillatorType = 'sine', bendTo?: number): void {
  const { ac, v, out, t } = c;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (bendTo) o.frequency.exponentialRampToValueAtTime(bendTo, t + dur);
  const e = percEnv(ac, t, level, 0.004, dur);
  const lp = v.add(biquad(ac, 'lowpass', Math.min(16000, freq * 8), 0.8));
  o.connect(lp);
  lp.connect(e.node);
  e.node.connect(out);
  v.add(e.node);
  v.play(o, t, e.end);
}

interface BurstOpts {
  kind?: 'white' | 'pink' | 'brown';
  freq: number;
  q?: number;
  type?: BiquadFilterType;
  attack?: number;
  decay: number;
  level: number;
  sweepTo?: number;
  at?: number;
}

/** Filtered noise burst — the backbone of every mechanical sound here. */
function burst(c: CueCtx, o: BurstOpts): void {
  const { ac, v, out, env, rng } = c;
  const t = o.at ?? c.t;
  const src = env.noise.source(o.kind ?? 'white', rng, rand(rng, 0.9, 1.1));
  const f = v.add(biquad(ac, o.type ?? 'bandpass', o.freq, o.q ?? 1.2));
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), t + o.decay);
  const e = percEnv(ac, t, o.level, o.attack ?? 0.003, o.decay);
  src.connect(f);
  f.connect(e.node);
  e.node.connect(out);
  v.add(e.node);
  v.play(src, t, e.end, NoiseBank.offsetOf(src));
}

/** Resonant modal ring — clanks, hull taps, tool contacts. */
function modes(c: CueCtx, freqs: readonly number[], dur: number, level: number, type: OscillatorType = 'triangle'): void {
  const { ac, v, out, t, rng } = c;
  for (let i = 0; i < freqs.length; i++) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freqs[i] * rand(rng, 0.985, 1.015);
    const e = percEnv(ac, t, (level * 0.8) / (1 + i * 0.8), 0.002, dur / (1 + i * 0.45));
    o.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(o, t, e.end);
  }
}

/* ------------------------------------------------------------------ *
 * Cue builders
 * ------------------------------------------------------------------ */

const BUILDERS: Record<string, Builder> = {
  /* ---- UI ---- */
  'ui.click': (c) => {
    blip(c, 1180, 0.05, 0.28 * c.level, 'sine', 940);
    burst(c, { freq: 5200, q: 1.4, type: 'highpass', decay: 0.022, level: 0.14 * c.level });
  },
  'ui.hover': (c) => {
    blip(c, 1720, 0.032, 0.1 * c.level, 'sine');
  },
  'ui.back': (c) => {
    blip(c, 780, 0.07, 0.22 * c.level, 'sine', 520);
    burst(c, { freq: 3200, type: 'highpass', decay: 0.03, level: 0.08 * c.level });
  },
  'ui.confirm': (c) => {
    pluck(c, midiToFreq(76), 0.5, 0.26 * c.level, 5);
    pluck({ ...c, t: c.t + 0.075 }, midiToFreq(83), 0.55, 0.2 * c.level, 5);
  },
  'ui.error': (c) => {
    const { ac, v, out, t } = c;
    for (const f of [148, 151.5]) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const shaper = v.add(ac.createWaveShaper());
      shaper.curve = softClipCurve(0.9);
      const e = percEnv(ac, t, 0.2 * c.level, 0.006, 0.26);
      o.connect(shaper);
      shaper.connect(e.node);
      e.node.connect(out);
      v.add(e.node);
      v.play(o, t, e.end);
    }
    burst(c, { freq: 900, q: 2.4, decay: 0.2, level: 0.1 * c.level });
  },
  'ui.open': (c) => {
    burst(c, { kind: 'pink', freq: 420, q: 0.8, decay: 0.3, level: 0.22 * c.level, sweepTo: 2600, attack: 0.02 });
    blip(c, 620, 0.18, 0.1 * c.level, 'sine', 1240);
  },
  'ui.close': (c) => {
    burst(c, { kind: 'pink', freq: 2400, q: 0.8, decay: 0.26, level: 0.2 * c.level, sweepTo: 380, attack: 0.01 });
    blip(c, 900, 0.14, 0.08 * c.level, 'sine', 440);
  },
  'ui.tick': (c) => {
    burst(c, { freq: 6800, type: 'highpass', decay: 0.014, level: 0.12 * c.level });
  },
  'ui.notify': (c) => {
    pluck(c, midiToFreq(81), 0.6, 0.2 * c.level, 6);
  },
  'ui.unlock': (c) => {
    for (let i = 0; i < 3; i++) {
      pluck({ ...c, t: c.t + i * 0.11 }, midiToFreq([69, 76, 81][i]), 0.9, 0.18 * c.level, 7);
    }
  },

  /* ---- tools ---- */
  'tool.scanner': (c) => {
    const { ac, v, out, t, rng, env } = c;
    const dur = 0.95;
    // Rising resonant sweep: noise through a high-Q band-pass climbing 3 octaves.
    const src = env.noise.source('white', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', 320, 9));
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(3400, t + dur * 0.8);
    bp.frequency.exponentialRampToValueAtTime(2200, t + dur);
    const e = padEnv(ac, t, 0.42 * c.level, 0.06, dur * 0.55, dur * 0.4);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(src, t, e.end, NoiseBank.offsetOf(src));

    // Carrier whine tracking the sweep, plus a tick train for the data readout.
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(1980, t + dur * 0.8);
    const oe = padEnv(ac, t, 0.12 * c.level, 0.08, dur * 0.5, dur * 0.35);
    o.connect(oe.node);
    oe.node.connect(out);
    v.add(oe.node);
    v.play(o, t, oe.end);

    const ticks = 7;
    for (let i = 0; i < ticks; i++) {
      burst(c, {
        at: t + 0.06 + i * (dur / (ticks + 1)),
        freq: 4200 + i * 420,
        q: 3,
        decay: 0.02,
        level: 0.09 * c.level,
      });
    }
  },
  'tool.scanner.complete': (c) => {
    pluck(c, midiToFreq(74), 0.7, 0.22 * c.level, 6);
    pluck({ ...c, t: c.t + 0.09 }, midiToFreq(81), 0.75, 0.2 * c.level, 6);
    pluck({ ...c, t: c.t + 0.18 }, midiToFreq(86), 0.8, 0.16 * c.level, 6);
  },
  'tool.knife': (c) => {
    // Swipe: fast descending band of noise, plus a thin metallic zing.
    burst(c, { kind: 'white', freq: 4200, q: 1.1, decay: 0.17, level: 0.42 * c.level, sweepTo: 780 });
    const { ac, v, out, t, rng } = c;
    for (const f of [2450, 3670]) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * rand(rng, 0.98, 1.02), t);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.13);
      const e = percEnv(ac, t, 0.08 * c.level, 0.002, 0.14);
      o.connect(e.node);
      e.node.connect(out);
      v.add(e.node);
      v.play(o, t, e.end);
    }
  },
  'tool.knife.hit': (c) => {
    burst(c, { kind: 'white', freq: 1700, q: 1.5, decay: 0.09, level: 0.4 * c.level, sweepTo: 500 });
    modes(c, [430, 910, 1560], 0.18, 0.16 * c.level);
  },
  'tool.mine': (c) => {
    const { rng } = c;
    // Rock impact: dull broadband hit, modal clank, crumbling tail.
    burst(c, { kind: 'brown', freq: rand(rng, 220, 420), q: 0.9, decay: 0.1, level: 0.45 * c.level });
    modes(
      c,
      [rand(rng, 300, 380), rand(rng, 520, 640), rand(rng, 800, 980)],
      rand(rng, 0.14, 0.26),
      0.3 * c.level,
    );
    // Crumble: a scatter of grains after the strike.
    const grains = Math.round(rand(rng, 6, 14));
    for (let i = 0; i < grains; i++) {
      burst(c, {
        at: c.t + rand(rng, 0.03, 0.55),
        kind: 'pink',
        freq: rand(rng, 900, 3400),
        q: 2,
        decay: rand(rng, 0.02, 0.09),
        level: rand(rng, 0.05, 0.16) * c.level,
      });
    }
    const { ac, v, out, t } = c;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(rng, 110, 150), t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.24);
    const e = percEnv(ac, t, 0.26 * c.level, 0.003, 0.26);
    o.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(o, t, e.end);
  },
  'tool.flashlight': (c) => {
    burst(c, { freq: 2600, q: 3, decay: 0.035, level: 0.2 * c.level });
    modes(c, [1240, 2180], 0.06, 0.1 * c.level);
  },
  'tool.propulsion': (c) => {
    const { ac, v, out, t, env, rng } = c;
    const dur = 0.7;
    const src = env.noise.source('pink', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', 600, 1.6));
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + dur);
    const e = padEnv(ac, t, 0.34 * c.level, 0.05, 0.2, 0.4);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(src, t, e.end, NoiseBank.offsetOf(src));
    blip(c, 180, dur, 0.14 * c.level, 'sawtooth', 520);
  },

  /* ---- fabricator: a scheduled multi-stage sequence ---- */
  fabricator: (c) => {
    const { ac, v, out, t, rng, env } = c;
    const lvl = c.level;

    // 1. Spin-up hum: detuned saws through a slowly opening low-pass.
    const humLp = v.add(biquad(ac, 'lowpass', 300, 3.5));
    humLp.frequency.setValueAtTime(240, t);
    humLp.frequency.exponentialRampToValueAtTime(2400, t + 2.1);
    humLp.frequency.exponentialRampToValueAtTime(600, t + 3.2);
    const humEnv = padEnv(ac, t, 0.22 * lvl, 0.35, 1.9, 0.9);
    humLp.connect(humEnv.node);
    humEnv.node.connect(out);
    v.add(humEnv.node);
    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 74 * (i + 1) * 0.5;
      o.detune.value = rand(rng, -12, 12);
      o.connect(humLp);
      v.play(o, t, humEnv.end);
    }

    // 2. Mechanical ticks as the plate indexes round.
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.25 + i * 0.42;
      burst(c, { at: tt, freq: 3200, q: 4, decay: 0.03, level: 0.18 * lvl });
      modes({ ...c, t: tt }, [520, 1180], 0.09, 0.12 * lvl);
    }

    // 3. Energy sizzle while the item is assembled.
    const sz = env.noise.source('white', rng, 1);
    const szBp = v.add(biquad(ac, 'bandpass', 3000, 1.1));
    szBp.frequency.setValueAtTime(1600, t + 0.6);
    szBp.frequency.exponentialRampToValueAtTime(6200, t + 2.3);
    const szEnv = padEnv(ac, t + 0.6, 0.12 * lvl, 0.5, 0.9, 0.6);
    sz.connect(szBp);
    szBp.connect(szEnv.node);
    szEnv.node.connect(out);
    v.add(szEnv.node);
    v.play(sz, t + 0.6, szEnv.end, NoiseBank.offsetOf(sz));

    // 4. Materialise shimmer: rising additive partials.
    const wave = harmonicWave(ac, [1, 0.5, 0.3, 0.16, 0.08, 0.04]);
    for (let i = 0; i < 4; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave);
      const f = midiToFreq(69 + i * 7);
      o.frequency.setValueAtTime(f * 0.5, t + 1.4 + i * 0.12);
      o.frequency.exponentialRampToValueAtTime(f, t + 2.3 + i * 0.12);
      const e = padEnv(ac, t + 1.4 + i * 0.12, 0.07 * lvl, 0.5, 0.3, 0.7);
      o.connect(e.node);
      e.node.connect(out);
      v.add(e.node);
      v.play(o, t + 1.4 + i * 0.12, e.end);
    }

    // 5. Done chime: root and fifth.
    pluck({ ...c, t: t + 2.65 }, midiToFreq(69), 1.2, 0.2 * lvl, 7);
    pluck({ ...c, t: t + 2.78 }, midiToFreq(76), 1.3, 0.16 * lvl, 7);
  },

  /* ---- game feedback ---- */
  'item.pickup': (c) => {
    pluck(c, midiToFreq(rand(c.rng, 79, 84)), 0.35, 0.18 * c.level, 4);
    burst(c, { kind: 'pink', freq: 2600, q: 1.4, decay: 0.09, level: 0.1 * c.level, sweepTo: 5200 });
  },
  'item.drop': (c) => {
    burst(c, { kind: 'brown', freq: 400, q: 1, decay: 0.14, level: 0.22 * c.level, sweepTo: 180 });
    modes(c, [260, 470], 0.12, 0.1 * c.level);
  },
  'craft.done': (c) => {
    pluck(c, midiToFreq(72), 1.1, 0.2 * c.level, 7);
    pluck({ ...c, t: c.t + 0.12 }, midiToFreq(79), 1.2, 0.17 * c.level, 7);
    pluck({ ...c, t: c.t + 0.24 }, midiToFreq(84), 1.3, 0.13 * c.level, 7);
  },
  'build.place': (c) => {
    burst(c, { kind: 'brown', freq: 300, q: 1.1, decay: 0.16, level: 0.4 * c.level });
    modes(c, [180, 420, 900], 0.3, 0.24 * c.level);
    blip({ ...c, t: c.t + 0.14 }, 320, 0.5, 0.1 * c.level, 'sawtooth', 190);
  },
  'save.done': (c) => {
    blip(c, 1480, 0.06, 0.1 * c.level);
    blip({ ...c, t: c.t + 0.08 }, 1980, 0.08, 0.09 * c.level);
  },

  /* ---- alarms ---- */
  'alarm.oxygen': (c) => {
    for (let i = 0; i < 2; i++) {
      const tt = c.t + i * 0.19;
      blip({ ...c, t: tt }, 1560, 0.11, 0.3 * c.level, 'sine');
      blip({ ...c, t: tt }, 780, 0.12, 0.14 * c.level, 'triangle');
    }
  },
  'alarm.depth': (c) => {
    blip(c, 420, 0.4, 0.24 * c.level, 'triangle', 300);
    burst(c, { kind: 'brown', freq: 160, q: 1.2, decay: 0.5, level: 0.2 * c.level });
  },
  'alarm.damage': (c) => {
    blip(c, 240, 0.3, 0.26 * c.level, 'sawtooth', 170);
    burst(c, { freq: 1200, q: 2.5, decay: 0.2, level: 0.12 * c.level });
  },

  /* ---- PDA ---- */
  'pda.voice': (c) => {
    // Radio pre-roll: squelch tick, carrier lift, then a soft static bed under
    // the subtitle. No speech synthesis — this frames the text, it doesn't fake it.
    const { ac, v, out, t, env, rng } = c;
    burst(c, { freq: 2800, q: 4, decay: 0.03, level: 0.14 * c.level });
    blip({ ...c, t: c.t + 0.04 }, 880, 0.09, 0.12 * c.level, 'sine', 1320);
    const src = env.noise.source('pink', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', 1600, 0.9));
    const e = padEnv(ac, t + 0.05, 0.05 * c.level, 0.15, 1.1, 0.8);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(src, t + 0.05, e.end, NoiseBank.offsetOf(src));
  },
};

/** Where each cue family lives in the mixer. */
const ROUTES: Array<[RegExp, Route]> = [
  [/^ui\./, { bus: 'sfx', world: false, priority: 1 }],
  [/^pda\./, { bus: 'voice', world: false, priority: 2 }],
  [/^alarm\./, { bus: 'sfx', world: false, priority: 2 }],
  [/^(craft|save|item)\./, { bus: 'sfx', world: false, priority: 1 }],
  [/^tool\./, { bus: 'sfx', world: true, priority: 1 }],
  [/^(fabricator|build)/, { bus: 'sfx', world: true, priority: 1 }],
];

const DEFAULT_ROUTE: Route = { bus: 'sfx', world: true, priority: 1 };

const ALIASES: Record<string, string> = {
  click: 'ui.click',
  hover: 'ui.hover',
  back: 'ui.back',
  cancel: 'ui.back',
  confirm: 'ui.confirm',
  accept: 'ui.confirm',
  error: 'ui.error',
  deny: 'ui.error',
  open: 'ui.open',
  close: 'ui.close',
  notify: 'ui.notify',
  toast: 'ui.notify',
  unlock: 'ui.unlock',
  'tech.unlock': 'ui.unlock',
  databank: 'ui.unlock',
  'quest.update': 'ui.notify',
  scanner: 'tool.scanner',
  scan: 'tool.scanner',
  'scan.done': 'tool.scanner.complete',
  'scan.complete': 'tool.scanner.complete',
  knife: 'tool.knife',
  slash: 'tool.knife',
  mine: 'tool.mine',
  mining: 'tool.mine',
  drill: 'tool.mine',
  'mine.hit': 'tool.mine',
  flashlight: 'tool.flashlight',
  torch: 'tool.flashlight',
  seaglide: 'tool.propulsion',
  propulsion: 'tool.propulsion',
  fab: 'fabricator',
  'fabricator.start': 'fabricator',
  craft: 'fabricator',
  pickup: 'item.pickup',
  'inventory.add': 'item.pickup',
  drop: 'item.drop',
  place: 'build.place',
  voice: 'pda.voice',
  radio: 'pda.voice',
  oxygen: 'alarm.oxygen',
  'low.oxygen': 'alarm.oxygen',
  damage: 'alarm.damage',
  depth: 'alarm.depth',
};

export function normaliseCue(id: string): string {
  const n = id
    .toLowerCase()
    .trim()
    .replace(/[:/\\\s_]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
  return ALIASES[n] ?? n;
}

/** Every cue id this module knows about, for documentation/debugging. */
export function cueIds(): string[] {
  return [...Object.keys(BUILDERS), ...Object.keys(LOOPS)].sort();
}

/* ------------------------------------------------------------------ *
 * Sustained tool loops
 * ------------------------------------------------------------------ */

type LoopBuilder = (env: AudioEnv, out: GainNode, rng: () => number) => AudioScheduledSourceNode[];

const LOOPS: Record<string, LoopBuilder> = {
  'loop.drill': (env, out, rng) => {
    const ac = env.ac;
    const srcs: AudioScheduledSourceNode[] = [];
    const t = ac.currentTime;
    const src = env.noise.source('white', rng, 1);
    const bp = biquad(ac, 'bandpass', 1400, 2.2);
    const wob = ac.createOscillator();
    wob.type = 'sine';
    wob.frequency.value = 7.5;
    const wobAmt = gain(ac, 420);
    wob.connect(wobAmt).connect(bp.frequency);
    src.connect(bp).connect(out);
    src.start(t, NoiseBank.offsetOf(src));
    wob.start(t);
    srcs.push(src, wob);

    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 92 * (i + 1);
      o.detune.value = rand(rng, -18, 18);
      const shaper = ac.createWaveShaper();
      shaper.curve = softClipCurve(0.7);
      const g = gain(ac, 0.16 / (i + 1));
      o.connect(shaper).connect(g).connect(out);
      o.start(t);
      srcs.push(o);
    }
    return srcs;
  },
  'loop.welder': (env, out, rng) => {
    const ac = env.ac;
    const t = ac.currentTime;
    const src = env.noise.source('white', rng, 1);
    const hp = biquad(ac, 'highpass', 2200, 0.8);
    const crackle = gain(ac, 0.22);
    const lfo = ac.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 23;
    const lfoAmt = gain(ac, 0.18);
    lfo.connect(lfoAmt).connect(crackle.gain);
    src.connect(hp).connect(crackle).connect(out);
    const hum = ac.createOscillator();
    hum.type = 'triangle';
    hum.frequency.value = 118;
    const hg = gain(ac, 0.1);
    hum.connect(hg).connect(out);
    src.start(t, NoiseBank.offsetOf(src));
    lfo.start(t);
    hum.start(t);
    return [src, lfo, hum];
  },
  'loop.scanner': (env, out, rng) => {
    const ac = env.ac;
    const t = ac.currentTime;
    const src = env.noise.source('pink', rng, 1);
    const bp = biquad(ac, 'bandpass', 1200, 7);
    const sweep = ac.createOscillator();
    sweep.type = 'triangle';
    sweep.frequency.value = 0.9;
    const amt = gain(ac, 900);
    sweep.connect(amt).connect(bp.frequency);
    const g = gain(ac, 0.28);
    src.connect(bp).connect(g).connect(out);
    const carrier = ac.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = 1320;
    const cg = gain(ac, 0.05);
    const trem = ac.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = 5.5;
    const tremAmt = gain(ac, 0.04);
    trem.connect(tremAmt).connect(cg.gain);
    carrier.connect(cg).connect(out);
    src.start(t, NoiseBank.offsetOf(src));
    sweep.start(t);
    carrier.start(t);
    trem.start(t);
    return [src, sweep, carrier, trem];
  },
};

interface LoopHandle {
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
  stopAt: number;
}

/* ------------------------------------------------------------------ *
 * Sfx manager
 * ------------------------------------------------------------------ */

export class Sfx {
  private loops = new Map<string, LoopHandle>();
  private dyingLoops: LoopHandle[] = [];
  private rng: () => number;
  /** Rate limiter so a spammed cue cannot machine-gun the mixer. */
  private lastAt = new Map<string, number>();

  constructor(private readonly env: AudioEnv) {
    this.rng = env.rng;
  }

  /** Fire a one-shot. Returns false when the cue is unknown or was dropped. */
  play(rawId: string, pos?: Vec3Like, level = 1): boolean {
    const id = normaliseCue(rawId);
    if (id.startsWith('loop.')) return this.toggleLoop(id, true);
    const build = BUILDERS[id];
    if (!build) return false;

    const t = this.env.now();
    const last = this.lastAt.get(id) ?? -1;
    // 25 ms minimum gap per cue id — inaudible, but kills accidental double-fires.
    if (t - last < 0.025) return false;
    this.lastAt.set(id, t);

    let route = DEFAULT_ROUTE;
    for (const [re, r] of ROUTES) {
      if (re.test(id)) {
        route = r;
        break;
      }
    }

    const h = this.env.head(route.bus, {
      world: route.world,
      pos,
      priority: route.priority,
      place: { refDistance: 2.5, rolloff: 1.15 },
    });
    if (!h) return false;
    build({
      env: this.env,
      ac: this.env.ac,
      v: h.v,
      out: h.out,
      t: t + 0.008,
      rng: this.rng,
      level: clamp(level, 0, 4),
    });
    if (h.v.idle) h.v.release();
    return true;
  }

  /** Start/stop a sustained tool loop (`loop.drill`, `loop.welder`, `loop.scanner`). */
  toggleLoop(rawId: string, on: boolean): boolean {
    const id = normaliseCue(rawId);
    const build = LOOPS[id];
    if (!build) return false;
    const existing = this.loops.get(id);
    if (on) {
      if (existing) return true;
      const out = gain(this.env.ac, 0.0001);
      out.connect(this.env.mixer.input('sfx', true));
      const srcs = build(this.env, out, this.rng);
      const t = this.env.now();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(1, t + 0.08);
      this.loops.set(id, { out, srcs, stopAt: 0 });
      return true;
    }
    if (!existing) return false;
    const t = this.env.now();
    existing.out.gain.cancelScheduledValues(t);
    existing.out.gain.setValueAtTime(Math.max(0.0001, existing.out.gain.value), t);
    existing.out.gain.linearRampToValueAtTime(0.0001, t + 0.12);
    existing.stopAt = t + 0.2;
    this.dyingLoops.push(existing);
    this.loops.delete(id);
    return true;
  }

  update(_dt: number): void {
    if (!this.dyingLoops.length) return;
    const t = this.env.now();
    for (let i = this.dyingLoops.length - 1; i >= 0; i--) {
      const l = this.dyingLoops[i];
      if (t < l.stopAt) continue;
      this.killLoop(l);
      this.dyingLoops.splice(i, 1);
    }
  }

  private killLoop(l: LoopHandle): void {
    const t = this.env.now();
    for (const s of l.srcs) {
      try {
        s.stop(t);
      } catch {
        /* not started */
      }
      try {
        s.disconnect();
      } catch {
        /* detached */
      }
    }
    l.out.disconnect();
  }

  dispose(): void {
    for (const l of this.loops.values()) this.killLoop(l);
    for (const l of this.dyingLoops) this.killLoop(l);
    this.loops.clear();
    this.dyingLoops.length = 0;
  }
}

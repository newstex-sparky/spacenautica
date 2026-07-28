/**
 * Player foley. Everything here is driven by the *actual* player state each
 * frame — swim strokes come from velocity, breathing rate from oxygen and
 * exertion, the heartbeat from health — so the mix reacts to play rather than
 * to triggers.
 *
 * Body-internal sounds (breathing, regulator, heartbeat) are routed to the dry
 * side of the sfx bus: they happen inside your helmet, so they must not be
 * muffled by the water. Sounds that happen in the ocean (strokes, impacts,
 * splashes) go through the underwater chain.
 */
import type { AudioEnv } from './Env';
import { biquad, clamp, gain, NoiseBank, padEnv, percEnv, rand, softClipCurve } from './Dsp';

export class Foley {
  private strokePhase = 0;
  private breathPhase = 0.3;
  private heartPhase = 0;
  private stepPhase = 0;
  private lastStrokeSide = 1;
  private rng: () => number;
  /** Suppresses foley for a moment after a hard event (death, transition). */
  private mute = 0;

  constructor(private readonly env: AudioEnv) {
    this.rng = env.rng;
  }

  /* ---------------------------------------------------------------- *
   * Per-frame driver
   * ---------------------------------------------------------------- */

  update(dt: number): void {
    const s = this.env.state;
    const t = this.env.now();
    if (this.mute > 0) this.mute -= dt;

    // --- swim strokes: cadence follows speed, not a fixed timer ---
    if (s.swimming && !s.inVehicle) {
      const speed = s.speed;
      if (speed > 0.35) {
        // ~1 stroke per 1.6 m travelled, faster when sprinting.
        this.strokePhase += dt * (0.34 + speed * 0.28) * (s.sprinting ? 1.35 : 1);
        if (this.strokePhase >= 1) {
          this.strokePhase -= 1;
          this.swimStroke(t, clamp(speed / 7, 0.18, 1));
        }
      } else {
        this.strokePhase = Math.min(this.strokePhase + dt * 0.05, 0.9);
      }
    } else if (s.grounded && s.speed > 0.6) {
      // Walking on the sea floor: soft granular shuffle.
      this.stepPhase += dt * clamp(s.speed * 0.55, 0.3, 2.2);
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.footfall(t, clamp(s.speed / 5, 0.2, 1));
      }
    }

    // --- breathing: period from oxygen + exertion ---
    const oxy = clamp(s.oxygen, 0, 1);
    const panic = (1 - oxy) * (1 - oxy);
    const period = clamp(
      4.5 * (1 - 0.62 * panic) * (s.sprinting ? 0.66 : 1) * (s.health < 0.35 ? 0.85 : 1),
      1.15,
      5.2,
    );
    const prev = this.breathPhase;
    this.breathPhase += dt / period;
    if (this.breathPhase >= 1) this.breathPhase -= 1;
    if (this.mute <= 0) {
      if (prev < 0.02 || this.breathPhase < prev) this.inhale(t, s.underwater, 0.55 + 0.5 * panic);
      else if (prev < 0.5 && this.breathPhase >= 0.5) this.exhale(t, s.underwater, 0.5 + 0.5 * panic);
    }

    // --- heartbeat: low health or near-drowning ---
    const stress = Math.max(s.health < 0.45 ? 1 - s.health / 0.45 : 0, oxy < 0.22 ? 1 - oxy / 0.22 : 0);
    if (stress > 0.05) {
      const bpm = 62 + 96 * stress;
      this.heartPhase += (dt * bpm) / 60;
      if (this.heartPhase >= 1) {
        this.heartPhase -= 1;
        this.heartbeat(t, 0.25 + 0.75 * stress);
      }
    } else {
      this.heartPhase = 0.85;
    }
  }

  /* ---------------------------------------------------------------- *
   * Voices
   * ---------------------------------------------------------------- */

  /** Arm sweep: broadband water displacement, band-swept, softly panned. */
  swimStroke(t: number, level: number): void {
    const env = this.env;
    const ac = env.ac;
    const h = env.head('sfx', { world: true, priority: 0 });
    if (!h) return;
    const { v, out } = h;
    const rng = this.rng;

    const dur = rand(rng, 0.34, 0.55);
    const src = env.noise.source(rng() < 0.5 ? 'brown' : 'pink', rng, rand(rng, 0.9, 1.15));
    const bp = v.add(biquad(ac, 'bandpass', 260, 0.85));
    bp.frequency.setValueAtTime(rand(rng, 210, 300), t);
    bp.frequency.linearRampToValueAtTime(rand(rng, 780, 1250) * (0.6 + level * 0.7), t + dur * 0.4);
    bp.frequency.linearRampToValueAtTime(rand(rng, 280, 420), t + dur);
    const e = percEnv(ac, t, 0.38 * level, 0.055, dur);
    const pan = v.add(ac.createStereoPanner());
    this.lastStrokeSide *= -1;
    pan.pan.value = this.lastStrokeSide * rand(rng, 0.18, 0.45);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(pan);
    pan.connect(out);
    v.add(e.node);
    v.play(src, t, e.end, NoiseBank.offsetOf(src));

    // Low displacement thump so a stroke has weight.
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(rng, 80, 130), t);
    o.frequency.exponentialRampToValueAtTime(rand(rng, 42, 62), t + 0.22);
    const oe = percEnv(ac, t, 0.16 * level, 0.02, 0.24);
    o.connect(oe.node);
    oe.node.connect(out);
    v.add(oe.node);
    v.play(o, t, oe.end);

    // Sprinting churns bubbles off your hands.
    if (level > 0.62 && rng() < 0.5) this.smallBubbles(t + 0.05, 0.35 * level, out, v);
  }

  /** Granular sand shuffle when walking the floor. */
  footfall(t: number, level: number): void {
    const env = this.env;
    const ac = env.ac;
    const h = env.head('sfx', { world: true, priority: 0 });
    if (!h) return;
    const { v, out } = h;
    const rng = this.rng;
    const grains = Math.round(rand(rng, 5, 12));
    const bp = v.add(biquad(ac, 'bandpass', rand(rng, 900, 2200), 1.1));
    const lp = v.add(biquad(ac, 'lowpass', 3600, 0.7));
    bp.connect(lp);
    lp.connect(out);
    for (let i = 0; i < grains; i++) {
      const gt = t + rand(rng, 0, 0.09);
      const src = env.noise.source('white', rng, rand(rng, 0.7, 1.4));
      const e = percEnv(ac, gt, rand(rng, 0.05, 0.18) * level, 0.003, rand(rng, 0.02, 0.07));
      src.connect(e.node);
      e.node.connect(bp);
      v.add(e.node);
      v.play(src, gt, e.end, NoiseBank.offsetOf(src));
    }
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(rng, 70, 100), t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const oe = percEnv(ac, t, 0.1 * level, 0.004, 0.14);
    o.connect(oe.node);
    oe.node.connect(out);
    v.add(oe.node);
    v.play(o, t, oe.end);
  }

  /** Inhale. Underwater this is the regulator: valve click, then rushing air. */
  inhale(t: number, underwater: boolean, level: number): void {
    const env = this.env;
    const ac = env.ac;
    const h = env.head('sfx', { world: false, priority: 1 });
    if (!h) return;
    const { v, out } = h;
    const rng = this.rng;
    const dur = underwater ? rand(rng, 0.55, 0.85) : rand(rng, 0.7, 1.0);

    if (underwater) {
      // Regulator valve: a tiny high click that sells the hardware.
      const click = env.noise.source('white', rng, 1);
      const hp = v.add(biquad(ac, 'highpass', 2600, 0.9));
      const ce = percEnv(ac, t, 0.1 * level, 0.001, 0.02);
      click.connect(hp);
      hp.connect(ce.node);
      ce.node.connect(out);
      v.add(ce.node);
      v.play(click, t, ce.end, NoiseBank.offsetOf(click));
    }

    // Airflow: band-passed noise rising then settling.
    const src = env.noise.source(underwater ? 'white' : 'pink', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', underwater ? 1150 : 620, underwater ? 1.25 : 0.8));
    bp.frequency.setValueAtTime(underwater ? 780 : 430, t);
    bp.frequency.linearRampToValueAtTime(underwater ? rand(rng, 1250, 1700) : rand(rng, 700, 900), t + dur * 0.55);
    bp.frequency.linearRampToValueAtTime(underwater ? 900 : 520, t + dur);
    const e = padEnv(ac, t, (underwater ? 0.26 : 0.16) * level, dur * 0.35, dur * 0.15, dur * 0.5);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(src, t, e.end, NoiseBank.offsetOf(src));

    // Chest tone: the body behind the breath.
    const body = env.noise.source('brown', rng, 1);
    const lp = v.add(biquad(ac, 'lowpass', rand(rng, 300, 460), 1.0));
    const be = padEnv(ac, t, 0.13 * level, dur * 0.4, dur * 0.1, dur * 0.5);
    body.connect(lp);
    lp.connect(be.node);
    be.node.connect(out);
    v.add(be.node);
    v.play(body, t, be.end, NoiseBank.offsetOf(body));
  }

  /** Exhale. Underwater that means a burst of bubbles leaving the regulator. */
  exhale(t: number, underwater: boolean, level: number): void {
    const env = this.env;
    const ac = env.ac;
    const h = env.head('sfx', { world: false, priority: 0 });
    if (!h) return;
    const { v, out } = h;
    const rng = this.rng;
    const dur = rand(rng, 0.45, 0.75);

    const src = env.noise.source(underwater ? 'white' : 'pink', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', underwater ? 900 : 480, 0.9));
    bp.frequency.setValueAtTime(underwater ? 1100 : 560, t);
    bp.frequency.linearRampToValueAtTime(underwater ? 520 : 320, t + dur);
    const e = padEnv(ac, t, (underwater ? 0.2 : 0.12) * level, dur * 0.18, dur * 0.2, dur * 0.6);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(src, t, e.end, NoiseBank.offsetOf(src));

    if (underwater) this.smallBubbles(t + 0.02, 0.7 * level, out, v);
  }

  /** Two-thump heartbeat, pitch-dropping sines through a heavy low-pass. */
  heartbeat(t: number, level: number): void {
    const env = this.env;
    const ac = env.ac;
    const h = env.head('sfx', { world: false, priority: 1 });
    if (!h) return;
    const { v, out } = h;
    const lp = v.add(biquad(ac, 'lowpass', 190, 1.1));
    lp.connect(out);

    for (const [dt, amp] of [
      [0, 1],
      [0.19, 0.62],
    ] as const) {
      const o = ac.createOscillator();
      o.type = 'sine';
      const st = t + dt;
      o.frequency.setValueAtTime(78, st);
      o.frequency.exponentialRampToValueAtTime(34, st + 0.16);
      const e = percEnv(ac, st, 0.42 * level * amp, 0.012, 0.19);
      o.connect(e.node);
      e.node.connect(lp);
      v.add(e.node);
      v.play(o, st, e.end);
    }
  }

  /** Head breaks the surface: a gasp plus the splash of the water falling away. */
  surfaceGasp(): void {
    const env = this.env;
    const ac = env.ac;
    const t = env.now() + 0.01;
    this.mute = 0.9;
    this.breathPhase = 0.05;

    const h = env.head('sfx', { world: false, priority: 2 });
    if (h) {
      const { v, out } = h;
      const rng = this.rng;
      // Gasp: two formant bands over a fast noise swell = vocal without a sample.
      const src = env.noise.source('pink', rng, 1);
      const e = padEnv(ac, t, 0.42, 0.05, 0.1, 0.5);
      const bus = v.add(gain(ac, 1));
      for (const [f, q, g] of [
        [rand(rng, 620, 780), 5, 8],
        [rand(rng, 1050, 1350), 6, 6],
        [rand(rng, 2400, 2900), 4, 3],
      ] as const) {
        const pk = v.add(biquad(ac, 'peaking', f, q, g));
        src.connect(pk);
        pk.connect(bus);
      }
      const hp = v.add(biquad(ac, 'highpass', 320, 0.8));
      bus.connect(hp);
      hp.connect(e.node);
      e.node.connect(out);
      v.add(e.node);
      v.play(src, t, e.end, NoiseBank.offsetOf(src));
    }
    this.splash(t, 0.85, false);
  }

  /** Entering the water: whoosh, muffled thump, bubble surge. */
  plunge(): void {
    this.mute = 0.35;
    this.splash(this.env.now() + 0.01, 1, true);
  }

  /** Broadband splash. `down` adds the descending muffle of going under. */
  splash(t: number, level: number, down: boolean): void {
    const env = this.env;
    const ac = env.ac;
    const h = env.head('sfx', { world: true, priority: 2 });
    if (!h) return;
    const { v, out } = h;
    const rng = this.rng;

    const src = env.noise.source('white', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', 1200, 0.6));
    if (down) {
      bp.frequency.setValueAtTime(rand(rng, 2600, 3600), t);
      bp.frequency.exponentialRampToValueAtTime(rand(rng, 320, 520), t + 0.5);
    } else {
      bp.frequency.setValueAtTime(rand(rng, 500, 800), t);
      bp.frequency.exponentialRampToValueAtTime(rand(rng, 2600, 4200), t + 0.28);
    }
    const e = percEnv(ac, t, 0.42 * level, 0.006, down ? 0.6 : 0.45);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(src, t, e.end, NoiseBank.offsetOf(src));

    // Body displacement thud.
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(rng, 150, 210), t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    const oe = percEnv(ac, t, 0.22 * level, 0.008, 0.32);
    o.connect(oe.node);
    oe.node.connect(out);
    v.add(oe.node);
    v.play(o, t, oe.end);

    // Droplets on the way out, bubble surge on the way in.
    this.smallBubbles(t + 0.03, down ? 1 : 0.45, out, v);
  }

  /** Impact / damage. `source` colours it: bites crunch, rocks thud. */
  impact(amount: number, source: string): void {
    const env = this.env;
    const ac = env.ac;
    const t = env.now() + 0.005;
    const level = clamp(0.3 + amount / 45, 0.3, 1.3);
    const h = env.head('sfx', { world: true, priority: 2 });
    if (!h) return;
    const { v, out } = h;
    const rng = this.rng;

    // Sub thump: the hit you feel.
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(rng, 130, 185), t);
    o.frequency.exponentialRampToValueAtTime(rand(rng, 34, 48), t + 0.28);
    const oe = percEnv(ac, t, 0.5 * level, 0.004, 0.3);
    const shaper = v.add(ac.createWaveShaper());
    shaper.curve = softClipCurve(0.6);
    o.connect(oe.node);
    oe.node.connect(shaper);
    shaper.connect(out);
    v.add(oe.node);
    v.play(o, t, oe.end);

    // Tissue/impact texture.
    const bite = /creature|bite|reaper|stalker|shark|leviathan|squid/i.test(source);
    const src = env.noise.source(bite ? 'white' : 'brown', rng, 1);
    const bp = v.add(biquad(ac, 'bandpass', bite ? 1500 : 420, bite ? 1.6 : 1.0));
    if (bite) {
      bp.frequency.setValueAtTime(rand(rng, 2200, 3200), t);
      bp.frequency.exponentialRampToValueAtTime(rand(rng, 600, 900), t + 0.22);
    }
    const e = percEnv(ac, t, (bite ? 0.55 : 0.32) * level, 0.003, bite ? 0.3 : 0.18);
    src.connect(bp);
    bp.connect(e.node);
    e.node.connect(out);
    v.add(e.node);
    v.play(src, t, e.end, NoiseBank.offsetOf(src));

    // A bite also rattles the suit: short metallic ring.
    if (bite) {
      for (const f of [rand(rng, 620, 780), rand(rng, 1400, 1750)]) {
        const ro = ac.createOscillator();
        ro.type = 'triangle';
        ro.frequency.value = f;
        const re = percEnv(ac, t + 0.01, 0.12 * level, 0.002, rand(rng, 0.25, 0.5));
        ro.connect(re.node);
        re.node.connect(out);
        v.add(re.node);
        v.play(ro, t + 0.01, re.end);
      }
    }
  }

  /** Death: everything drops away into a long descending drone. */
  death(): void {
    const env = this.env;
    const ac = env.ac;
    const t = env.now() + 0.02;
    this.mute = 6;
    const h = env.head('sfx', { world: false, priority: 2 });
    if (!h) return;
    const { v, out } = h;
    const rng = this.rng;

    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      const f0 = [110, 73.4, 55][i];
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + 4.5);
      o.detune.value = rand(rng, -14, 14);
      const lp = v.add(biquad(ac, 'lowpass', 900, 0.9));
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(140, t + 4.5);
      const e = padEnv(ac, t, 0.3 / (i + 1), 0.35, 1.4, 3.2);
      o.connect(lp);
      lp.connect(e.node);
      e.node.connect(out);
      v.add(e.node);
      v.play(o, t, e.end);
    }
    // Final bubble release.
    this.smallBubbles(t + 0.1, 1.1, out, v);
  }

  /** Reusable bubble cluster attached to an existing voice. */
  private smallBubbles(t: number, level: number, out: AudioNode, v: import('./Dsp').Voice): void {
    const ac = this.env.ac;
    const rng = this.rng;
    const count = Math.round(rand(rng, 4, 11) * clamp(level, 0.2, 1.2));
    const lp = v.add(biquad(ac, 'lowpass', 5200, 0.7));
    lp.connect(out);
    for (let i = 0; i < count; i++) {
      const bt = t + rng() * rand(rng, 0.15, 0.6);
      const f0 = rand(rng, 500, 2400);
      const dur = rand(rng, 0.025, 0.07);
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, bt);
      o.frequency.exponentialRampToValueAtTime(f0 * rand(rng, 1.3, 2.0), bt + dur);
      const e = percEnv(ac, bt, rand(rng, 0.06, 0.2) * level, 0.002, dur);
      o.connect(e.node);
      e.node.connect(lp);
      v.add(e.node);
      v.play(o, bt, e.end);
    }
  }
}

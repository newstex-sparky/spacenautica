/**
 * The shared underwater processor. Every world sound (ambience, foley, tools,
 * creatures) passes through this, so a single depth value re-colours the whole
 * ocean at once.
 *
 * Three things happen here:
 *  1. A low-pass whose cutoff falls with depth — water absorbs high frequencies
 *     roughly exponentially with distance, and at 200 m almost nothing above
 *     1 kHz survives the trip to your ears.
 *  2. Body: a low shelf plus a narrow resonance around 250 Hz. This is the
 *     "head in a bucket" cue that makes submersion read instantly.
 *  3. Two procedurally-generated convolution reverbs, crossfaded by an
 *     enclosure factor: a short dark "open water" tail versus a dense metallic
 *     "inside a wreck/base" response.
 *
 * On `water:transition` the whole thing switches with no ramp at all
 * (`hardSwitch`) — the moment your head breaks the surface the sound must snap,
 * not fade.
 */
import type { QualityTier } from '../core/Types';
import { biquad, gain, hardSet, makeIR, smoothTo } from './Dsp';

export interface UnderwaterState {
  underwater: boolean;
  /** Metres below the surface, >= 0. */
  depth: number;
  /** 0 = open water, 1 = fully enclosed interior (wreck, cave, base). */
  enclosure: number;
}

/** IR seconds per tier: convolution cost is linear in response length. */
const IR_SECONDS: Record<QualityTier, { open: number; enclosed: number }> = {
  low: { open: 0.45, enclosed: 0.7 },
  medium: { open: 0.8, enclosed: 1.2 },
  high: { open: 1.3, enclosed: 1.9 },
  ultra: { open: 1.8, enclosed: 2.6 },
};

export class UnderwaterChain {
  /** Connect world sounds here. */
  readonly input: GainNode;
  /** Connect this to the mixer master. */
  readonly output: GainNode;

  private readonly trim: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;
  private readonly shelf: BiquadFilterNode;
  private readonly res: BiquadFilterNode;
  private readonly dry: GainNode;
  private readonly wetOpen: GainNode;
  private readonly wetEnc: GainNode;
  private readonly convOpen: ConvolverNode;
  private readonly convEnc: ConvolverNode;
  private readonly openTone: BiquadFilterNode;
  private readonly encTone: BiquadFilterNode;
  private readonly encRing: BiquadFilterNode;

  private tier: QualityTier;
  private last = { lp: -1, shelf: -99, res: -99, dry: -1, open: -1, enc: -1 };

  constructor(
    private readonly ac: AudioContext,
    tier: QualityTier,
    private readonly rng: () => number,
  ) {
    this.tier = tier;
    this.input = gain(ac, 1);
    this.output = gain(ac, 1);

    this.trim = biquad(ac, 'highpass', 26, 0.7);
    this.lp = biquad(ac, 'lowpass', 20000, 0.75);
    this.shelf = biquad(ac, 'lowshelf', 190, 0.7, 0);
    this.res = biquad(ac, 'peaking', 255, 0.9, 0);

    this.dry = gain(ac, 1);
    this.wetOpen = gain(ac, 0);
    this.wetEnc = gain(ac, 0);

    this.convOpen = ac.createConvolver();
    this.convOpen.normalize = true;
    this.convEnc = ac.createConvolver();
    this.convEnc.normalize = true;
    this.buildIRs();

    // Reverb returns get their own tone shaping: the open-water tail is dull,
    // the interior tail keeps a metallic band alive around 700 Hz.
    this.openTone = biquad(ac, 'lowpass', 1800, 0.6);
    this.encTone = biquad(ac, 'lowpass', 5200, 0.7);
    this.encRing = biquad(ac, 'peaking', 720, 1.4, 4.5);

    this.input.connect(this.trim);
    this.trim.connect(this.lp);
    this.lp.connect(this.shelf);
    this.shelf.connect(this.res);

    this.res.connect(this.dry);
    this.dry.connect(this.output);

    this.res.connect(this.wetOpen);
    this.wetOpen.connect(this.convOpen);
    this.convOpen.connect(this.openTone);
    this.openTone.connect(this.output);

    this.res.connect(this.wetEnc);
    this.wetEnc.connect(this.convEnc);
    this.convEnc.connect(this.encRing);
    this.encRing.connect(this.encTone);
    this.encTone.connect(this.output);
  }

  private buildIRs(): void {
    const s = IR_SECONDS[this.tier];
    this.convOpen.buffer = makeIR(this.ac, { kind: 'openwater', seconds: s.open, rng: this.rng });
    this.convEnc.buffer = makeIR(this.ac, { kind: 'enclosed', seconds: s.enclosed, rng: this.rng });
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.buildIRs();
  }

  /* ---------------------------------------------------------------- *
   * Target computation
   * ---------------------------------------------------------------- */

  private targets(s: UnderwaterState): {
    lp: number;
    shelf: number;
    res: number;
    dry: number;
    open: number;
    enc: number;
  } {
    const enc = Math.min(1, Math.max(0, s.enclosure));
    if (!s.underwater) {
      return {
        // In air, only the enclosure dulls things (and only slightly).
        lp: 20000 - 8000 * enc,
        shelf: 1.5 * enc,
        res: 0,
        dry: 1,
        open: 0.05 * (1 - enc),
        enc: 0.34 * enc,
      };
    }
    // Absorption: ~5 kHz just under the surface collapsing toward 600 Hz by the
    // time you are in the Lost River.
    const d = Math.max(0, s.depth);
    const lp = 620 + 4600 * Math.exp(-d / 72);
    return {
      lp,
      shelf: 5.5,
      res: 3.2,
      dry: 0.86,
      open: 0.3 * (1 - enc),
      enc: 0.62 * enc,
    };
  }

  /** Per-frame smoothing. Cheap: only re-schedules params that actually moved. */
  update(_dt: number, s: UnderwaterState): void {
    const t = this.ac.currentTime;
    const g = this.targets(s);

    if (Math.abs(g.lp - this.last.lp) > this.last.lp * 0.01) {
      smoothTo(this.lp.frequency, g.lp, t, 0.09);
      this.last.lp = g.lp;
    }
    if (Math.abs(g.shelf - this.last.shelf) > 0.05) {
      smoothTo(this.shelf.gain, g.shelf, t, 0.12);
      this.last.shelf = g.shelf;
    }
    if (Math.abs(g.res - this.last.res) > 0.05) {
      smoothTo(this.res.gain, g.res, t, 0.12);
      this.last.res = g.res;
    }
    if (Math.abs(g.dry - this.last.dry) > 0.005) {
      smoothTo(this.dry.gain, g.dry, t, 0.1);
      this.last.dry = g.dry;
    }
    if (Math.abs(g.open - this.last.open) > 0.005) {
      smoothTo(this.wetOpen.gain, g.open, t, 0.14);
      this.last.open = g.open;
    }
    if (Math.abs(g.enc - this.last.enc) > 0.005) {
      smoothTo(this.wetEnc.gain, g.enc, t, 0.14);
      this.last.enc = g.enc;
    }
  }

  /**
   * Instantaneous, un-ramped reconfiguration. Called from the
   * `water:transition` handler so surfacing is a hard cut, exactly like taking
   * your head out of a bath.
   */
  hardSwitch(s: UnderwaterState): void {
    const t = this.ac.currentTime;
    const g = this.targets(s);
    hardSet(this.lp.frequency, g.lp, t);
    hardSet(this.shelf.gain, g.shelf, t);
    hardSet(this.res.gain, g.res, t);
    hardSet(this.dry.gain, g.dry, t);
    hardSet(this.wetOpen.gain, g.open, t);
    hardSet(this.wetEnc.gain, g.enc, t);
    this.last = { lp: g.lp, shelf: g.shelf, res: g.res, dry: g.dry, open: g.open, enc: g.enc };
  }

  dispose(): void {
    for (const n of [
      this.input,
      this.trim,
      this.lp,
      this.shelf,
      this.res,
      this.dry,
      this.wetOpen,
      this.wetEnc,
      this.convOpen,
      this.convEnc,
      this.openTone,
      this.encTone,
      this.encRing,
      this.output,
    ]) {
      try {
        n.disconnect();
      } catch {
        /* already detached */
      }
    }
    this.convOpen.buffer = null;
    this.convEnc.buffer = null;
  }
}

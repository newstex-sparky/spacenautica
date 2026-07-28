/**
 * The mixer graph.
 *
 *   voice ──▶ bus.dry   ──────────────────────────────┐
 *   voice ──▶ bus.world ──▶ [underwater chain] ──▶ ───┼──▶ master ──▶ limiter ──▶ clip ──▶ out
 *
 * Every bus has two inputs with the same gain: `dry` (UI, view-model, music)
 * and `world` (anything that physically exists in the ocean and must therefore
 * be filtered and reverberated by the water). Because the bus gain is applied
 * *before* the shared underwater processing, one convolver pair serves the
 * whole game instead of one per bus.
 */
import type { AudioSettings } from '../core/Settings';
import { clamp, gain, softClipCurve } from './Dsp';

export type BusName = 'music' | 'sfx' | 'ambience' | 'voice';

export const BUS_NAMES: readonly BusName[] = ['music', 'sfx', 'ambience', 'voice'];

interface Bus {
  readonly dry: GainNode;
  readonly world: GainNode;
}

/**
 * Mix headroom. Measured peak/RMS of the full graph (ambience + score + a
 * leviathan roar + foley) sits around -6 dBFS with this, so the limiter only
 * catches genuine transient stacks instead of riding the whole mix.
 */
const HEADROOM = 0.5;

/** Perceptual taper — a linear slider feels wrong on a linear gain. */
function taper(v: number): number {
  return Math.pow(clamp(v, 0, 1), 1.6);
}

export class Mixer {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly clip: WaveShaperNode;

  private readonly busses: Record<BusName, Bus>;
  private readonly curve = softClipCurve(0.25);

  constructor(
    private readonly ac: AudioContext,
    /** Input of the shared underwater processor. */
    worldIn: AudioNode,
  ) {
    this.master = gain(ac, 0.9);

    // Brick-wall-ish safety limiter. A generative score plus dozens of
    // simultaneous one-shots will occasionally stack; without this the whole
    // mix clips into digital crunch on a loud creature roar.
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;

    this.clip = ac.createWaveShaper();
    this.clip.curve = this.curve;
    this.clip.oversample = '2x';

    this.master.connect(this.limiter);
    this.limiter.connect(this.clip);
    this.clip.connect(ac.destination);

    const mk = (): Bus => {
      const dry = gain(ac, 1);
      const world = gain(ac, 1);
      dry.connect(this.master);
      world.connect(worldIn);
      return { dry, world };
    };
    this.busses = { music: mk(), sfx: mk(), ambience: mk(), voice: mk() };
  }

  /** The node a sound should connect to. `world` routes through the water. */
  input(bus: BusName, world: boolean): GainNode {
    const b = this.busses[bus];
    return world ? b.world : b.dry;
  }

  /** Wire core/Settings audio values into the graph. Call on every change. */
  apply(a: AudioSettings): void {
    const t = this.ac.currentTime;
    this.master.gain.setTargetAtTime(taper(a.master) * HEADROOM, t, 0.05);
    for (const name of BUS_NAMES) {
      const v = taper(a[name]);
      const b = this.busses[name];
      b.dry.gain.setTargetAtTime(v, t, 0.05);
      b.world.gain.setTargetAtTime(v, t, 0.05);
    }
  }

  dispose(): void {
    for (const name of BUS_NAMES) {
      this.busses[name].dry.disconnect();
      this.busses[name].world.disconnect();
    }
    this.master.disconnect();
    this.limiter.disconnect();
    this.clip.disconnect();
  }
}

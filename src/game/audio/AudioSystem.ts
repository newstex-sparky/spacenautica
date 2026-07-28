import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';

/** BASELINE — fully procedural WebAudio. Replaced by the audio agent. */
export class AudioSystem implements GameSystem {
  readonly name = 'audio';
  readonly phase = Phase.UI;
  protected ctxAudio: AudioContext | null = null;

  init(ctx: GameContext): void {
    const unlock = () => {
      if (!this.ctxAudio) {
        try { this.ctxAudio = new AudioContext(); } catch { /* unsupported */ }
      }
      void this.ctxAudio?.resume();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    ctx.bus.on('audio:cue', () => {});
  }

  update(_dt: number, _ctx: GameContext): void {}
  dispose(): void { void this.ctxAudio?.close(); }
}

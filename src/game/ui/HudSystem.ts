import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import type { PlayerSystem } from '../player/PlayerSystem';

/**
 * DOM overlay HUD. Reads systems, never mutates world state — it emits bus
 * events instead. BASELINE — replaced by the UI agent.
 */
export class HudSystem implements GameSystem {
  readonly name = 'ui.hud';
  readonly phase = Phase.UI;

  protected root!: HTMLDivElement;
  protected oxygenEl!: HTMLDivElement;
  protected depthEl!: HTMLDivElement;
  protected biomeEl!: HTMLDivElement;
  protected player!: PlayerSystem;
  protected lastBiome = '';

  init(ctx: GameContext): void {
    this.player = ctx.get<PlayerSystem>('player');
    const host = document.getElementById('ui-root') ?? document.body;

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-vitals">
        <div class="hud-ring" id="hud-o2"><span>O₂</span><b>45</b></div>
      </div>
      <div class="hud-depth"><b>0</b><span>m</span></div>
      <div class="hud-biome"></div>
      <div class="hud-reticle"></div>
    `;
    host.appendChild(this.root);
    this.oxygenEl = this.root.querySelector('#hud-o2 b') as HTMLDivElement;
    this.depthEl = this.root.querySelector('.hud-depth b') as HTMLDivElement;
    this.biomeEl = this.root.querySelector('.hud-biome') as HTMLDivElement;
  }

  update(_dt: number, ctx: GameContext): void {
    if (ctx.frame % 6 !== 0) return;
    const p = this.player;
    this.oxygenEl.textContent = String(Math.ceil(p.vitals.oxygen));
    this.depthEl.textContent = String(Math.round(p.depth));
    const b = ctx.world.biomeAt(p.position.x, p.position.z);
    if (b.id !== this.lastBiome) {
      this.lastBiome = b.id;
      const def = ctx.get<{ biomes: ReadonlyMap<string, { name: string }> }
        & GameSystem>('world.terrain').biomes.get(b.id);
      this.biomeEl.textContent = def?.name ?? b.id;
      ctx.bus.emit('biome:entered', { id: b.id, name: def?.name ?? b.id });
    }
  }

  dispose(): void {
    this.root?.remove();
  }
}

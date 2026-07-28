import { Engine } from './core/Engine';
import { Settings } from './core/Settings';
import { TextureLibrary } from './assets/TextureLibrary';
import { SkySystem } from './world/sky/SkySystem';
import { TerrainSystem } from './world/terrain/TerrainSystem';
import { WaterSystem } from './world/water/WaterSystem';
import { FloraSystem } from './world/flora/FloraSystem';
import { PropsSystem } from './world/props/PropsSystem';
import { FaunaSystem } from './fauna/FaunaSystem';
import { PlayerSystem } from './player/PlayerSystem';
import { CameraRig } from './player/CameraRig';
import { ViewModelSystem } from './player/ViewModelSystem';
import { GameState } from './systems/GameState';
import { BuildSystem } from './systems/BuildSystem';
import { HudSystem } from './ui/HudSystem';
import { AudioSystem } from './audio/AudioSystem';
import { PostStack } from './render/PostStack';

declare global {
  interface Window {
    /** Exposed for automated visual capture and debugging. */
    __GAME__?: Engine;
    /** Set true by the engine once the first frame with real content is drawn. */
    __READY__?: boolean;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loader = document.getElementById('loading');
  const loaderBar = document.getElementById('loading-bar');
  const loaderLabel = document.getElementById('loading-label');

  const settings = Settings.load();
  const engine = new Engine({ canvas, settings });
  window.__GAME__ = engine;

  // Auto-detect quality on first run only, so the user's choice sticks.
  if (!localStorage.getItem('spacenautica.settings.v2')) {
    settings.applyPreset(Settings.detectTier(engine.renderer));
  }

  // Registration order does not matter for updates (phases sort that out) but
  // it does define init order, so dependencies come first.
  engine.register(new TextureLibrary());
  engine.register(new TerrainSystem());
  engine.register(new SkySystem());
  engine.register(new WaterSystem());
  engine.register(new FloraSystem());
  engine.register(new PropsSystem());
  engine.register(new FaunaSystem());
  engine.register(new PlayerSystem());
  engine.register(new CameraRig());
  engine.register(new ViewModelSystem());
  engine.register(new GameState());
  engine.register(new BuildSystem());
  engine.register(new PostStack());
  engine.register(new AudioSystem());
  engine.register(new HudSystem());

  await engine.boot((f, label) => {
    if (loaderBar) loaderBar.style.width = `${Math.round(f * 100)}%`;
    if (loaderLabel) loaderLabel.textContent = label;
  });

  engine.start();

  // Give the first few frames a chance to compile shaders before we declare
  // readiness — automated capture waits on this flag.
  let frames = 0;
  const markReady = () => {
    if (++frames < 8) {
      requestAnimationFrame(markReady);
      return;
    }
    window.__READY__ = true;
    loader?.classList.add('done');
    setTimeout(() => loader?.remove(), 900);
  };
  requestAnimationFrame(markReady);

  canvas.addEventListener('click', () => engine.inputImpl.requestLock());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') engine.paused = !engine.paused;
  });
}

boot().catch((err) => {
  console.error('[boot] fatal', err);
  const loaderLabel = document.getElementById('loading-label');
  if (loaderLabel) {
    loaderLabel.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
    loaderLabel.style.color = '#ff7a6b';
  }
});

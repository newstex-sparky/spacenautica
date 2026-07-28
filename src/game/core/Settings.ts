import type { QualityTier } from './Types';
import { qualityAtLeast } from './Types';

export interface GraphicsSettings {
  tier: QualityTier;
  /** Render-scale multiplier applied on top of devicePixelRatio. */
  renderScale: number;
  /** Hard cap on devicePixelRatio. */
  maxPixelRatio: number;
  /** Temporal anti-aliasing. */
  taa: boolean;
  /** Ground-truth ambient occlusion. */
  gtao: boolean;
  /** Screen-space reflections on the water surface + wet materials. */
  ssr: boolean;
  /** Volumetric light shafts. */
  godRays: boolean;
  /** Screen-space bloom. */
  bloom: boolean;
  /** Depth of field (cinematic + focus-pull). */
  dof: boolean;
  /** Per-object motion blur. */
  motionBlur: boolean;
  /** Underwater particulate/marine-snow density multiplier. */
  particulate: number;
  /** Shadow map resolution per cascade. */
  shadowMapSize: number;
  /** Number of cascaded shadow map splits. */
  shadowCascades: number;
  /** Terrain view distance in metres. */
  viewDistance: number;
  /** Instanced vegetation density multiplier. */
  foliageDensity: number;
  /** Max simultaneous fauna agents. */
  faunaBudget: number;
  /** Anisotropic filtering level. */
  anisotropy: number;
  /** Adaptive resolution targets this frame time (ms). 0 disables. */
  targetFrameMs: number;
  /** Chromatic aberration strength at screen edges. */
  chromaticAberration: number;
  /** Film grain strength. */
  filmGrain: number;
  /** Camera FOV in degrees. */
  fov: number;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  voice: number;
}

export interface GameplaySettings {
  mouseSensitivity: number;
  invertY: boolean;
  headBob: number;
  cameraShake: number;
  subtitles: boolean;
  /** 'freedom' keeps hunger/thirst, 'creative' disables all survival drains. */
  mode: 'survival' | 'freedom' | 'creative' | 'hardcore';
}

export interface SettingsData {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
}

const PRESETS: Record<QualityTier, Partial<GraphicsSettings>> = {
  low: {
    renderScale: 0.72,
    maxPixelRatio: 1,
    taa: false,
    gtao: false,
    ssr: false,
    godRays: false,
    bloom: true,
    dof: false,
    motionBlur: false,
    particulate: 0.35,
    shadowMapSize: 1024,
    shadowCascades: 2,
    viewDistance: 340,
    foliageDensity: 0.35,
    faunaBudget: 90,
    anisotropy: 2,
  },
  medium: {
    renderScale: 0.85,
    maxPixelRatio: 1.25,
    taa: true,
    gtao: false,
    ssr: false,
    godRays: true,
    bloom: true,
    dof: false,
    motionBlur: false,
    particulate: 0.6,
    shadowMapSize: 1536,
    shadowCascades: 3,
    viewDistance: 520,
    foliageDensity: 0.6,
    faunaBudget: 170,
    anisotropy: 4,
  },
  high: {
    renderScale: 1,
    maxPixelRatio: 1.5,
    taa: true,
    gtao: true,
    ssr: true,
    godRays: true,
    bloom: true,
    dof: true,
    motionBlur: true,
    particulate: 1,
    shadowMapSize: 2048,
    shadowCascades: 3,
    viewDistance: 760,
    foliageDensity: 1,
    faunaBudget: 280,
    anisotropy: 8,
  },
  ultra: {
    renderScale: 1,
    maxPixelRatio: 2,
    taa: true,
    gtao: true,
    ssr: true,
    godRays: true,
    bloom: true,
    dof: true,
    motionBlur: true,
    particulate: 1.35,
    shadowMapSize: 3072,
    shadowCascades: 4,
    viewDistance: 1100,
    foliageDensity: 1.45,
    faunaBudget: 420,
    anisotropy: 16,
  },
};

const DEFAULTS: SettingsData = {
  graphics: {
    tier: 'high',
    renderScale: 1,
    maxPixelRatio: 1.5,
    taa: true,
    gtao: true,
    ssr: true,
    godRays: true,
    bloom: true,
    dof: true,
    motionBlur: true,
    particulate: 1,
    shadowMapSize: 2048,
    shadowCascades: 3,
    viewDistance: 760,
    foliageDensity: 1,
    faunaBudget: 280,
    anisotropy: 8,
    targetFrameMs: 16.7,
    chromaticAberration: 0.35,
    filmGrain: 0.35,
    fov: 70,
  },
  audio: { master: 0.9, music: 0.55, sfx: 0.9, ambience: 0.8, voice: 1 },
  gameplay: {
    mouseSensitivity: 1,
    invertY: false,
    headBob: 1,
    cameraShake: 1,
    subtitles: true,
    mode: 'survival',
  },
};

const STORAGE_KEY = 'spacenautica.settings.v2';

type Listener = (s: Settings) => void;

export class Settings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
  private listeners = new Set<Listener>();
  /** Bumped whenever anything changes; systems can cheaply poll this. */
  revision = 0;

  constructor(initial?: Partial<SettingsData>) {
    this.graphics = { ...DEFAULTS.graphics, ...initial?.graphics };
    this.audio = { ...DEFAULTS.audio, ...initial?.audio };
    this.gameplay = { ...DEFAULTS.gameplay, ...initial?.gameplay };
  }

  static load(): Settings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return new Settings(JSON.parse(raw) as Partial<SettingsData>);
    } catch {
      /* corrupt storage — fall through to defaults */
    }
    return new Settings();
  }

  save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ graphics: this.graphics, audio: this.audio, gameplay: this.gameplay }),
      );
    } catch {
      /* private mode / quota — non-fatal */
    }
  }

  /** Apply a quality preset, preserving user-set fov/sensitivity style options. */
  applyPreset(tier: QualityTier): void {
    Object.assign(this.graphics, PRESETS[tier], { tier });
    this.touch();
  }

  /** Auto-detect a sensible starting tier from the GPU string and screen size. */
  static detectTier(renderer: { getContext(): WebGL2RenderingContext | WebGLRenderingContext }): QualityTier {
    try {
      const gl = renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const raw = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      const s = raw.toLowerCase();
      const mobile = /adreno|mali|powervr|apple a\d/.test(s);
      if (mobile) return 'low';
      if (/rtx\s*(40|50)|rx\s*7\d00|m[1-4]\s*(max|ultra)/.test(s)) return 'ultra';
      if (/rtx|radeon rx|arc a7|m[1-4]\s*pro/.test(s)) return 'high';
      if (/intel|uhd|iris/.test(s)) return 'low';
      return 'medium';
    } catch {
      return 'medium';
    }
  }

  at(tier: QualityTier): boolean {
    return qualityAtLeast(this.graphics.tier, tier);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call after mutating any field so dependent systems rebuild. */
  touch(): void {
    this.revision++;
    for (const fn of this.listeners) fn(this);
    this.save();
  }
}

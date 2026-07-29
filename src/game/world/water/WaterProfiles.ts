import * as THREE from 'three';
import type { BiomeDef } from '../terrain/Biomes';

/**
 * Jerlov optical water types. Values are diffuse downwelling attenuation
 * coefficients Kd in m^-1 sampled at 650 nm (R), 550 nm (G) and 450 nm (B).
 *
 * Red light is gone within a handful of metres, green survives tens of metres
 * and blue carries past a hundred — this table is the entire reason the game
 * reads as *water* rather than as blue fog.
 */
export type JerlovType = 'I' | 'IA' | 'IB' | 'II' | 'III' | 'C1' | 'C3' | 'C5' | 'C7' | 'C9';

const KD: Record<JerlovType, [number, number, number]> = {
  I: [0.34, 0.055, 0.017],
  IA: [0.35, 0.06, 0.022],
  IB: [0.37, 0.068, 0.032],
  II: [0.41, 0.088, 0.056],
  III: [0.47, 0.13, 0.11],
  C1: [0.55, 0.19, 0.2],
  C3: [0.72, 0.32, 0.4],
  C5: [0.95, 0.47, 0.62],
  C7: [1.2, 0.62, 0.85],
  C9: [1.5, 0.8, 1.1],
};

/**
 * Beam (view-path) extinction is larger than the diffuse downwelling Kd because
 * a viewing ray loses light to scattering *out* of the ray as well as to
 * absorption. This ratio sets horizontal visibility: 1.35 gives ~45 m of useful
 * sight in the shallows, which matches the reference game closely.
 */
const BEAM_RATIO = 1.35;

export interface WaterProfile {
  /** Per-metre beam extinction along a view ray, RGB. */
  extinction: THREE.Vector3;
  /** Per-metre downwelling attenuation, RGB (always <= extinction). */
  downwelling: THREE.Vector3;
  /** Volume scattering albedo per channel — how much of the loss re-emits. */
  albedo: THREE.Vector3;
  /** Biome inscatter hue, linear. */
  tint: THREE.Color;
  /** Marine-snow density multiplier. */
  turbidity: number;
  /** Caustics brightness multiplier (murky water diffuses them away). */
  caustics: number;
}

interface BiomeWater {
  jerlov: JerlovType;
  turbidity: number;
  caustics: number;
  /** Extra hue push applied on top of the biome's own fogColor. */
  hue?: [number, number, number];
}

/**
 * Optical character per shipped biome id. Unknown ids fall back to depth.
 *
 * These are deliberately toward the *clear* end of the table. The coastal C-types
 * are physically correct for turbid water and completely unplayable: Kd(blue) of
 * 0.2 m^-1 leaves 0.15% of surface light at 40 m, which renders a kelp forest at
 * a perfectly ordinary depth as solid black. Round 1 did exactly that. The reference
 * game reads as *clear tropical* water everywhere above the Lost River, so the
 * murk is spent on hue and turbidity rather than on absorption.
 */
const BIOME_WATER: Record<string, BiomeWater> = {
  shallows: { jerlov: 'IA', turbidity: 0.55, caustics: 1.15 },
  kelp_forest: { jerlov: 'II', turbidity: 1.0, caustics: 0.8, hue: [0.85, 1.1, 0.9] },
  grassy_plateau: { jerlov: 'IB', turbidity: 0.85, caustics: 0.95 },
  red_grass: { jerlov: 'II', turbidity: 0.95, caustics: 0.7, hue: [1.1, 0.95, 0.9] },
  mushroom_forest: { jerlov: 'III', turbidity: 1.15, caustics: 0.35 },
  blood_kelp: { jerlov: 'C1', turbidity: 1.5, caustics: 0.08, hue: [1.15, 0.72, 0.9] },
  lost_river: { jerlov: 'III', turbidity: 1.35, caustics: 0.02, hue: [0.7, 1.1, 0.95] },
  lava_zone: { jerlov: 'C3', turbidity: 1.6, caustics: 0.0, hue: [1.4, 0.75, 0.5] },
};

/** Depth-driven fallback so biomes added later still get sane optics. */
function jerlovForDepth(depth: number): JerlovType {
  if (depth < 40) return 'IA';
  if (depth < 90) return 'IB';
  if (depth < 160) return 'II';
  if (depth < 300) return 'III';
  if (depth < 600) return 'C1';
  return 'C3';
}

const _tmpTint = new THREE.Color();

/**
 * Accumulates a blended optical profile across the biome weights reported by
 * `WorldQuery.biomeAt`, so swimming from the shallows into a kelp forest
 * cross-fades the water optics instead of snapping.
 */
export class ProfileBlender {
  readonly result: WaterProfile = {
    extinction: new THREE.Vector3(),
    downwelling: new THREE.Vector3(),
    albedo: new THREE.Vector3(0.72, 0.86, 0.94),
    tint: new THREE.Color(),
    turbidity: 1,
    caustics: 1,
  };

  private wsum = 0;

  begin(): void {
    this.result.extinction.set(0, 0, 0);
    this.result.downwelling.set(0, 0, 0);
    this.result.tint.setRGB(0, 0, 0);
    this.result.turbidity = 0;
    this.result.caustics = 0;
    this.wsum = 0;
  }

  /** Adds one biome's contribution. `def` may be undefined for unknown ids. */
  add(id: string, weight: number, def: BiomeDef | undefined): void {
    if (weight <= 1e-4) return;
    const midDepth = def ? (def.depthRange[0] + def.depthRange[1]) * 0.5 : 60;
    const cfg = BIOME_WATER[id] ?? {
      jerlov: jerlovForDepth(midDepth),
      turbidity: 1,
      caustics: Math.max(0, 1 - midDepth / 320),
    };
    const kd = KD[cfg.jerlov];
    const r = this.result;
    r.downwelling.x += kd[0] * weight;
    r.downwelling.y += kd[1] * weight;
    r.downwelling.z += kd[2] * weight;

    // Inscatter hue: the biome's authored fogColor, nudged by the profile hue.
    const h = cfg.hue;
    if (def) _tmpTint.copy(def.fogColor);
    else _tmpTint.setRGB(0.06, 0.5, 0.6);
    if (h) _tmpTint.setRGB(_tmpTint.r * h[0], _tmpTint.g * h[1], _tmpTint.b * h[2]);
    // Normalise so authored brightness does not double-count with sun intensity.
    const lum = Math.max(1e-3, _tmpTint.r * 0.24 + _tmpTint.g * 0.6 + _tmpTint.b * 0.16);
    r.tint.r += (_tmpTint.r / lum) * weight;
    r.tint.g += (_tmpTint.g / lum) * weight;
    r.tint.b += (_tmpTint.b / lum) * weight;

    r.turbidity += cfg.turbidity * weight;
    r.caustics += cfg.caustics * weight;
    this.wsum += weight;
  }

  /** Normalises the accumulation and derives beam extinction. */
  end(): WaterProfile {
    const r = this.result;
    const w = this.wsum;
    if (w <= 1e-4) {
      r.downwelling.set(0.35, 0.06, 0.022);
      r.tint.setRGB(0.16, 1.03, 1.16);
      r.turbidity = 0.6;
      r.caustics = 1;
    } else {
      r.downwelling.multiplyScalar(1 / w);
      r.tint.setRGB(r.tint.r / w, r.tint.g / w, r.tint.b / w);
      r.turbidity /= w;
      r.caustics /= w;
    }
    r.extinction.copy(r.downwelling).multiplyScalar(BEAM_RATIO);
    return r;
  }
}

/** Named depth bands, used for the `depth:band` bus event and music cues. */
export const DEPTH_BANDS: Array<{ id: string; until: number }> = [
  { id: 'surface', until: 8 },
  { id: 'sunlit', until: 45 },
  { id: 'twilight', until: 130 },
  { id: 'deep', until: 300 },
  { id: 'abyss', until: 650 },
  { id: 'void', until: Infinity },
];

export function bandForDepth(depth: number): string {
  for (const b of DEPTH_BANDS) if (depth < b.until) return b.id;
  return 'void';
}

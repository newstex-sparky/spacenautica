import * as THREE from 'three';
import { hash2, mulberry32 } from '../../core/Noise';
import type { BiomeSample } from '../../core/Types';

/**
 * Biome definitions and the 2D biome map.
 *
 * `BiomeDef` keeps the shape documented in `CONTRACTS.md` — flora, fauna, props
 * and audio all key off it. The extra fields at the bottom are **optional
 * additions** so existing consumers keep compiling.
 *
 * The map itself is a jittered-Voronoi region assignment (biomes are *places*
 * you swim between, each with a soft, meandering border) multiplied by a depth
 * suitability curve (so a region only takes hold where its depth band allows).
 * That combination gives Subnautica's readable geography instead of concentric
 * depth rings.
 */
export interface BiomeDef {
  id: string;
  name: string;
  depthRange: [number, number];
  floorColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  ambientLight: number;
  flora: Array<{ id: string; density: number }>;
  fauna: Array<{ id: string; density: number }>;
  music: string;

  /* ---- optional additions (terrain-side, safe to ignore) ---------------- */
  /** 0 = bare rock, 1 = deep soft sediment. Drives the splat weights. */
  sediment?: number;
  /** Extra tint applied to the *rock* layers only, keeps cliffs in-family. */
  rockColor?: THREE.Color;
  /** Multiplier on sand-ripple amplitude in the material. */
  rippleScale?: number;
  /** Relative likelihood of this biome winning a Voronoi region. */
  regionWeight?: number;
}

const c = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

export const BIOMES: BiomeDef[] = [
  {
    id: 'shallows', name: 'Safe Shallows', depthRange: [0, 55],
    floorColor: c(0xe3ddcd), fogColor: c(0x2ec8d8), fogDensity: 0.014, ambientLight: 1.0,
    flora: [{ id: 'kelp_short', density: 0.5 }, { id: 'coral_fan', density: 0.35 }, { id: 'seagrass', density: 1.2 }],
    fauna: [{ id: 'peeper', density: 1.0 }, { id: 'boomerang', density: 0.6 }], music: 'shallows',
    sediment: 0.92, rockColor: c(0xc8c3b6), rippleScale: 1.25, regionWeight: 1.4,
  },
  {
    id: 'kelp_forest', name: 'Kelp Forest', depthRange: [20, 110],
    floorColor: c(0xa8ab92), fogColor: c(0x1e9e96), fogDensity: 0.022, ambientLight: 0.78,
    flora: [{ id: 'kelp_giant', density: 1.4 }, { id: 'algae_mat', density: 0.7 }],
    fauna: [{ id: 'stalker', density: 0.25 }, { id: 'peeper', density: 0.5 }], music: 'kelp',
    sediment: 0.66, rockColor: c(0x9b9c8b), rippleScale: 0.8, regionWeight: 1.2,
  },
  {
    id: 'grassy_plateau', name: 'Grassy Plateaus', depthRange: [50, 160],
    floorColor: c(0x9aab88), fogColor: c(0x18868f), fogDensity: 0.026, ambientLight: 0.66,
    flora: [{ id: 'seagrass', density: 1.6 }, { id: 'coral_tube', density: 0.4 }],
    fauna: [{ id: 'sandshark', density: 0.2 }, { id: 'hoverfish', density: 0.8 }], music: 'plateau',
    sediment: 0.78, rockColor: c(0x8d9284), rippleScale: 0.9, regionWeight: 1.15,
  },
  {
    id: 'red_grass', name: 'Sparse Reef', depthRange: [90, 220],
    floorColor: c(0xa8817a), fogColor: c(0x146b7d), fogDensity: 0.031, ambientLight: 0.5,
    flora: [{ id: 'coral_brain', density: 0.8 }, { id: 'sponge', density: 0.5 }],
    fauna: [{ id: 'jellyray', density: 0.3 }], music: 'reef',
    sediment: 0.46, rockColor: c(0x99807a), rippleScale: 0.6, regionWeight: 1.0,
  },
  {
    id: 'mushroom_forest', name: 'Mushroom Forest', depthRange: [120, 260],
    floorColor: c(0x847b90), fogColor: c(0x116271), fogDensity: 0.034, ambientLight: 0.45,
    flora: [{ id: 'tree_mushroom', density: 0.9 }, { id: 'bioluminescent', density: 0.6 }],
    fauna: [{ id: 'jellyray', density: 0.4 }, { id: 'crabsnake', density: 0.12 }], music: 'mushroom',
    sediment: 0.6, rockColor: c(0x7d7688), rippleScale: 0.55, regionWeight: 0.95,
  },
  {
    id: 'blood_kelp', name: 'Blood Kelp Zone', depthRange: [250, 480],
    floorColor: c(0x5e3d46), fogColor: c(0x2a2438), fogDensity: 0.048, ambientLight: 0.22,
    flora: [{ id: 'blood_kelp', density: 1.1 }, { id: 'bioluminescent', density: 1.2 }],
    fauna: [{ id: 'crabsquid', density: 0.1 }, { id: 'bladderfish', density: 0.5 }], music: 'bloodkelp',
    sediment: 0.72, rockColor: c(0x5d444a), rippleScale: 0.4, regionWeight: 1.0,
  },
  {
    id: 'lost_river', name: 'Lost River', depthRange: [420, 780],
    floorColor: c(0x4d5f5f), fogColor: c(0x123a33), fogDensity: 0.055, ambientLight: 0.16,
    flora: [{ id: 'bioluminescent', density: 1.5 }],
    fauna: [{ id: 'ghostray', density: 0.15 }], music: 'lostriver',
    sediment: 0.5, rockColor: c(0x556666), rippleScale: 0.3, regionWeight: 0.9,
  },
  {
    id: 'lava_zone', name: 'Inactive Lava Zone', depthRange: [700, 1300],
    floorColor: c(0x3b2a26), fogColor: c(0x3a1408), fogDensity: 0.062, ambientLight: 0.12,
    flora: [{ id: 'lava_coral', density: 0.4 }],
    fauna: [{ id: 'lavalarva', density: 0.3 }], music: 'lava',
    sediment: 0.22, rockColor: c(0x3d2c28), rippleScale: 0.2, regionWeight: 0.8,
  },

  /* ---- new regions ------------------------------------------------------ */
  {
    id: 'coral_reef', name: 'Coral Reef Wall', depthRange: [18, 130],
    floorColor: c(0xd8bfa9), fogColor: c(0x24b0c4), fogDensity: 0.018, ambientLight: 0.9,
    flora: [{ id: 'coral_fan', density: 1.3 }, { id: 'coral_brain', density: 0.9 }, { id: 'sponge', density: 0.6 }],
    fauna: [{ id: 'peeper', density: 0.8 }, { id: 'hoverfish', density: 0.9 }], music: 'reef',
    sediment: 0.3, rockColor: c(0xc7b6a4), rippleScale: 0.5, regionWeight: 1.25,
  },
  {
    id: 'sand_dunes', name: 'Sand Dunes', depthRange: [110, 330],
    floorColor: c(0xd2cdba), fogColor: c(0x137384), fogDensity: 0.03, ambientLight: 0.52,
    flora: [{ id: 'seagrass', density: 0.35 }],
    fauna: [{ id: 'sandshark', density: 0.35 }, { id: 'jellyray', density: 0.2 }], music: 'plateau',
    sediment: 1.0, rockColor: c(0xbcb6a8), rippleScale: 1.6, regionWeight: 1.2,
  },
  {
    id: 'boulder_garden', name: 'Boulder Garden', depthRange: [55, 210],
    floorColor: c(0xa3a498), fogColor: c(0x157584), fogDensity: 0.029, ambientLight: 0.58,
    flora: [{ id: 'algae_mat', density: 0.8 }, { id: 'sponge', density: 0.45 }],
    fauna: [{ id: 'hoverfish', density: 0.6 }, { id: 'boomerang', density: 0.4 }], music: 'plateau',
    sediment: 0.35, rockColor: c(0x939489), rippleScale: 0.45, regionWeight: 1.05,
  },
  {
    id: 'crag_field', name: 'Crag Field', depthRange: [170, 430],
    floorColor: c(0x757d88), fogColor: c(0x0f4d5c), fogDensity: 0.042, ambientLight: 0.3,
    flora: [{ id: 'bioluminescent', density: 0.7 }],
    fauna: [{ id: 'bladderfish', density: 0.4 }], music: 'mushroom',
    sediment: 0.18, rockColor: c(0x6e757f), rippleScale: 0.25, regionWeight: 1.0,
  },
  {
    id: 'deep_basin', name: 'Deep Sediment Basin', depthRange: [300, 620],
    floorColor: c(0x7b776c), fogColor: c(0x0d2f3a), fogDensity: 0.05, ambientLight: 0.2,
    flora: [{ id: 'bioluminescent', density: 0.9 }],
    fauna: [{ id: 'ghostray', density: 0.1 }, { id: 'bladderfish', density: 0.35 }], music: 'bloodkelp',
    sediment: 1.0, rockColor: c(0x736f64), rippleScale: 1.1, regionWeight: 1.1,
  },
];

export const BIOME_MAP: ReadonlyMap<string, BiomeDef> = new Map(BIOMES.map((b) => [b.id, b]));

/* ------------------------------------------------------------------ *
 * Biome map — jittered Voronoi regions blended with depth
 * ------------------------------------------------------------------ */

/** Mean spacing between region centres, metres. */
const REGION_CELL = 265;
/** How many neighbours contribute to a blend. */
const MAX_CONTRIB = 4;

/** Everything the terrain mesher needs about a point, without allocating. */
export interface BiomeShading {
  /** Weighted albedo tint, linear RGB. */
  r: number;
  g: number;
  b: number;
  /** Weighted 0..1 sediment preference. */
  sediment: number;
  /** Weighted ripple amplitude scale. */
  ripple: number;
}

interface Region {
  x: number;
  z: number;
  biome: number;
}

export class BiomeMap {
  readonly defs: BiomeDef[] = BIOMES;

  private readonly seed: number;
  private readonly depthFn: (x: number, z: number) => number;
  private readonly regions = new Map<number, Region>();

  /** Scratch, reused every query. */
  private readonly wIdx = new Int32Array(MAX_CONTRIB);
  private readonly wVal = new Float64Array(MAX_CONTRIB);
  private readonly accum: Float64Array;
  /**
   * Separate scratch for `regionAt`. It MUST NOT share `accum`: `weigh` zeroes
   * `accum`, then calls `regionAt` inside its neighbourhood loop, so a shared
   * buffer let a cache-missing region overwrite the weights being accumulated.
   * The result was biome weights summed on top of an unrelated region's
   * depth-suitability values — wrong dominant biome, weights above 1, and a
   * shelf biome winning at 130 m.
   */
  private readonly pickScratch: Float64Array;

  /** Coarse cache for `sample()` so fauna/flora can hammer it. */
  private readonly cache = new Map<number, BiomeSample>();
  private static readonly CACHE_CELL = 6;
  private static readonly CACHE_MAX = 12000;

  constructor(seed: number, depthFn: (x: number, z: number) => number) {
    this.seed = seed | 0;
    this.depthFn = depthFn;
    this.accum = new Float64Array(BIOMES.length);
    this.pickScratch = new Float64Array(BIOMES.length);
  }

  /* ---------------------------------------------------------------- *
   * Region lookup
   * ---------------------------------------------------------------- */

  private regionAt(cx: number, cz: number): Region {
    const key = (((cx + 32768) & 0xffff) << 16) | ((cz + 32768) & 0xffff);
    let reg = this.regions.get(key);
    if (reg) return reg;

    const jx = hash2(cx, cz, this.seed ^ 0x1a2b);
    const jz = hash2(cx, cz, this.seed ^ 0x3c4d);
    const px = (cx + 0.12 + 0.76 * jx) * REGION_CELL;
    const pz = (cz + 0.12 + 0.76 * jz) * REGION_CELL;

    // Choose the biome from the region centre's macro depth, weighted by how
    // well each biome's band covers it. Deterministic from the cell hash.
    const depth = this.depthFn(px, pz);
    let total = 0;
    const defs = BIOMES;
    const acc = this.pickScratch;
    for (let i = 0; i < defs.length; i++) {
      const w = depthSuitability(defs[i], depth) * (defs[i].regionWeight ?? 1);
      acc[i] = w;
      total += w;
    }
    let pick = hash2(cx, cz, this.seed ^ 0x5e6f) * total;
    let chosen = 0;
    for (let i = 0; i < defs.length; i++) {
      pick -= acc[i];
      if (pick <= 0) {
        chosen = i;
        break;
      }
      chosen = i;
    }
    reg = { x: px, z: pz, biome: chosen };
    this.regions.set(key, reg);
    return reg;
  }

  /* ---------------------------------------------------------------- *
   * Weighted sampling
   * ---------------------------------------------------------------- */

  /**
   * Fills `this.accum` with normalised biome weights at (x, z) and returns the
   * dominant index. No allocation.
   */
  private weigh(x: number, z: number, depth: number): number {
    const acc = this.accum;
    acc.fill(0);

    const cx = Math.floor(x / REGION_CELL);
    const cz = Math.floor(z / REGION_CELL);

    // Collect the MAX_CONTRIB nearest region sites out of the 5x5 neighbourhood
    // (5x5 because sites are jittered across most of their cell).
    const idx = this.wIdx;
    const val = this.wVal;
    for (let i = 0; i < MAX_CONTRIB; i++) {
      idx[i] = -1;
      val[i] = Infinity;
    }
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const reg = this.regionAt(cx + dx, cz + dz);
        const ex = reg.x - x;
        const ez = reg.z - z;
        const d2 = ex * ex + ez * ez;
        // insertion sort into the top-MAX_CONTRIB
        for (let k = 0; k < MAX_CONTRIB; k++) {
          if (d2 < val[k]) {
            for (let m = MAX_CONTRIB - 1; m > k; m--) {
              val[m] = val[m - 1];
              idx[m] = idx[m - 1];
            }
            val[k] = d2;
            idx[k] = reg.biome;
            break;
          }
        }
      }
    }

    const d1 = Math.sqrt(val[0]);
    let total = 0;
    for (let k = 0; k < MAX_CONTRIB; k++) {
      if (idx[k] < 0) continue;
      const d = Math.sqrt(val[k]);
      // Soft, meandering borders: falls to zero at 1.45x the nearest distance.
      let w = 1 - d / (d1 * 1.45 + 24);
      if (w <= 0) continue;
      w = w * w * w;
      // Depth gate: a region cannot express itself outside its band.
      w *= 0.06 + 0.94 * depthSuitability(BIOMES[idx[k]], depth);
      acc[idx[k]] += w;
      total += w;
    }

    if (total <= 1e-6) {
      // Fall back to pure depth banding (only happens in the abyss).
      for (let i = 0; i < BIOMES.length; i++) {
        const w = depthSuitability(BIOMES[i], depth);
        acc[i] = w;
        total += w;
      }
      if (total <= 1e-6) {
        acc[0] = 1;
        total = 1;
      }
    }

    let best = 0;
    const inv = 1 / total;
    for (let i = 0; i < BIOMES.length; i++) {
      acc[i] *= inv;
      if (acc[i] > acc[best]) best = i;
    }
    return best;
  }

  /** Public `WorldQuery.biomeAt`, cached on a 6 m lattice. */
  sample(x: number, z: number): BiomeSample {
    const cell = BiomeMap.CACHE_CELL;
    const qx = Math.round(x / cell);
    const qz = Math.round(z / cell);
    const key = (((qx + 65536) & 0x1ffff) * 131072 + ((qz + 65536) & 0x1ffff)) | 0;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const depth = this.depthFn(qx * cell, qz * cell);
    const best = this.weigh(qx * cell, qz * cell, depth);
    const weights: Record<string, number> = {};
    for (let i = 0; i < BIOMES.length; i++) {
      if (this.accum[i] > 0.004) weights[BIOMES[i].id] = this.accum[i];
    }
    const out: BiomeSample = { id: BIOMES[best].id, weight: this.accum[best], weights };
    if (this.cache.size > BiomeMap.CACHE_MAX) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }

  /**
   * Per-vertex shading data for the mesher: blended floor tint, sediment
   * preference and ripple scale. Writes into `out`, allocates nothing.
   */
  shadeInto(x: number, z: number, depth: number, out: BiomeShading): void {
    this.weigh(x, z, depth);
    let r = 0;
    let g = 0;
    let b = 0;
    let sed = 0;
    let rip = 0;
    for (let i = 0; i < BIOMES.length; i++) {
      const w = this.accum[i];
      if (w <= 0.002) continue;
      const d = BIOMES[i];
      r += d.floorColor.r * w;
      g += d.floorColor.g * w;
      b += d.floorColor.b * w;
      sed += (d.sediment ?? 0.6) * w;
      rip += (d.rippleScale ?? 1) * w;
    }
    out.r = r;
    out.g = g;
    out.b = b;
    out.sediment = sed;
    out.ripple = rip;
  }

  /** Drops caches; call when the seed or the field changes. */
  reset(): void {
    this.regions.clear();
    this.cache.clear();
  }
}

/**
 * 1 inside the biome's depth band, falling off smoothly over a shoulder that is
 * proportional to the band width, so wide bands blend gently and narrow bands
 * stay crisp.
 */
function depthSuitability(def: BiomeDef, depth: number): number {
  const [a, b] = def.depthRange;
  const shoulder = Math.max(12, (b - a) * 0.35);
  if (depth < a) {
    const t = (depth - (a - shoulder)) / shoulder;
    return t <= 0 ? 0 : t * t * (3 - 2 * t);
  }
  if (depth > b) {
    const t = ((b + shoulder) - depth) / shoulder;
    return t <= 0 ? 0 : t * t * (3 - 2 * t);
  }
  return 1;
}

/** Deterministic region palette preview, used by the debug overlay. */
export function biomeDebugColor(index: number, seed = 1): THREE.Color {
  const rnd = mulberry32((index * 2654435761 + seed) | 0);
  return new THREE.Color(0.25 + 0.75 * rnd(), 0.25 + 0.75 * rnd(), 0.25 + 0.75 * rnd());
}

/**
 * The per-material recipe table. One entry per `TextureId`.
 *
 * Everything here is tuning data for the six family shaders; adding a material
 * that resembles an existing one is a table edit, not new GLSL.
 *
 * Conventions
 *  - All `cells` values are **integers**. The bake noise is periodic modulo the
 *    cell count, so integer cells are what makes the maps tile seamlessly.
 *    Non-integer cells produce a visible seam.
 *  - Amplitudes follow `amp ~= K / cells` so each scale contributes a similar
 *    *slope*. A layer's contribution to the normal map is `amp * cells`, so
 *    micro grain needs a tiny amplitude to avoid drowning the macro form.
 *  - Colours are authored as sRGB hex and converted to linear by THREE.Color.
 */
import * as THREE from 'three';
import { TEXTURE_IDS } from './TextureIds';
import type { TextureId } from './TextureIds';

export type MaterialFamily = 'sediment' | 'rock' | 'organic' | 'manmade' | 'skin' | 'utility';

export type Vec4 = readonly [number, number, number, number];

export interface MaterialDef {
  family: MaterialFamily;
  /** Sub-type index consumed by the family shader's `uSub`. */
  sub: number;
  /** uP[0]: macro cells x, y, amplitude, domain-warp amount. */
  macro: Vec4;
  /** uP[1]: mid cells x, y, amplitude, spare. */
  mid: Vec4;
  /** uP[2]: micro cells x, y, amplitude, sparkle density. */
  micro: Vec4;
  /** uP[3..5]: family-specific tuning. */
  a: Vec4;
  b: Vec4;
  c: Vec4;
  /** uP[6]: roughness base, roughness variance, metalness base, aux base. */
  surf: Vec4;
  /** uP[7]: hue jitter, value jitter, cavity grime, convex wear. */
  vary: Vec4;
  /** uP[8]: anisotropy dir x, y, stretch, spare. */
  aniso: Vec4;
  /** uP[9].yzw: bump strength, AO strength, curvature gain (x is the texel size). */
  relief: readonly [number, number, number];
  colA: number;
  colB: number;
  colC: number;
  colD: number;
  seed: number;
  /** Allocate the albedo attachment linear — for data maps, not colour maps. */
  dataAlbedo?: boolean;
  /** Also bake a 4th target: height/curvature/flow/sparkle (a displacementMap). */
  displace?: boolean;
  /** Relative bake cost hint, used only to order the background queue. */
  weight?: number;
}

const Z: Vec4 = [0, 0, 0, 0];

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

const DEFS: Record<string, MaterialDef> = {
  /* ---------------- sediments ---------------- */
  sand_fine: {
    family: 'sediment', sub: 0,
    macro: [3, 3, 0.34, 0.55], mid: [16, 16, 0.09, 0], micro: [88, 88, 0.020, 0.055],
    a: Z, b: [0.28, 0.16, 0.1, 0.4], c: [40, 40, 0.05, 0.32],
    surf: [0.76, 0.12, 0, 0], vary: [0.1, 0.1, 0.3, 0.14], aniso: Z,
    relief: [0.34, 0.2, 6], colA: 0xcbb99a, colB: 0xb0a288, colC: 0x6b6a4e, colD: 0x7a7466,
    seed: 11,
  },
  sand_rippled: {
    family: 'sediment', sub: 1,
    macro: [3, 3, 0.26, 0.55], mid: [14, 14, 0.075, 0], micro: [88, 88, 0.020, 0.06],
    a: [14, 3, 1.6, 1.35], b: [0.36, 0.12, 0.1, 0.4], c: [40, 40, 0.06, 0.32],
    surf: [0.74, 0.13, 0, 0], vary: [0.1, 0.1, 0.32, 0.2], aniso: Z,
    relief: [0.3, 0.22, 6], colA: 0xd2c1a2, colB: 0xaa9c80, colC: 0x6b6a4e, colD: 0x78725f,
    seed: 12, displace: true,
  },
  gravel: {
    family: 'sediment', sub: 2,
    macro: [3, 3, 0.2, 0.5], mid: [18, 18, 0.24, 0], micro: [88, 88, 0.021, 0.05],
    a: Z, b: [0.16, 0.14, 0.1, 0.46], c: [44, 44, 0.04, 0.3],
    surf: [0.72, 0.16, 0, 0], vary: [0.16, 0.18, 0.4, 0.22], aniso: Z,
    relief: [0.26, 0.24, 7], colA: 0x8a8478, colB: 0x6d6860, colC: 0x5c6b52, colD: 0x45413a,
    seed: 13, displace: true, weight: 1.2,
  },
  mud_silt: {
    family: 'sediment', sub: 3,
    macro: [3, 3, 0.2, 0.6], mid: [12, 12, 0.075, 0], micro: [88, 88, 0.016, 0.01],
    a: Z, b: [0.1, 0.3, 0.14, 0.4], c: [40, 40, 0.02, 0.3],
    surf: [0.86, 0.08, 0, 0], vary: [0.08, 0.1, 0.36, 0.08], aniso: Z,
    relief: [0.3, 0.2, 6], colA: 0x6f6455, colB: 0x534c3d, colC: 0x4b5340, colD: 0x3a3730,
    seed: 14,
  },
  clay_red: {
    family: 'sediment', sub: 4,
    macro: [3, 3, 0.22, 0.6], mid: [10, 10, 0.11, 0], micro: [88, 88, 0.016, 0.02],
    a: Z, b: [0.12, 0.2, 0.2, 0.4], c: [40, 40, 0.03, 0.3],
    surf: [0.82, 0.1, 0, 0], vary: [0.12, 0.14, 0.4, 0.14], aniso: Z,
    relief: [0.3, 0.22, 6], colA: 0x9c5a3c, colB: 0x7a4430, colC: 0x5f5a3a, colD: 0x46301f,
    seed: 15,
  },

  /* ---------------- rock ---------------- */
  rock_basalt: {
    family: 'rock', sub: 0,
    macro: [3, 3, 0.3, 0.6], mid: [9, 9, 0.14, 0], micro: [84, 84, 0.020, 0.04],
    a: [5, 5, 0.14, 0.16], b: [1, 10, 0.1, 0.16], c: [0.55, 6, 0.05, 0.55],
    surf: [0.72, 0.16, 0, 0], vary: [0.12, 0.2, 0.42, 0.24], aniso: Z,
    relief: [0.28, 0.26, 6], colA: 0x4a4a4c, colB: 0x333336, colC: 0x2b3a2e, colD: 0x1f1f1d,
    seed: 21, displace: true, weight: 1.3,
  },
  rock_limestone: {
    family: 'rock', sub: 1,
    macro: [3, 3, 0.3, 0.65], mid: [11, 11, 0.16, 0], micro: [84, 84, 0.019, 0.05],
    a: [6, 6, 0.12, 0.14], b: [1, 8, 0.1, 0.2], c: [0.7, 5, 0.07, 0.5],
    surf: [0.68, 0.18, 0, 0], vary: [0.1, 0.2, 0.44, 0.26], aniso: Z,
    relief: [0.28, 0.26, 6], colA: 0xcfc7b4, colB: 0xaea691, colC: 0x8f9a7a, colD: 0x6b6558,
    seed: 22, displace: true, weight: 1.3,
  },
  rock_sandstone: {
    family: 'rock', sub: 2,
    macro: [3, 3, 0.28, 0.6], mid: [10, 10, 0.13, 0], micro: [88, 88, 0.019, 0.06],
    a: [5, 5, 0.11, 0.12], b: [1, 9, 0.13, 0.1], c: [0.4, 5, 0.04, 0.4],
    surf: [0.76, 0.14, 0, 0], vary: [0.14, 0.18, 0.36, 0.2], aniso: Z,
    relief: [0.28, 0.24, 6], colA: 0xc4a077, colB: 0xa5855e, colC: 0x7a7a54, colD: 0x5c5142,
    seed: 23,
  },
  shale_dark: {
    family: 'rock', sub: 3,
    macro: [3, 3, 0.26, 0.55], mid: [12, 12, 0.12, 0], micro: [88, 88, 0.018, 0.05],
    a: [6, 6, 0.1, 0.1], b: [1, 14, 0.1, 0.1], c: [0.45, 6, 0.03, 0.6],
    surf: [0.62, 0.2, 0, 0], vary: [0.08, 0.22, 0.4, 0.3], aniso: Z,
    relief: [0.28, 0.24, 6], colA: 0x35383c, colB: 0x212429, colC: 0x2c3630, colD: 0x17191b,
    seed: 24, displace: true,
  },
  crystal_face: {
    family: 'rock', sub: 4,
    macro: [3, 3, 0.1, 0.4], mid: [7, 7, 0.07, 0], micro: [80, 80, 0.013, 0.12],
    a: [4, 4, 0.07, 0.06], b: [1, 6, 0.05, 0.08], c: [0.12, 4, 0.01, 0.2],
    surf: [0.14, 0.1, 0, 0.8], vary: [0.22, 0.26, 0.14, 0.1], aniso: Z,
    relief: [0.42, 0.16, 6], colA: 0xa8c8d8, colB: 0xd8e4ea, colC: 0x6d8f9a, colD: 0x46586a,
    seed: 25, displace: true,
  },

  /* ---------------- organics ---------------- */
  coral_brain: {
    family: 'organic', sub: 0,
    macro: [3, 3, 0.16, 0.7], mid: [1, 1, 0.3, 0], micro: [80, 80, 0.020, 0.06],
    a: [7, 7, 3.4, 0.2], b: [64, 64, 0.05, 0.3], c: [1, 1, 0, 0.55],
    surf: [0.5, 0.16, 0, 0], vary: [0.14, 0.18, 0.4, 0.2], aniso: Z,
    relief: [0.3, 0.24, 6], colA: 0xc8a05a, colB: 0x8a5f2e, colC: 0x9fae5a, colD: 0x54401f,
    seed: 31, displace: true, weight: 1.3,
  },
  coral_tube: {
    family: 'organic', sub: 1,
    macro: [3, 3, 0.14, 0.6], mid: [1, 1, 0.28, 0], micro: [76, 76, 0.017, 0.05],
    a: [10, 10, 0, 0.13], b: [1, 1, 0, 0.4], c: [0, 24, 0, 0.6],
    surf: [0.46, 0.16, 0, 0], vary: [0.2, 0.2, 0.42, 0.16], aniso: Z,
    relief: [0.3, 0.26, 6], colA: 0xd4694a, colB: 0x8a3a2a, colC: 0xe0a878, colD: 0x461c14,
    seed: 32, displace: true,
  },
  coral_fan: {
    family: 'organic', sub: 2,
    macro: [3, 3, 0.1, 0.6], mid: [1, 1, 0.22, 0], micro: [76, 76, 0.016, 0.05],
    a: [12, 12, 0, 0.14], b: [0, 40, 0.03, 0.3], c: [1, 1, 0, 0.85],
    surf: [0.42, 0.16, 0, 0], vary: [0.22, 0.2, 0.3, 0.14], aniso: Z,
    relief: [0.3, 0.2, 6], colA: 0xc4527a, colB: 0x7a2a48, colC: 0xe08aa8, colD: 0x3c1728,
    seed: 33,
  },
  kelp_blade: {
    family: 'organic', sub: 5,
    macro: [2, 2, 0.1, 0.5], mid: [1, 6, 0.12, 0], micro: [64, 88, 0.018, 0.04],
    a: [1, 1, 0, 0.2], b: [6, 24, 0.05, 0.12], c: [0, 9, 0.05, 0.9],
    surf: [0.4, 0.14, 0, 0], vary: [0.14, 0.16, 0.26, 0.1], aniso: Z,
    relief: [0.28, 0.18, 6], colA: 0x4a6b32, colB: 0x2e4520, colC: 0x8a7a3a, colD: 0x1c2a14,
    seed: 34,
  },
  algae_mat: {
    family: 'organic', sub: 4,
    macro: [4, 4, 0.14, 0.7], mid: [12, 12, 0.16, 0], micro: [76, 32, 0.020, 0.06],
    a: [1, 1, 0, 0.2], b: [1, 1, 0, 0.2], c: [0, 1, 0, 0.5],
    surf: [0.4, 0.2, 0, 0], vary: [0.16, 0.22, 0.36, 0.12], aniso: Z,
    relief: [0.26, 0.22, 6], colA: 0x3e6b34, colB: 0x24401f, colC: 0x7a7a34, colD: 0x16260f,
    seed: 35,
  },
  seagrass: {
    family: 'organic', sub: 6,
    macro: [2, 2, 0.08, 0.4], mid: [1, 8, 0.09, 0], micro: [56, 92, 0.016, 0.03],
    a: [1, 1, 0, 0.2], b: [1, 1, 0, 0.1], c: [7, 0, 0.04, 0.85],
    surf: [0.38, 0.14, 0, 0], vary: [0.12, 0.16, 0.24, 0.1], aniso: Z,
    relief: [0.26, 0.18, 6], colA: 0x5a8a3e, colB: 0x35521f, colC: 0x8f8a44, colD: 0x22331a,
    seed: 36,
  },
  sponge: {
    family: 'organic', sub: 3,
    macro: [3, 3, 0.16, 0.7], mid: [1, 1, 0.3, 0], micro: [76, 76, 0.020, 0.04],
    a: [14, 14, 0, 0.2], b: [1, 1, 0, 0.3], c: [1, 1, 0, 0.7],
    surf: [0.62, 0.18, 0, 0], vary: [0.18, 0.22, 0.44, 0.14], aniso: Z,
    relief: [0.28, 0.28, 6], colA: 0xc47a52, colB: 0x7a3f28, colC: 0xd8a878, colD: 0x461f12,
    seed: 37, weight: 1.2,
  },
  bioluminescent: {
    family: 'organic', sub: 7,
    macro: [3, 3, 0.12, 0.6], mid: [1, 1, 0.2, 0], micro: [76, 76, 0.017, 0.05],
    a: [16, 16, 0, 0.15], b: [1, 1, 0, 0.2], c: [1, 1, 0, 0.4],
    surf: [0.36, 0.14, 0, 0], vary: [0.16, 0.2, 0.3, 0.1], aniso: Z,
    relief: [0.3, 0.2, 6], colA: 0x123040, colB: 0x0a1c26, colC: 0x4ee0d0, colD: 0x071218,
    seed: 38,
  },

  /* ---------------- manmade ---------------- */
  hull_painted: {
    family: 'manmade', sub: 0,
    macro: [3, 3, 0.06, 0.5], mid: [12, 12, 0.05, 0], micro: [88, 88, 0.015, 0.03],
    a: [4, 6, 0.028, 0.09], b: [6, 6, 0.03, 0.45], c: [0.86, 0.35, 5.5, 0.5],
    surf: [0.34, 0.1, 0, 0], vary: [0.06, 0.12, 0.34, 0.3], aniso: Z,
    relief: [0.4, 0.24, 6], colA: 0xd4791f, colB: 0x2e3a44, colC: 0x8a4a30, colD: 0x6a6e72,
    seed: 41, displace: false, weight: 1.6,
  },
  hull_rusted: {
    family: 'manmade', sub: 1,
    macro: [3, 3, 0.07, 0.5], mid: [12, 12, 0.06, 0], micro: [88, 88, 0.017, 0.03],
    a: [4, 6, 0.03, 0.11], b: [6, 6, 0.032, 0.45], c: [0.6, 1, 4.0, 0.6],
    surf: [0.62, 0.16, 0, 0], vary: [0.08, 0.16, 0.44, 0.34], aniso: Z,
    relief: [0.4, 0.28, 6], colA: 0x4a6a7a, colB: 0x2a3238, colC: 0x7a4028, colD: 0x5e6266,
    seed: 42, displace: true, weight: 1.8,
  },
  metal_brushed: {
    family: 'manmade', sub: 2,
    macro: [3, 3, 0.03, 0.4], mid: [8, 8, 0.03, 0], micro: [96, 96, 0.009, 0.05],
    a: [1, 1, 0, 0], b: [1, 1, 0, 0], c: [1, 1, 1, 0.5],
    surf: [0.3, 0.14, 1, 0.4], vary: [0.03, 0.08, 0.2, 0.24], aniso: [1, 0, 24, 0],
    relief: [0.36, 0.14, 6], colA: 0xb8bcc0, colB: 0x8e9296, colC: 0x6a6e72, colD: 0x4a4e52,
    seed: 43,
  },
  metal_scuffed: {
    family: 'manmade', sub: 3,
    macro: [3, 3, 0.05, 0.45], mid: [14, 14, 0.05, 0], micro: [88, 88, 0.013, 0.05],
    a: [1, 1, 0, 0.05], b: [1, 1, 0, 0], c: [1, 1, 1, 0.85],
    surf: [0.36, 0.18, 1, 0.4], vary: [0.05, 0.12, 0.4, 0.3], aniso: Z,
    relief: [0.36, 0.2, 6], colA: 0x9aa0a4, colB: 0x7a8084, colC: 0x5a6064, colD: 0x3e4246,
    seed: 44,
  },
  glass_scratched: {
    family: 'manmade', sub: 4,
    macro: [2, 2, 0.02, 0.3], mid: [10, 10, 0.02, 0], micro: [88, 88, 0.006, 0.02],
    a: [1, 1, 0, 0], b: [1, 1, 0, 0], c: [1, 1, 1, 0.5],
    surf: [0.06, 0.03, 0, 1], vary: [0.02, 0.04, 0.1, 0.06], aniso: Z,
    relief: [0.5, 0.1, 6], colA: 0x050607, colB: 0xcfd8dc, colC: 0x8fa8b0, colD: 0x202428,
    seed: 45,
  },
  rubber_seal: {
    family: 'manmade', sub: 5,
    macro: [3, 3, 0.03, 0.4], mid: [1, 18, 0.09, 0], micro: [76, 76, 0.018, 0.005],
    a: [1, 18, 0, 0.04], b: [1, 1, 0, 0], c: [1, 1, 1, 0.2],
    surf: [0.86, 0.08, 0, 0], vary: [0.04, 0.08, 0.3, 0.06], aniso: Z,
    relief: [0.3, 0.22, 6], colA: 0x1c1e20, colB: 0x66665f, colC: 0x2a2c2e, colD: 0x101112,
    seed: 46,
  },
  circuit_panel: {
    family: 'manmade', sub: 6,
    macro: [3, 3, 0.02, 0.3], mid: [12, 12, 0.02, 0], micro: [88, 88, 0.010, 0.02],
    a: [16, 16, 0, 0.05], b: [1, 1, 0, 0], c: [1, 1, 1, 0.3],
    surf: [0.44, 0.12, 0, 0], vary: [0.04, 0.08, 0.24, 0.14], aniso: Z,
    relief: [0.42, 0.18, 6], colA: 0x14503a, colB: 0xd8dcd8, colC: 0x0a2a20, colD: 0xb8863a,
    seed: 47, weight: 1.2,
  },
  fabric_suit: {
    family: 'manmade', sub: 9,
    macro: [3, 3, 0.02, 0.3], mid: [1, 1, 0.2, 0], micro: [96, 96, 0.013, 0.01],
    a: [48, 48, 0, 0.035], b: [1, 1, 0, 0], c: [1, 1, 1, 0.4],
    surf: [0.7, 0.16, 0, 0], vary: [0.05, 0.1, 0.26, 0.18], aniso: Z,
    relief: [0.34, 0.2, 6], colA: 0x23303c, colB: 0x1a242e, colC: 0xd8842a, colD: 0x0f1620,
    seed: 48,
  },
  plastic_orange: {
    family: 'manmade', sub: 7,
    macro: [3, 3, 0.03, 0.4], mid: [8, 8, 0.03, 0], micro: [80, 80, 0.011, 0.02],
    a: [1, 1, 0, 0.02], b: [1, 1, 0, 0], c: [1, 1, 1, 0.45],
    surf: [0.32, 0.12, 0, 0.55], vary: [0.05, 0.1, 0.24, 0.18], aniso: Z,
    relief: [0.38, 0.16, 6], colA: 0xe0641a, colB: 0xf0b070, colC: 0xa03a0a, colD: 0x6a2408,
    seed: 49,
  },
  decal_warning: {
    family: 'manmade', sub: 8,
    macro: [3, 3, 0.03, 0.4], mid: [10, 10, 0.03, 0], micro: [88, 88, 0.013, 0.02],
    a: [6, 1, 0, 0.03], b: [1, 1, 0, 0], c: [0.66, 1, 1, 0.7],
    surf: [0.3, 0.1, 0, 0], vary: [0.04, 0.08, 0.28, 0.3], aniso: Z,
    relief: [0.4, 0.16, 6], colA: 0xe8c020, colB: 0x1a1a18, colC: 0xf0f0e8, colD: 0x6a6e72,
    seed: 50,
  },

  /* ---------------- creature skin ---------------- */
  skin_scales: {
    family: 'skin', sub: 0,
    macro: [4, 2, 0.08, 0.5], mid: [1, 1, 0.1, 0], micro: [88, 88, 0.013, 0.04],
    a: [40, 24, 0.35, 0.05], b: [1, 1, 0, 0.35], c: [4, 1, 0, 0.06],
    surf: [0.3, 0.12, 0, 0], vary: [0.1, 0.14, 0.24, 0.12], aniso: Z,
    relief: [0.34, 0.2, 6], colA: 0x2a4a6a, colB: 0xc8d0d4, colC: 0x6a8aa0, colD: 0x14263a,
    seed: 61, displace: true,
  },
  skin_smooth: {
    family: 'skin', sub: 1,
    macro: [4, 2, 0.08, 0.5], mid: [1, 6, 0.07, 0], micro: [88, 88, 0.012, 0.02],
    a: [1, 1, 0, 0.05], b: [10, 6, 0.55, 0.3], c: [3, 1, 0, 0.05],
    surf: [0.26, 0.1, 0, 0], vary: [0.08, 0.12, 0.2, 0.08], aniso: Z,
    relief: [0.34, 0.16, 6], colA: 0x4a5a60, colB: 0xcfd4d0, colC: 0x7a8a86, colD: 0x2a3436,
    seed: 62,
  },
  skin_leathery: {
    family: 'skin', sub: 2,
    macro: [4, 2, 0.1, 0.55], mid: [1, 1, 0.12, 0], micro: [88, 88, 0.015, 0.03],
    a: [26, 18, 0, 0.04], b: [1, 1, 0, 0.3], c: [1, 1, 0, 0.1],
    surf: [0.6, 0.18, 0, 0], vary: [0.1, 0.18, 0.4, 0.22], aniso: Z,
    relief: [0.32, 0.24, 6], colA: 0x4a4438, colB: 0xa89a86, colC: 0x6a6254, colD: 0x28231c,
    seed: 63,
  },
  skin_spotted: {
    family: 'skin', sub: 3,
    macro: [4, 2, 0.08, 0.5], mid: [1, 6, 0.07, 0], micro: [88, 88, 0.012, 0.02],
    a: [1, 1, 0, 0.05], b: [14, 9, 0.75, 0.4], c: [3, 1, 0.35, 0.03],
    surf: [0.3, 0.12, 0, 0], vary: [0.1, 0.14, 0.22, 0.1], aniso: Z,
    relief: [0.34, 0.16, 6], colA: 0x6a5a3a, colB: 0xd8cfb8, colC: 0x2a2418, colD: 0x38311f,
    seed: 64,
  },
  skin_striped: {
    family: 'skin', sub: 4,
    macro: [4, 2, 0.08, 0.5], mid: [1, 6, 0.07, 0], micro: [88, 88, 0.012, 0.02],
    a: [1, 1, 0, 0.05], b: [1, 1, 0.8, 0.3], c: [9, 2, 0.2, 0.03],
    surf: [0.3, 0.12, 0, 0], vary: [0.1, 0.14, 0.22, 0.1], aniso: Z,
    relief: [0.34, 0.16, 6], colA: 0xb8863a, colB: 0xe8dcc0, colC: 0x2a2018, colD: 0x6a4a20,
    seed: 65,
  },

  /* ---------------- utility ---------------- */
  detail_grunge: {
    family: 'utility', sub: 0,
    macro: [4, 4, 0.2, 0.7], mid: [20, 20, 0.12, 0], micro: [88, 88, 0.020, 0.04],
    a: [1, 1, 0, 0], b: Z, c: Z,
    surf: [0.7, 0.2, 0, 0], vary: [0, 0, 0, 0], aniso: Z,
    relief: [0.3, 0.22, 6], colA: 0xffffff, colB: 0x3e3a34, colC: 0x8a8478, colD: 0x2a2622,
    seed: 71, displace: true,
  },
  detail_noise: {
    family: 'utility', sub: 1,
    macro: [4, 4, 0.1, 0.5], mid: [16, 16, 0.3, 0], micro: [96, 96, 0.010, 0],
    a: [1, 1, 0, 0], b: Z, c: Z,
    surf: [0.5, 0, 0, 0], vary: [0, 0, 0, 0], aniso: Z,
    relief: [0.3, 0.16, 6], colA: 0xffffff, colB: 0x000000, colC: 0x808080, colD: 0x808080,
    seed: 72, dataAlbedo: true,
  },
  foam_mask: {
    family: 'utility', sub: 2,
    macro: [4, 4, 0.12, 0.7], mid: [26, 26, 0.2, 0], micro: [88, 88, 0.016, 0.03],
    a: [1, 1, 0, 0], b: Z, c: Z,
    surf: [0.42, 0.16, 0, 0], vary: [0, 0, 0.1, 0.05], aniso: Z,
    relief: [0.3, 0.2, 6], colA: 0xf0f4f4, colB: 0xc4d8de, colC: 0x9ab4bc, colD: 0xd0dcdc,
    seed: 73, dataAlbedo: true,
  },
  caustic_tile: {
    family: 'utility', sub: 3,
    macro: [4, 4, 0.05, 0.4], mid: [10, 10, 0.05, 0], micro: [88, 88, 0.005, 0],
    a: [9, 9, 9, 0.6], b: [0.16, 0, 0, 0], c: Z,
    surf: [1, 0, 0, 0], vary: [0, 0, 0, 0], aniso: Z,
    relief: [0.2, 0.1, 6], colA: 0xffffff, colB: 0xa8d8ff, colC: 0x8fc8ff, colD: 0xffffff,
    seed: 74, dataAlbedo: true,
  },
  wet_ripple: {
    family: 'utility', sub: 4,
    macro: [4, 4, 0.06, 0.5], mid: [12, 12, 0.055, 0], micro: [88, 88, 0.012, 0.02],
    a: [7, 3, 0, 0], b: Z, c: Z,
    surf: [0.16, 0.12, 0, 0], vary: [0, 0, 0.14, 0.1], aniso: Z,
    relief: [0.4, 0.16, 6], colA: 0x6a7a80, colB: 0x9aaab0, colC: 0x546268, colD: 0x44505a,
    seed: 75, displace: true,
  },
};

/* ------------------------------------------------------------------ *
 * Lookup with a name-based fallback
 * ------------------------------------------------------------------ */

const FALLBACK_RULES: Array<[RegExp, MaterialFamily, string]> = [
  [/sand|silt|mud|clay|gravel|sediment|dune|ash/, 'sediment', 'sand_fine'],
  [/rock|stone|basalt|shale|granite|cliff|boulder|crystal|ore|slate/, 'rock', 'rock_basalt'],
  [/coral|kelp|algae|grass|weed|sponge|bio|plant|frond|vine|fungus|flesh/, 'organic', 'coral_brain'],
  [/hull|metal|steel|glass|plastic|panel|rubber|fabric|decal|circuit|pipe|crate|wire/, 'manmade', 'metal_scuffed'],
  [/skin|scale|hide|leather|fin|shell|carapace|chitin/, 'skin', 'skin_scales'],
];

/**
 * Resolves a texture id to a recipe. Ids appended to the shared registry by
 * other modules are matched heuristically by name rather than throwing, so a
 * new id never breaks the build — it just gets a plausible material.
 */
export function materialDef(id: string): MaterialDef {
  const exact = DEFS[id];
  if (exact) return exact;
  for (const [re, , proto] of FALLBACK_RULES) {
    if (re.test(id)) return DEFS[proto];
  }
  return DEFS.detail_grunge;
}

/** True when the id has a hand-tuned recipe rather than a heuristic fallback. */
export function hasMaterialDef(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFS, id);
}

/** Every id with a hand-tuned recipe, in registry order. */
export const TUNED_IDS: TextureId[] = TEXTURE_IDS.filter((id) => hasMaterialDef(id));

/** Ids worth generating before the first frame: whatever the sea floor needs. */
export const CORE_PREWARM: TextureId[] = [
  'sand_fine',
  'sand_rippled',
  'rock_basalt',
  'gravel',
  'detail_grunge',
  'caustic_tile',
];

const _color = new THREE.Color();

/** sRGB hex to a linear-working-space THREE.Color (allocates; bake-time only). */
export function linearColor(hex: number): THREE.Color {
  return new THREE.Color().copy(_color.setHex(hex, THREE.SRGBColorSpace));
}

/**
 * Void-and-cluster blue noise (Ulichney 1993), fast enough to run at boot.
 *
 * The naive formulation is O(n^2): every rank assignment scans the whole energy
 * field for an argmax/argmin. At 128x128 that is ~270M comparisons, which is why
 * the old relaxation loop was unusable. Here the argmax/argmin is accelerated
 * with a two-level tile summary (8x8 tiles): each step scans 256 tile records
 * plus the 64 pixels of the winning tile, and only the handful of tiles touched
 * by the Gaussian splat are recomputed. That drops a full 128x128 rank-ordered
 * pattern to ~10M operations (tens of milliseconds).
 *
 * The result is a genuine rank-ordered void-and-cluster set: thresholding it at
 * any level yields a well distributed blue-noise dither pattern, and its power
 * spectrum has the characteristic empty low-frequency core.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/Noise';

const TILE = 8;

/**
 * Produces a rank-ordered dither array in `[0, 1)`, toroidally tileable.
 * `size` must be a multiple of {@link TILE}.
 */
export function voidAndCluster(size: number, seed: number, sigma = 1.5, radius = 4): Float32Array {
  const n = size * size;
  const rnd = mulberry32(seed);

  /* ---- truncated Gaussian splat kernel ---- */
  const kw = radius * 2 + 1;
  const kernel = new Float32Array(kw * kw);
  const inv = 1 / (2 * sigma * sigma);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      kernel[(dy + radius) * kw + (dx + radius)] = Math.exp(-(dx * dx + dy * dy) * inv);
    }
  }

  const energy = new Float32Array(n);
  const mask = new Uint8Array(n);
  const rank = new Int32Array(n).fill(-1);

  /* ---- tile summaries: max energy over 1s, min energy over 0s ---- */
  const tpr = size / TILE;
  const tileCount = tpr * tpr;
  const maxVal = new Float32Array(tileCount);
  const maxIdx = new Int32Array(tileCount);
  const minVal = new Float32Array(tileCount);
  const minIdx = new Int32Array(tileCount);

  const recomputeTile = (tx: number, ty: number): void => {
    const t = ty * tpr + tx;
    let mv = -Infinity;
    let mi = -1;
    let nv = Infinity;
    let ni = -1;
    const x0 = tx * TILE;
    const y0 = ty * TILE;
    for (let y = y0; y < y0 + TILE; y++) {
      const row = y * size;
      for (let x = x0; x < x0 + TILE; x++) {
        const i = row + x;
        const e = energy[i];
        if (mask[i] === 1) {
          if (e > mv) {
            mv = e;
            mi = i;
          }
        } else if (e < nv) {
          nv = e;
          ni = i;
        }
      }
    }
    maxVal[t] = mv;
    maxIdx[t] = mi;
    minVal[t] = nv;
    minIdx[t] = ni;
  };

  const recomputeAll = (): void => {
    for (let ty = 0; ty < tpr; ty++) for (let tx = 0; tx < tpr; tx++) recomputeTile(tx, ty);
  };

  /** Adds (`s = +1`) or removes (`s = -1`) a point's energy contribution. */
  const splat = (i: number, s: number): void => {
    const px = i % size;
    const py = (i / size) | 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = (py + dy + size) % size;
      const row = y * size;
      const krow = (dy + radius) * kw + radius;
      for (let dx = -radius; dx <= radius; dx++) {
        const x = (px + dx + size) % size;
        energy[row + x] += s * kernel[krow + dx];
      }
    }
    // Every tile overlapping the splat footprint (plus the flipped pixel's own
    // tile, whose eligibility changed) needs its summary rebuilt.
    const t0x = Math.floor((px - radius) / TILE);
    const t1x = Math.floor((px + radius) / TILE);
    const t0y = Math.floor((py - radius) / TILE);
    const t1y = Math.floor((py + radius) / TILE);
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        recomputeTile(((tx % tpr) + tpr) % tpr, ((ty % tpr) + tpr) % tpr);
      }
    }
  };

  const tightestCluster = (): number => {
    let best = -Infinity;
    let idx = -1;
    for (let t = 0; t < tileCount; t++) {
      if (maxIdx[t] >= 0 && maxVal[t] > best) {
        best = maxVal[t];
        idx = maxIdx[t];
      }
    }
    return idx;
  };

  const largestVoid = (): number => {
    let best = Infinity;
    let idx = -1;
    for (let t = 0; t < tileCount; t++) {
      if (minIdx[t] >= 0 && minVal[t] < best) {
        best = minVal[t];
        idx = minIdx[t];
      }
    }
    return idx;
  };

  const setPoint = (i: number, on: boolean): void => {
    mask[i] = on ? 1 : 0;
    splat(i, on ? 1 : -1);
  };

  /* ---- phase 0: random seed pattern, relaxed to remove clusters/voids ---- */
  const ones = Math.max(1, Math.round(n * 0.1));
  recomputeAll();
  let placed = 0;
  while (placed < ones) {
    const i = (rnd() * n) | 0;
    if (mask[i] === 0) {
      setPoint(i, true);
      placed++;
    }
  }
  for (let guard = 0; guard < ones * 6; guard++) {
    const c = tightestCluster();
    if (c < 0) break;
    setPoint(c, false);
    const v = largestVoid();
    if (v < 0 || v === c) {
      setPoint(c, true);
      break;
    }
    setPoint(v, true);
  }

  const initial = mask.slice();
  const initialEnergy = energy.slice();

  /* ---- phase 1: peel the minority pattern apart, high ranks first ---- */
  for (let r = ones - 1; r >= 0; r--) {
    const c = tightestCluster();
    if (c < 0) break;
    setPoint(c, false);
    rank[c] = r;
  }

  /* ---- phase 2+3: fill the remaining voids in order ----
   * On a torus the filtered-zeros field is exactly (kernelSum - filteredOnes),
   * so "largest void of the 1s" and "tightest cluster of the 0s" select the
   * same pixel; Ulichney's phase III therefore needs no separate rule here. */
  mask.set(initial);
  energy.set(initialEnergy);
  recomputeAll();
  for (let r = ones; r < n; r++) {
    const v = largestVoid();
    if (v < 0) break;
    setPoint(v, true);
    rank[v] = r;
  }

  const out = new Float32Array(n);
  const scale = 1 / n;
  for (let i = 0; i < n; i++) out[i] = (rank[i] < 0 ? 0 : rank[i]) * scale;
  return out;
}

/** Toroidal shift of a pattern — preserves the spectrum, decorrelates channels. */
function shifted(src: Float32Array, size: number, sx: number, sy: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    const sry = ((y + sy) % size) * size;
    const dry = y * size;
    for (let x = 0; x < size; x++) out[dry + x] = src[sry + ((x + sx) % size)];
  }
  return out;
}

export interface BlueNoiseTexture {
  texture: THREE.DataTexture;
  /** Wall-clock generation cost, for the boot budget report. */
  ms: number;
}

/**
 * RGBA blue-noise tile. With `runs = 2` (high tier and up) R and G are two
 * independent void-and-cluster patterns and B/A are toroidal shifts of them;
 * with `runs = 1` all four channels are shifts of a single solve. A shift
 * preserves the power spectrum exactly and only correlates the channels at that
 * one lag, so four usable channels cost one or two solves rather than four.
 *
 * Cost: ~55-60 ms per 128x128 solve on a desktop CPU.
 */
export function makeBlueNoiseTexture(size = 128, runs = 2): BlueNoiseTexture {
  const t0 = now();
  const a = voidAndCluster(size, 0x5eed1a3f);
  const b = runs > 1 ? voidAndCluster(size, 0x13c6ef37) : shifted(a, size, 53, 11);
  const c = shifted(a, size, 37, 59);
  const d = shifted(b, size, 71, 23);

  const n = size * size;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = Math.min(255, (a[i] * 256) | 0);
    data[i * 4 + 1] = Math.min(255, (b[i] * 256) | 0);
    data[i * 4 + 2] = Math.min(255, (c[i] * 256) | 0);
    data[i * 4 + 3] = Math.min(255, (d[i] * 256) | 0);
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'blueNoise';
  tex.needsUpdate = true;
  return { texture: tex, ms: now() - t0 };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

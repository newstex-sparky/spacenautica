/**
 * Placement field for the flora layer.
 *
 * The world is diced into a spatial hash of fixed-size cells. A cell is
 * generated once, lazily, and deterministically from the world seed, so it
 * regenerates identically after eviction and never shimmers as you swim back
 * and forth.
 *
 * Generating a cell is dominated by terrain queries, so each cell samples a
 * small heightfield grid *once* and then bilinearly interpolates it for all its
 * candidates — 169 `heightAt` calls instead of ~25 000. Candidates come from a
 * jittered sub-grid with a min-distance rejection pass (Poisson-disc-ish), which
 * is what stops flora from reading as a lattice. Species are chosen by a
 * weighted lottery built from every biome contributing weight at this cell, so
 * biome borders blend instead of switching, and each accepted instance is then
 * gated by a low-frequency clump field so beds and thickets form.
 *
 * Everything is stored struct-of-arrays; nothing here allocates per frame.
 */
import type { WorldQuery } from '../../core/Types';
import { Noise, hash2 } from '../../core/Noise';
import { BIOME_MAP } from '../terrain/Biomes';
import { SPECIES, SPECIES_INDEX } from './FloraSpecies';
import type { SpeciesDef } from './FloraSpecies';

const TAU = Math.PI * 2;

export class FloraCell {
  cx = 0;
  cz = 0;
  count = 0;
  species = new Uint8Array(0);
  variant = new Uint8Array(0);
  /** x, y, z */
  pos = new Float32Array(0);
  /** terrain normal x, y, z */
  nrm = new Float32Array(0);
  /** seed, phase, heightScale, rank */
  data = new Float32Array(0);
  /** twist, leanMag, leanX, leanZ */
  warp = new Float32Array(0);
  /** r, g, b multiplier */
  tint = new Float32Array(0);
  /** scale, rotY */
  xform = new Float32Array(0);
  /** Bounding sphere for cheap whole-cell frustum rejection. */
  centreX = 0;
  centreY = 0;
  centreZ = 0;
  radius = 0;
  /** Frame index when this cell was last inside the streaming radius. */
  touched = 0;
}

export interface FieldConfig {
  cellSize: number;
  /** Heightfield samples per cell edge. */
  gridRes: number;
  /** Candidate sites per cell edge. */
  candidates: number;
  /** Peak plant count per square metre before clumping and thinning. */
  plantsPerM2: number;
  seed: number;
}

const H_KEY_BIAS = 32768;

function cellKey(cx: number, cz: number): number {
  return (((cx + H_KEY_BIAS) & 0xffff) << 16) | ((cz + H_KEY_BIAS) & 0xffff);
}

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export class FloraField {
  readonly cells = new Map<number, FloraCell>();
  private grid: Float32Array;
  private noise: Noise;
  /** Scratch accumulation buffers, reused for every cell. */
  private accW = new Float64Array(SPECIES.length);
  private lotSp: number[] = [];
  private lotCum: number[] = [];
  private bufSpecies: Uint8Array;
  private bufVariant: Uint8Array;
  private bufPos: Float32Array;
  private bufNrm: Float32Array;
  private bufData: Float32Array;
  private bufWarp: Float32Array;
  private bufTint: Float32Array;
  private bufXform: Float32Array;
  /**
   * `rowStart[j]` = number of accepted candidates before row `j` began.
   * Candidates are visited in row-major order, so the min-distance test only
   * ever has to look back a bounded number of rows instead of at every plant
   * already placed in the cell — which is what keeps a fine candidate grid from
   * turning the rejection pass into an O(n^2) stall.
   */
  private rowStart: Int32Array;
  /** Widest species separation, metres — sets the look-back window. */
  private readonly maxSpacing: number;

  constructor(
    readonly cfg: FieldConfig,
    private world: WorldQuery,
    /** Measured plant height in metres at scale 1, per species index. */
    private heights: number[],
  ) {
    this.grid = new Float32Array(cfg.gridRes * cfg.gridRes);
    this.noise = new Noise(cfg.seed ^ 0x1f0a3b);
    const max = cfg.candidates * cfg.candidates;
    this.bufSpecies = new Uint8Array(max);
    this.bufVariant = new Uint8Array(max);
    this.bufPos = new Float32Array(max * 3);
    this.bufNrm = new Float32Array(max * 3);
    this.bufData = new Float32Array(max * 4);
    this.bufWarp = new Float32Array(max * 4);
    this.bufTint = new Float32Array(max * 3);
    this.bufXform = new Float32Array(max * 2);
    this.rowStart = new Int32Array(cfg.candidates + 1);
    let ms = 0;
    for (const s of SPECIES) ms = Math.max(ms, s.spacing);
    this.maxSpacing = ms;
  }

  get(cx: number, cz: number): FloraCell | undefined {
    return this.cells.get(cellKey(cx, cz));
  }

  has(cx: number, cz: number): boolean {
    return this.cells.has(cellKey(cx, cz));
  }

  /** Generates and caches one cell. Costs ~0.3 ms; call it a few per frame. */
  ensure(cx: number, cz: number): FloraCell {
    const key = cellKey(cx, cz);
    const existing = this.cells.get(key);
    if (existing) return existing;
    const cell = this.build(cx, cz);
    this.cells.set(key, cell);
    return cell;
  }

  evictUntouched(currentFrame: number, maxAge: number): void {
    for (const [key, cell] of this.cells) {
      if (currentFrame - cell.touched > maxAge) this.cells.delete(key);
    }
  }

  clear(): void {
    this.cells.clear();
  }

  /* -------------------------------------------------------------- *
   * Cell construction
   * -------------------------------------------------------------- */

  private build(cx: number, cz: number): FloraCell {
    const { cellSize, gridRes, candidates } = this.cfg;
    const ox = cx * cellSize;
    const oz = cz * cellSize;
    const step = cellSize / (gridRes - 1);
    const grid = this.grid;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < gridRes; j++) {
      const wz = oz + j * step;
      for (let i = 0; i < gridRes; i++) {
        const h = this.world.heightAt(ox + i * step, wz);
        grid[j * gridRes + i] = h;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }

    // --- species lottery, blended across every contributing biome ---
    const acc = this.accW;
    acc.fill(0);
    for (let s = 0; s < 5; s++) {
      const fx = s === 0 ? 0.5 : s === 1 || s === 3 ? 0.22 : 0.78;
      const fz = s === 0 ? 0.5 : s < 3 ? 0.22 : 0.78;
      const sample = this.world.biomeAt(ox + fx * cellSize, oz + fz * cellSize);
      // Normalise the blend so a cell where four biomes overlap is not four
      // times as densely planted as one where a single biome dominates.
      let wsum = 0;
      for (const id in sample.weights) wsum += sample.weights[id];
      if (wsum <= 1e-5) continue;
      for (const id in sample.weights) {
        const biome = BIOME_MAP.get(id);
        if (!biome) continue;
        const bw = sample.weights[id] / wsum;
        for (const entry of biome.flora) {
          const idx = SPECIES_INDEX.get(entry.id);
          if (idx === undefined) continue;
          acc[idx] += (bw * entry.density * SPECIES[idx].densityMul) / 5;
        }
      }
    }

    const lotSp = this.lotSp;
    const lotCum = this.lotCum;
    lotSp.length = 0;
    lotCum.length = 0;
    let total = 0;
    for (let i = 0; i < acc.length; i++) {
      if (acc[i] <= 1e-4) continue;
      total += acc[i];
      lotSp.push(i);
      lotCum.push(total);
    }

    const cell = new FloraCell();
    cell.cx = cx;
    cell.cz = cz;
    cell.centreX = ox + cellSize * 0.5;
    cell.centreZ = oz + cellSize * 0.5;
    cell.centreY = (minY + maxY) * 0.5;
    // Radius covers the diagonal plus the tallest plant we might place.
    cell.radius = Math.hypot(cellSize * 0.5, cellSize * 0.5) + (maxY - minY) * 0.5 + 34;

    if (total <= 0) return cell;

    const k = candidates;
    const spacingStep = cellSize / k;
    const cellArea = spacingStep * spacingStep;
    const pBase = Math.min(1, total * this.cfg.plantsPerM2 * cellArea);

    let n = 0;
    const bp = this.bufPos;
    const seedBase = this.cfg.seed ^ (cx * 0x9e3779b1) ^ (cz * 0x85ebca6b);
    // Any accepted plant that could block this one lies within this many rows.
    const rowSpan = Math.ceil(this.maxSpacing * 0.5 / spacingStep) + 1;
    const rowStart = this.rowStart;

    for (let j = 0; j < k; j++) {
      rowStart[j] = n;
      for (let i = 0; i < k; i++) {
        const hx = hash2(cx * k + i, cz * k + j, seedBase);
        const hy = hash2(cx * k + i + 7919, cz * k + j - 4271, seedBase);
        const x = ox + (i + 0.5 + (hx - 0.5) * 0.88) * spacingStep;
        const z = oz + (j + 0.5 + (hy - 0.5) * 0.88) * spacingStep;

        // --- lottery ---
        const hs = hash2(cx * k + i + 131, cz * k + j + 977, seedBase ^ 0x5bd1e995);
        const pick = hs * total;
        let lo = 0;
        while (lo < lotCum.length - 1 && lotCum[lo] < pick) lo++;
        const si = lotSp[lo];
        const sp = SPECIES[si];

        // --- terrain sample by bilinear interpolation of the cell grid ---
        const gx = ((x - ox) / step);
        const gz = ((z - oz) / step);
        const i0 = Math.min(gridRes - 2, Math.max(0, Math.floor(gx)));
        const j0 = Math.min(gridRes - 2, Math.max(0, Math.floor(gz)));
        const fx = gx - i0;
        const fz = gz - j0;
        const h00 = grid[j0 * gridRes + i0];
        const h10 = grid[j0 * gridRes + i0 + 1];
        const h01 = grid[(j0 + 1) * gridRes + i0];
        const h11 = grid[(j0 + 1) * gridRes + i0 + 1];
        const y = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;

        const depth = -y;
        if (depth < sp.minDepth || depth > sp.maxDepth) continue;

        // Gradient of the same bilinear patch — consistent with the height used.
        const dhdx = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / step;
        const dhdz = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / step;
        const nl = Math.hypot(-dhdx, 1, -dhdz);
        const ny = 1 / nl;
        if (ny < sp.minNormalY) continue;
        const nx = -dhdx / nl;
        const nz = -dhdz / nl;

        // --- patchiness ---
        const clump = this.noise.fbm2(x * sp.clumpFreq, z * sp.clumpFreq, 3);
        const patch = Math.max(0, 0.55 + clump * sp.clumpAmt * 1.3);
        const hp = hash2(cx * k + i - 313, cz * k + j + 5171, seedBase ^ 0x27d4eb2d);
        if (hp > pBase * patch) continue;

        // --- min-distance rejection against the recent rows ---
        let blocked = false;
        const from = rowStart[Math.max(0, j - rowSpan)];
        for (let q = from; q < n; q++) {
          const other = SPECIES[this.bufSpecies[q]];
          const need = Math.max(sp.spacing, other.spacing) * 0.5;
          const dx = bp[q * 3] - x;
          const dz = bp[q * 3 + 2] - z;
          if (dx * dx + dz * dz < need * need) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        this.emit(n, si, sp, x, y, z, nx, ny, nz, cx * k + i, cz * k + j, seedBase);
        n++;
      }
    }

    cell.count = n;
    if (n > 0) {
      cell.species = this.bufSpecies.slice(0, n);
      cell.variant = this.bufVariant.slice(0, n);
      cell.pos = this.bufPos.slice(0, n * 3);
      cell.nrm = this.bufNrm.slice(0, n * 3);
      cell.data = this.bufData.slice(0, n * 4);
      cell.warp = this.bufWarp.slice(0, n * 4);
      cell.tint = this.bufTint.slice(0, n * 3);
      cell.xform = this.bufXform.slice(0, n * 2);
    }
    return cell;
  }

  private emit(
    n: number,
    si: number,
    sp: SpeciesDef,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    ix: number,
    iz: number,
    seedBase: number,
  ): void {
    const r1 = hash2(ix + 11, iz + 23, seedBase ^ 0x1b873593);
    const r2 = hash2(ix + 37, iz + 61, seedBase ^ 0x2c1b3c6d);
    const r3 = hash2(ix + 71, iz + 97, seedBase ^ 0x3d4b7f1f);
    const r4 = hash2(ix + 113, iz + 149, seedBase ^ 0x4e6f8a2b);
    const r5 = hash2(ix + 181, iz + 211, seedBase ^ 0x5f7a9b3d);
    const r6 = hash2(ix + 233, iz + 271, seedBase ^ 0x6a8bac4f);

    const scale = sp.scaleMin + (sp.scaleMax - sp.scaleMin) * r1;
    const height = Math.max(0.2, this.heights[si] ?? 1);

    this.bufSpecies[n] = si;
    this.bufVariant[n] = (r2 * 251) & 0xff;

    this.bufPos[n * 3] = x;
    this.bufPos[n * 3 + 1] = y - sp.sink * scale;
    this.bufPos[n * 3 + 2] = z;

    this.bufNrm[n * 3] = nx;
    this.bufNrm[n * 3 + 1] = ny;
    this.bufNrm[n * 3 + 2] = nz;

    this.bufData[n * 4] = r2;
    this.bufData[n * 4 + 1] = r3;
    // Non-uniform vertical stretch: changes proportions, not just size.
    this.bufData[n * 4 + 2] = 0.78 + 0.46 * r4;
    this.bufData[n * 4 + 3] = r5;

    const leanA = r6 * TAU;
    this.bufWarp[n * 4] = (r3 - 0.5) * 2 * sp.twistAmt;
    this.bufWarp[n * 4 + 1] = sp.leanAmt * height * (0.25 + 0.9 * r4);
    this.bufWarp[n * 4 + 2] = Math.cos(leanA);
    this.bufWarp[n * 4 + 3] = Math.sin(leanA);

    // Per-instance tint is a multiplier, not a replacement: brightness, a
    // warm/cool axis and a green/magenta axis. Keeping it multiplicative means
    // the species reads as one species while no two plants match.
    const bright = 1 + (r6 - 0.5) * 2 * sp.tintLum;
    const warm = (r5 - 0.5) * 2 * sp.tintSat;
    const hue = (r4 - 0.5) * 2 * sp.tintHue * 4;
    this.bufTint[n * 3] = clamp(bright * (1 + warm * 0.55 + hue * 0.5), 0.3, 1.8);
    this.bufTint[n * 3 + 1] = clamp(bright * (1 + warm * 0.06 - hue * 0.35), 0.3, 1.8);
    this.bufTint[n * 3 + 2] = clamp(bright * (1 - warm * 0.45 + hue * 0.4), 0.3, 1.8);

    this.bufXform[n * 2] = scale;
    this.bufXform[n * 2 + 1] = r6 * TAU + r5 * 1.7;
  }
}

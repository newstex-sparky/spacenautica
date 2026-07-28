/**
 * ChunkMesher — turns a region of the `TerrainField` into a CDLOD chunk.
 *
 * Every chunk shares one index buffer (topology is identical at all levels), and
 * carries, per vertex:
 *
 *   position   fine grid position, chunk-local
 *   normal     fine grid normal
 *   color      blended biome floor tint
 *   aCoarse    (coarseY, coarseNormal.xyz) — the *next coarser* level's surface
 *   aSurf      (flowX, flowZ, curvature, sediment)
 *   aMorph     (morphStart, morphEnd) in metres of horizontal camera distance
 *
 * The vertex shader lerps position/normal between the fine and coarse values by
 * a factor derived purely from horizontal camera distance. Because the coarse
 * value at an even grid index is *exactly* the field value that the next coarser
 * chunk samples there, and the odd indices are the linear midpoint of the coarse
 * edge, a fully-morphed chunk edge is bit-comparable to its coarser neighbour —
 * no cracks, and no popping on the way there.
 *
 * A short skirt is welded around each chunk anyway, as cheap insurance against
 * a pathological 2-level neighbour difference.
 */
import * as THREE from 'three';
import type { TerrainField } from './TerrainField';
import type { BiomeMap, BiomeShading } from './Biomes';

export class ChunkTemplate {
  readonly n: number;
  readonly interiorCount: number;
  readonly vertexCount: number;
  readonly index: THREE.BufferAttribute;

  constructor(n: number) {
    if (n % 2 !== 0) throw new Error('[terrain] chunk resolution must be even');
    this.n = n;
    const side = n + 1;
    this.interiorCount = side * side;
    this.vertexCount = this.interiorCount + 4 * side;

    const triCount = 2 * n * n + 8 * n;
    const idx = this.vertexCount > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
    let p = 0;
    const at = (i: number, j: number) => i + j * side;
    const sk = (run: number, k: number) => this.interiorCount + run * side + k;

    // interior
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        idx[p++] = a; idx[p++] = d; idx[p++] = b;
        idx[p++] = b; idx[p++] = d; idx[p++] = c;
      }
    }
    // skirt run 0: j = 0, faces -Z
    for (let i = 0; i < n; i++) {
      const a = at(i, 0), b = at(i + 1, 0), ap = sk(0, i), bp = sk(0, i + 1);
      idx[p++] = a; idx[p++] = b; idx[p++] = ap;
      idx[p++] = b; idx[p++] = bp; idx[p++] = ap;
    }
    // skirt run 1: j = n, faces +Z
    for (let i = 0; i < n; i++) {
      const a = at(i, n), b = at(i + 1, n), ap = sk(1, i), bp = sk(1, i + 1);
      idx[p++] = a; idx[p++] = ap; idx[p++] = b;
      idx[p++] = b; idx[p++] = ap; idx[p++] = bp;
    }
    // skirt run 2: i = 0, faces -X
    for (let j = 0; j < n; j++) {
      const a = at(0, j), b = at(0, j + 1), ap = sk(2, j), bp = sk(2, j + 1);
      idx[p++] = a; idx[p++] = ap; idx[p++] = b;
      idx[p++] = b; idx[p++] = ap; idx[p++] = bp;
    }
    // skirt run 3: i = n, faces +X
    for (let j = 0; j < n; j++) {
      const a = at(n, j), b = at(n, j + 1), ap = sk(3, j), bp = sk(3, j + 1);
      idx[p++] = a; idx[p++] = b; idx[p++] = ap;
      idx[p++] = b; idx[p++] = bp; idx[p++] = ap;
    }

    this.index = new THREE.BufferAttribute(idx, 1);
  }

  dispose(): void {
    // BufferAttribute has no GPU handle of its own; three frees it with the
    // last geometry that referenced it. Nothing to do.
  }
}

/** Everything the terrain system keeps about a built chunk. */
export interface ChunkBuild {
  geometry: THREE.BufferGeometry;
  /** Field heights on a (n+5)^2 lattice with a 2-cell border, for fast queries. */
  heights: Float32Array;
  /** World X/Z of heights[0] (i.e. index -2). */
  hOriginX: number;
  hOriginZ: number;
  hStep: number;
  hSide: number;
  minY: number;
  maxY: number;
}

/* Scratch reused across builds so meshing never allocates in the frame loop. */
let scratchHeights: Float32Array | null = null;
let scratchNormals: Float32Array | null = null;
const shade: BiomeShading = { r: 0.8, g: 0.75, b: 0.6, sediment: 0.7, ripple: 1 };
const flow = { x: 1, y: 0 };

export interface MeshChunkArgs {
  field: TerrainField;
  biomes: BiomeMap;
  template: ChunkTemplate;
  /** Chunk world size in metres. */
  size: number;
  /** Chunk grid coordinates at this level. */
  gx: number;
  gz: number;
  /** Camera-distance band over which this chunk morphs to the coarser level. */
  morphStart: number;
  morphEnd: number;
}

export function meshChunk(args: MeshChunkArgs): ChunkBuild {
  const { field, biomes, template, size, gx, gz } = args;
  const n = template.n;
  const side = n + 1;
  const hSide = n + 5;
  const step = size / n;
  const ox = gx * size;
  const oz = gz * size;

  if (!scratchHeights || scratchHeights.length < hSide * hSide) {
    scratchHeights = new Float32Array(hSide * hSide);
    scratchNormals = new Float32Array(hSide * hSide * 3);
  }
  const H = scratchHeights;
  const CN = scratchNormals!;

  /* ---- 1. sample the field on a 2-cell-bordered lattice --------------- */
  let minY = Infinity;
  let maxY = -Infinity;
  for (let j = -2; j <= n + 2; j++) {
    const wz = oz + j * step;
    const row = (j + 2) * hSide;
    for (let i = -2; i <= n + 2; i++) {
      const h = field.height(ox + i * step, wz);
      H[row + i + 2] = h;
      if (i >= 0 && i <= n && j >= 0 && j <= n) {
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
  }
  const h = (i: number, j: number) => H[(j + 2) * hSide + i + 2];

  /* ---- 2. coarse (next-level) heights + normals ----------------------- */
  // Coarse grid = every other vertex. Odd indices are the linear midpoint of
  // the coarse edge, which is exactly what the coarser chunk renders there.
  const coarseY = (i: number, j: number): number => {
    const oddI = i & 1;
    const oddJ = j & 1;
    if (!oddI && !oddJ) return h(i, j);
    if (oddI && !oddJ) return 0.5 * (h(i - 1, j) + h(i + 1, j));
    if (!oddI && oddJ) return 0.5 * (h(i, j - 1) + h(i, j + 1));
    return 0.25 * (h(i - 1, j - 1) + h(i + 1, j - 1) + h(i - 1, j + 1) + h(i + 1, j + 1));
  };
  // Coarse normals at even nodes only (spacing 2*step), stored in CN.
  const cStep2 = 4 * step;
  for (let j = 0; j <= n; j += 2) {
    for (let i = 0; i <= n; i += 2) {
      const dx = coarseY(i - 2, j) - coarseY(i + 2, j);
      const dz = coarseY(i, j - 2) - coarseY(i, j + 2);
      const len = Math.sqrt(dx * dx + cStep2 * cStep2 + dz * dz) || 1;
      const o = ((j + 2) * hSide + i + 2) * 3;
      CN[o] = dx / len;
      CN[o + 1] = cStep2 / len;
      CN[o + 2] = dz / len;
    }
  }
  const cn = (i: number, j: number, c: number): number => CN[((j + 2) * hSide + i + 2) * 3 + c];
  const coarseNormal = (i: number, j: number, out: Float32Array): void => {
    const oddI = i & 1;
    const oddJ = j & 1;
    let x: number, y: number, z: number;
    if (!oddI && !oddJ) {
      x = cn(i, j, 0); y = cn(i, j, 1); z = cn(i, j, 2);
    } else if (oddI && !oddJ) {
      x = 0.5 * (cn(i - 1, j, 0) + cn(i + 1, j, 0));
      y = 0.5 * (cn(i - 1, j, 1) + cn(i + 1, j, 1));
      z = 0.5 * (cn(i - 1, j, 2) + cn(i + 1, j, 2));
    } else if (!oddI && oddJ) {
      x = 0.5 * (cn(i, j - 1, 0) + cn(i, j + 1, 0));
      y = 0.5 * (cn(i, j - 1, 1) + cn(i, j + 1, 1));
      z = 0.5 * (cn(i, j - 1, 2) + cn(i, j + 1, 2));
    } else {
      x = 0.25 * (cn(i - 1, j - 1, 0) + cn(i + 1, j - 1, 0) + cn(i - 1, j + 1, 0) + cn(i + 1, j + 1, 0));
      y = 0.25 * (cn(i - 1, j - 1, 1) + cn(i + 1, j - 1, 1) + cn(i - 1, j + 1, 1) + cn(i + 1, j + 1, 1));
      z = 0.25 * (cn(i - 1, j - 1, 2) + cn(i + 1, j - 1, 2) + cn(i - 1, j + 1, 2) + cn(i + 1, j + 1, 2));
    }
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    out[0] = x / len;
    out[1] = y / len;
    out[2] = z / len;
  };

  /* ---- 3. fill the vertex buffers ------------------------------------- */
  const vc = template.vertexCount;
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const col = new Float32Array(vc * 3);
  const aCoarse = new Float32Array(vc * 4);
  const aSurf = new Float32Array(vc * 4);
  const aMorph = new Float32Array(vc * 2);
  const cnTmp = new Float32Array(3);

  const twoStep = 2 * step;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = i + j * side;
      const y = h(i, j);
      const wx = ox + i * step;
      const wz = oz + j * step;

      pos[v * 3] = i * step;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = j * step;

      const dx = h(i - 1, j) - h(i + 1, j);
      const dz = h(i, j - 1) - h(i, j + 1);
      const nl = Math.sqrt(dx * dx + twoStep * twoStep + dz * dz) || 1;
      nrm[v * 3] = dx / nl;
      nrm[v * 3 + 1] = twoStep / nl;
      nrm[v * 3 + 2] = dz / nl;

      aCoarse[v * 4] = coarseY(i, j);
      coarseNormal(i, j, cnTmp);
      aCoarse[v * 4 + 1] = cnTmp[0];
      aCoarse[v * 4 + 2] = cnTmp[1];
      aCoarse[v * 4 + 3] = cnTmp[2];

      // Scale-invariant curvature: the laplacian expressed per grid step, so a
      // roughly self-similar field reads the same at every LOD.
      const lap = h(i - 1, j) + h(i + 1, j) + h(i, j - 1) + h(i, j + 1) - 4 * y;
      const curv = Math.max(-1, Math.min(1, lap / (step * 3)));

      field.flowInto(wx, wz, flow);
      biomes.shadeInto(wx, wz, -y, shade);

      col[v * 3] = shade.r;
      col[v * 3 + 1] = shade.g;
      col[v * 3 + 2] = shade.b;

      aSurf[v * 4] = flow.x;
      aSurf[v * 4 + 1] = flow.y;
      aSurf[v * 4 + 2] = curv;
      aSurf[v * 4 + 3] = shade.sediment;

      aMorph[v * 2] = args.morphStart;
      aMorph[v * 2 + 1] = args.morphEnd;
    }
  }

  /* ---- 4. skirt ------------------------------------------------------- */
  const drop = Math.max(2.5, step * 2.6);
  const copySkirt = (dst: number, src: number): void => {
    pos[dst * 3] = pos[src * 3];
    pos[dst * 3 + 1] = pos[src * 3 + 1] - drop;
    pos[dst * 3 + 2] = pos[src * 3 + 2];
    nrm[dst * 3] = nrm[src * 3];
    nrm[dst * 3 + 1] = nrm[src * 3 + 1];
    nrm[dst * 3 + 2] = nrm[src * 3 + 2];
    col[dst * 3] = col[src * 3];
    col[dst * 3 + 1] = col[src * 3 + 1];
    col[dst * 3 + 2] = col[src * 3 + 2];
    aCoarse[dst * 4] = aCoarse[src * 4] - drop;
    aCoarse[dst * 4 + 1] = aCoarse[src * 4 + 1];
    aCoarse[dst * 4 + 2] = aCoarse[src * 4 + 2];
    aCoarse[dst * 4 + 3] = aCoarse[src * 4 + 3];
    aSurf[dst * 4] = aSurf[src * 4];
    aSurf[dst * 4 + 1] = aSurf[src * 4 + 1];
    aSurf[dst * 4 + 2] = aSurf[src * 4 + 2];
    aSurf[dst * 4 + 3] = aSurf[src * 4 + 3];
    aMorph[dst * 2] = aMorph[src * 2];
    aMorph[dst * 2 + 1] = aMorph[src * 2 + 1];
  };
  const base = template.interiorCount;
  for (let k = 0; k <= n; k++) {
    copySkirt(base + 0 * side + k, k + 0 * side);
    copySkirt(base + 1 * side + k, k + n * side);
    copySkirt(base + 2 * side + k, 0 + k * side);
    copySkirt(base + 3 * side + k, n + k * side);
  }

  /* ---- 5. geometry ---------------------------------------------------- */
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aCoarse', new THREE.BufferAttribute(aCoarse, 4));
  geo.setAttribute('aSurf', new THREE.BufferAttribute(aSurf, 4));
  geo.setAttribute('aMorph', new THREE.BufferAttribute(aMorph, 2));
  geo.setIndex(template.index);

  // Bounding sphere by hand: computeBoundingSphere would ignore the fact that
  // the vertex shader displaces up to `coarse` height.
  const cy = (minY + maxY) * 0.5;
  const half = size * 0.5;
  const vert = (maxY - minY) * 0.5 + drop + 4;
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(half, cy, half),
    Math.sqrt(2 * half * half + vert * vert),
  );
  geo.boundingBox = new THREE.Box3(
    new THREE.Vector3(0, minY - drop, 0),
    new THREE.Vector3(size, maxY, size),
  );

  // Keep the sampled lattice: `heightAt` bilinear-samples it, which makes the
  // collision surface identical to the rendered surface rather than merely
  // close to it.
  const heights = new Float32Array(hSide * hSide);
  heights.set(H.subarray(0, hSide * hSide));

  return {
    geometry: geo,
    heights,
    hOriginX: ox - 2 * step,
    hOriginZ: oz - 2 * step,
    hStep: step,
    hSide,
    minY,
    maxY,
  };
}

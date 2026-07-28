/**
 * Procedural texture generation for the flora layer.
 *
 * Everything here is synthesised from integer hashes at runtime — no image is
 * ever fetched. Three material *families* cover the whole species roster:
 *
 *   `blade` — kelp / seagrass laminae: anisotropic fibres, a raised midrib,
 *             chevron veins, age blotches and edge erosion in the alpha.
 *   `crust` — corals and sponges: porous pitting over macro lumps.
 *   `flesh` — mushrooms and bioluminescent tissue: soft, waxy, faintly cellular.
 *
 * Each family yields albedo (+alpha), a derived tangent-space normal map and a
 * roughness map. The shader samples every one of them twice — once at the
 * species' natural scale (mid detail) and once at 8-14x (micro grain) — and
 * multiplies in a third, world-space macro layer, which is how a single 256px
 * set holds up from 30 m and from 30 cm without reading as tiled.
 */
import * as THREE from 'three';
import { hash2 } from '../../core/Noise';

export type FloraFamily = 'blade' | 'crust' | 'flesh';

export interface FloraMapSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/* ------------------------------------------------------------------ *
 * Tileable value-noise fBm.
 *
 * The lattice period is carried per axis so the field wraps exactly at the
 * texture border at every octave — this is what lets us mip and repeat the
 * result without a seam. Frequencies must be integers.
 * ------------------------------------------------------------------ */

function wrapi(a: number, p: number): number {
  return ((a % p) + p) % p;
}

function tileValue(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = wrapi(xi, px);
  const x1 = wrapi(xi + 1, px);
  const y0 = wrapi(yi, py);
  const y1 = wrapi(yi + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Tileable fBm over the unit square. `fx`/`fy` are integer base frequencies. */
function tfbm(u: number, v: number, fx: number, fy: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let sx = fx;
  let sy = fy;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileValue(u * sx, v * sy, sx, sy, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    sx *= 2;
    sy *= 2;
  }
  return sum / Math.max(norm, 1e-5);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/* ------------------------------------------------------------------ *
 * Family shaders (evaluated on the CPU, once, at boot)
 * ------------------------------------------------------------------ */

interface Sample {
  /** Relief height, roughly 0..1 — feeds the derived normal map. */
  h: number;
  r: number;
  g: number;
  b: number;
  /** Coverage. Only consumed where the vertex `blade` weight is non-zero. */
  a: number;
  rough: number;
}

const OUT: Sample = { h: 0, r: 0, g: 0, b: 0, a: 1, rough: 0.6 };

function sampleBlade(u: number, v: number, s: number, out: Sample): void {
  // Long fibres running the length of the lamina, plus finer strands.
  const fib = tfbm(u, v, 24, 3, 3, s + 11);
  const strand = tfbm(u, v, 56, 7, 2, s + 23);
  const blotch = tfbm(u, v, 4, 4, 3, s + 37);
  const grain = tfbm(u, v, 96, 96, 2, s + 53);
  const wet = tfbm(u, v, 9, 9, 2, s + 71);
  const erode = tfbm(u, v, 20, 20, 3, s + 89);

  // Raised central midrib (the structural rib of a kelp blade).
  const dx = (u - 0.5) * 5.2;
  const midrib = Math.exp(-dx * dx * 2.0);
  // Chevron veins fanning out from the midrib.
  const veinP = Math.sin((u - 0.5) * 21.0 + v * 44.0 + blotch * 7.0);
  const vein = Math.max(0, veinP) * (1 - midrib) * 0.55;

  out.h = 0.42 * fib + 0.55 * midrib + 0.20 * vein + 0.16 * strand + 0.10 * grain;

  const age = smoothstep(0.54, 0.94, blotch);
  let lum = 0.70 + 0.30 * (fib - 0.5) + 0.26 * (blotch - 0.5) + 0.10 * (grain - 0.5) + 0.20 * midrib;
  lum *= 1 - 0.24 * vein;
  lum = Math.max(0.12, lum);
  out.r = lum * (1 + 0.34 * age);
  out.g = lum * (1 + 0.09 * age);
  out.b = lum * (1 - 0.30 * age);

  // Wet sheen lives in the roughness map; dried patches near the tip are rougher.
  out.rough = clamp01(0.60 - 0.30 * wet - 0.16 * midrib + 0.16 * (grain - 0.5) + 0.10 * age);

  // Ragged, insect-eaten margins. Applied in the shader only where the vertex
  // blade weight says "this really is a thin lamina edge".
  const edge = Math.min(u, 1 - u) * 2;
  const bite = (erode - 0.5) * 0.30;
  out.a = smoothstep(0.0, 0.20, edge + bite) * smoothstep(1.02, 0.86, v - bite * 0.6);
}

function sampleCrust(u: number, v: number, s: number, out: Sample): void {
  const lump = tfbm(u, v, 5, 5, 3, s + 11);
  const pore = tfbm(u, v, 26, 26, 2, s + 23);
  const pore2 = tfbm(u, v, 58, 58, 2, s + 37);
  const grain = tfbm(u, v, 112, 112, 2, s + 53);
  const calc = tfbm(u, v, 13, 13, 3, s + 71);

  // Osculum-like pits: threshold the mid-frequency field so the openings read
  // as discrete holes rather than smooth noise.
  const pit = smoothstep(0.60, 0.33, pore) * 0.85 + smoothstep(0.66, 0.44, pore2) * 0.35;

  out.h = 0.55 * lump + 0.30 * calc + 0.20 * pore2 + 0.10 * grain - 0.55 * pit;

  let lum = 0.62 + 0.34 * (lump - 0.5) + 0.22 * (calc - 0.5) + 0.14 * (grain - 0.5);
  lum *= 1 - 0.52 * clamp01(pit);
  lum = Math.max(0.08, lum);
  // Pits go cooler (they are in shadow and full of water), ridges warmer.
  const warm = smoothstep(0.45, 0.85, lump);
  out.r = lum * (1 + 0.20 * warm - 0.10 * pit);
  out.g = lum * (1 + 0.04 * warm);
  out.b = lum * (1 - 0.14 * warm + 0.26 * pit);
  out.rough = clamp01(0.80 + 0.14 * (grain - 0.5) - 0.20 * warm + 0.10 * pit);
  out.a = 1;
}

function sampleFlesh(u: number, v: number, s: number, out: Sample): void {
  const soft = tfbm(u, v, 3, 3, 3, s + 11);
  const cell = tfbm(u, v, 17, 17, 3, s + 23);
  const speck = tfbm(u, v, 78, 78, 2, s + 37);
  const streak = tfbm(u, v, 6, 40, 2, s + 53);

  out.h = 0.58 * soft + 0.30 * cell + 0.14 * speck + 0.18 * streak;

  let lum = 0.78 + 0.20 * (soft - 0.5) + 0.16 * (cell - 0.5) + 0.08 * (speck - 0.5) + 0.10 * (streak - 0.5);
  lum = Math.max(0.14, lum);
  const bruise = smoothstep(0.62, 0.95, cell);
  out.r = lum * (1 + 0.10 * bruise);
  out.g = lum * (1 - 0.06 * bruise);
  out.b = lum * (1 + 0.16 * bruise);
  out.rough = clamp01(0.46 + 0.22 * (soft - 0.5) + 0.16 * (speck - 0.5) - 0.12 * bruise);
  out.a = 1;
}

const SAMPLERS: Record<FloraFamily, (u: number, v: number, s: number, out: Sample) => void> = {
  blade: sampleBlade,
  crust: sampleCrust,
  flesh: sampleFlesh,
};

const BUMP: Record<FloraFamily, number> = { blade: 1.9, crust: 2.6, flesh: 1.25 };

/* ------------------------------------------------------------------ *
 * Map-set generation
 * ------------------------------------------------------------------ */

function finish(tex: THREE.Texture, srgb: boolean, anisotropy: number): THREE.Texture {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds the albedo/normal/roughness triple for one family. Cost scales with
 * `size^2`; 256 is the default and 128 is used on the low tier.
 */
export function generateFloraMaps(family: FloraFamily, size: number, seed: number, anisotropy: number): FloraMapSet {
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const sampler = SAMPLERS[family];

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      sampler(u, v, seed, OUT);
      const i = y * size + x;
      height[i] = OUT.h;
      const o = i * 4;
      albedo[o] = Math.min(255, Math.max(0, (Math.sqrt(clamp01(OUT.r)) * 255) | 0));
      albedo[o + 1] = Math.min(255, Math.max(0, (Math.sqrt(clamp01(OUT.g)) * 255) | 0));
      albedo[o + 2] = Math.min(255, Math.max(0, (Math.sqrt(clamp01(OUT.b)) * 255) | 0));
      albedo[o + 3] = (clamp01(OUT.a) * 255) | 0;
      // three reads roughness from .g and metalness from .b.
      const rr = (clamp01(OUT.rough) * 255) | 0;
      rough[o] = rr;
      rough[o + 1] = rr;
      rough[o + 2] = 0;
      rough[o + 3] = 255;
    }
  }

  // Derive a tangent-space normal from the relief with wrapped differences.
  const normal = new Uint8Array(n * 4);
  const k = BUMP[family] * (size / 256);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dhdx = (height[yc + xp] - height[yc + xm]) * k;
      const dhdy = (height[yp + x] - height[ym + x]) * k;
      let nx = -dhdx;
      let ny = -dhdy;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (yc + x) * 4;
      normal[o] = ((nx * 0.5 + 0.5) * 255) | 0;
      normal[o + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      normal[o + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      normal[o + 3] = 255;
    }
  }

  return {
    map: finish(new THREE.DataTexture(albedo, size, size, THREE.RGBAFormat), true, anisotropy),
    normalMap: finish(new THREE.DataTexture(normal, size, size, THREE.RGBAFormat), false, anisotropy),
    roughnessMap: finish(new THREE.DataTexture(rough, size, size, THREE.RGBAFormat), false, anisotropy),
  };
}

/* ------------------------------------------------------------------ *
 * Impostor baking for the furthest LOD
 *
 * Rather than hand-authoring billboard cards (which never match the mesh they
 * replace and therefore pop), we software-rasterise the species' own simplified
 * geometry into an alpha-tested card. Same silhouette, same shading ramp, same
 * per-species colour — so the dithered crossfade has nothing to give away.
 * ------------------------------------------------------------------ */

export interface Impostor {
  texture: THREE.Texture;
  /** width / height of the baked footprint, so the card quad matches. */
  aspect: number;
}

const LIGHT_X = 0.34;
const LIGHT_Y = 0.78;
const LIGHT_Z = 0.52;

export function bakeImpostor(
  geo: THREE.BufferGeometry,
  tint: THREE.Color,
  width: number,
  height: number,
  anisotropy: number,
): Impostor {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const bend = geo.getAttribute('aBend');
  const index = geo.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;

  geo.computeBoundingBox();
  const bb = geo.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
  // Bake a front orthographic view. The card is as wide as the widest of the
  // two horizontal axes so a Y-rotated instance never clips its own silhouette.
  const halfW = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 0.02) * 0.5;
  const cx = (bb.max.x + bb.min.x) * 0.5;
  const y0 = bb.min.y;
  const y1 = Math.max(bb.max.y, y0 + 0.02);
  const aspect = (halfW * 2) / (y1 - y0);

  const SS = 2; // supersample factor
  const W = width * SS;
  const H = height * SS;
  const cov = new Float32Array(W * H);
  const acc = new Float32Array(W * H * 3);
  const zbuf = new Float32Array(W * H).fill(-1e9);

  const margin = 1.5 / SS;
  const sx = (W - 2 * margin * SS) / (halfW * 2);
  const sy = (H - 2 * margin * SS) / (y1 - y0);

  const toScreen = (vi: number, out: number[]): void => {
    out[0] = (pos.getX(vi) - cx + halfW) * sx + margin * SS;
    out[1] = H - ((pos.getY(vi) - y0) * sy + margin * SS);
    out[2] = pos.getZ(vi);
  };

  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  const shade = (vi: number): number => {
    const d = nrm.getX(vi) * LIGHT_X + nrm.getY(vi) * LIGHT_Y + nrm.getZ(vi) * LIGHT_Z;
    const ao = bend ? bend.getW(vi) : 1;
    // Soft baked shade only — the card is still lit by the scene, so heavy
    // baked contrast would double-darken it.
    return (0.52 + 0.48 * Math.abs(d)) * (0.58 + 0.42 * ao);
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    toScreen(i0, a);
    toScreen(i1, b);
    toScreen(i2, c);

    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (minX > maxX || minY > maxY) continue;

    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    const inv = 1 / area;

    const s0 = shade(i0);
    const s1 = shade(i1);
    const s2 = shade(i2);

    for (let py = minY; py <= maxY; py++) {
      const fy = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const fx = px + 0.5;
        const w0 = ((b[0] - fx) * (c[1] - fy) - (c[0] - fx) * (b[1] - fy)) * inv;
        const w1 = ((c[0] - fx) * (a[1] - fy) - (a[0] - fx) * (c[1] - fy)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = a[2] * w0 + b[2] * w1 + c[2] * w2;
        const o = py * W + px;
        if (z <= zbuf[o]) continue;
        zbuf[o] = z;
        const l = s0 * w0 + s1 * w1 + s2 * w2;
        cov[o] = 1;
        acc[o * 3] = tint.r * l;
        acc[o * 3 + 1] = tint.g * l;
        acc[o * 3 + 2] = tint.b * l;
      }
    }
  }

  // Box-downsample to get antialiased coverage, then flood the colour outward
  // by one texel so mipping never pulls black in from empty space.
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const o = (y * SS + j) * W + (x * SS + i);
          if (cov[o] > 0) {
            cr += acc[o * 3];
            cg += acc[o * 3 + 1];
            cb += acc[o * 3 + 2];
            ca += 1;
          }
        }
      }
      const o = (y * width + x) * 4;
      if (ca > 0) {
        data[o] = Math.min(255, (Math.sqrt(cr / ca) * 255) | 0);
        data[o + 1] = Math.min(255, (Math.sqrt(cg / ca) * 255) | 0);
        data[o + 2] = Math.min(255, (Math.sqrt(cb / ca) * 255) | 0);
        data[o + 3] = ((ca / (SS * SS)) * 255) | 0;
      } else {
        data[o + 3] = 0;
      }
    }
  }
  dilateRGB(data, width, height, 2);

  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, aspect };
}

/** Pushes colour (not alpha) outward into transparent texels. */
function dilateRGB(data: Uint8Array, w: number, h: number, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const src = data.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (src[o + 3] > 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const no = (ny * w + nx) * 4;
            if (src[no + 3] === 0 && !(src[no] || src[no + 1] || src[no + 2])) continue;
            r += src[no];
            g += src[no + 1];
            b += src[no + 2];
            n++;
          }
        }
        if (n === 0) continue;
        data[o] = (r / n) | 0;
        data[o + 1] = (g / n) | 0;
        data[o + 2] = (b / n) | 0;
      }
    }
  }
}

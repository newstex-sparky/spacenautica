import * as THREE from 'three';

/**
 * Procedurally generated 3D colour LUTs for the underwater look.
 *
 * Zero external assets: the cubes are built in code at boot from a small grading
 * model — per-channel extinction gain, a three-way (lift/gamma/gain style)
 * shadow-midtone-highlight tint, a saturation roll-off and an S-curve. Three
 * bands are generated and the grade pass cross-fades between the two that
 * bracket the current camera depth, so the palette actually shifts as you
 * descend instead of sitting on one fixed teal.
 *
 * The cubes operate on **display-referred sRGB** values, exactly like a .cube
 * file, so the grade pass applies them after tonemapping and the sRGB transfer.
 */

export interface LutBand {
  /** Depth in metres at which this band is fully weighted. */
  depth: number;
  texture: THREE.Data3DTexture;
}

interface GradeSpec {
  /** Multiplied onto linear RGB — this is the wavelength-dependent part. */
  gain: [number, number, number];
  /** Added to the linear shadows. */
  shadowTint: [number, number, number];
  /** Multiplied into the midtones. */
  midTint: [number, number, number];
  /** Multiplied into the highlights. */
  highTint: [number, number, number];
  /** < 1 desaturates. */
  saturation: number;
  /** S-curve strength around mid grey. */
  contrast: number;
  /** Overall gamma on the display signal. */
  gamma: number;
  /** Blacks are lifted toward this colour by this amount. */
  lift: [number, number, number];
  liftAmount: number;
}

const BANDS: Array<{ depth: number; spec: GradeSpec }> = [
  {
    // Surface / sunlit shallows: warm sun, turquoise shadows, punchy.
    depth: 0,
    spec: {
      gain: [1.02, 1.0, 0.98],
      shadowTint: [-0.004, 0.006, 0.014],
      midTint: [0.98, 1.02, 1.04],
      highTint: [1.04, 1.01, 0.96],
      saturation: 1.08,
      contrast: 0.17,
      gamma: 0.98,
      lift: [0.02, 0.09, 0.12],
      liftAmount: 0.035,
    },
  },
  {
    // 15-120 m: red is gone, the world is teal, contrast flattens with haze.
    depth: 55,
    spec: {
      gain: [0.72, 0.99, 1.06],
      shadowTint: [-0.01, 0.008, 0.022],
      midTint: [0.86, 1.03, 1.1],
      highTint: [0.92, 1.02, 1.05],
      saturation: 0.92,
      contrast: 0.15,
      gamma: 1.02,
      lift: [0.01, 0.07, 0.13],
      liftAmount: 0.045,
    },
  },
  {
    // Deep: nearly monochrome blue, crushed blacks with a cold lift.
    depth: 220,
    spec: {
      gain: [0.42, 0.78, 1.08],
      shadowTint: [-0.012, 0.004, 0.026],
      midTint: [0.7, 0.94, 1.14],
      highTint: [0.78, 0.96, 1.12],
      saturation: 0.68,
      contrast: 0.11,
      gamma: 1.06,
      lift: [0.004, 0.035, 0.09],
      liftAmount: 0.062,
    },
  },
];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = Math.max(0, c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function buildCube(size: number, spec: GradeSpec): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  const inv = 1 / (size - 1);
  let p = 0;

  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        // --- to linear ---
        let r = srgbToLinear(ri * inv);
        let g = srgbToLinear(gi * inv);
        let b = srgbToLinear(bi * inv);

        // --- wavelength-dependent gain ---
        r *= spec.gain[0];
        g *= spec.gain[1];
        b *= spec.gain[2];

        // --- three-way tint, weighted by luminance ---
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const wShadow = Math.max(0, 1 - l * 3.2);
        const wHigh = clamp01((l - 0.42) * 1.9);
        const wMid = Math.max(0, 1 - wShadow - wHigh);

        r += spec.shadowTint[0] * wShadow;
        g += spec.shadowTint[1] * wShadow;
        b += spec.shadowTint[2] * wShadow;

        r *= 1 + (spec.midTint[0] - 1) * wMid + (spec.highTint[0] - 1) * wHigh;
        g *= 1 + (spec.midTint[1] - 1) * wMid + (spec.highTint[1] - 1) * wHigh;
        b *= 1 + (spec.midTint[2] - 1) * wMid + (spec.highTint[2] - 1) * wHigh;

        // --- saturation about luminance ---
        const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l2 + (r - l2) * spec.saturation;
        g = l2 + (g - l2) * spec.saturation;
        b = l2 + (b - l2) * spec.saturation;

        // --- back to display, then curve work ---
        let dr = linearToSrgb(r);
        let dg = linearToSrgb(g);
        let db = linearToSrgb(b);

        // S-curve around mid grey (smoothstep blended by strength).
        const s = spec.contrast;
        if (s !== 0) {
          const curve = (v: number): number => {
            const t = clamp01(v);
            return t + s * (t * t * (3 - 2 * t) - t);
          };
          dr = curve(dr);
          dg = curve(dg);
          db = curve(db);
        }

        // Lift: blacks drift toward the water colour instead of clipping to 0.
        const a = spec.liftAmount;
        dr = dr * (1 - a) + spec.lift[0] * a;
        dg = dg * (1 - a) + spec.lift[1] * a;
        db = db * (1 - a) + spec.lift[2] * a;

        dr = Math.pow(clamp01(dr), spec.gamma);
        dg = Math.pow(clamp01(dg), spec.gamma);
        db = Math.pow(clamp01(db), spec.gamma);

        data[p++] = Math.round(clamp01(dr) * 255);
        data[p++] = Math.round(clamp01(dg) * 255);
        data[p++] = Math.round(clamp01(db) * 255);
        data[p++] = 255;
      }
    }
  }

  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Builds the depth-banded LUT set. `size` should be 16 (low) or 32. */
export function buildUnderwaterLuts(size = 32): LutBand[] {
  return BANDS.map((b) => ({ depth: b.depth, texture: buildCube(size, b.spec) }));
}

/**
 * Picks the two bands bracketing `depth` and the blend factor between them.
 * Returned indices are always valid for the array passed in.
 */
export function selectBands(
  bands: LutBand[],
  depth: number,
): { a: number; b: number; mix: number } {
  if (bands.length === 0) return { a: 0, b: 0, mix: 0 };
  if (depth <= bands[0].depth) return { a: 0, b: 0, mix: 0 };
  for (let i = 1; i < bands.length; i++) {
    if (depth <= bands[i].depth) {
      const lo = bands[i - 1].depth;
      const hi = bands[i].depth;
      return { a: i - 1, b: i, mix: (depth - lo) / Math.max(1e-3, hi - lo) };
    }
  }
  const last = bands.length - 1;
  return { a: last, b: last, mix: 0 };
}

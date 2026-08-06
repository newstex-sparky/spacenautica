/**
 * prng.ts
 *
 * Seeded pseudo-random number generators for Spacenautica.
 *
 * The game uses Math.random() in many places (asteroid placement, debris
 * fields, procedural geometry). Math.random() is not seedable, so the same
 * world cannot be reproduced. This module provides two small, well-known,
 * deterministic PRNGs:
 *
 *   - mulberry32      — fast 32-bit PRNG, good statistical quality, tiny.
 *   - xoshiro128**    — higher-quality 128-bit PRNG (the "**" scrambler).
 *
 * Both return floats in [0, 1). Seeding the same generator with the same
 * seed always produces the same sequence, which lets the game reproduce a
 * world layout from a single seed (e.g. a saved world id).
 *
 * Pure and self-contained. No browser or Node globals are required.
 */

/** A function that returns the next pseudo-random float in [0, 1). */
export type PRNG = () => number;

/** Supported seeded PRNG algorithms. */
export type PRNGAlgorithm = 'mulberry32' | 'xoshiro128ss';

/**
 * Create a mulberry32 generator.
 *
 * mulberry32 is a compact 32-bit PRNG by Tommy Ettinger. It is fast and has
 * good statistical quality for game use. The seed is any 32-bit integer.
 */
export function createMulberry32(seed: number): PRNG {
  let a = seed | 0;
  return function mulberry32(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a xoshiro128** generator.
 *
 * xoshiro128** is a 128-bit PRNG from the xoshiro family (Blackman &
 * Vigna). It has excellent statistical quality. The 128-bit state is
 * derived from the seed using splitmix32, so any 32-bit seed works.
 */
export function createXoshiro128ss(seed: number): PRNG {
  // splitmix32 is used only to expand the 32-bit seed into four 32-bit
  // state words. It is a well-known, high-quality seeding step.
  let sm = seed | 0;
  const splitmix32 = (): number => {
    sm = (sm + 0x9e3779b9) | 0;
    let z = sm;
    z = (z ^ (z >>> 16)) | 0;
    z = Math.imul(z, 0x21f0aaad) | 0;
    z = (z ^ (z >>> 15)) | 0;
    z = Math.imul(z, 0x735a2d97) | 0;
    z = (z ^ (z >>> 15)) | 0;
    return z >>> 0;
  };

  let a = splitmix32();
  let b = splitmix32();
  let c = splitmix32();
  let d = splitmix32();

  return function xoshiro128ss(): number {
    const t = (b << 9) | 0;
    let r = (b * 5) | 0;
    r = (((r << 7) | (r >>> 25)) * 9) | 0;
    c = (c ^ a) | 0;
    d = (d ^ b) | 0;
    b = (b ^ c) | 0;
    a = (a ^ d) | 0;
    c = (c ^ t) | 0;
    d = ((d << 11) | (d >>> 21)) | 0;
    return (r >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded PRNG using the named algorithm.
 *
 * Defaults to mulberry32. This is the primary entry point for game code
 * that wants a reproducible random source from a single seed.
 */
export function createSeededRandom(
  seed: number,
  algorithm: PRNGAlgorithm = 'mulberry32',
): PRNG {
  if (algorithm === 'xoshiro128ss') {
    return createXoshiro128ss(seed);
  }
  return createMulberry32(seed);
}

/**
 * Hash an arbitrary string (or number) into a non-negative 32-bit seed.
 *
 * Useful when the natural seed is a world id or a name rather than a
 * number. Deterministic: the same input always maps to the same seed.
 */
export function hashSeed(input: string | number): number {
  const str = String(input);
  // FNV-1a 32-bit hash.
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

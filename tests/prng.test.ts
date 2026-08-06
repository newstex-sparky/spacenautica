import { test } from 'node:test';
import { ok, strictEqual, notStrictEqual } from 'node:assert';

// Reference values are truncated to 10 decimal places, so compare with a
// small tolerance rather than exact equality.
function approx(actual: number, expected: number, msg = ''): void {
  ok(
    Math.abs(actual - expected) < 1e-9,
    `${msg} expected ${actual} to be within 1e-9 of ${expected}`,
  );
}

import {
  createMulberry32,
  createXoshiro128ss,
  createSeededRandom,
  hashSeed,
} from '../src/systems/prng.ts';

// ─── mulberry32 ────────────────────────────────────────────────────────────

test('mulberry32 is deterministic: same seed produces the same sequence', () => {
  const a = createMulberry32(42);
  const b = createMulberry32(42);
  for (let i = 0; i < 20; i++) {
    strictEqual(a(), b(), `value ${i} should match for the same seed`);
  }
});

test('mulberry32 different seeds produce different sequences', () => {
  const a = createMulberry32(1);
  const b = createMulberry32(2);
  let differ = false;
  for (let i = 0; i < 20; i++) {
    if (a() !== b()) {
      differ = true;
      break;
    }
  }
  ok(differ, 'two different seeds should diverge');
});

test('mulberry32(0) matches the canonical reference sequence', () => {
  const rng = createMulberry32(0);
  const expected = [
    0.2664292087, 0.0003297457, 0.2232720274, 0.1462021479, 0.4673278229,
  ];
  for (let i = 0; i < expected.length; i++) {
    approx(rng(), expected[i], `reference value ${i}`);
  }
});

test('mulberry32(12345) matches the canonical reference sequence', () => {
  const rng = createMulberry32(12345);
  const expected = [
    0.9797282678, 0.3067522645, 0.4842054215, 0.8179344125, 0.5094283693,
  ];
  for (let i = 0; i < expected.length; i++) {
    approx(rng(), expected[i], `reference value ${i}`);
  }
});

test('mulberry32 returns floats in [0, 1)', () => {
  const rng = createMulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    ok(v >= 0 && v < 1, `value ${v} must be in [0, 1)`);
  }
});

// ─── xoshiro128** ─────────────────────────────────────────────────────────

test('xoshiro128** is deterministic: same seed produces the same sequence', () => {
  const a = createXoshiro128ss(99);
  const b = createXoshiro128ss(99);
  for (let i = 0; i < 20; i++) {
    strictEqual(a(), b(), `value ${i} should match for the same seed`);
  }
});

test('xoshiro128** different seeds produce different sequences', () => {
  const a = createXoshiro128ss(10);
  const b = createXoshiro128ss(11);
  let differ = false;
  for (let i = 0; i < 20; i++) {
    if (a() !== b()) {
      differ = true;
      break;
    }
  }
  ok(differ, 'two different seeds should diverge');
});

test('xoshiro128**(seed 0) matches the canonical reference sequence', () => {
  const rng = createXoshiro128ss(0);
  const expected = [
    0.4167513326, 0.0104706655, 0.5870561684, 0.8961040510, 0.2650367361,
  ];
  for (let i = 0; i < expected.length; i++) {
    approx(rng(), expected[i], `reference value ${i}`);
  }
});

test('xoshiro128** returns floats in [0, 1)', () => {
  const rng = createXoshiro128ss(3);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    ok(v >= 0 && v < 1, `value ${v} must be in [0, 1)`);
  }
});

// ─── createSeededRandom factory ────────────────────────────────────────────

test('createSeededRandom defaults to mulberry32', () => {
  const rng = createSeededRandom(0);
  const mulberry = createMulberry32(0);
  for (let i = 0; i < 10; i++) {
    strictEqual(rng(), mulberry(), `value ${i} should match mulberry32`);
  }
});

test('createSeededRandom supports the xoshiro128ss algorithm', () => {
  const rng = createSeededRandom(0, 'xoshiro128ss');
  const xoshiro = createXoshiro128ss(0);
  for (let i = 0; i < 10; i++) {
    strictEqual(rng(), xoshiro(), `value ${i} should match xoshiro128**`);
  }
});

test('createSeededRandom is deterministic across calls', () => {
  const a = createSeededRandom(2024);
  const b = createSeededRandom(2024);
  for (let i = 0; i < 20; i++) {
    strictEqual(a(), b());
  }
});

// ─── hashSeed ─────────────────────────────────────────────────────────────

test('hashSeed is deterministic for the same input', () => {
  strictEqual(hashSeed('world-1'), hashSeed('world-1'));
  strictEqual(hashSeed(12345), hashSeed(12345));
});

test('hashSeed maps different inputs to different seeds', () => {
  notStrictEqual(hashSeed('world-1'), hashSeed('world-2'));
  notStrictEqual(hashSeed('alpha'), hashSeed('beta'));
});

test('hashSeed returns a non-negative 32-bit integer', () => {
  const h = hashSeed('any string seed');
  ok(Number.isInteger(h), 'seed must be an integer');
  ok(h >= 0 && h <= 0xffffffff, `seed ${h} must fit in 32 bits`);
});

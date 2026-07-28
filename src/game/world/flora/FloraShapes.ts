/**
 * Parametric generators for every flora species.
 *
 * Each builder is a pure function of `(seed, lod)`. Every dimension it uses —
 * height, taper, blade count, curl, branch angles, groove frequency, lobe
 * asymmetry — is drawn from that seed, so calling a builder with a different
 * seed yields a genuinely different plant rather than a rescaled copy. The
 * flora system bakes several seeds per species per LOD into separate instanced
 * batches and then applies a further per-instance twist/lean/height warp in the
 * vertex shader, so identical silhouettes never appear twice in a frame.
 *
 * `lod` 0 is the full mesh, 1 is the simplified mesh (also the source for the
 * software-baked billboard impostor at LOD 2).
 */
import * as THREE from 'three';
import { Noise, mulberry32 } from '../../core/Noise';
import {
  FloraMeshBuilder,
  blob,
  buildPath,
  lathe,
  lsystem,
  ribbon,
  skinBranches,
  tube,
} from './FloraGeometry';

export type ShapeBuilder = (seed: number, lod: number) => THREE.BufferGeometry;

const TAU = Math.PI * 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ease(x: number): number {
  return x * x * (3 - 2 * x);
}

/* ------------------------------------------------------------------ *
 * Kelps — long ribboned laminae on a flexible stipe
 * ------------------------------------------------------------------ */

interface KelpOpts {
  height: [number, number];
  stipeRadius: [number, number];
  blades: [number, number];
  bladeLength: [number, number];
  bladeWidth: [number, number];
  firstBlade: number;
  /** Terminal gas bladder radius; 0 for none. */
  bladder: number;
  /** Bladder at each blade insertion (true kelp pneumatocysts). */
  perBladeBladder: number;
  nodeBulge: number;
  emitPods: number;
  curl: [number, number];
  droop: number;
}

function buildKelp(seed: number, lod: number, o: KelpOpts): THREE.BufferGeometry {
  const rnd = mulberry32(seed >>> 0);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;

  const H = lerp(o.height[0], o.height[1], rnd());
  const segs = hi ? Math.min(30, Math.max(10, Math.round(H * 1.15))) : Math.max(6, Math.round(H * 0.5));
  const radial = hi ? 6 : 4;
  const r0 = lerp(o.stipeRadius[0], o.stipeRadius[1], rnd());
  const twistDir = rnd() < 0.5 ? -1 : 1;
  const curl = lerp(o.curl[0], o.curl[1], rnd());
  const leanA = rnd() * TAU;
  const lean = 0.03 + rnd() * 0.09;
  const nodeFreq = 3 + Math.floor(rnd() * 4);

  const frames = buildPath(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(Math.cos(leanA) * lean, 1, Math.sin(leanA) * lean).normalize(),
    segs,
    () => H / segs,
    (_i, u, out) => {
      const a = u * 5.5 * twistDir + seed * 0.0007;
      out.set(
        Math.cos(a) * curl + Math.cos(leanA) * 0.006,
        0,
        Math.sin(a) * curl + Math.sin(leanA) * 0.006,
      );
    },
  );

  const stipeAo = (u: number) => 0.22 + 0.78 * ease(Math.min(1, u * 2.4));
  tube(mb, frames, {
    radius: (u) => r0 * (1 - 0.62 * u) * (1 + o.nodeBulge * Math.sin(u * nodeFreq * TAU) ** 2),
    radial,
    wobble: (u, ang) => 0.09 * Math.sin(ang * 3 + u * 22) + 0.05 * Math.sin(u * 47),
    ao: stipeAo,
    tOf: (u) => u,
    phaseSpan: 1,
    blade: 0,
    thick: 0.12,
    vRepeat: H * 0.45,
    capTop: true,
  });

  // Holdfast: a knuckle of fused haptera. Breaks the "cylinder in sand" look.
  const hapCount = hi ? 5 : 3;
  for (let i = 0; i < hapCount; i++) {
    const a = (i / hapCount) * TAU + rnd() * 0.6;
    const rr = r0 * (1.4 + rnd() * 1.5);
    blob(mb, {
      center: new THREE.Vector3(Math.cos(a) * r0 * 1.5, r0 * (0.3 + rnd() * 0.6), Math.sin(a) * r0 * 1.5),
      radius: (d) => rr * (0.7 + 0.5 * Math.abs(d.y) + 0.25 * Math.sin(d.x * 9 + d.z * 7)),
      scale: new THREE.Vector3(1, 0.65, 1),
      subdiv: 0,
      uvScale: 7,
      tOf: () => 0.02,
      ao: () => 0.18,
      thick: 0.05,
    });
  }

  const nBlades = hi
    ? Math.round(lerp(o.blades[0], o.blades[1], rnd()))
    : Math.max(3, Math.round(lerp(o.blades[0], o.blades[1], rnd()) * 0.4));
  const bladeSegs = hi ? 11 : 5;
  const cross = hi ? 2 : 1;
  const outDir = new THREE.Vector3();
  const scaleK = H / 18;

  for (let bi = 0; bi < nBlades; bi++) {
    const u = lerp(o.firstBlade, 0.985, bi / Math.max(1, nBlades - 1)) + (rnd() - 0.5) * 0.03;
    const fi = Math.min(frames.length - 1, Math.max(0, Math.round(u * (frames.length - 1))));
    const f = frames[fi];
    const spiral = bi * 2.399963 + rnd() * 0.5;
    outDir.copy(f.n).multiplyScalar(Math.cos(spiral)).addScaledVector(f.b, Math.sin(spiral));
    const len = lerp(o.bladeLength[0], o.bladeLength[1], rnd()) * scaleK * (0.75 + 0.5 * ease(u));
    const hw = lerp(o.bladeWidth[0], o.bladeWidth[1], rnd()) * scaleK;
    const droop = o.droop * (0.6 + rnd() * 0.9);
    const bSegs = Math.min(bladeSegs, Math.max(3, Math.round(bladeSegs * (0.6 + 0.6 * (len / 3)))));
    const wiggle = 0.05 + rnd() * 0.12;
    const wigglePhase = rnd() * TAU;
    const cupSign = rnd() < 0.5 ? 1 : -1;
    const twistAmp = 0.35 + rnd() * 0.5;

    const start = f.p.clone().addScaledVector(outDir, r0 * (1 - 0.6 * u) * 0.9);
    const bFrames = buildPath(
      start,
      outDir.clone().setY(0.35 + rnd() * 0.5).normalize(),
      bSegs,
      () => len / bSegs,
      (_i, bu, out) => {
        // Droops away from the stipe, then buoyancy lifts the distal half.
        out.set(0, -droop + droop * 2.1 * ease(bu), 0);
        out.x += Math.cos(bu * 9 + wigglePhase) * wiggle;
        out.z += Math.sin(bu * 7.5 + wigglePhase) * wiggle;
      },
    );

    const tBase = u;
    ribbon(mb, bFrames, {
      width: (bu) => hw * (0.35 + 0.9 * Math.sin(Math.min(1, bu * 1.25) * Math.PI) ** 0.55) * (1 - 0.45 * bu),
      twist: (bu) => Math.sin(bu * 3.2 + wigglePhase) * twistAmp + bu * 0.9 * twistDir,
      cup: (bu) => hw * 0.42 * Math.sin(bu * Math.PI) * cupSign,
      cross,
      ao: (bu) => Math.min(1, (0.4 + 0.6 * ease(tBase)) * (0.72 + 0.35 * bu)),
      tOf: (bu) => Math.min(1, tBase + (1 - tBase) * (0.3 + 0.7 * bu)),
      phase: tBase,
      phaseSpan: 0.55,
      blade: 1,
      thick: 0.98,
      vRepeat: Math.max(1, len * 0.7),
      twistWeight: 1,
    });

    // Pneumatocysts on roughly every third insertion: enough to read, cheap
    // enough that a 25 m kelp still fits the vertex budget.
    if (o.perBladeBladder > 0 && bi % 3 === 0) {
      const br = o.perBladeBladder * scaleK * (0.7 + rnd() * 0.7) * 1.5;
      const podLit = rnd() < 0.55 ? 1 : 0.25;
      blob(mb, {
        center: start.clone().addScaledVector(outDir, br * 0.6),
        radius: (d) => br * (1 + 0.14 * Math.sin(d.y * 8 + d.x * 5)),
        scale: new THREE.Vector3(0.85, 1.5, 0.85),
        subdiv: 0,
        uvScale: 9,
        tOf: () => Math.min(1, tBase + 0.05),
        ao: () => 0.55 + 0.45 * ease(tBase),
        emit: () => o.emitPods * podLit,
        thick: 0.55,
        phase: tBase,
      });
    }
  }

  if (o.bladder > 0) {
    const top = frames[frames.length - 1].p;
    const br = o.bladder * scaleK * (0.8 + rnd() * 0.5);
    blob(mb, {
      center: top.clone().add(new THREE.Vector3(0, br * 0.7, 0)),
      radius: (d) => br * (1 + 0.10 * Math.sin(d.x * 7 + d.z * 6) + 0.07 * d.y),
      scale: new THREE.Vector3(1, 1.35, 1),
      subdiv: hi ? 1 : 0,
      uvScale: 6,
      tOf: () => 1,
      ao: () => 1,
      emit: () => o.emitPods * 0.7,
      thick: 0.6,
      phase: 1,
    });
  }

  return mb.geometry();
}

export const buildGiantKelp: ShapeBuilder = (seed, lod) =>
  buildKelp(seed, lod, {
    height: [11, 26],
    stipeRadius: [0.045, 0.075],
    blades: [13, 24],
    bladeLength: [1.4, 3.4],
    bladeWidth: [0.10, 0.20],
    firstBlade: 0.14,
    bladder: 0.20,
    perBladeBladder: 0.055,
    nodeBulge: 0.10,
    emitPods: 0,
    curl: [0.010, 0.030],
    droop: 0.16,
  });

export const buildShortKelp: ShapeBuilder = (seed, lod) =>
  buildKelp(seed, lod, {
    height: [1.5, 4.2],
    stipeRadius: [0.030, 0.055],
    blades: [9, 20],
    bladeLength: [1.6, 4.0],
    bladeWidth: [0.20, 0.42],
    firstBlade: 0.16,
    bladder: 0,
    perBladeBladder: 0,
    nodeBulge: 0.06,
    emitPods: 0,
    curl: [0.02, 0.06],
    droop: 0.26,
  });

export const buildBloodKelp: ShapeBuilder = (seed, lod) =>
  buildKelp(seed, lod, {
    height: [8, 20],
    stipeRadius: [0.07, 0.13],
    blades: [10, 20],
    bladeLength: [1.2, 2.8],
    bladeWidth: [0.12, 0.26],
    firstBlade: 0.20,
    bladder: 0.26,
    perBladeBladder: 0.10,
    nodeBulge: 0.24,
    emitPods: 1,
    curl: [0.008, 0.022],
    droop: 0.20,
  });

/* ------------------------------------------------------------------ *
 * Seagrass — clumps of thin blades from one holdfast
 * ------------------------------------------------------------------ */

export const buildSeagrass: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const n = hi ? 7 + Math.floor(rnd() * 11) : 4 + Math.floor(rnd() * 4);
  const H = 0.35 + rnd() * 0.95;
  const flare = 0.25 + rnd() * 0.7;
  const spiralSeed = rnd() * TAU;

  for (let i = 0; i < n; i++) {
    const a = spiralSeed + i * 2.399963 + (rnd() - 0.5) * 0.7;
    const len = H * (0.5 + rnd() * 0.8);
    const segs = hi ? 7 : 4;
    const bendAmt = flare * (0.5 + rnd() * 1.1);
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const kink = rnd() * TAU;
    const frames = buildPath(
      new THREE.Vector3(dirX * 0.012 * n, 0, dirZ * 0.012 * n),
      new THREE.Vector3(dirX * 0.18, 1, dirZ * 0.18).normalize(),
      segs,
      () => len / segs,
      (_k, u, out) => {
        const g = bendAmt * (0.15 + u * u * 1.6) * 0.18;
        out.set(dirX * g + Math.cos(kink + u * 6) * 0.03, -g * 0.55 * u, dirZ * g + Math.sin(kink + u * 5) * 0.03);
      },
    );
    const hw = (0.012 + rnd() * 0.022) * (0.7 + H);
    ribbon(mb, frames, {
      width: (u) => hw * (0.55 + 0.7 * Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.4) * (1 - 0.6 * u * u),
      twist: (u) => Math.sin(u * 2.6 + kink) * 0.75 + u * 0.6,
      cup: (u) => hw * 0.5 * Math.sin(u * Math.PI),
      cross: hi ? 2 : 1,
      ao: (u) => 0.28 + 0.72 * ease(Math.min(1, u * 1.6)),
      tOf: (u) => u,
      phase: i * 0.137,
      phaseSpan: 0.7,
      blade: 1,
      thick: 1,
      vRepeat: Math.max(1, len * 1.6),
    });
  }
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Algal mat — flat rosette of lobes hugging the floor
 * ------------------------------------------------------------------ */

export const buildAlgaeMat: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const lobes = hi ? 5 + Math.floor(rnd() * 6) : 4;
  const R = 0.35 + rnd() * 0.9;

  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU + (rnd() - 0.5) * 0.5;
    const len = R * (0.6 + rnd() * 0.8);
    const segs = hi ? 6 : 3;
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const ripple = rnd() * TAU;
    const frames = buildPath(
      new THREE.Vector3(0, 0.03 + rnd() * 0.04, 0),
      new THREE.Vector3(dirX, 0.42, dirZ).normalize(),
      segs,
      () => len / segs,
      (_k, u, out) => {
        out.set(0, -0.30 - 0.12 * u, 0);
        out.x += Math.cos(ripple + u * 7) * 0.10;
        out.z += Math.sin(ripple + u * 6) * 0.10;
      },
    );
    const hw = R * (0.22 + rnd() * 0.24);
    ribbon(mb, frames, {
      width: (u) => hw * (0.4 + 1.0 * Math.sin(Math.min(1, u * 1.05) * Math.PI) ** 0.5),
      twist: (u) => Math.sin(u * 4 + ripple) * 0.4,
      cup: (u) => hw * 0.45 * Math.sin(u * Math.PI + ripple),
      cross: hi ? 3 : 1,
      ao: (u) => 0.35 + 0.5 * u,
      tOf: (u) => 0.25 + 0.75 * u,
      phase: i * 0.19,
      phaseSpan: 0.5,
      blade: 1,
      thick: 0.9,
      vRepeat: Math.max(1, len * 1.4),
    });
  }

  // A few upright fronds so the mat is not a pure disc in silhouette.
  const fronds = hi ? 3 + Math.floor(rnd() * 4) : 2;
  for (let i = 0; i < fronds; i++) {
    const a = rnd() * TAU;
    const len = R * (0.5 + rnd() * 0.7);
    const segs = hi ? 5 : 3;
    const frames = buildPath(
      new THREE.Vector3(Math.cos(a) * R * 0.25, 0.02, Math.sin(a) * R * 0.25),
      new THREE.Vector3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25).normalize(),
      segs,
      () => len / segs,
      (_k, u, out) => out.set(Math.cos(a) * 0.12 * u, -0.05, Math.sin(a) * 0.12 * u),
    );
    const hw = R * 0.06;
    ribbon(mb, frames, {
      width: (u) => hw * (0.6 + 0.6 * Math.sin(u * Math.PI)),
      twist: (u) => u * 1.8,
      cross: 1,
      ao: (u) => 0.4 + 0.6 * u,
      tOf: (u) => 0.4 + 0.6 * u,
      phase: 0.3 + i * 0.2,
      phaseSpan: 0.6,
      blade: 1,
      thick: 1,
      vRepeat: 2,
    });
  }
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Brain coral — deformed head with meandering grooves
 * ------------------------------------------------------------------ */

export const buildBrainCoral: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const noise = new Noise(seed ^ 0x51ed);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const R = 0.30 + rnd() * 1.05;
  const flat = 0.55 + rnd() * 0.30;
  const grooveFreq = 5.5 + rnd() * 5.0;
  const lumpAmt = 0.10 + rnd() * 0.12;
  const tilt = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(0.35);

  const radiusOf = (d: THREE.Vector3): number => {
    const w = noise.fbm3(d.x * 1.6, d.y * 1.6, d.z * 1.6, 3);
    const meander = Math.sin(w * grooveFreq + d.y * 2.4 + noise.noise3(d.x * 4, d.y * 4, d.z * 4) * 1.6);
    const groove = Math.pow(1 - Math.abs(meander), 2.2);
    const lump = noise.fbm3(d.x * 2.6 + 11, d.y * 2.6, d.z * 2.6 - 5, 3);
    const bite = Math.max(0, noise.fbm3(d.x * 5 + 31, d.y * 5, d.z * 5, 2)) * 0.10;
    return R * (1 + lumpAmt * lump - 0.075 * groove - bite + tilt.x * d.x + tilt.z * d.z);
  };

  blob(mb, {
    center: new THREE.Vector3(0, R * flat * 0.92, 0),
    radius: radiusOf,
    scale: new THREE.Vector3(1, flat, 0.92 + rnd() * 0.16),
    subdiv: hi ? 3 : 2,
    uvScale: 1.5 / Math.max(0.2, R),
    tOf: (p) => Math.min(1, Math.max(0, p.y / (R * flat * 2))) * 0.35,
    ao: (d) => {
      const w = noise.fbm3(d.x * 1.6, d.y * 1.6, d.z * 1.6, 3);
      const meander = Math.sin(w * grooveFreq + d.y * 2.4);
      const groove = Math.pow(1 - Math.abs(meander), 2.2);
      return Math.min(1, (0.30 + 0.70 * ease(Math.min(1, d.y * 0.5 + 0.65))) * (1 - 0.55 * groove));
    },
    thick: 0.05,
  });

  // Encrusting skirt so it does not float on the sand.
  const skirt = hi ? 4 + Math.floor(rnd() * 4) : 2;
  for (let i = 0; i < skirt; i++) {
    const a = (i / skirt) * TAU + rnd() * 0.7;
    const rr = R * (0.28 + rnd() * 0.26);
    blob(mb, {
      center: new THREE.Vector3(Math.cos(a) * R * 0.82, rr * 0.35, Math.sin(a) * R * 0.82),
      radius: (d) => rr * (0.8 + 0.35 * noise.fbm3(d.x * 4, d.y * 4, d.z * 4, 2)),
      scale: new THREE.Vector3(1, 0.5, 1),
      subdiv: hi ? 1 : 0,
      uvScale: 3 / Math.max(0.2, R),
      tOf: () => 0.05,
      ao: () => 0.35,
      thick: 0.05,
    });
  }
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Tube coral — cluster of polyp tubes with flared, hollow rims
 * ------------------------------------------------------------------ */

export const buildTubeCoral: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const n = hi ? 4 + Math.floor(rnd() * 8) : 3 + Math.floor(rnd() * 3);
  const spread = 0.10 + rnd() * 0.28;
  const maxH = 0.22 + rnd() * 0.95;

  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const rr = spread * Math.sqrt(rnd());
    const cx = Math.cos(a) * rr;
    const cz = Math.sin(a) * rr;
    const h = maxH * (0.35 + rnd() * 0.75);
    const r0 = (0.028 + rnd() * 0.075) * (0.6 + h);
    const flare = 1.25 + rnd() * 0.55;
    const ridges = 5 + Math.floor(rnd() * 7);
    const leanX = (rnd() - 0.5) * 0.30;
    const leanZ = (rnd() - 0.5) * 0.30;

    const profile = (v: number): { r: number; y: number } => {
      if (v < 0.74) {
        const w = v / 0.74;
        return { r: r0 * (1 + 0.22 * Math.sin(w * 3.1) - 0.18 * w), y: h * w };
      }
      if (v < 0.84) {
        const w = (v - 0.74) / 0.10;
        return { r: r0 * lerp(1.04, flare, ease(w)), y: h * lerp(1, 1.05, w) };
      }
      const w = (v - 0.84) / 0.16;
      return { r: r0 * lerp(flare * 0.86, 0.30, ease(w)), y: h * lerp(1.05, 0.60, ease(w)) };
    };

    const base = mb.count;
    lathe(mb, {
      profile,
      rows: hi ? 13 : 7,
      radial: hi ? 10 : 6,
      wobble: (v, ang) => 0.06 * Math.sin(ang * ridges + v * 4) * (1 - v * 0.4) + 0.03 * Math.sin(v * 19),
      ao: (v) => (v < 0.84 ? 0.30 + 0.70 * ease(Math.min(1, v * 1.5)) : 0.20 + 0.2 * (1 - v)),
      tOf: (v) => Math.min(1, v * 0.55),
      blade: 0,
      thick: 0.25,
      phase: i * 0.21,
      uRepeat: 1.5,
      vRepeat: Math.max(1, h * 3),
    });
    // Nudge the whole polyp into place and lean it.
    for (let k = base; k < mb.count; k++) {
      const y = mb.pos[k * 3 + 1];
      mb.pos[k * 3] += cx + leanX * y;
      mb.pos[k * 3 + 2] += cz + leanZ * y;
    }
  }

  // Common calcareous base.
  const noise = new Noise(seed ^ 0x2f7);
  blob(mb, {
    center: new THREE.Vector3(0, 0.02, 0),
    radius: (d) => spread * (1.15 + 0.35 * noise.fbm3(d.x * 3.5, d.y * 3.5, d.z * 3.5, 2)),
    scale: new THREE.Vector3(1, 0.28, 1),
    subdiv: hi ? 2 : 1,
    uvScale: 2.5,
    tOf: () => 0.02,
    ao: () => 0.28,
    thick: 0.05,
  });
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Fan coral — planar gorgonian built by a real branching L-system
 * ------------------------------------------------------------------ */

export const buildFanCoral: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const noise = new Noise(seed ^ 0x77bb);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const H = 0.55 + rnd() * 1.85;
  const levels = hi ? 3 : 2;

  const branches = lsystem({
    rnd,
    origin: new THREE.Vector3(0, 0, 0),
    dir: new THREE.Vector3((rnd() - 0.5) * 0.2, 1, 0).normalize(),
    length: H * 0.34,
    radius: H * (0.016 + rnd() * 0.014),
    levels,
    children: [2, 3],
    spread: 0.42 + rnd() * 0.32,
    lengthDecay: 0.66 + rnd() * 0.14,
    planar: 0.80 + rnd() * 0.17,
    curve: 0.10 + rnd() * 0.12,
    upBias: 0.22 + rnd() * 0.24,
    subSegs: hi ? 5 : 3,
    murray: 2.2 + rnd() * 0.6,
  });

  skinBranches(mb, branches, {
    radial: hi ? 6 : 4,
    ao: (t, depth) => Math.min(1, (0.24 + 0.76 * ease(Math.min(1, t * 1.5))) * (1 - depth * 0.04)),
    wobble: (u, ang, depth) => 0.14 * Math.sin(ang * 3 + u * 15 + depth) + 0.07 * Math.sin(u * 31),
    thick: 0.35,
    polypRadius: hi ? H * 0.014 : 0,
    rnd,
    vScale: 5,
  });

  // Encrusting holdfast plate.
  blob(mb, {
    center: new THREE.Vector3(0, 0.012, 0),
    radius: (d) => H * 0.10 * (1 + 0.4 * noise.fbm3(d.x * 4, d.y * 4, d.z * 4, 2)),
    scale: new THREE.Vector3(1, 0.30, 1),
    subdiv: hi ? 1 : 0,
    uvScale: 6,
    tOf: () => 0.01,
    ao: () => 0.25,
    thick: 0.05,
  });
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Barrel sponge — one continuous lathe up the outside, over the rim,
 * and down into the atrium, so the cavity is genuinely visible
 * ------------------------------------------------------------------ */

export const buildBarrelSponge: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const H = 0.40 + rnd() * 1.70;
  const R = H * (0.30 + rnd() * 0.26);
  const waist = 0.68 + rnd() * 0.26;
  const rimIn = 0.60 + rnd() * 0.22;
  const channels = 7 + Math.floor(rnd() * 10);
  const leanX = (rnd() - 0.5) * 0.22;
  const leanZ = (rnd() - 0.5) * 0.22;
  const lopsided = 0.08 + rnd() * 0.14;
  const lopA = rnd() * TAU;

  const profile = (v: number): { r: number; y: number } => {
    if (v < 0.66) {
      const w = v / 0.66;
      // Waisted barrel: wide foot, pinched middle, flaring rim.
      const r = R * (0.72 + 0.28 * Math.cos(w * Math.PI) * (1 - waist) + waist * Math.pow(w, 1.6) * 0.55);
      return { r, y: H * w };
    }
    if (v < 0.74) {
      const w = (v - 0.66) / 0.08;
      return { r: R * lerp(0.98 + waist * 0.55, 1.02, ease(w)), y: H * lerp(1, 1.035, w) };
    }
    const w = (v - 0.74) / 0.26;
    return { r: R * lerp(rimIn * 1.35, rimIn * 0.35, ease(w)), y: H * lerp(1.03, 0.16, ease(w)) };
  };

  const base = mb.count;
  lathe(mb, {
    profile,
    rows: hi ? 26 : 12,
    radial: hi ? 20 : 9,
    wobble: (v, ang) =>
      lopsided * Math.cos(ang - lopA) * ease(Math.min(1, v * 1.6)) +
      0.045 * Math.sin(ang * channels + v * 2.5) * (v < 0.7 ? 1 : 0.3) +
      0.03 * Math.sin(v * 26 + ang * 2),
    ao: (v) => (v < 0.72 ? 0.24 + 0.76 * ease(Math.min(1, v * 1.35)) : 0.06 + 0.30 * (1 - (v - 0.72) / 0.28)),
    tOf: (v) => Math.min(1, v * 0.4),
    blade: 0,
    thick: 0.18,
    uRepeat: 2.5,
    vRepeat: Math.max(1.5, H * 2.2),
  });
  for (let k = base; k < mb.count; k++) {
    const y = mb.pos[k * 3 + 1];
    mb.pos[k * 3] += leanX * y;
    mb.pos[k * 3 + 2] += leanZ * y;
  }
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Tree mushroom — thick curved stalk, broad lopsided cap with gills
 * ------------------------------------------------------------------ */

export const buildTreeMushroom: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const H = 0.8 + rnd() * 3.4;
  const stalkR = H * (0.055 + rnd() * 0.055);
  const capR = H * (0.30 + rnd() * 0.34);
  const dome = capR * (0.28 + rnd() * 0.30);
  const underDepth = capR * (0.22 + rnd() * 0.22);
  const gills = 14 + Math.floor(rnd() * 18);
  const leanA = rnd() * TAU;
  const leanAmt = 0.05 + rnd() * 0.16;
  const wave = 0.10 + rnd() * 0.16;
  const waveN = 3 + Math.floor(rnd() * 4);

  const stalkFrames = buildPath(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(Math.cos(leanA) * leanAmt, 1, Math.sin(leanA) * leanAmt).normalize(),
    hi ? 10 : 5,
    () => H / (hi ? 10 : 5),
    (_i, u, out) =>
      out.set(Math.cos(leanA) * leanAmt * 0.16 * (1 - u), 0, Math.sin(leanA) * leanAmt * 0.16 * (1 - u)),
  );
  tube(mb, stalkFrames, {
    radius: (u) => stalkR * (1.7 - 0.85 * ease(Math.min(1, u * 1.5)) + 0.22 * Math.sin(u * 9)),
    radial: hi ? 12 : 6,
    wobble: (u, ang) => 0.07 * Math.sin(ang * 5 + u * 8) + 0.05 * Math.sin(u * 21),
    ao: (u) => 0.20 + 0.62 * ease(Math.min(1, u * 1.25)),
    tOf: (u) => u * 0.55,
    blade: 0,
    thick: 0.12,
    vRepeat: Math.max(1.5, H * 1.4),
  });

  const top = stalkFrames[stalkFrames.length - 1].p;
  const capBase = mb.count;
  lathe(mb, {
    profile: (v) => {
      if (v < 0.56) {
        const w = v / 0.56;
        return { r: capR * Math.sin((w * Math.PI) / 2) ** 0.85, y: dome * Math.cos((w * Math.PI) / 2) };
      }
      const w = (v - 0.56) / 0.44;
      return { r: capR * lerp(0.99, stalkR / capR * 1.1, ease(w)), y: -underDepth * Math.sin((w * Math.PI) / 2) };
    },
    rows: hi ? 20 : 9,
    radial: hi ? 26 : 11,
    wobble: (v, ang) => wave * Math.sin(ang * waveN + v * 1.7) * ease(Math.min(1, v * 2)) + 0.03 * Math.sin(ang * 11),
    rise: (v, ang) =>
      v > 0.56
        ? capR * 0.020 * Math.sin(ang * gills) * (1 - (v - 0.56) / 0.44)
        : capR * 0.030 * Math.sin(ang * waveN + 1.1) * v,
    ao: (v) => (v < 0.56 ? 0.72 + 0.28 * (1 - v) : 0.10 + 0.22 * (1 - (v - 0.56) / 0.44)),
    tOf: () => 0.85,
    blade: 0.3,
    thick: 0.45,
    phase: 0.6,
    uRepeat: 3,
    vRepeat: Math.max(1.5, capR * 2.5),
  });
  for (let k = capBase; k < mb.count; k++) {
    mb.pos[k * 3] += top.x;
    mb.pos[k * 3 + 1] += top.y;
    mb.pos[k * 3 + 2] += top.z;
  }

  // Occasional bracket cap partway up the stalk.
  if (rnd() < 0.45 && hi) {
    const bv = 0.35 + rnd() * 0.3;
    const bf = stalkFrames[Math.round(bv * (stalkFrames.length - 1))];
    const br = capR * (0.30 + rnd() * 0.28);
    const bAng = rnd() * TAU;
    const b2 = mb.count;
    lathe(mb, {
      profile: (v) => {
        if (v < 0.55) {
          const w = v / 0.55;
          return { r: br * Math.sin((w * Math.PI) / 2) ** 0.9, y: br * 0.35 * Math.cos((w * Math.PI) / 2) };
        }
        const w = (v - 0.55) / 0.45;
        return { r: br * lerp(0.98, 0.12, ease(w)), y: -br * 0.24 * Math.sin((w * Math.PI) / 2) };
      },
      rows: 10,
      radial: 14,
      wobble: (v, ang) => 0.16 * Math.sin(ang * 3 + 0.7) * v,
      ao: (v) => (v < 0.55 ? 0.7 : 0.14),
      tOf: () => 0.5,
      blade: 0.3,
      thick: 0.45,
      uRepeat: 2,
      vRepeat: 2,
    });
    for (let k = b2; k < mb.count; k++) {
      mb.pos[k * 3] += bf.p.x + Math.cos(bAng) * br * 0.35;
      mb.pos[k * 3 + 1] += bf.p.y;
      mb.pos[k * 3 + 2] += bf.p.z + Math.sin(bAng) * br * 0.35;
    }
  }
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Bioluminescent stalks — flexible stems ending in glowing bulbs
 * ------------------------------------------------------------------ */

export const buildBioStalk: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const n = hi ? 2 + Math.floor(rnd() * 4) : 2;
  const maxH = 0.5 + rnd() * 2.3;

  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const H = maxH * (0.45 + rnd() * 0.7);
    const segs = hi ? Math.max(7, Math.round(H * 5)) : 4;
    const curl = 0.05 + rnd() * 0.11;
    const swirl = rnd() < 0.5 ? -1 : 1;
    const r0 = H * (0.012 + rnd() * 0.012);
    const frames = buildPath(
      new THREE.Vector3(Math.cos(a) * maxH * 0.06, 0, Math.sin(a) * maxH * 0.06),
      new THREE.Vector3(Math.cos(a) * 0.22, 1, Math.sin(a) * 0.22).normalize(),
      segs,
      () => H / segs,
      (_k, u, out) => {
        const t = u * 5.0 * swirl + a;
        out.set(Math.cos(t) * curl + Math.cos(a) * 0.03, -0.02 * u, Math.sin(t) * curl + Math.sin(a) * 0.03);
      },
    );

    const beadCount = hi ? 2 + Math.floor(rnd() * 3) : 0;
    tube(mb, frames, {
      radius: (u) => r0 * (1.4 - 0.7 * u) * (1 + 0.22 * Math.sin(u * 13)),
      radial: hi ? 6 : 4,
      wobble: (u, ang) => 0.10 * Math.sin(ang * 3 + u * 20),
      ao: (u) => 0.25 + 0.75 * ease(Math.min(1, u * 1.4)),
      emit: (u) => 0.10 + 0.22 * u,
      tOf: (u) => u,
      phase: i * 0.23,
      phaseSpan: 1,
      blade: 0.25,
      thick: 0.5,
      vRepeat: Math.max(1.5, H * 3),
    });

    // Terminal bulb — the actual light source.
    const tip = frames[frames.length - 1];
    const br = r0 * (3.4 + rnd() * 2.6);
    blob(mb, {
      center: tip.p.clone().addScaledVector(tip.t, br * 0.75),
      radius: (d) => br * (1 + 0.16 * Math.sin(d.x * 7 + d.z * 6) + 0.10 * d.y),
      scale: new THREE.Vector3(1, 1.25 + rnd() * 0.4, 1),
      subdiv: hi ? 1 : 0,
      uvScale: 8,
      tOf: () => 1,
      ao: () => 1,
      emit: (d) => 0.75 + 0.25 * d.y,
      thick: 0.9,
      phase: i * 0.23 + 1,
    });

    for (let k = 0; k < beadCount; k++) {
      const u = 0.25 + (k / Math.max(1, beadCount)) * 0.65 + rnd() * 0.05;
      const f = frames[Math.round(u * (frames.length - 1))];
      const rr = r0 * (1.4 + rnd() * 1.6);
      blob(mb, {
        center: f.p.clone().addScaledVector(f.n, r0 * 1.2),
        radius: () => rr,
        subdiv: hi ? 1 : 0,
        uvScale: 12,
        tOf: () => u,
        ao: () => 1,
        emit: () => 0.9,
        thick: 0.9,
        phase: i * 0.23 + u,
      });
    }
  }
  return mb.geometry();
};

/* ------------------------------------------------------------------ *
 * Lava coral — thick twisted branches with glowing crevices
 * ------------------------------------------------------------------ */

export const buildLavaCoral: ShapeBuilder = (seed, lod) => {
  const rnd = mulberry32(seed >>> 0);
  const noise = new Noise(seed ^ 0x9a1c);
  const mb = new FloraMeshBuilder();
  const hi = lod === 0;
  const H = 0.45 + rnd() * 1.75;

  const branches = lsystem({
    rnd,
    origin: new THREE.Vector3(0, 0, 0),
    dir: new THREE.Vector3((rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3).normalize(),
    length: H * 0.42,
    radius: H * (0.055 + rnd() * 0.040),
    levels: hi ? 3 : 2,
    children: [2, 3],
    spread: 0.55 + rnd() * 0.35,
    lengthDecay: 0.58 + rnd() * 0.16,
    planar: 0.10 * rnd(),
    curve: 0.20 + rnd() * 0.18,
    upBias: 0.15 + rnd() * 0.30,
    subSegs: hi ? 5 : 3,
    murray: 2.6,
  });

  skinBranches(mb, branches, {
    radial: hi ? 8 : 5,
    ao: (t) => 0.18 + 0.72 * ease(Math.min(1, t * 1.6)),
    wobble: (u, ang, depth) =>
      0.20 * Math.sin(ang * 4 + u * 11 + depth * 2) + 0.11 * Math.sin(u * 27) + 0.06 * Math.sin(ang * 9),
    emit: (p, t) => {
      const crack = noise.fbm3(p.x * 5.5, p.y * 5.5, p.z * 5.5, 2);
      return Math.max(0, 0.95 - t * 1.15) * Math.max(0, crack * 1.9 - 0.15);
    },
    thick: 0.10,
    polypRadius: 0,
    rnd,
    vScale: 3,
  });

  // Cooled crust base with glowing fissures.
  blob(mb, {
    center: new THREE.Vector3(0, H * 0.03, 0),
    radius: (d) => H * 0.20 * (1 + 0.45 * noise.fbm3(d.x * 3, d.y * 3, d.z * 3, 3)),
    scale: new THREE.Vector3(1, 0.34, 1),
    subdiv: hi ? 2 : 1,
    uvScale: 4,
    tOf: () => 0.01,
    ao: () => 0.24,
    emit: (d) => Math.max(0, noise.fbm3(d.x * 6, d.y * 6, d.z * 6, 2) * 1.6 - 0.35) * 0.8,
    thick: 0.05,
  });
  return mb.geometry();
};

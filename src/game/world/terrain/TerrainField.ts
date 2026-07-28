/**
 * TerrainField — the single authoritative definition of the sea floor.
 *
 * Everything that touches the shape of the world goes through here: the chunk
 * mesher, the collision queries, the biome map, flora/fauna placement. It is a
 * pure function of (x, z) and the world seed, so it is trivially reproducible
 * and identical on every machine.
 *
 * Geomorphology, from macro to micro:
 *   1. A keyframed *shelf profile* against a domain-warped radius: an inner
 *      shelf, an outer shelf, a steep drop-off, a deep plain and the abyss.
 *   2. Bounded low-frequency depth wobble so contours meander instead of
 *      forming rings.
 *   3. Reef ridges (ridged multifractal) gated by a rockiness mask.
 *   4. Kelp basins — smooth bowls with a raised lip.
 *   5. Deterministic set pieces: two spires, a terraced sinkhole, a branching
 *      canyon, three rock arches, boulder fields.
 *   6. Crevasses — knife-thin, near-vertical slots cut through the floor.
 *   7. Boulder fields (jittered-grid domes, per-instance radius + wobble).
 *   8. Mid detail (fbm) and megaripples.
 *   9. Sand ripples aligned to the local current direction.
 *
 * Units are metres. Sea level is y = 0, the floor is negative Y.
 */
import { Noise, hash2, mulberry32 } from '../../core/Noise';

/* ------------------------------------------------------------------ *
 * Shelf profile
 * ------------------------------------------------------------------ */

/** Warped-radius keyframes, metres from the world origin. */
const PROFILE_R = [0, 40, 80, 115, 170, 205, 245, 292, 342, 392, 436, 520, 700, 1000, 1600, 2600, 4200];
/** Depth (positive metres below sea level) at each keyframe. */
const PROFILE_D = [30, 33, 40, 46, 58, 77, 108, 156, 208, 255, 281, 303, 325, 351, 399, 467, 551];

function profileDepth(r: number): number {
  if (r <= PROFILE_R[0]) return PROFILE_D[0];
  const last = PROFILE_R.length - 1;
  if (r >= PROFILE_R[last]) return PROFILE_D[last];
  let i = 1;
  while (PROFILE_R[i] < r) i++;
  const t = (r - PROFILE_R[i - 1]) / (PROFILE_R[i] - PROFILE_R[i - 1]);
  const s = t * t * (3 - 2 * t);
  return PROFILE_D[i - 1] + (PROFILE_D[i] - PROFILE_D[i - 1]) * s;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

/** The floor is never allowed closer than this to the surface (soft clamp). */
const MIN_DEPTH = 6.5;

/* ------------------------------------------------------------------ *
 * Set pieces
 * ------------------------------------------------------------------ */

export type SetPieceKind = 'spire' | 'sinkhole' | 'canyon' | 'arch' | 'basin' | 'boulders';

export interface SetPiece {
  kind: SetPieceKind;
  /** Centre in world XZ. */
  x: number;
  z: number;
  /** Influence radius; the height contribution is exactly zero outside it. */
  radius: number;
  /** Vertical amplitude in metres (meaning depends on kind). */
  amp: number;
  /** Yaw in radians, for asymmetric pieces. */
  rot: number;
  /** Per-piece hash seed so no two look alike. */
  seed: number;
  /** Polyline for canyons: [x0,z0, x1,z1, ...] in world space. */
  path?: Float32Array;
  /** Half-width for canyons / arch span thickness. */
  width?: number;
}

/** Hand-authored anchors; the seed only jitters them, so shots stay framed. */
interface Anchor {
  kind: SetPieceKind;
  x: number;
  z: number;
  radius: number;
  amp: number;
  width?: number;
}

const ANCHORS: Anchor[] = [
  // Dramatic vertical landmark just off the inner shelf, reads against the blue.
  { kind: 'spire', x: 132, z: -108, radius: 44, amp: 74 },
  { kind: 'spire', x: -244, z: -52, radius: 33, amp: 56 },
  { kind: 'spire', x: 62, z: 178, radius: 26, amp: 38 },
  // Terraced sinkhole punched through the shelf.
  { kind: 'sinkhole', x: -92, z: 162, radius: 78, amp: 158 },
  // Kelp basins — broad bowls with a raised lip.
  { kind: 'basin', x: -128, z: 102, radius: 126, amp: 21 },
  { kind: 'basin', x: 186, z: 66, radius: 98, amp: 15 },
  { kind: 'basin', x: -52, z: -196, radius: 112, amp: 24 },
  // Boulder gardens.
  { kind: 'boulders', x: 74, z: 98, radius: 112, amp: 1 },
  { kind: 'boulders', x: -46, z: -168, radius: 134, amp: 1 },
  { kind: 'boulders', x: 214, z: -164, radius: 96, amp: 1 },
  // Rock arches (the heightfield gets footings; the span is a real mesh).
  { kind: 'arch', x: 46, z: -60, radius: 16, amp: 13, width: 3.1 },
  { kind: 'arch', x: -156, z: 64, radius: 21, amp: 17, width: 4.0 },
  { kind: 'arch', x: 236, z: 122, radius: 18, amp: 14, width: 3.4 },
  { kind: 'arch', x: -206, z: -232, radius: 24, amp: 19, width: 4.6 },
];

/** Canyon start points + outward headings; the polyline is grown from the seed. */
const CANYON_SEEDS: Array<{ x: number; z: number; heading: number; len: number; width: number; amp: number }> = [
  { x: 262, z: 34, heading: -0.35, len: 760, width: 52, amp: 74 },
  { x: -216, z: 214, heading: 2.25, len: 620, width: 41, amp: 58 },
];

/* ------------------------------------------------------------------ *
 * The field
 * ------------------------------------------------------------------ */

export class TerrainField {
  readonly pieces: SetPiece[] = [];
  /** Arches only, kept separately because they also produce real geometry. */
  readonly arches: SetPiece[] = [];

  readonly seed: number;

  private readonly nMacro: Noise;
  private readonly nMid: Noise;
  private readonly nRock: Noise;
  private readonly nFlow: Noise;

  constructor(seed: number) {
    this.seed = seed;
    this.nMacro = new Noise(seed);
    this.nMid = new Noise(seed ^ 0x9e3779b9);
    this.nRock = new Noise((seed + 0x1f123bb5) | 0);
    this.nFlow = new Noise((seed ^ 0x2545f491) | 0);

    const rnd = mulberry32((seed ^ 0x51ed270b) | 0);
    for (const a of ANCHORS) {
      const piece: SetPiece = {
        kind: a.kind,
        x: a.x + (rnd() - 0.5) * 34,
        z: a.z + (rnd() - 0.5) * 34,
        radius: a.radius * (0.88 + rnd() * 0.26),
        amp: a.amp * (0.9 + rnd() * 0.22),
        rot: rnd() * Math.PI * 2,
        seed: (rnd() * 0xffffff) | 0,
        width: a.width,
      };
      this.pieces.push(piece);
      if (a.kind === 'arch') this.arches.push(piece);
    }

    for (const c of CANYON_SEEDS) {
      const pts: number[] = [];
      let px = c.x;
      let pz = c.z;
      let head = c.heading + (rnd() - 0.5) * 0.5;
      const segs = 9;
      const step = c.len / segs;
      pts.push(px, pz);
      for (let i = 0; i < segs; i++) {
        head += (rnd() - 0.5) * 0.72;
        px += Math.cos(head) * step;
        pz += Math.sin(head) * step;
        pts.push(px, pz);
      }
      // Bounding circle for cheap rejection.
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < pts.length; i += 2) {
        cx += pts[i];
        cz += pts[i + 1];
      }
      cx /= pts.length / 2;
      cz /= pts.length / 2;
      let rad = 0;
      for (let i = 0; i < pts.length; i += 2) {
        rad = Math.max(rad, Math.sqrt((pts[i] - cx) ** 2 + (pts[i + 1] - cz) ** 2));
      }
      this.pieces.push({
        kind: 'canyon',
        x: cx,
        z: cz,
        radius: rad + c.width * 2.2,
        amp: c.amp * (0.9 + rnd() * 0.2),
        rot: 0,
        seed: (rnd() * 0xffffff) | 0,
        path: new Float32Array(pts),
        width: c.width * (0.85 + rnd() * 0.3),
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Macro terms
   * ---------------------------------------------------------------- */

  /**
   * Cheap, smooth depth used for biome assignment and LOD bounds. Contains the
   * shelf profile and the low-frequency wobble only — no detail, no set pieces.
   */
  macroDepth(x: number, z: number): number {
    const raw = Math.sqrt(x * x + z * z);
    // Mild radial warp so the drop-off meanders. Faded in so the inner shelf
    // (and therefore the spawn area) stays exactly where it is authored.
    const w1 = this.nMacro.fbm2(x * 0.00126 + 61.7, z * 0.00126 - 23.4, 2);
    const r = raw * (1 + 0.135 * w1 * smoothstep(45, 250, raw));
    const pd = profileDepth(r);
    // Bounded meander: on the steep slope this shifts contours tens of metres
    // horizontally without ever inverting the profile. Damped on the inner
    // shelf so the spawn basin stays calm and readable.
    const g = 0.2 + 0.8 * smoothstep(38, 105, pd);
    let d = pd;
    d += 19 * g * this.nMacro.fbm2(x * 0.0022 + 111.3, z * 0.0022 - 84.7, 3);
    d += 7.5 * g * this.nMacro.noise2(x * 0.0068 - 42.1, z * 0.0068 + 38.9);
    return d;
  }

  /** 0 = pure sediment, 1 = exposed rock. Drives ridges, boulders, splatting. */
  rockMask(x: number, z: number): number {
    const n = this.nRock.fbm2(x * 0.0019 + 55.5, z * 0.0019 - 91.1, 2);
    return clamp(0.5 + 0.85 * n, 0, 1);
  }

  /* ---------------------------------------------------------------- *
   * Current / flow field  (also drives sand-ripple orientation)
   * ---------------------------------------------------------------- */

  /**
   * Horizontal current direction+strength at a world XZ, from the gradient of a
   * noise stream function (so the field is divergence-free and reads as a real
   * current rather than random jitter). Writes a unit-ish vector into out.
   */
  flowInto(x: number, z: number, out: { x: number; y: number }): number {
    const p = this.nFlow;
    // Two decorrelated octaves of a slowly-turning vector field, plus a weak
    // prevailing drift so there is never a dead spot.
    const a = p.noise2(x * 0.00185 + 12.7, z * 0.00185 - 5.1);
    const b = p.noise2(x * 0.00185 - 71.3, z * 0.00185 + 44.9);
    let fx = a * 0.9 + 0.14;
    let fz = b * 0.9 - 0.1;
    const len = Math.sqrt(fx * fx + fz * fz);
    if (len < 1e-5) {
      out.x = 1;
      out.y = 0;
      return 0;
    }
    out.x = fx / len;
    out.y = fz / len;
    return Math.min(1, len * 1.35);
  }

  /* ---------------------------------------------------------------- *
   * Height
   * ---------------------------------------------------------------- */

  private static readonly _flow = { x: 1, y: 0 };

  /** Sea-floor world Y at (x, z). This IS the terrain, by definition. */
  height(x: number, z: number): number {
    const rock = this.rockMask(x, z);
    const macro = this.macroDepth(x, z);
    let y = -macro;

    // The inner shelf stays a calm sandy basin so the shallows read as a
    // dive site; relief ramps up as you move out toward the drop-off.
    const relief = 0.26 + 0.74 * smoothstep(30, 78, macro);

    // --- reef ridges: sharp crests where rock is exposed -----------------
    const ridge = this.nRock.ridged2(x * 0.0046 + 37.1, z * 0.0046 - 19.6, 3);
    y += (ridge - 0.3) * 32 * rock * relief;
    // second, larger ridge system for macro silhouette
    const ridge2 = this.nRock.ridged2(x * 0.0016 + 143.2, z * 0.0016 - 97.4, 3);
    y += (ridge2 - 0.31) * 44 * (0.35 + 0.65 * rock) * relief;

    // --- set pieces ------------------------------------------------------
    y += this.setPieces(x, z);

    // --- crevasses: thin near-vertical slots ------------------------------
    y -= this.crevasse(x, z, rock) * relief;

    // --- boulders --------------------------------------------------------
    y += this.boulders(x, z, rock) * (0.4 + 0.6 * relief);

    // --- mid detail ------------------------------------------------------
    y += 3.1 * this.nMid.fbm2(x * 0.021 + 8.3, z * 0.021 - 2.7, 3);
    y += 1.15 * this.nMid.billow2(x * 0.062 + 4.4, z * 0.062 - 1.8, 2);

    // --- sand ripples, aligned to the local current -----------------------
    const f = TerrainField._flow;
    const strength = this.flowInto(x, z, f);
    const along = x * f.x + z * f.y;
    const jitter = 2.4 * this.nMid.noise2(x * 0.045, z * 0.045);
    const sandy = 1 - rock;
    // megaripples (~7 m) then ripples (~1.6 m)
    y += 0.42 * (0.35 + 0.65 * strength) * Math.sin(along * 0.897 + jitter) * sandy;
    y += 0.13 * (0.4 + 0.6 * strength) * Math.sin(along * 3.927 + jitter * 2.1) * sandy;

    // --- soft ceiling: the floor never breaks the surface -----------------
    const d = -y;
    return -0.5 * (d + MIN_DEPTH + Math.sqrt((d - MIN_DEPTH) * (d - MIN_DEPTH) + 7));
  }

  /* ---------------------------------------------------------------- *
   * Set-piece evaluation
   * ---------------------------------------------------------------- */

  private setPieces(x: number, z: number): number {
    let acc = 0;
    const pieces = this.pieces;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > p.radius * p.radius) continue;
      switch (p.kind) {
        case 'spire':
          acc += this.spire(p, dx, dz, Math.sqrt(d2));
          break;
        case 'sinkhole':
          acc += this.sinkhole(p, dx, dz, Math.sqrt(d2));
          break;
        case 'basin':
          acc += this.basin(p, Math.sqrt(d2));
          break;
        case 'arch':
          acc += this.archFooting(p, dx, dz);
          break;
        case 'canyon':
          acc += this.canyon(p, x, z);
          break;
        case 'boulders':
          // handled by boulders() via the density mask
          break;
      }
    }
    return acc;
  }

  /** Fluted, twisted, asymmetric pinnacle. Nothing like a cone. */
  private spire(p: SetPiece, dx: number, dz: number, d: number): number {
    const ang = Math.atan2(dz, dx) + p.rot;
    // Flutes + a lean, both hashed per piece.
    const flute =
      1 +
      0.24 * Math.sin(ang * 5 + p.seed * 0.001) +
      0.15 * Math.sin(ang * 11 - p.seed * 0.003) +
      0.18 * this.nRock.noise2(Math.cos(ang) * 3 + p.seed * 0.01, Math.sin(ang) * 3);
    const rEff = p.radius * clamp(flute * 0.82, 0.35, 1.15);
    if (d >= rEff) return 0;
    const t = 1 - d / rEff;
    // Concave profile → true pinnacle silhouette, plus erosion notches.
    const prof = Math.pow(t, 2.25) * (1 + 0.35 * t);
    const erosion = 1 - 0.28 * Math.max(0, this.nRock.fbm2(dx * 0.09, dz * 0.09, 3));
    const shelfNotch = 1 - 0.16 * smoothstep(0.42, 0.5, t) * smoothstep(0.62, 0.54, t);
    return p.amp * prof * erosion * shelfNotch;
  }

  /** Terraced sinkhole with a raised rim — reads as a hole, not a dent. */
  private sinkhole(p: SetPiece, dx: number, dz: number, d: number): number {
    const R = p.radius;
    const ang = Math.atan2(dz, dx) + p.rot;
    const lobe = 1 + 0.13 * Math.sin(ang * 3 + p.seed * 0.002) + 0.08 * Math.sin(ang * 7);
    const u = d / (R * lobe);
    if (u >= 1) return 0;
    // Rim: a narrow raised lip just inside the outer edge.
    const rim = 9.5 * smoothstep(1.0, 0.86, u) * smoothstep(0.72, 0.9, u);
    // Bowl: steep walls, flattening at the bottom, with 3 terraces.
    const bowl = -p.amp * Math.pow(smoothstep(1.0, 0.08, u), 1.35);
    const terr = -7.0 * Math.floor(clamp((1 - u) * 3.2, 0, 3)) * smoothstep(0.95, 0.55, u) * 0.34;
    const rough = 3.4 * this.nRock.fbm2(dx * 0.055, dz * 0.055, 3) * smoothstep(1.0, 0.2, u);
    return rim + bowl + terr + rough;
  }

  /** Broad bowl with a lip — where kelp forests live. */
  private basin(p: SetPiece, d: number): number {
    const u = d / p.radius;
    if (u >= 1) return 0;
    const lip = 4.2 * smoothstep(1.0, 0.82, u) * smoothstep(0.66, 0.86, u);
    return lip - p.amp * Math.pow(smoothstep(1.0, 0.05, u), 1.2);
  }

  /** Two thick footings so the arch mesh grows out of the rock, not the sand. */
  private archFooting(p: SetPiece, dx: number, dz: number): number {
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    // Local frame: u along the span, v across it.
    const u = dx * c + dz * s;
    const v = -dx * s + dz * c;
    const span = p.radius * 0.82;
    let h = 0;
    for (let k = -1; k <= 1; k += 2) {
      const du = u - k * span * 0.72;
      const vv = v * 1.25;
      const d = Math.sqrt(du * du + vv * vv);
      const foot = p.radius * 0.36;
      if (d < foot) {
        const t = 1 - d / foot;
        h += p.amp * 0.62 * Math.pow(t, 1.5) * (1 + 0.3 * this.nRock.noise2(dx * 0.2, dz * 0.2));
      }
    }
    // A low plinth linking them so the arch reads as one formation.
    const plinth = smoothstep(span * 1.15, span * 0.6, Math.abs(u)) * smoothstep(p.radius * 0.5, p.radius * 0.18, Math.abs(v));
    h += p.amp * 0.16 * plinth;
    return h;
  }

  /** Distance-to-polyline carve with terraced walls. */
  private canyon(p: SetPiece, x: number, z: number): number {
    const path = p.path;
    if (!path) return 0;
    let best = Infinity;
    let along = 0;
    for (let i = 0; i + 3 < path.length; i += 2) {
      const ax = path[i];
      const az = path[i + 1];
      const bx = path[i + 2];
      const bz = path[i + 3];
      const ex = bx - ax;
      const ez = bz - az;
      const len2 = ex * ex + ez * ez;
      let t = len2 > 1e-6 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0;
      t = clamp(t, 0, 1);
      const px = ax + ex * t;
      const pz = az + ez * t;
      const qx = x - px;
      const qz = z - pz;
      const d = Math.sqrt(qx * qx + qz * qz);
      if (d < best) {
        best = d;
        along = i * 0.5 + t;
      }
    }
    const w = (p.width ?? 40) * (1 + 0.28 * this.nRock.noise2(along * 0.7, p.seed * 0.001));
    if (best >= w) return 0;
    const u = best / w;
    const prof = Math.pow(smoothstep(1.0, 0.12, u), 1.25);
    // Stepped walls read as sedimentary strata.
    const strata = -3.6 * Math.floor(clamp((1 - u) * 4.0, 0, 4)) * 0.3;
    const rough = 2.6 * this.nRock.fbm2(x * 0.05, z * 0.05, 3) * prof;
    return -p.amp * prof + strata * prof + rough;
  }

  /* ---------------------------------------------------------------- *
   * Crevasses + boulders
   * ---------------------------------------------------------------- */

  private crevasse(x: number, z: number, rock: number): number {
    // Warped ridge lines; the zero-set of `c` is where the slot cuts.
    const wx = x + 96 * this.nMacro.noise2(x * 0.00092 + 21.4, z * 0.00092 - 6.7);
    const wz = z + 96 * this.nMacro.noise2(x * 0.00092 - 13.9, z * 0.00092 + 17.2);
    const c = this.nMacro.fbm2(wx * 0.00105 + 13.7, wz * 0.00105 - 4.3, 2);
    const w = Math.abs(c);
    const cut = smoothstep(0.052, 0.004, w);
    if (cut <= 0.001) return 0;
    const gate = 0.25 + 0.75 * rock;
    const depth = 20 + 40 * Math.max(0, this.nMacro.noise2(x * 0.0035 + 3.1, z * 0.0035 - 8.2));
    // pow > 1 keeps the walls near-vertical instead of V-shaped
    return Math.pow(cut, 1.7) * depth * gate;
  }

  /** Jittered-grid domes: per-instance radius, height and surface wobble. */
  private boulders(x: number, z: number, rock: number): number {
    // Density mask: rocky ground everywhere, plus the boulder-garden pieces.
    let mask = 0.45 * rock;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (p.kind !== 'boulders') continue;
      const bx = x - p.x;
      const bz = z - p.z;
      const d = Math.sqrt(bx * bx + bz * bz);
      if (d < p.radius) mask += smoothstep(1, 0.15, d / p.radius);
    }
    mask = clamp(mask, 0, 1.35);
    if (mask <= 0.02) return 0;

    const cs = 12.5;
    const gx = Math.floor(x / cs);
    const gz = Math.floor(z / cs);
    let h = 0;
    for (let dzi = -1; dzi <= 1; dzi++) {
      for (let dxi = -1; dxi <= 1; dxi++) {
        const cx = gx + dxi;
        const cz = gz + dzi;
        if (hash2(cx, cz, this.seed ^ 0x51ed) > 0.2 + 0.24 * mask) continue;
        const px = (cx + 0.16 + 0.68 * hash2(cx, cz, this.seed ^ 0x11)) * cs;
        const pz = (cz + 0.16 + 0.68 * hash2(cx, cz, this.seed ^ 0x22)) * cs;
        const rad = 1.7 + 4.6 * hash2(cx, cz, this.seed ^ 0x33);
        const dx = x - px;
        const dz = z - pz;
        // Elliptical + rotated so no two boulders share a silhouette.
        const a = hash2(cx, cz, this.seed ^ 0x44) * Math.PI;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const ex = (dx * ca + dz * sa) / (1 + 0.5 * hash2(cx, cz, this.seed ^ 0x55));
        const ez = -dx * sa + dz * ca;
        const d = Math.sqrt(ex * ex + ez * ez);
        if (d >= rad) continue;
        const t = 1 - d / rad;
        const wob = 1 + 0.4 * this.nMid.noise2(px * 0.28 + ex * 0.9, pz * 0.28 + ez * 0.9);
        h += rad * (0.4 + 0.32 * hash2(cx, cz, this.seed ^ 0x66)) * Math.pow(t, 0.62) * wob * Math.min(1, mask);
      }
    }
    return h;
  }
}

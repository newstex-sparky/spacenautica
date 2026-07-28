/**
 * Procedural item icons. Two tiers, no files, ever:
 *
 *  Tier A (always available, synchronous): canvas-2D line art generated from the
 *  item's archetype + a per-item seed. Backplate glow, gradient-filled
 *  silhouette, accent line work, hatch shading and micro grain.
 *
 *  Tier B (preferred, amortised): a tiny offscreen Three.js render of a
 *  procedurally generated mesh of the item, lit with a three-point rig and a
 *  procedural equirect environment, composited over the tier-A backplate with a
 *  faked bloom pass. Cached forever per (id, size).
 *
 * The 3D pass uses its own small renderer so it can never perturb the game
 * renderer's state mid-frame. It is created lazily on the first request and only
 * when the quality tier allows it; if context creation fails the UI silently
 * stays on tier A.
 */
import * as THREE from 'three';
import { hash01, makeRng } from './UiKit';
import { itemDef } from './ItemDatabase';
import type { IconArchetype, ItemDef } from './ItemDatabase';

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function shade(c: number, k: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

/* ------------------------------------------------------------------ *
 * Tier A — canvas 2D line art
 * ------------------------------------------------------------------ */

interface DrawCtx {
  g: CanvasRenderingContext2D;
  /** Logical size; all archetypes draw into a 0..1 box scaled by this. */
  s: number;
  rng: () => number;
  def: ItemDef;
}

function poly(g: CanvasRenderingContext2D, pts: number[][], close = true): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
}

/** Irregular blob: a closed radial path with hashed radius wobble. */
function blob(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  lobes: number,
  wobble: number,
  rng: () => number,
): void {
  const pts: number[][] = [];
  const n = Math.max(7, lobes * 3);
  const phase = rng() * 6.283;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k =
      1 +
      Math.sin(a * lobes + phase) * wobble +
      Math.sin(a * (lobes * 2 + 1) + phase * 1.7) * wobble * 0.45;
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  // Closed cardinal-ish spline through the points for organic silhouettes.
  g.beginPath();
  g.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}

function fillGradient(d: DrawCtx, x0: number, y0: number, x1: number, y1: number, top = 1.35, bottom = 0.42): void {
  const grad = d.g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, shade(d.def.tint, top));
  grad.addColorStop(0.55, shade(d.def.tint, (top + bottom) * 0.5));
  grad.addColorStop(1, shade(d.def.tint, bottom));
  d.g.fillStyle = grad;
  d.g.fill();
}

function stroke(d: DrawCtx, w = 1.4, color?: string, alpha = 0.85): void {
  d.g.lineWidth = (w * d.s) / 96;
  d.g.strokeStyle = color ?? rgba(d.def.accent, alpha);
  d.g.stroke();
}

/** Line-work shading: short parallel hatch strokes inside the current clip. */
function hatch(d: DrawCtx, x: number, y: number, w: number, h: number, gap = 6, alpha = 0.16): void {
  const g = d.g;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = `rgba(4, 18, 26, ${alpha})`;
  g.lineWidth = (1.1 * d.s) / 96;
  const step = (gap * d.s) / 96;
  for (let i = -h; i < w + h; i += step) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + h, y);
    g.stroke();
  }
  g.restore();
}

type Drawer = (d: DrawCtx) => void;

const DRAWERS: Record<IconArchetype, Drawer> = {
  ore(d) {
    const { g, s, rng } = d;
    blob(g, s * 0.5, s * 0.54, s * 0.31, 4, 0.16, rng);
    fillGradient(d, 0, s * 0.2, 0, s * 0.86);
    stroke(d, 1.6, rgba(d.def.accent, 0.5));
    hatch(d, s * 0.5, s * 0.5, s * 0.4, s * 0.4, 5, 0.2);
    // Embedded mineral facets.
    for (let i = 0; i < 4; i++) {
      const a = rng() * 6.283;
      const r = s * (0.06 + rng() * 0.13);
      const cx = s * 0.5 + Math.cos(a) * s * 0.13;
      const cy = s * 0.54 + Math.sin(a) * s * 0.12;
      poly(g, [
        [cx, cy - r],
        [cx + r * 0.72, cy - r * 0.1],
        [cx + r * 0.3, cy + r * 0.85],
        [cx - r * 0.5, cy + r * 0.55],
        [cx - r * 0.7, cy - r * 0.3],
      ]);
      g.fillStyle = rgba(d.def.accent, 0.55 + rng() * 0.3);
      g.fill();
      stroke(d, 1, rgba(0xffffff, 0.35));
    }
  },

  crystal(d) {
    const { g, s, rng } = d;
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1 || 1);
      const bx = s * (0.32 + t * 0.36 + (rng() - 0.5) * 0.06);
      const by = s * 0.82;
      const h = s * (0.3 + rng() * 0.36) * (i === Math.floor(n / 2) ? 1.25 : 1);
      const w = s * (0.055 + rng() * 0.05);
      const tilt = (rng() - 0.5) * s * 0.12;
      poly(g, [
        [bx - w, by],
        [bx - w * 0.82, by - h * 0.82],
        [bx + tilt, by - h],
        [bx + w * 0.82, by - h * 0.78],
        [bx + w, by],
      ]);
      fillGradient(d, bx, by - h, bx, by, 1.5, 0.35);
      stroke(d, 1.2, rgba(0xffffff, 0.4));
      // Internal c-axis line — reads as transparency.
      g.beginPath();
      g.moveTo(bx + tilt * 0.5, by - h * 0.92);
      g.lineTo(bx - w * 0.15, by - h * 0.05);
      stroke(d, 1, rgba(0xffffff, 0.55));
    }
  },

  metal(d) {
    const { g, s, rng } = d;
    const x = s * 0.2;
    const y = s * 0.32;
    const w = s * 0.6;
    const h = s * 0.36;
    const bevel = s * 0.06;
    poly(g, [
      [x + bevel, y],
      [x + w, y],
      [x + w, y + h - bevel],
      [x + w - bevel, y + h],
      [x, y + h],
      [x, y + bevel],
    ]);
    fillGradient(d, x, y, x, y + h, 1.4, 0.5);
    stroke(d, 1.5, rgba(d.def.accent, 0.7));
    hatch(d, x, y + h * 0.55, w, h * 0.45, 5, 0.18);
    // Top face for a plate silhouette rather than a flat rectangle.
    poly(g, [
      [x + bevel, y],
      [x + w, y],
      [x + w - s * 0.08, y - s * 0.1],
      [x + bevel - s * 0.06, y - s * 0.1],
    ]);
    g.fillStyle = shade(d.def.tint, 1.6);
    g.fill();
    stroke(d, 1, rgba(0xffffff, 0.28));
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(x + w * (0.2 + i * 0.3), y + h * 0.78, s * 0.018, 0, 6.283);
      g.fillStyle = rgba(0x061620, 0.5);
      g.fill();
    }
    if (rng() > 0.5) {
      // Wear scratch — breaks the "programmer art" perfect rectangle.
      g.beginPath();
      g.moveTo(x + w * 0.15, y + h * 0.3);
      g.lineTo(x + w * 0.72, y + h * 0.46);
      stroke(d, 1, rgba(0xffffff, 0.22));
    }
  },

  plant(d) {
    const { g, s, rng } = d;
    // Stem
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.88);
    g.bezierCurveTo(s * 0.44, s * 0.66, s * 0.57, s * 0.46, s * 0.5, s * 0.16);
    g.lineWidth = (3.2 * s) / 96;
    g.strokeStyle = shade(d.def.tint, 0.8);
    g.stroke();
    const blades = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < blades; i++) {
      const t = 0.2 + (i / blades) * 0.62;
      const side = i % 2 === 0 ? 1 : -1;
      const ox = s * 0.5 + side * s * 0.02;
      const oy = s * (0.88 - t * 0.68);
      const len = s * (0.2 + rng() * 0.16);
      g.beginPath();
      g.moveTo(ox, oy);
      g.quadraticCurveTo(ox + side * len * 0.8, oy - len * 0.5, ox + side * len * 0.35, oy - len);
      g.quadraticCurveTo(ox + side * len * 0.1, oy - len * 0.45, ox, oy);
      fillGradient(d, ox, oy - len, ox, oy, 1.3, 0.55);
      stroke(d, 1.1, rgba(d.def.accent, 0.55));
    }
  },

  seed(d) {
    const { g, s, rng } = d;
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng() * 0.4;
      const r = s * (0.1 + rng() * 0.06);
      const cx = s * 0.5 + Math.cos(a) * s * 0.14;
      const cy = s * 0.55 + Math.sin(a) * s * 0.13;
      g.beginPath();
      g.ellipse(cx, cy, r, r * 1.22, a * 0.4, 0, 6.283);
      fillGradient(d, cx, cy - r, cx, cy + r, 1.45, 0.5);
      stroke(d, 1.2, rgba(d.def.accent, 0.6));
      g.beginPath();
      g.arc(cx - r * 0.3, cy - r * 0.4, r * 0.22, 0, 6.283);
      g.fillStyle = rgba(0xffffff, 0.3);
      g.fill();
    }
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.42);
    g.quadraticCurveTo(s * 0.55, s * 0.28, s * 0.48, s * 0.16);
    stroke(d, 2, shade(d.def.tint, 0.7), 1);
  },

  fish(d) {
    const { g, s, rng } = d;
    const cy = s * 0.52;
    const bl = s * (0.3 + rng() * 0.05);
    const bh = s * (0.13 + rng() * 0.05);
    // Tail
    poly(g, [
      [s * 0.5 - bl * 0.9, cy],
      [s * 0.5 - bl * 1.42, cy - bh * 1.1],
      [s * 0.5 - bl * 1.22, cy],
      [s * 0.5 - bl * 1.42, cy + bh * 1.05],
    ]);
    g.fillStyle = rgba(d.def.accent, 0.7);
    g.fill();
    stroke(d, 1.1, rgba(0x061620, 0.4));
    // Dorsal
    poly(g, [
      [s * 0.5 - bl * 0.35, cy - bh * 0.85],
      [s * 0.5 - bl * 0.05, cy - bh * 1.9],
      [s * 0.5 + bl * 0.3, cy - bh * 0.8],
    ]);
    g.fillStyle = rgba(d.def.accent, 0.55);
    g.fill();
    // Body
    g.beginPath();
    g.ellipse(s * 0.5, cy, bl, bh, rng() * 0.1 - 0.05, 0, 6.283);
    fillGradient(d, 0, cy - bh, 0, cy + bh, 1.45, 0.45);
    stroke(d, 1.4, rgba(0x061620, 0.45));
    hatch(d, s * 0.5 - bl, cy, bl * 2, bh, 4, 0.14);
    // Pectoral fin
    g.beginPath();
    g.moveTo(s * 0.5 + bl * 0.1, cy + bh * 0.3);
    g.quadraticCurveTo(s * 0.5, cy + bh * 1.5, s * 0.5 - bl * 0.35, cy + bh * 0.75);
    g.fillStyle = rgba(d.def.accent, 0.5);
    g.fill();
    // Eye
    g.beginPath();
    g.arc(s * 0.5 + bl * 0.62, cy - bh * 0.22, s * 0.035, 0, 6.283);
    g.fillStyle = '#f2fbff';
    g.fill();
    g.beginPath();
    g.arc(s * 0.5 + bl * 0.64, cy - bh * 0.2, s * 0.017, 0, 6.283);
    g.fillStyle = '#06161e';
    g.fill();
  },

  egg(d) {
    const { g, s, rng } = d;
    g.beginPath();
    g.ellipse(s * 0.5, s * 0.55, s * 0.21, s * 0.28, 0, 0, 6.283);
    fillGradient(d, 0, s * 0.27, 0, s * 0.83, 1.35, 0.5);
    stroke(d, 1.5, rgba(d.def.accent, 0.6));
    for (let i = 0; i < 14; i++) {
      const a = rng() * 6.283;
      const r = Math.sqrt(rng());
      g.beginPath();
      g.arc(
        s * 0.5 + Math.cos(a) * r * s * 0.16,
        s * 0.55 + Math.sin(a) * r * s * 0.22,
        s * (0.012 + rng() * 0.016),
        0,
        6.283,
      );
      g.fillStyle = rgba(d.def.accent, 0.35 + rng() * 0.4);
      g.fill();
    }
  },

  circuit(d) {
    const { g, s, rng } = d;
    const x = s * 0.16;
    const y = s * 0.28;
    const w = s * 0.68;
    const h = s * 0.44;
    poly(g, [
      [x, y],
      [x + w - s * 0.06, y],
      [x + w, y + s * 0.06],
      [x + w, y + h],
      [x, y + h],
    ]);
    fillGradient(d, x, y, x, y + h, 1.2, 0.55);
    stroke(d, 1.4, rgba(d.def.accent, 0.5));
    // Traces
    g.lineWidth = (1.2 * s) / 96;
    g.strokeStyle = rgba(d.def.accent, 0.85);
    for (let i = 0; i < 6; i++) {
      const ty = y + h * (0.12 + (i / 6) * 0.8);
      g.beginPath();
      g.moveTo(x + s * 0.03, ty);
      const mid = x + w * (0.3 + rng() * 0.4);
      g.lineTo(mid, ty);
      g.lineTo(mid + s * 0.05, ty + (rng() > 0.5 ? s * 0.05 : -s * 0.05));
      g.lineTo(x + w - s * 0.03, ty + (rng() > 0.5 ? s * 0.05 : -s * 0.05));
      g.stroke();
    }
    // Dies + pads
    for (let i = 0; i < 3; i++) {
      const cw = s * (0.09 + rng() * 0.07);
      const ch = s * (0.07 + rng() * 0.05);
      const cx = x + s * 0.08 + i * w * 0.28;
      const cy = y + h * (0.28 + rng() * 0.34);
      g.fillStyle = shade(0x0b1a20, 1);
      g.fillRect(cx, cy, cw, ch);
      g.strokeStyle = rgba(0xffffff, 0.25);
      g.lineWidth = (1 * s) / 96;
      g.strokeRect(cx, cy, cw, ch);
    }
  },

  battery(d) {
    const { g, s, rng } = d;
    const w = s * 0.32;
    const h = s * 0.5;
    const x = s * 0.5 - w / 2;
    const y = s * 0.28;
    const r = s * 0.05;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    fillGradient(d, x, y, x, y + h, 1.3, 0.45);
    stroke(d, 1.5, rgba(d.def.accent, 0.55));
    // Terminal
    g.beginPath();
    g.roundRect(s * 0.5 - w * 0.22, y - s * 0.07, w * 0.44, s * 0.075, s * 0.02);
    g.fillStyle = rgba(d.def.accent, 0.9);
    g.fill();
    // Charge segments
    for (let i = 0; i < 4; i++) {
      const sy = y + h * (0.16 + i * 0.19);
      g.beginPath();
      g.roundRect(x + w * 0.18, sy, w * 0.64, h * 0.11, s * 0.012);
      g.fillStyle = rgba(d.def.accent, i < 3 ? 0.75 : 0.18);
      g.fill();
    }
    hatch(d, x, y + h * 0.62, w, h * 0.38, 4, 0.16);
    if (rng() > 0.4) {
      g.beginPath();
      g.moveTo(x + w * 0.1, y + h * 0.9);
      g.lineTo(x + w * 0.8, y + h * 0.84);
      stroke(d, 1, rgba(0xffffff, 0.18));
    }
  },

  tank(d) {
    const { g, s } = d;
    const w = s * 0.34;
    const h = s * 0.62;
    const x = s * 0.5 - w / 2;
    const y = s * 0.24;
    g.beginPath();
    g.roundRect(x, y, w, h, w * 0.5);
    fillGradient(d, x, y, x + w, y + h, 1.45, 0.42);
    stroke(d, 1.6, rgba(d.def.accent, 0.5));
    // Valve
    g.beginPath();
    g.rect(s * 0.5 - s * 0.035, y - s * 0.09, s * 0.07, s * 0.1);
    g.fillStyle = shade(d.def.accent, 0.8);
    g.fill();
    g.beginPath();
    g.arc(s * 0.5, y - s * 0.1, s * 0.045, 0, 6.283);
    g.fillStyle = rgba(d.def.accent, 0.95);
    g.fill();
    // Straps
    for (const t of [0.3, 0.66]) {
      g.beginPath();
      g.rect(x - s * 0.02, y + h * t, w + s * 0.04, s * 0.045);
      g.fillStyle = rgba(0x0a1c24, 0.62);
      g.fill();
    }
    // Specular sheen
    g.beginPath();
    g.roundRect(x + w * 0.16, y + h * 0.1, w * 0.16, h * 0.7, w * 0.1);
    g.fillStyle = rgba(0xffffff, 0.22);
    g.fill();
  },

  tool(d) {
    const { g, s, rng } = d;
    // Handle
    g.save();
    g.translate(s * 0.5, s * 0.55);
    g.rotate(-0.5);
    g.beginPath();
    g.roundRect(-s * 0.05, -s * 0.02, s * 0.1, s * 0.34, s * 0.04);
    g.fillStyle = shade(0x1a262c, 1);
    g.fill();
    stroke(d, 1.2, rgba(0xffffff, 0.16));
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(-s * 0.05, s * 0.05 + i * s * 0.06);
      g.lineTo(s * 0.05, s * 0.05 + i * s * 0.06);
      stroke(d, 1, rgba(0xffffff, 0.12));
    }
    // Head — asymmetric, worn
    poly(g, [
      [-s * 0.07, -s * 0.02],
      [-s * 0.03, -s * 0.3],
      [s * 0.02, -s * 0.34],
      [s * 0.09, -s * 0.24],
      [s * 0.07, -s * 0.02],
    ]);
    fillGradient(d, -s * 0.07, -s * 0.34, s * 0.09, 0, 1.5, 0.5);
    stroke(d, 1.4, rgba(d.def.accent, 0.7));
    g.beginPath();
    g.moveTo(-s * 0.02, -s * 0.3);
    g.lineTo(s * 0.03, -s * 0.06);
    stroke(d, 1.1, rgba(0xffffff, 0.45));
    g.restore();
    if (rng() > 0.5) {
      g.beginPath();
      g.arc(s * 0.62, s * 0.62, s * 0.035, 0, 6.283);
      g.fillStyle = rgba(d.def.accent, 0.8);
      g.fill();
    }
  },

  device(d) {
    const { g, s, rng } = d;
    const w = s * 0.56;
    const h = s * 0.4;
    const x = s * 0.5 - w / 2;
    const y = s * 0.3;
    g.beginPath();
    g.roundRect(x, y, w, h, s * 0.06);
    fillGradient(d, x, y, x, y + h, 1.3, 0.48);
    stroke(d, 1.5, rgba(d.def.accent, 0.55));
    // Lens / emitter
    const lx = x + w * 0.74;
    const ly = y + h * 0.42;
    g.beginPath();
    g.arc(lx, ly, s * 0.085, 0, 6.283);
    const lg = g.createRadialGradient(lx - s * 0.02, ly - s * 0.02, 0, lx, ly, s * 0.085);
    lg.addColorStop(0, rgba(0xffffff, 0.95));
    lg.addColorStop(0.4, rgba(d.def.accent, 0.9));
    lg.addColorStop(1, rgba(d.def.accent, 0.15));
    g.fillStyle = lg;
    g.fill();
    stroke(d, 1.3, rgba(0x061620, 0.55));
    // Readout strip
    g.beginPath();
    g.roundRect(x + w * 0.1, y + h * 0.2, w * 0.4, h * 0.24, s * 0.015);
    g.fillStyle = rgba(0x03141c, 0.7);
    g.fill();
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.rect(x + w * 0.13 + i * w * 0.09, y + h * 0.25 + rng() * h * 0.06, w * 0.05, h * 0.1);
      g.fillStyle = rgba(d.def.accent, 0.5 + rng() * 0.4);
      g.fill();
    }
    // Grip texture
    hatch(d, x + w * 0.06, y + h * 0.6, w * 0.5, h * 0.32, 4, 0.2);
  },

  module(d) {
    const { g, s } = d;
    const cx = s * 0.5;
    const cy = s * 0.53;
    const r = s * 0.3;
    poly(
      g,
      Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      }),
    );
    fillGradient(d, cx, cy - r, cx, cy + r, 1.35, 0.45);
    stroke(d, 1.7, rgba(d.def.accent, 0.65));
    poly(
      g,
      Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return [cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6];
      }),
    );
    stroke(d, 1.2, rgba(d.def.accent, 0.4));
    hatch(d, cx - r, cy, r * 2, r, 5, 0.16);
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI / 3) * (i * 2) - Math.PI / 6;
      g.beginPath();
      g.arc(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8, s * 0.022, 0, 6.283);
      g.fillStyle = rgba(0x061620, 0.55);
      g.fill();
    }
  },

  food(d) {
    const { g, s, rng } = d;
    blob(g, s * 0.5, s * 0.56, s * 0.26, 3, 0.1, rng);
    fillGradient(d, 0, s * 0.28, 0, s * 0.84, 1.35, 0.48);
    stroke(d, 1.5, rgba(d.def.accent, 0.5));
    hatch(d, s * 0.5, s * 0.56, s * 0.3, s * 0.3, 5, 0.18);
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(s * (0.36 + i * 0.09), s * 0.42);
      g.quadraticCurveTo(s * (0.4 + i * 0.09), s * 0.56, s * (0.35 + i * 0.09), s * 0.7);
      stroke(d, 1.4, rgba(0x061620, 0.3));
    }
  },

  bottle(d) {
    const { g, s } = d;
    const cx = s * 0.5;
    g.beginPath();
    g.moveTo(cx - s * 0.06, s * 0.24);
    g.lineTo(cx - s * 0.06, s * 0.36);
    g.quadraticCurveTo(cx - s * 0.2, s * 0.46, cx - s * 0.19, s * 0.68);
    g.quadraticCurveTo(cx - s * 0.19, s * 0.82, cx, s * 0.82);
    g.quadraticCurveTo(cx + s * 0.19, s * 0.82, cx + s * 0.19, s * 0.68);
    g.quadraticCurveTo(cx + s * 0.2, s * 0.46, cx + s * 0.06, s * 0.36);
    g.lineTo(cx + s * 0.06, s * 0.24);
    g.closePath();
    g.fillStyle = rgba(0xdff6ff, 0.14);
    g.fill();
    stroke(d, 1.6, rgba(0xdff6ff, 0.45));
    // Liquid
    g.save();
    g.clip();
    const lg = g.createLinearGradient(0, s * 0.5, 0, s * 0.82);
    lg.addColorStop(0, shade(d.def.tint, 1.25));
    lg.addColorStop(1, shade(d.def.tint, 0.55));
    g.fillStyle = lg;
    g.fillRect(0, s * 0.52, s, s * 0.4);
    g.fillStyle = rgba(0xffffff, 0.3);
    g.fillRect(0, s * 0.52, s, s * 0.012);
    g.restore();
    // Cap
    g.beginPath();
    g.roundRect(cx - s * 0.075, s * 0.19, s * 0.15, s * 0.07, s * 0.02);
    g.fillStyle = shade(d.def.accent, 0.85);
    g.fill();
    stroke(d, 1.2, rgba(0x061620, 0.4));
    // Highlight
    g.beginPath();
    g.roundRect(cx - s * 0.13, s * 0.5, s * 0.045, s * 0.24, s * 0.02);
    g.fillStyle = rgba(0xffffff, 0.22);
    g.fill();
  },

  fragment(d) {
    const { g, s, rng } = d;
    const pts: number[][] = [];
    const n = 7 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng() * 0.3;
      const r = s * (0.16 + rng() * 0.16);
      pts.push([s * 0.5 + Math.cos(a) * r, s * 0.55 + Math.sin(a) * r * 0.85]);
    }
    poly(g, pts);
    fillGradient(d, 0, s * 0.3, 0, s * 0.82, 1.3, 0.42);
    stroke(d, 1.7, rgba(d.def.accent, 0.6));
    hatch(d, s * 0.5, s * 0.5, s * 0.4, s * 0.4, 5, 0.22);
    // Fracture lines + one exposed inner face.
    for (let i = 0; i < 3; i++) {
      const a = pts[(i * 3) % n];
      g.beginPath();
      g.moveTo(s * 0.5, s * 0.55);
      g.lineTo(a[0], a[1]);
      stroke(d, 1.1, rgba(0xffffff, 0.2));
    }
    poly(g, [pts[0], pts[1], [s * 0.5, s * 0.55]]);
    g.fillStyle = rgba(d.def.accent, 0.22);
    g.fill();
  },

  blueprint(d) {
    const { g, s } = d;
    const x = s * 0.2;
    const y = s * 0.24;
    const w = s * 0.6;
    const h = s * 0.52;
    g.beginPath();
    g.moveTo(x, y + s * 0.02);
    g.lineTo(x + w * 0.92, y);
    g.lineTo(x + w, y + h);
    g.lineTo(x + s * 0.02, y + h - s * 0.02);
    g.closePath();
    g.fillStyle = rgba(0x07222e, 0.85);
    g.fill();
    stroke(d, 1.5, rgba(d.def.accent, 0.7));
    g.save();
    g.clip();
    g.strokeStyle = rgba(d.def.accent, 0.3);
    g.lineWidth = (1 * s) / 96;
    for (let i = 1; i < 6; i++) {
      g.beginPath();
      g.moveTo(x, y + (h * i) / 6);
      g.lineTo(x + w, y + (h * i) / 6);
      g.stroke();
      g.beginPath();
      g.moveTo(x + (w * i) / 6, y);
      g.lineTo(x + (w * i) / 6, y + h);
      g.stroke();
    }
    // A schematic sitting on the grid.
    g.strokeStyle = rgba(0xffffff, 0.75);
    g.lineWidth = (1.6 * s) / 96;
    g.beginPath();
    g.rect(x + w * 0.22, y + h * 0.28, w * 0.34, h * 0.34);
    g.stroke();
    g.beginPath();
    g.moveTo(x + w * 0.56, y + h * 0.45);
    g.lineTo(x + w * 0.78, y + h * 0.45);
    g.stroke();
    g.beginPath();
    g.arc(x + w * 0.78, y + h * 0.45, w * 0.06, 0, 6.283);
    g.stroke();
    g.restore();
  },

  suit(d) {
    const { g, s } = d;
    const cx = s * 0.5;
    g.beginPath();
    g.moveTo(cx - s * 0.1, s * 0.26);
    g.quadraticCurveTo(cx - s * 0.26, s * 0.32, cx - s * 0.23, s * 0.5);
    g.lineTo(cx - s * 0.19, s * 0.8);
    g.lineTo(cx + s * 0.19, s * 0.8);
    g.lineTo(cx + s * 0.23, s * 0.5);
    g.quadraticCurveTo(cx + s * 0.26, s * 0.32, cx + s * 0.1, s * 0.26);
    g.quadraticCurveTo(cx, s * 0.34, cx - s * 0.1, s * 0.26);
    g.closePath();
    fillGradient(d, 0, s * 0.26, 0, s * 0.8, 1.3, 0.45);
    stroke(d, 1.6, rgba(d.def.accent, 0.6));
    hatch(d, cx - s * 0.24, s * 0.5, s * 0.48, s * 0.3, 5, 0.2);
    // Collar + chest seal
    g.beginPath();
    g.moveTo(cx - s * 0.1, s * 0.27);
    g.quadraticCurveTo(cx, s * 0.36, cx + s * 0.1, s * 0.27);
    stroke(d, 2.2, rgba(d.def.accent, 0.9));
    g.beginPath();
    g.moveTo(cx, s * 0.34);
    g.lineTo(cx, s * 0.78);
    stroke(d, 1.3, rgba(0x061620, 0.45));
    g.beginPath();
    g.arc(cx + s * 0.12, s * 0.44, s * 0.03, 0, 6.283);
    g.fillStyle = rgba(d.def.accent, 0.85);
    g.fill();
  },

  shell(d) {
    const { g, s, rng } = d;
    blob(g, s * 0.5, s * 0.58, s * 0.27, 5, 0.13, rng);
    fillGradient(d, 0, s * 0.3, 0, s * 0.86, 1.35, 0.46);
    stroke(d, 1.5, rgba(d.def.accent, 0.55));
    // Radial ribs — coral/shell growth structure at a second scale.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.283 + rng() * 0.1;
      g.beginPath();
      g.moveTo(s * 0.5, s * 0.58);
      g.quadraticCurveTo(
        s * 0.5 + Math.cos(a) * s * 0.16,
        s * 0.58 + Math.sin(a) * s * 0.16,
        s * 0.5 + Math.cos(a) * s * 0.27,
        s * 0.58 + Math.sin(a) * s * 0.24,
      );
      stroke(d, 1.1, rgba(0x061620, 0.28));
    }
    // Polyp mouths
    for (let i = 0; i < 5; i++) {
      const a = rng() * 6.283;
      const r = Math.sqrt(rng()) * s * 0.17;
      g.beginPath();
      g.arc(s * 0.5 + Math.cos(a) * r, s * 0.58 + Math.sin(a) * r, s * (0.016 + rng() * 0.018), 0, 6.283);
      g.fillStyle = rgba(d.def.accent, 0.65);
      g.fill();
    }
  },
};

/* ------------------------------------------------------------------ *
 * Tier B — offscreen mesh builders
 * ------------------------------------------------------------------ */

/** Displaces vertices along their normals with hashed noise; kills perfect primitives. */
function bump(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h =
      hash01(seed + Math.round(x * 37) * 131 + Math.round(y * 41) * 17 + Math.round(z * 43) * 7) - 0.5;
    const h2 =
      hash01(seed * 3 + Math.round(x * 11) * 5 + Math.round(y * 13) * 3 + Math.round(z * 7)) - 0.5;
    const k = (h * 0.7 + h2 * 0.3) * amount;
    if (nor) {
      pos.setXYZ(i, x + nor.getX(i) * k, y + nor.getY(i) * k, z + nor.getZ(i) * k);
    } else {
      pos.setXYZ(i, x * (1 + k), y * (1 + k), z * (1 + k));
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------ */

interface Pending {
  key: string;
  id: string;
  size: number;
}

export class IconFactory {
  /** Master canvases keyed `id@size`. */
  private masters = new Map<string, HTMLCanvasElement>();
  /** Keys whose tier-B upgrade has already been applied. */
  private upgraded = new Set<string>();
  private queue: Pending[] = [];
  private queued = new Set<string>();
  /** Live DOM canvases awaiting an upgraded blit. */
  private live: Array<{ key: string; canvas: HTMLCanvasElement }> = [];

  private renderer: THREE.WebGLRenderer | null = null;
  private rendererFailed = false;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private rigSize = 0;
  private env: THREE.Texture | null = null;
  private trash: Array<{ dispose(): void }> = [];

  /** Set false on low tier to skip the 3D pass entirely. */
  allow3d = true;
  /** Icons upgraded per frame. Each costs one small draw + one composite. */
  budgetPerFrame = 2;

  /* ---------------- public ---------------- */

  /**
   * Returns a canvas element for the item, drawn immediately with tier-A art and
   * queued for a tier-B upgrade. Safe to call for hundreds of items.
   */
  element(id: string, size = 64, cls = 'ui-icon'): HTMLCanvasElement {
    const key = `${id}@${size}`;
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    c.className = cls;
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    const master = this.master(id, size);
    const g = c.getContext('2d');
    if (g) g.drawImage(master, 0, 0, c.width, c.height);
    if (this.allow3d && !this.upgraded.has(key)) {
      this.live.push({ key, canvas: c });
      if (!this.queued.has(key)) {
        this.queued.add(key);
        this.queue.push({ key, id, size });
      }
    }
    return c;
  }

  /** A CSS-usable data URL. Used where a canvas element is impractical. */
  dataUrl(id: string, size = 64): string {
    return this.master(id, size).toDataURL();
  }

  /** Ticked by HudSystem; performs at most `budgetPerFrame` upgrades. */
  update(): void {
    if (!this.allow3d || this.queue.length === 0) return;
    let n = this.budgetPerFrame;
    while (n-- > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.queued.delete(job.key);
      if (this.upgraded.has(job.key)) continue;
      const ok = this.render3d(job.id, job.size, this.masters.get(job.key));
      if (!ok) {
        // Renderer unavailable — stop trying, tier A is already on screen.
        this.queue.length = 0;
        this.queued.clear();
        this.allow3d = false;
        return;
      }
      this.upgraded.add(job.key);
      this.blit(job.key);
    }
    // Drop dead references so the list cannot grow without bound.
    if (this.live.length > 512) this.live = this.live.filter((l) => l.canvas.isConnected);
  }

  dispose(): void {
    for (const t of this.trash) {
      try {
        t.dispose();
      } catch {
        /* already gone */
      }
    }
    this.trash.length = 0;
    this.env?.dispose();
    this.env = null;
    this.scene = null;
    this.camera = null;
    this.renderer?.dispose();
    const gl = this.renderer?.getContext();
    const lose = gl?.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    this.renderer = null;
    this.masters.clear();
    this.upgraded.clear();
    this.live.length = 0;
    this.queue.length = 0;
    this.queued.clear();
  }

  /* ---------------- tier A ---------------- */

  private master(id: string, size: number): HTMLCanvasElement {
    const key = `${id}@${size}`;
    const found = this.masters.get(key);
    if (found) return found;

    const def = itemDef(id);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    if (g) {
      g.scale(dpr, dpr);
      this.draw2d(g, size, def);
    }
    this.masters.set(key, c);
    return c;
  }

  private draw2d(g: CanvasRenderingContext2D, s: number, def: ItemDef): void {
    let seed = 0;
    for (let i = 0; i < def.id.length; i++) seed = (seed * 31 + def.id.charCodeAt(i)) | 0;
    const rng = makeRng(seed || 7);
    const d: DrawCtx = { g, s, rng, def };

    g.clearRect(0, 0, s, s);

    // Backplate glow: gives every icon depth separation from the grid cell.
    const bg = g.createRadialGradient(s * 0.5, s * 0.52, 0, s * 0.5, s * 0.52, s * 0.52);
    bg.addColorStop(0, rgba(def.accent, 0.2 + (def.glow ?? 0) * 0.35));
    bg.addColorStop(0.55, rgba(def.accent, 0.07));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bg;
    g.fillRect(0, 0, s, s);

    // Contact shadow so the object sits on something.
    g.save();
    g.beginPath();
    g.ellipse(s * 0.5, s * 0.85, s * 0.26, s * 0.045, 0, 0, 6.283);
    g.fillStyle = 'rgba(2, 12, 18, 0.42)';
    g.filter = 'blur(2px)';
    g.fill();
    g.restore();

    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    (DRAWERS[def.archetype] ?? DRAWERS.fragment)(d);
    g.restore();

    // Bioluminescence: additive halo behind the silhouette.
    if (def.glow) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const eg = g.createRadialGradient(s * 0.5, s * 0.54, 0, s * 0.5, s * 0.54, s * 0.42);
      eg.addColorStop(0, rgba(def.accent, 0.5 * def.glow));
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = eg;
      g.fillRect(0, 0, s, s);
      g.restore();
    }

    // Micro grain — kills the flat vector look at 30 cm.
    g.save();
    g.globalAlpha = 0.075;
    for (let i = 0; i < Math.round(s * 2.2); i++) {
      g.fillStyle = rng() > 0.5 ? '#ffffff' : '#02121a';
      g.fillRect(rng() * s, rng() * s, 1, 1);
    }
    g.restore();
  }

  /* ---------------- tier B ---------------- */

  private ensureRig(size: number): boolean {
    if (this.rendererFailed) return false;
    const target = Math.min(256, Math.max(96, size * 2));
    if (this.renderer && this.rigSize === target) return true;

    if (!this.renderer) {
      try {
        const canvas = document.createElement('canvas');
        this.renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          premultipliedAlpha: false,
          powerPreference: 'low-power',
        });
        this.renderer.setPixelRatio(1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.setClearAlpha(0);
      } catch (err) {
        console.warn('[ui] icon renderer unavailable, staying on 2-D icons', err);
        this.rendererFailed = true;
        this.renderer = null;
        return false;
      }
    }
    this.rigSize = target;
    this.renderer.setSize(target, target, false);

    if (!this.scene) {
      const scene = new THREE.Scene();
      const amb = new THREE.AmbientLight(0x2f5566, 1.15);
      const key = new THREE.DirectionalLight(0xe8fbff, 3.1);
      key.position.set(1.3, 1.9, 1.5);
      const rim = new THREE.DirectionalLight(0x54d8ff, 2.0);
      rim.position.set(-1.6, 0.5, -1.3);
      const fill = new THREE.PointLight(0xffa06a, 1.4, 8, 1.4);
      fill.position.set(0.6, -0.9, 1.2);
      scene.add(amb, key, rim, fill);
      this.scene = scene;

      this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 24);
      this.camera.position.set(0.95, 0.82, 2.05);
      this.camera.lookAt(0, -0.02, 0);

      this.env = this.buildEnv();
      if (this.env) scene.environment = this.env;
    }
    return true;
  }

  /**
   * A 32x16 equirect gradient (bright surface above, deep blue below) run
   * through PMREM. Entirely procedural; makes metals read as metal.
   */
  private buildEnv(): THREE.Texture | null {
    if (!this.renderer) return null;
    try {
      const w = 32;
      const h = 16;
      const data = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        // t=0 is the top row of an equirect: the water surface.
        const r = 0.5 * (1 - t) ** 2 + 0.02;
        const g = 0.72 * (1 - t) ** 1.4 + 0.05;
        const b = 0.9 * (1 - t) ** 1.1 + 0.09;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const dapple = 1 + 0.16 * Math.sin(x * 0.9 + y * 0.4);
          data[i] = r * dapple;
          data[i + 1] = g * dapple;
          data[i + 2] = b * dapple;
          data[i + 3] = 1;
        }
      }
      const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const rt = pmrem.fromEquirectangular(tex);
      tex.dispose();
      pmrem.dispose();
      return rt.texture;
    } catch (err) {
      console.warn('[ui] icon env map failed', err);
      return null;
    }
  }

  /** Returns false when the 3D path is unavailable. */
  private render3d(id: string, size: number, master?: HTMLCanvasElement): boolean {
    if (!master) return true;
    if (!this.ensureRig(size)) return false;
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!renderer || !scene || !camera) return false;

    const def = itemDef(id);
    let seed = 0;
    for (let i = 0; i < def.id.length; i++) seed = (seed * 33 + def.id.charCodeAt(i)) | 0;

    const group = this.buildMesh(def, Math.abs(seed) || 3);
    scene.add(group);

    // Normalise scale so every icon reads at the same visual weight.
    const box = new THREE.Box3().setFromObject(group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (sphere.radius > 1e-4) {
      const k = 0.62 / sphere.radius;
      group.scale.multiplyScalar(k);
      group.position.sub(sphere.center.multiplyScalar(k));
    }

    let ok = true;
    try {
      renderer.clear();
      renderer.render(scene, camera);
      const g = master.getContext('2d');
      if (g) {
        const w = master.width;
        const h = master.height;
        const src = renderer.domElement;
        // Faked bloom for emissive items: blurred over-draw, then the sharp pass.
        if (def.glow) {
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.42 * def.glow;
          try {
            g.filter = 'blur(5px)';
          } catch {
            /* filter unsupported */
          }
          g.drawImage(src, 0, 0, w, h);
          g.restore();
        }
        g.drawImage(src, 0, 0, w, h);
      }
    } catch (err) {
      console.warn('[ui] icon render failed', err);
      ok = false;
    }

    scene.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) for (const x of mat) x.dispose();
      else mat?.dispose();
    });
    return ok;
  }

  private blit(key: string): void {
    const master = this.masters.get(key);
    if (!master) return;
    for (const l of this.live) {
      if (l.key !== key) continue;
      const g = l.canvas.getContext('2d');
      if (!g) continue;
      g.clearRect(0, 0, l.canvas.width, l.canvas.height);
      g.drawImage(master, 0, 0, l.canvas.width, l.canvas.height);
    }
  }

  /* ---------------- mesh archetypes ---------------- */

  private mat(color: number, rough: number, metal: number, emissive = 0, accent = 0xffffff): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      emissive: emissive > 0 ? accent : 0x000000,
      emissiveIntensity: emissive * 2.2,
      flatShading: false,
    });
  }

  private buildMesh(def: ItemDef, seed: number): THREE.Group {
    const g = new THREE.Group();
    const rng = makeRng(seed);
    const tint = def.tint;
    const accent = def.accent;
    const glow = def.glow ?? 0;

    const push = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    switch (def.archetype) {
      case 'ore': {
        const body = bump(new THREE.DodecahedronGeometry(0.55, 1), 0.18, seed);
        push(body, this.mat(tint, 0.82, 0.15));
        for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
          const c = new THREE.ConeGeometry(0.07 + rng() * 0.05, 0.2 + rng() * 0.2, 5 + Math.floor(rng() * 2));
          const m = push(c, this.mat(accent, 0.24, 0.1, glow * 0.7 + 0.15, accent));
          const a = rng() * 6.283;
          const b = (rng() - 0.5) * 2;
          m.position.set(Math.cos(a) * 0.4, b * 0.34, Math.sin(a) * 0.4);
          m.lookAt(m.position.clone().multiplyScalar(2.4));
          m.rotateX(Math.PI / 2);
        }
        break;
      }
      case 'crystal': {
        const n = 3 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const h = 0.4 + rng() * 0.7;
          const r = 0.09 + rng() * 0.09;
          const geo = new THREE.CylinderGeometry(r * (0.2 + rng() * 0.3), r, h, 6, 1);
          const m = push(geo, this.mat(tint, 0.1 + rng() * 0.12, 0.05, glow * 0.8 + 0.22, accent));
          m.position.set((rng() - 0.5) * 0.4, h * 0.5 - 0.42, (rng() - 0.5) * 0.4);
          m.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
        }
        push(bump(new THREE.IcosahedronGeometry(0.34, 1), 0.14, seed + 5), this.mat(0x4a5a62, 0.9, 0.05), 0, -0.42, 0);
        break;
      }
      case 'metal': {
        const plate = new THREE.BoxGeometry(1.05, 0.2, 0.68, 3, 1, 3);
        push(bump(plate, 0.012, seed), this.mat(tint, 0.34, 0.92));
        for (let i = 0; i < 4; i++) {
          push(
            new THREE.CylinderGeometry(0.035, 0.035, 0.055, 10),
            this.mat(accent, 0.42, 0.85),
            -0.36 + (i % 2) * 0.72,
            0.11,
            -0.2 + Math.floor(i / 2) * 0.4,
          );
        }
        push(new THREE.BoxGeometry(1.06, 0.03, 0.1), this.mat(accent, 0.5, 0.7), 0, 0.09, 0.18);
        break;
      }
      case 'plant': {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          pts.push(new THREE.Vector3(Math.sin(t * 3.4 + rng()) * 0.12, -0.55 + t * 1.15, Math.cos(t * 2.6) * 0.08));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        push(new THREE.TubeGeometry(curve, 22, 0.032, 6, false), this.mat(tint, 0.72, 0.02, glow * 0.4, accent));
        const blades = 3 + Math.floor(rng() * 3);
        for (let i = 0; i < blades; i++) {
          const t = 0.2 + (i / blades) * 0.7;
          const p = curve.getPoint(t);
          const geo = new THREE.PlaneGeometry(0.62, 0.16, 6, 2);
          const posAttr = geo.attributes.position as THREE.BufferAttribute;
          for (let v = 0; v < posAttr.count; v++) {
            const x = posAttr.getX(v);
            posAttr.setZ(v, -Math.pow(Math.abs(x) / 0.31, 2) * 0.16);
            posAttr.setY(v, posAttr.getY(v) * (1 - Math.abs(x) / 0.34));
          }
          geo.computeVertexNormals();
          const m = push(
            geo,
            new THREE.MeshStandardMaterial({
              color: tint,
              roughness: 0.62,
              metalness: 0.02,
              side: THREE.DoubleSide,
              emissive: glow > 0 ? accent : 0x000000,
              emissiveIntensity: glow * 1.4,
            }),
          );
          m.position.copy(p);
          m.rotation.set(rng() * 0.7 - 0.35, (i / blades) * 6.283, 0.5 + rng() * 0.5);
        }
        break;
      }
      case 'seed': {
        for (let i = 0; i < 4 + Math.floor(rng() * 2); i++) {
          const r = 0.16 + rng() * 0.09;
          const geo = bump(new THREE.SphereGeometry(r, 12, 10), 0.03, seed + i);
          const m = push(geo, this.mat(tint, 0.36, 0.05, glow, accent));
          const a = (i / 5) * 6.283;
          m.position.set(Math.cos(a) * 0.2, (rng() - 0.5) * 0.24, Math.sin(a) * 0.2);
          m.scale.y = 1.25;
        }
        push(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6), this.mat(0x4a5f36, 0.8, 0.02), 0, 0.42, 0);
        break;
      }
      case 'fish': {
        const profile: THREE.Vector2[] = [];
        const len = 0.95 + rng() * 0.25;
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          const r = Math.sin(t * Math.PI) * (0.2 + rng() * 0.03) * (1 - t * 0.35) + 0.012;
          profile.push(new THREE.Vector2(r, (t - 0.5) * len));
        }
        const body = new THREE.LatheGeometry(profile, 14);
        const m = push(body, this.mat(tint, 0.42, 0.16));
        m.rotation.z = Math.PI / 2;
        // Tail
        const tail = new THREE.ConeGeometry(0.26, 0.3, 4, 1);
        const t1 = push(tail, this.mat(accent, 0.5, 0.1, glow * 0.4, accent), -len * 0.55, 0, 0);
        t1.rotation.z = Math.PI / 2;
        t1.scale.set(1, 1, 0.22);
        // Dorsal + pectoral
        const finGeo = new THREE.CircleGeometry(0.22, 3);
        const finMat = new THREE.MeshStandardMaterial({
          color: accent,
          roughness: 0.5,
          metalness: 0.05,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        });
        const dorsal = push(finGeo, finMat, -0.05, 0.19, 0);
        dorsal.rotation.set(0, Math.PI / 2, 0.5);
        const pect = new THREE.Mesh(finGeo, finMat);
        pect.position.set(0.12, -0.06, 0.14);
        pect.rotation.set(0.9, 0.2, -0.4);
        pect.scale.setScalar(0.7);
        g.add(pect);
        // Eyes
        for (const s of [-1, 1]) {
          push(new THREE.SphereGeometry(0.065, 10, 8), this.mat(0xf2fbff, 0.14, 0.1), len * 0.31, 0.07, s * 0.11);
          push(new THREE.SphereGeometry(0.032, 8, 6), this.mat(0x06131a, 0.2, 0), len * 0.35, 0.075, s * 0.115);
        }
        break;
      }
      case 'egg': {
        const geo = bump(new THREE.SphereGeometry(0.5, 20, 16), 0.02, seed);
        const m = push(geo, this.mat(tint, 0.55, 0.06, glow * 0.5, accent));
        m.scale.set(0.82, 1.18, 0.82);
        for (let i = 0; i < 10; i++) {
          const a = rng() * 6.283;
          const b = Math.acos(2 * rng() - 1);
          const p = new THREE.Vector3(
            Math.sin(b) * Math.cos(a) * 0.4,
            Math.cos(b) * 0.56,
            Math.sin(b) * Math.sin(a) * 0.4,
          );
          push(new THREE.SphereGeometry(0.03 + rng() * 0.03, 7, 6), this.mat(accent, 0.3, 0.05, 0.7, accent), p.x, p.y, p.z);
        }
        break;
      }
      case 'circuit': {
        push(new THREE.BoxGeometry(1.0, 0.05, 0.72), this.mat(tint, 0.62, 0.1));
        for (let i = 0; i < 4; i++) {
          push(
            new THREE.BoxGeometry(0.16 + rng() * 0.12, 0.07, 0.12 + rng() * 0.1),
            this.mat(0x0d1a20, 0.5, 0.2),
            -0.3 + i * 0.2,
            0.06,
            (rng() - 0.5) * 0.4,
          );
        }
        for (let i = 0; i < 7; i++) {
          push(
            new THREE.BoxGeometry(0.5 + rng() * 0.4, 0.012, 0.018),
            this.mat(accent, 0.28, 0.9, 0.25, accent),
            (rng() - 0.5) * 0.2,
            0.033,
            -0.3 + i * 0.1,
          );
        }
        break;
      }
      case 'battery': {
        push(new THREE.CylinderGeometry(0.3, 0.3, 0.86, 20, 1), this.mat(tint, 0.42, 0.55));
        push(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 20), this.mat(accent, 0.3, 0.8, glow * 0.6 + 0.2, accent), 0, 0.3, 0);
        push(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 20), this.mat(0x0d1a20, 0.7, 0.2), 0, -0.2, 0);
        push(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 12), this.mat(accent, 0.24, 0.9, 0.4, accent), 0, 0.47, 0);
        push(new THREE.TorusGeometry(0.305, 0.02, 6, 20), this.mat(0x08161c, 0.8, 0.1), 0, 0.06, 0).rotation.x = Math.PI / 2;
        break;
      }
      case 'tank': {
        push(new THREE.CapsuleGeometry(0.3, 0.72, 6, 18), this.mat(tint, 0.26, 0.62));
        push(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 12), this.mat(accent, 0.3, 0.8), 0, 0.72, 0);
        push(new THREE.TorusGeometry(0.1, 0.022, 6, 14), this.mat(accent, 0.34, 0.85), 0, 0.8, 0).rotation.x = Math.PI / 2;
        for (const y of [0.22, -0.16]) {
          push(new THREE.TorusGeometry(0.31, 0.028, 6, 20), this.mat(0x101d24, 0.85, 0.05), 0, y, 0).rotation.x = Math.PI / 2;
        }
        break;
      }
      case 'tool': {
        const handle = push(new THREE.CapsuleGeometry(0.09, 0.5, 4, 12), this.mat(0x1b272d, 0.72, 0.15), 0, -0.18, 0);
        handle.rotation.z = 0.32;
        for (let i = 0; i < 5; i++) {
          const ring = push(new THREE.TorusGeometry(0.095, 0.014, 5, 12), this.mat(0x0c1519, 0.9, 0.05), 0.06 - i * 0.03, -0.36 + i * 0.1, 0);
          ring.rotation.set(Math.PI / 2, 0, 0.32);
        }
        const head = bump(new THREE.BoxGeometry(0.22, 0.62, 0.1, 2, 4, 1), 0.02, seed);
        const hm = push(head, this.mat(tint, 0.28, 0.86), 0.19, 0.36, 0);
        hm.rotation.z = 0.32;
        push(new THREE.BoxGeometry(0.06, 0.16, 0.08), this.mat(accent, 0.36, 0.6, 0.3, accent), 0.06, 0.06, 0.02);
        break;
      }
      case 'device': {
        push(bump(new THREE.BoxGeometry(0.9, 0.46, 0.34, 2, 2, 2), 0.008, seed), this.mat(tint, 0.44, 0.5));
        push(new THREE.CylinderGeometry(0.14, 0.16, 0.1, 18), this.mat(accent, 0.12, 0.3, 0.9, accent), 0.34, 0.02, 0.15).rotation.x = Math.PI / 2;
        push(new THREE.BoxGeometry(0.34, 0.16, 0.02), this.mat(0x03121a, 0.35, 0.1, 0.55, accent), -0.16, 0.06, 0.18);
        for (let i = 0; i < 4; i++) {
          push(new THREE.BoxGeometry(0.02, 0.24, 0.02), this.mat(0x0a1a20, 0.8, 0.1), -0.3 + i * 0.06, -0.12, 0.18);
        }
        break;
      }
      case 'module': {
        push(new THREE.CylinderGeometry(0.6, 0.6, 0.14, 6), this.mat(tint, 0.5, 0.55));
        push(new THREE.CylinderGeometry(0.36, 0.36, 0.17, 6), this.mat(accent, 0.34, 0.7, 0.22, accent));
        push(new THREE.TorusGeometry(0.48, 0.024, 6, 6), this.mat(0x0b1a22, 0.8, 0.2), 0, 0.08, 0).rotation.x = Math.PI / 2;
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * 6.283;
          push(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8), this.mat(accent, 0.3, 0.8), Math.cos(a) * 0.46, 0.04, Math.sin(a) * 0.46);
        }
        break;
      }
      case 'food': {
        const m = push(bump(new THREE.SphereGeometry(0.5, 18, 14), 0.055, seed), this.mat(tint, 0.66, 0.05, glow * 0.5, accent));
        m.scale.set(1.1, 0.72, 0.92);
        for (let i = 0; i < 3; i++) {
          push(new THREE.BoxGeometry(0.02, 0.06, 0.7), this.mat(shade2(tint, 0.55), 0.8, 0.02), -0.18 + i * 0.18, 0.33, 0);
        }
        break;
      }
      case 'bottle': {
        const profile: THREE.Vector2[] = [
          new THREE.Vector2(0.001, -0.55),
          new THREE.Vector2(0.26, -0.54),
          new THREE.Vector2(0.3, -0.3),
          new THREE.Vector2(0.29, 0.06),
          new THREE.Vector2(0.12, 0.3),
          new THREE.Vector2(0.1, 0.5),
          new THREE.Vector2(0.115, 0.56),
        ];
        const glass = new THREE.MeshStandardMaterial({
          color: 0xdff6ff,
          roughness: 0.08,
          metalness: 0.02,
          transparent: true,
          opacity: 0.32,
          side: THREE.DoubleSide,
        });
        push(new THREE.LatheGeometry(profile, 20), glass);
        const inner = profile.map((p) => new THREE.Vector2(p.x * 0.86, p.y));
        const liquid = new THREE.LatheGeometry(inner.slice(0, 4), 18);
        push(liquid, this.mat(tint, 0.2, 0.02, glow * 0.6, accent));
        push(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14), this.mat(accent, 0.5, 0.4), 0, 0.58, 0);
        break;
      }
      case 'fragment': {
        const geo = bump(new THREE.IcosahedronGeometry(0.55, 1), 0.3, seed);
        // Slice the far side flat so it reads as broken, not as a rock.
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          if (pos.getZ(i) < -0.12) pos.setZ(i, -0.12);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        push(geo, this.mat(tint, 0.55, 0.6));
        push(new THREE.BoxGeometry(0.5, 0.34, 0.02), this.mat(accent, 0.28, 0.8, 0.35, accent), 0.05, -0.02, -0.13);
        for (let i = 0; i < 3; i++) {
          push(
            new THREE.BoxGeometry(0.03, 0.03, 0.22),
            this.mat(accent, 0.4, 0.7, 0.2, accent),
            (rng() - 0.5) * 0.5,
            (rng() - 0.5) * 0.4,
            -0.2,
          );
        }
        break;
      }
      case 'blueprint': {
        const geo = new THREE.PlaneGeometry(1.0, 0.7, 8, 6);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          pos.setZ(i, Math.sin(pos.getX(i) * 3.2) * 0.045);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        push(
          geo,
          new THREE.MeshStandardMaterial({
            color: 0x082430,
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide,
            emissive: accent,
            emissiveIntensity: 0.28,
          }),
        );
        for (let i = 0; i < 6; i++) {
          push(new THREE.BoxGeometry(0.86, 0.006, 0.006), this.mat(accent, 0.3, 0.4, 0.8, accent), 0, -0.28 + i * 0.11, 0.03);
        }
        break;
      }
      case 'suit': {
        const torso = bump(new THREE.SphereGeometry(0.5, 18, 14), 0.03, seed);
        const m = push(torso, this.mat(tint, 0.58, 0.12));
        m.scale.set(0.86, 1.12, 0.6);
        for (const s of [-1, 1]) {
          push(new THREE.SphereGeometry(0.19, 12, 10), this.mat(tint, 0.52, 0.14), s * 0.42, 0.34, 0);
        }
        push(new THREE.TorusGeometry(0.16, 0.045, 8, 18), this.mat(accent, 0.3, 0.6, 0.3, accent), 0, 0.56, 0).rotation.x = Math.PI / 2;
        push(new THREE.BoxGeometry(0.05, 0.9, 0.03), this.mat(accent, 0.4, 0.4), 0, 0, 0.3);
        push(new THREE.SphereGeometry(0.055, 10, 8), this.mat(accent, 0.2, 0.3, 0.9, accent), 0.2, 0.18, 0.3);
        break;
      }
      case 'shell': {
        const base = bump(new THREE.SphereGeometry(0.46, 20, 16), 0.09, seed);
        const m = push(base, this.mat(tint, 0.72, 0.06, glow * 0.4, accent));
        m.scale.set(1, 0.68, 1);
        for (let i = 0; i < 5 + Math.floor(rng() * 3); i++) {
          const a = rng() * 6.283;
          const r = 0.1 + rng() * 0.12;
          const tube = push(
            new THREE.CylinderGeometry(r * 0.7, r, 0.16 + rng() * 0.22, 9, 1, true),
            new THREE.MeshStandardMaterial({
              color: accent,
              roughness: 0.62,
              metalness: 0.04,
              side: THREE.DoubleSide,
              emissive: glow > 0 ? accent : 0x000000,
              emissiveIntensity: glow,
            }),
            Math.cos(a) * 0.24,
            0.2 + rng() * 0.1,
            Math.sin(a) * 0.24,
          );
          tube.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
        }
        break;
      }
      default: {
        push(bump(new THREE.IcosahedronGeometry(0.5, 1), 0.16, seed), this.mat(tint, 0.6, 0.4));
      }
    }

    // Per-item tumble so no two icons present the same silhouette.
    g.rotation.set((rng() - 0.5) * 0.4, rng() * 6.283, (rng() - 0.5) * 0.3);
    return g;
  }
}

function shade2(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** Exported for the databank diagrams, which reuse the 2-D drawers directly. */
export function drawArchetype(
  g: CanvasRenderingContext2D,
  size: number,
  archetype: IconArchetype,
  tint: number,
  accent: number,
  seed: number,
): void {
  const def: ItemDef = {
    id: `diagram_${archetype}_${seed}`,
    name: archetype,
    category: 'raw',
    footprint: [1, 1],
    archetype,
    tint,
    accent,
    desc: '',
  };
  const d: DrawCtx = { g, s: size, rng: makeRng(seed || 5), def };
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  (DRAWERS[archetype] ?? DRAWERS.fragment)(d);
  g.restore();
}

export { hex as iconHex };

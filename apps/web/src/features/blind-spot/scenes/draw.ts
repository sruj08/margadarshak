/**
 * Drawing helpers shared by the Blind Spot scenes and the Phaser spike (type-only Phaser import,
 * so nothing here pulls the engine). Okabe-Ito colours; every state also has a shape or pattern.
 */
import type { Polygon } from "@margdarshak/game-core/sim";

export const COLOURS = {
  road: 0x2a2c33,
  grass: 0x3d6b3a,
  line: 0xc9ccd3,
  body: 0xc9ccd3,
  cab: 0x8a8f99,
  zone: 0xe69f00,
  rider: 0x56b4e9,
  riderInZone: 0xd55e00,
  ok: 0x009e73,
  pick: 0xf0e442,
  ink: 0x1f2026,
  white: 0xffffff,
} as const;

export const TEXT_STYLE = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Devanagari', sans-serif",
  fontSize: "12px",
  color: "#ffffff",
} as const;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounding box of a polygon after mapping each vertex. */
export function boxOf(poly: Polygon, map: (x: number, y: number) => [number, number]): Box {
  const pts = poly.map((v) => map(v.x, v.y));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** 45° hatch lines clipped to an axis-aligned box: [x1, y1, x2, y2] per line. */
export function hatchLines(b: Box, spacing: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  // Lines x - y = k (in box coordinates), k from -h to w.
  for (let k = -h + spacing / 2; k < w; k += spacing) {
    const xa = Math.max(0, k);
    const ya = xa - k;
    const xb = Math.min(w, k + h);
    const yb = xb - k;
    if (xb - xa <= 0) continue;
    out.push([b.x0 + xa, b.y0 + ya, b.x0 + xb, b.y0 + yb]);
  }
  return out;
}

/** Fills a no-zone box: translucent orange, cross-hatch and an outline. */
export function drawZone(g: Phaser.GameObjects.Graphics, b: Box, spacing = 7): void {
  g.fillStyle(COLOURS.zone, 0.25);
  g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  g.lineStyle(1.5, COLOURS.zone, 0.9);
  for (const [x1, y1, x2, y2] of hatchLines(b, spacing)) g.lineBetween(x1, y1, x2, y2);
  g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
}

/** A small eye with a slash (the "can't see you" mark). */
export function drawEyeOff(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.lineStyle(1.6, COLOURS.white, 1);
  g.strokeEllipse(x, y, 14, 8);
  g.strokeCircle(x, y, 2);
  g.lineBetween(x - 7, y - 5, x + 7, y + 5);
}

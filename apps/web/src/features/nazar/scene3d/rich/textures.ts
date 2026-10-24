import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Procedural canvas textures for the two showcase scenes (no image assets). Each is drawn once
 * from a seeded generator, so the pictures are the same every run. Cards (alpha-cut vegetation)
 * are drawn with strokes, the way slowroads.io-style scenes get dense foliage from thousands of
 * cheap instanced quads.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, x: c.getContext("2d") as CanvasRenderingContext2D };
}

function tex(c: HTMLCanvasElement, repeat = false) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

/** Mottled turf: thousands of short curved blades in several greens and straws. */
export function grassTexture(palette: "dry" | "lush" | "paddy") {
  const R = rng(palette === "dry" ? 11 : palette === "lush" ? 23 : 37);
  const { c, x } = canvas(512, 512);
  const base = palette === "dry" ? "#6c7836" : palette === "lush" ? "#4d6a2c" : "#4f8f2e";
  x.fillStyle = base;
  x.fillRect(0, 0, 512, 512);
  const hues =
    palette === "dry"
      ? [55, 62, 48, 70]
      : palette === "lush"
        ? [88, 96, 78, 104]
        : [95, 105, 85, 112];
  for (let i = 0; i < 9000; i++) {
    const px = R() * 512;
    const py = R() * 512;
    const len = 6 + R() * 16;
    const lean = (R() - 0.5) * 8;
    x.strokeStyle = hsl(hues[Math.floor(R() * 4)] as number, 38 + R() * 25, 18 + R() * 32, 0.55);
    x.lineWidth = 0.8 + R() * 1.4;
    for (const ox of [-512, 0, 512])
      for (const oy of [-512, 0, 512]) {
        const sx = px + ox;
        const sy = py + oy;
        if (sx < -30 || sx > 542 || sy < -30 || sy > 542) continue;
        x.beginPath();
        x.moveTo(sx, sy);
        x.quadraticCurveTo(sx + lean * 0.4, sy - len * 0.6, sx + lean, sy - len);
        x.stroke();
      }
  }
  for (let i = 0; i < 500; i++) {
    x.fillStyle = hsl(30 + R() * 20, 30, 25 + R() * 12, 0.25);
    x.fillRect(R() * 512, R() * 512, 2 + R() * 4, 2 + R() * 4);
  }
  return tex(c, true);
}

/** Layered rock: banded greys and browns with cracks and lichen. */
export function rockTexture() {
  const R = rng(5);
  const { c, x } = canvas(512, 512);
  x.fillStyle = "#6f675c";
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const y = R() * 512;
    x.fillStyle = hsl(28 + R() * 14, 8 + R() * 12, 28 + R() * 30, 0.35);
    const h = 4 + R() * 18;
    x.beginPath();
    x.moveTo(0, y);
    for (let px = 0; px <= 512; px += 32) x.lineTo(px, y + (R() - 0.5) * 10);
    for (let px = 512; px >= 0; px -= 32) x.lineTo(px, y + h + (R() - 0.5) * 10);
    x.fill();
  }
  for (let i = 0; i < 160; i++) {
    x.strokeStyle = `rgba(20,16,12,${0.25 + R() * 0.4})`;
    x.lineWidth = 0.6 + R() * 1.6;
    const px = R() * 512;
    const py = R() * 512;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + (R() - 0.5) * 70, py + R() * 60);
    x.stroke();
  }
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = hsl(70 + R() * 30, 40, 38 + R() * 18, 0.28);
    x.fillRect(R() * 512, R() * 512, 2 + R() * 3, 2 + R() * 3);
  }
  return tex(c, true);
}

/**
 * Tarmac across the road width (u) and 12 m along it (v): worn wheel tracks, patches, hairline
 * cracks, a dashed centre line and worn edge lines. `lane` is the lane width as a fraction.
 */
export function asphaltTexture(centreLine: boolean) {
  const R = rng(91);
  const { c, x } = canvas(512, 1024);
  x.fillStyle = "#56585d";
  x.fillRect(0, 0, 512, 1024);
  for (const cx of [128, 384]) {
    const g = x.createLinearGradient(cx - 70, 0, cx + 70, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(15,15,18,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(cx - 70, 0, 140, 1024);
  }
  for (let i = 0; i < 26; i++) {
    x.fillStyle = `rgba(${R() > 0.5 ? 70 : 20},${R() > 0.5 ? 70 : 20},${R() > 0.5 ? 72 : 22},${0.06 + R() * 0.08})`;
    x.fillRect(R() * 512, R() * 1024, 40 + R() * 160, 30 + R() * 120);
  }
  for (let i = 0; i < 9000; i++) {
    const v = 60 + R() * 80;
    x.fillStyle = `rgba(${v},${v},${v + 3},${0.18 + R() * 0.3})`;
    x.fillRect(R() * 512, R() * 1024, 1 + R() * 1.6, 1 + R() * 1.6);
  }
  for (let i = 0; i < 14; i++) {
    x.strokeStyle = "rgba(10,10,12,0.5)";
    x.lineWidth = 0.7 + R();
    x.beginPath();
    let px = R() * 512;
    let py = R() * 1024;
    x.moveTo(px, py);
    for (let k = 0; k < 6; k++) {
      px += (R() - 0.5) * 40;
      py += 10 + R() * 40;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  const worn = (px: number, w: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y += 3) {
      x.fillStyle = `rgba(232,230,222,${0.55 + R() * 0.4})`;
      x.fillRect(px - w / 2 + (R() - 0.5) * 1.5, y, w, 3);
    }
  };
  worn(26, 9, 0, 1024);
  worn(486, 9, 0, 1024);
  if (centreLine) {
    worn(256, 9, 40, 440);
    worn(256, 9, 560, 960);
  }
  return tex(c, true);
}

/** A card: soft-edged tuft of blades on transparent ground. */
export function tuftCard(dry: boolean, seed = 1) {
  const R = rng(seed);
  const { c, x } = canvas(256, 256);
  for (let i = 0; i < 90; i++) {
    const bx = 128 + (R() - 0.5) * 120;
    const h = 90 + R() * 150;
    const lean = (R() - 0.5) * 90;
    x.strokeStyle = dry
      ? hsl(48 + R() * 22, 40, 36 + R() * 30)
      : hsl(80 + R() * 30, 45, 22 + R() * 28);
    x.lineWidth = 1 + R() * 1.6;
    x.beginPath();
    x.moveTo(bx, 256);
    x.quadraticCurveTo(bx + lean * 0.3, 256 - h * 0.6, bx + lean, 256 - h);
    x.stroke();
  }
  return tex(c);
}

/** A card: leafy shrub; `flowers` adds white blossom clusters. */
export function bushCard(flowers: boolean, seed = 2) {
  const R = rng(seed);
  const { c, x } = canvas(256, 256);
  for (let i = 0; i < 420; i++) {
    const a = R() * Math.PI;
    const r = Math.sqrt(R()) * 112;
    const px = 128 + Math.cos(a) * r * 1.05;
    const py = 232 - Math.sin(a) * r * 0.95;
    x.fillStyle = hsl(85 + R() * 35, 42, 14 + R() * 26 + (py < 120 ? 8 : 0));
    x.beginPath();
    x.ellipse(px, py, 7 + R() * 7, 4 + R() * 4, R() * 3, 0, 6.3);
    x.fill();
  }
  if (flowers)
    for (let i = 0; i < 70; i++) {
      const a = R() * Math.PI;
      const r = Math.sqrt(R()) * 100;
      x.fillStyle = `rgba(250,250,245,${0.8 + R() * 0.2})`;
      x.beginPath();
      x.arc(128 + Math.cos(a) * r, 220 - Math.sin(a) * r * 0.9, 2.5 + R() * 2.5, 0, 6.3);
      x.fill();
    }
  return tex(c);
}

/** A card: a whole conifer, tier on tier of drooping needled branches round a dark trunk. */
export function pineCard(seed = 3) {
  const R = rng(seed);
  const { c, x } = canvas(256, 512);
  x.strokeStyle = "#2a2118";
  x.lineWidth = 9;
  x.beginPath();
  x.moveTo(128, 512);
  x.lineTo(128, 40);
  x.stroke();
  for (let y = 470; y > 30; y -= 7) {
    const reach = 20 + (y / 512) * 105 * (0.7 + R() * 0.5);
    for (const dir of [-1, 1]) {
      x.strokeStyle = hsl(112 + R() * 12, 38, 12 + R() * 10);
      x.lineWidth = 2.2;
      x.beginPath();
      x.moveTo(128, y);
      x.quadraticCurveTo(128 + dir * reach * 0.6, y - 4, 128 + dir * reach, y + reach * 0.28);
      x.stroke();
      for (let k = 0; k < 11; k++) {
        const t = 0.15 + (k / 11) * 0.85;
        const bx = 128 + dir * reach * t;
        const by = y + reach * 0.28 * t * t + (1 - t) * -2;
        x.strokeStyle = hsl(105 + R() * 25, 40, 16 + R() * 20, 0.95);
        x.lineWidth = 1.4;
        x.beginPath();
        x.moveTo(bx, by);
        x.lineTo(bx + dir * 2, by + 13 + R() * 9);
        x.stroke();
      }
    }
  }
  return tex(c);
}

/** A card: a coconut palm, curved trunk and a crown of drooping fronds. */
export function palmCard(seed = 4) {
  const R = rng(seed);
  const { c, x } = canvas(256, 512);
  x.strokeStyle = "#7a6446";
  x.lineWidth = 11;
  x.beginPath();
  x.moveTo(120, 512);
  x.quadraticCurveTo(140, 330, 132, 150);
  x.stroke();
  x.strokeStyle = "rgba(60,45,30,0.55)";
  x.lineWidth = 2;
  for (let y = 500; y > 160; y -= 14) {
    const cx = 120 + (512 - y) * 0.033;
    x.beginPath();
    x.moveTo(cx - 5, y);
    x.lineTo(cx + 5, y - 3);
    x.stroke();
  }
  for (let f = 0; f < 11; f++) {
    const a = (f / 11) * Math.PI * 2;
    const dx = Math.cos(a);
    const len = 95 + R() * 25;
    x.strokeStyle = hsl(100 + R() * 14, 55, 24 + R() * 10);
    x.lineWidth = 2.4;
    x.beginPath();
    x.moveTo(132, 150);
    x.quadraticCurveTo(
      132 + dx * len * 0.6,
      96 - Math.abs(Math.sin(a)) * 30,
      132 + dx * len,
      150 + 30 + Math.abs(dx) * 22,
    );
    x.stroke();
    for (let k = 1; k < 26; k++) {
      const t = k / 26;
      const bx = 132 + dx * len * t;
      const by =
        150 -
        Math.sin(t * Math.PI) * 44 * (0.5 + Math.abs(Math.sin(a))) +
        t * t * (30 + Math.abs(dx) * 22);
      x.strokeStyle = hsl(98 + R() * 20, 58, 20 + R() * 16);
      x.lineWidth = 1.7;
      x.beginPath();
      x.moveTo(bx, by);
      x.lineTo(bx + (R() - 0.5) * 6, by + 15 + R() * 8 - t * 6);
      x.stroke();
    }
  }
  return tex(c);
}

/** A card: a slim rubber or teak tree, grey trunk and broad leaf clusters. */
export function leafTreeCard(seed = 6) {
  const R = rng(seed);
  const { c, x } = canvas(256, 512);
  x.strokeStyle = "#5d5a52";
  x.lineWidth = 8;
  x.beginPath();
  x.moveTo(126, 512);
  x.lineTo(130, 190);
  x.stroke();
  for (let b = 0; b < 5; b++) {
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(130, 330 - b * 22);
    x.lineTo(130 + (b % 2 ? 1 : -1) * (50 + R() * 40), 230 - b * 18);
    x.stroke();
  }
  for (let i = 0; i < 520; i++) {
    const a = R() * Math.PI * 2;
    const r = Math.sqrt(R()) * 105;
    x.fillStyle = hsl(92 + R() * 30, 46, 15 + R() * 28);
    x.beginPath();
    x.ellipse(
      130 + Math.cos(a) * r,
      190 + Math.sin(a) * r * 0.85,
      9 + R() * 7,
      4 + R() * 3,
      R() * 3,
      0,
      6.3,
    );
    x.fill();
  }
  return tex(c);
}

/** Soft cloud puff (white on transparent). */
export function cloudCard() {
  const R = rng(8);
  const { c, x } = canvas(256, 128);
  for (let i = 0; i < 38; i++) {
    const px = 40 + R() * 176;
    const py = 50 + R() * 40;
    const r = 18 + R() * 26;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.beginPath();
    x.arc(px, py, r, 0, 6.3);
    x.fill();
  }
  return tex(c);
}

/** Stone for dry-stone walls and boulders. */
export function stoneTexture() {
  const R = rng(14);
  const { c, x } = canvas(256, 128);
  x.fillStyle = "#2c2a27";
  x.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 6; row++) {
    let px = -R() * 30;
    while (px < 256) {
      const w = 26 + R() * 34;
      const l = 30 + R() * 22;
      x.fillStyle = hsl(30 + R() * 18, 6 + R() * 8, l);
      x.fillRect(px + 1.5, row * 21 + 1.5, w - 3, 18);
      px += w;
    }
  }
  return tex(c, true);
}

import { CanvasTexture, SRGBColorSpace } from "three";

/**
 * Atlas textures for the 3D tree geometry (trees.ts). Each has an opaque bark patch in its top-left
 * corner, so a trunk and its leaves share one texture and one draw call.
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
function tex(c: HTMLCanvasElement) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function bark(x: CanvasRenderingContext2D) {
  x.fillStyle = "#7a6650";
  x.fillRect(0, 0, 14, 14);
}

/** One needled conifer branch pointing along +u. */
export function frondTexture(seed = 31) {
  const R = rng(seed);
  const { c, x } = canvas(256, 128);
  bark(x);
  x.strokeStyle = "#2c2a1e";
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(18, 64);
  x.lineTo(252, 64);
  x.stroke();
  for (let i = 0; i < 560; i++) {
    const t = R() ** 0.8;
    const px = 18 + t * 230;
    const side = R() < 0.5 ? -1 : 1;
    const len = (1 - t * 0.55) * (16 + R() * 40);
    x.strokeStyle = hsl(104 + R() * 22, 38 + R() * 12, 11 + R() * 20 + t * 6, 0.97);
    x.lineWidth = 1.2 + R() * 1.2;
    x.beginPath();
    x.moveTo(px, 64 + side * 1.5);
    x.quadraticCurveTo(px + 8, 64 + side * len * 0.55, px + 14 + R() * 8, 64 + side * len);
    x.stroke();
  }
  return tex(c);
}

/** A dense cluster of broad leaves. */
export function leafClusterTexture(tone: "oak" | "birch" | "tropical", seed = 41) {
  const R = rng(seed);
  const { c, x } = canvas(256, 256);
  bark(x);
  const hue = tone === "tropical" ? 98 : tone === "birch" ? 80 : 92;
  for (let i = 0; i < 380; i++) {
    const a = R() * Math.PI * 2;
    const r = Math.sqrt(R()) * 108;
    const px = 136 + Math.cos(a) * r;
    const py = 136 + Math.sin(a) * r * 0.92;
    x.save();
    x.translate(px, py);
    x.rotate(R() * Math.PI);
    x.fillStyle = hsl(hue + R() * 26, 44 + R() * 14, 14 + R() * 26 + (py < 120 ? 8 : 0));
    x.beginPath();
    x.ellipse(0, 0, 9 + R() * 8, 4 + R() * 4, 0, 0, 6.3);
    x.fill();
    x.restore();
  }
  return tex(c);
}

/** A coconut-palm frond: central rib with paired drooping leaflets along +u. */
export function palmFrondTexture(seed = 51) {
  const R = rng(seed);
  const { c, x } = canvas(256, 128);
  bark(x);
  x.strokeStyle = "#6e7a2c";
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(18, 64);
  x.lineTo(252, 64);
  x.stroke();
  for (let i = 0; i < 60; i++) {
    const px = 22 + (i / 60) * 226;
    const len = 52 * (1 - (i / 60) * 0.55);
    for (const side of [-1, 1]) {
      x.strokeStyle = hsl(92 + R() * 18, 52, 22 + R() * 14);
      x.lineWidth = 2.2;
      x.beginPath();
      x.moveTo(px, 64);
      x.quadraticCurveTo(px + 4, 64 + side * len * 0.55, px + 10, 64 + side * len);
      x.stroke();
    }
  }
  return tex(c);
}

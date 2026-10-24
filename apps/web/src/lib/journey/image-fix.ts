/**
 * On-device photo and signature fixer (MD-113, F-06). Canvas only: nothing is uploaded, no face
 * matching of any kind. The pixel and KB sizes are the commonly reported Sarathi figures (secondary
 * sources conflict; the official spec is not published), so the UI labels them "verify" (D-05).
 * Upload rules that ARE published (Sarathi FAQ-DL-Services Q14): JPG/PDF, at most 300 KB, file
 * name without spaces or special characters.
 */

export interface ImageSpec {
  kind: "photo" | "signature";
  width: number;
  height: number;
  minKb: number;
  maxKb: number;
  /** Published Sarathi limit for any upload. */
  hardMaxKb: number;
  confidence: "low";
  source: string;
}

export const PHOTO_SPEC: ImageSpec = {
  kind: "photo",
  width: 420,
  height: 525,
  minKb: 10,
  maxKb: 20,
  hardMaxKb: 300,
  confidence: "low",
  source: "Commonly reported Sarathi photo size (secondary sources, not published)",
};

export const SIGNATURE_SPEC: ImageSpec = {
  kind: "signature",
  width: 256,
  height: 64,
  minKb: 10,
  maxKb: 20,
  hardMaxKb: 300,
  confidence: "low",
  source: "Commonly reported Sarathi signature size (secondary sources, not published)",
};

/** "photo.jpg": letters only before the extension (no spaces, _, -, or extra dots). */
export function safeFileName(kind: ImageSpec["kind"]): string {
  return `${kind}.jpg`;
}

export function isSafeFileName(name: string): boolean {
  return /^[A-Za-z0-9]+\.(jpe?g|pdf)$/i.test(name);
}

export interface FixResult {
  blob: Blob;
  url: string;
  kb: number;
  width: number;
  height: number;
  whitened: boolean;
  brightness: number;
  checks: { id: string; ok: boolean }[];
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

/** Centre crop to the spec's aspect ratio, then scale to its pixel size. */
function cropTo(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  spec: ImageSpec,
): HTMLCanvasElement {
  const target = spec.width / spec.height;
  let cw = sw;
  let ch = sh;
  if (sw / sh > target) cw = sh * target;
  else ch = sw / target;
  const sx = (sw - cw) / 2;
  const sy = (sh - ch) / 2;
  const out = canvas(spec.width, spec.height);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, spec.width, spec.height);
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, spec.width, spec.height);
  return out;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Background whitening without a model: sample the border, treat pixels close to the border colour
 * as background and blend them to white (soft edge). Works for a plain wall; the UI asks for one.
 */
function whitenBackground(c: HTMLCanvasElement): { whitened: boolean; brightness: number } {
  const ctx = c.getContext("2d");
  if (!ctx) return { whitened: false, brightness: 0 };
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let br = 0;
  let bg = 0;
  let bb = 0;
  let n = 0;
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    br += d[i] as number;
    bg += d[i + 1] as number;
    bb += d[i + 2] as number;
    n++;
  };
  for (let x = 0; x < w; x += 4) {
    sample(x, 0);
    sample(x, 1);
  }
  for (let y = 0; y < h * 0.6; y += 4) {
    sample(0, y);
    sample(w - 1, y);
  }
  br /= n;
  bg /= n;
  bb /= n;
  let total = 0;
  let changed = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] as number;
    const g = d[i + 1] as number;
    const b = d[i + 2] as number;
    total += luminance(r, g, b);
    const dist = Math.sqrt((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2);
    if (dist < 70) {
      const a = dist < 40 ? 1 : (70 - dist) / 30;
      d[i] = r + (255 - r) * a;
      d[i + 1] = g + (255 - g) * a;
      d[i + 2] = b + (255 - b) * a;
      changed++;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { whitened: changed > (w * h) / 10, brightness: total / (d.length / 4) / 255 };
}

/** Signature: adaptive threshold to pure black ink on white, then trim to the ink. */
function inkOnWhite(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4)
    sum += luminance(d[i] as number, d[i + 1] as number, d[i + 2] as number);
  const mean = sum / (d.length / 4);
  const cut = mean * 0.72;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = luminance(d[i] as number, d[i + 1] as number, d[i + 2] as number) < cut;
      const v = ink ? 0 : 255;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
      if (ink) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  if (maxX <= minX || maxY <= minY) return c;
  const pad = 6;
  const tw = Math.min(w, maxX - minX + pad * 2);
  const th = Math.min(h, maxY - minY + pad * 2);
  const out = canvas(tw, th);
  out
    .getContext("2d")
    ?.drawImage(c, Math.max(0, minX - pad), Math.max(0, minY - pad), tw, th, 0, 0, tw, th);
  return out;
}

async function toJpeg(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", q),
  );
}

/** Quality search so the file lands inside the KB band (never above the published 300 KB). */
async function fitKb(c: HTMLCanvasElement, spec: ImageSpec): Promise<Blob> {
  let lo = 0.3;
  let hi = 0.95;
  let best = await toJpeg(c, 0.85);
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const b = await toJpeg(c, mid);
    const kb = b.size / 1024;
    if (kb > spec.maxKb) hi = mid;
    else {
      best = b;
      lo = mid;
      if (kb >= spec.minKb) break;
    }
  }
  if (best.size / 1024 > spec.hardMaxKb) best = await toJpeg(c, 0.3);
  return best;
}

export async function fixImage(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  spec: ImageSpec,
): Promise<FixResult> {
  let c: HTMLCanvasElement;
  let whitened = false;
  let brightness = 0.6;
  if (spec.kind === "signature") {
    const raw = canvas(sw, sh);
    raw.getContext("2d")?.drawImage(source, 0, 0, sw, sh);
    const trimmed = inkOnWhite(raw);
    c = cropTo(trimmed, trimmed.width, trimmed.height, spec);
    whitened = true;
  } else {
    c = cropTo(source, sw, sh, spec);
    const r = whitenBackground(c);
    whitened = r.whitened;
    brightness = r.brightness;
  }
  const blob = await fitKb(c, spec);
  const kb = Math.round((blob.size / 1024) * 10) / 10;
  const checks = [
    { id: "whitened", ok: whitened },
    { id: "cropped", ok: true },
    { id: "size", ok: kb <= spec.hardMaxKb },
    { id: "filename", ok: isSafeFileName(safeFileName(spec.kind)) },
    ...(spec.kind === "photo" ? [{ id: "light", ok: brightness > 0.35 && brightness < 0.92 }] : []),
  ];
  return {
    blob,
    url: URL.createObjectURL(blob),
    kb,
    width: spec.width,
    height: spec.height,
    whitened,
    brightness,
    checks,
  };
}

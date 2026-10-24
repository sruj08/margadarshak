"use client";

import { redact } from "@/lib/redact/redact";

/** A rectangle in the downscaled image's pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Prepared {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  /** Regions holding identity numbers found by on-device OCR (covered before upload). */
  readonly autoBoxes: Box[];
  /** On-device OCR text with identity numbers removed (sent as `ocr_text`; never to a model). */
  readonly ocrText: string;
}

interface DetectedText {
  rawValue: string;
  boundingBox: DOMRectReadOnly;
}

const MAX_SIDE = 1024;
const ID_NUMBER = /(\d[\s-]?){10,}|[A-Z]{5}\d{4}[A-Z]/;

/**
 * Downscales a photo to at most 1024 px on its longest side (API-42/75) and, where the browser has
 * a TextDetector (on-device OCR), finds number-like text to cover (MD-319: 12-digit and phone-like
 * regions are blurred on the device). Everything stays on the phone until the user taps send.
 */
export async function prepareImage(file: Blob): Promise<Prepared> {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const bitmap = await createImageBitmap(source, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
  source.close();
  const autoBoxes: Box[] = [];
  let ocrText = "";
  const Detector = (
    globalThis as { TextDetector?: new () => { detect(b: ImageBitmap): Promise<DetectedText[]> } }
  ).TextDetector;
  if (Detector) {
    try {
      const found = await new Detector().detect(bitmap);
      const lines: string[] = [];
      for (const t of found) {
        if (ID_NUMBER.test(t.rawValue)) {
          const b = t.boundingBox;
          autoBoxes.push({ x: b.x - 4, y: b.y - 4, w: b.width + 8, h: b.height + 8 });
        } else {
          lines.push(t.rawValue);
        }
      }
      ocrText = redact(lines.join(" ")).text;
    } catch {
      // OCR is a bonus; the manual cover still works
    }
  }
  return { bitmap, width, height, autoBoxes, ocrText };
}

/** Renders the image with every box covered in solid black and returns the JPEG to upload. */
export async function render(p: Prepared, boxes: readonly Box[]): Promise<Blob> {
  const canvas = new OffscreenCanvas(p.width, p.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(p.bitmap, 0, 0);
  ctx.fillStyle = "#000";
  for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}

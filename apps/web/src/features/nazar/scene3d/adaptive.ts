import type { WebGLRenderer } from "three";

/**
 * Keeps the frame rate smooth on weak GPUs by trading resolution for speed. It watches the time
 * between frames and lowers the render resolution (the canvas is then stretched by CSS) when frames
 * take too long, then raises it again when there is headroom. Cheap: no per-frame allocation.
 */
export class Adaptive {
  ratio: number;
  private ema = 16;
  private last = 0;
  private n = 0;
  private w = 0;
  private h = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly min: number,
    private readonly max: number,
    start: number,
  ) {
    this.ratio = Math.min(max, Math.max(min, start));
    renderer.setPixelRatio(this.ratio);
  }

  size(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
  }

  /** Call once per rendered frame. */
  tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    // Long gaps are pauses, not slow frames.
    if (dt > 250 || dt <= 0) return;
    this.ema = this.ema * 0.9 + dt * 0.1;
    if (++this.n % 20 !== 0) return;
    let next = this.ratio;
    if (this.ema > 29 && this.ratio > this.min) next = Math.max(this.min, this.ratio - 0.12);
    else if (this.ema < 18 && this.ratio < this.max) next = Math.min(this.max, this.ratio + 0.05);
    if (Math.abs(next - this.ratio) < 1e-3) return;
    this.ratio = next;
    this.renderer.setPixelRatio(next);
    this.renderer.setSize(this.w, this.h, false);
  }
}

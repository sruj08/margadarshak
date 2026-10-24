// Photosensitivity check: WCAG 2.3.1 "Three Flashes or Below Threshold", general-flash rule
// (ARCHITECTURE §8 flash_check; NAZAR §12; DATA_PIPELINE §2.5).
//
// WCAG definitions used:
//   - A general flash is a pair of opposing changes in relative luminance of 10% or more of the
//     maximum relative luminance (Δ ≥ 0.1 on a 0–1 scale), where the darker state is below 0.80.
//   - It only counts when it covers more than a 0.006 sr area (≈ 25% of a 10° visual field, i.e.
//     341×256 px on a 1024×768 screen at typical distance) — that is 11.1% of the screen, 1/9.
//   - Content passes when no 1-second period has more than three flashes.
//
// Our approximation (documented in the README):
//   1. Luma, not luminance: ffmpeg gives mean Y′ per frame or per region. We map limited-range Y′
//      (16–235) to 0–1 and apply the sRGB transfer curve to approximate relative luminance. Chroma
//      is ignored, so the WCAG "red flash" rule is not checked.
//   2. Area: buildLumaGridArgv averages each frame over a 3×3 grid. One tile is 1/9 of the frame,
//      the same 11.1% of the screen that WCAG's area threshold works out to, so a flash filling a
//      tile is roughly a flash at threshold size. A flash straddling tiles is diluted (may be
//      missed); the whole-frame series (buildLumaStatsArgv) is a coarser single region.
//   3. Counting: a hysteresis state machine records a transition each time luminance moves ≥ 0.1
//      away from the last extreme in the opposite direction with the darker side < 0.8. A flash is
//      two transitions, and we fail when any 1 s window holds more than 6 transitions (> 3 flashes).
//      Treating 7 transitions as a fail (3.5 flashes) is the conservative reading.
import {
  assertSafeMediaPath,
  type Binaries,
  type Command,
  ENCODER,
  escapeFilterValue,
  FFMPEG_PREAMBLE,
} from "./ffmpeg.ts";

export const WCAG_FLASH = { minDelta: 0.1, darkMax: 0.8, maxFlashesPerSecond: 3 } as const;
export const SIGNALSTATS_KEY = "lavfi.signalstats.YAVG";

export interface LumaStatsOptions {
  readonly input: string;
  /** Text file ffmpeg's `metadata` filter writes (one block per frame). */
  readonly metadataOutput: string;
  readonly binaries?: Binaries;
}

/** Whole-frame mean luma per frame (signalstats YAVG), at a constant 30 fps. Output: parseSignalstatsMetadata. */
export function buildLumaStatsArgv(o: LumaStatsOptions): Command {
  assertSafeMediaPath(o.input, "input");
  const file = escapeFilterValue(assertSafeMediaPath(o.metadataOutput, "metadataOutput"));
  return {
    file: o.binaries?.ffmpeg ?? "ffmpeg",
    args: [
      ...FFMPEG_PREAMBLE,
      "-i",
      o.input,
      "-map",
      "0:v:0",
      "-vf",
      `fps=${ENCODER.fps},signalstats,metadata=mode=print:key=${SIGNALSTATS_KEY}:file=${file}`,
      "-an",
      "-f",
      "null",
      "-",
    ],
  };
}

export interface LumaGridOptions {
  readonly input: string;
  /** Raw output: cols × rows bytes per frame (8-bit luma means). Parse with parseLumaGrid. */
  readonly output: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly binaries?: Binaries;
}

/**
 * Per-region mean luma: take the Y plane as-is (extractplanes keeps limited-range values), area-
 * average it down to cols × rows pixels, write raw 8-bit gray frames at a constant 30 fps.
 */
export function buildLumaGridArgv(o: LumaGridOptions): Command {
  const cols = o.cols ?? 3;
  const rows = o.rows ?? 3;
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 1 ||
    rows < 1 ||
    cols * rows > 64
  ) {
    throw new RangeError(`grid must be 1..64 integer tiles, got ${cols}x${rows}`);
  }
  return {
    file: o.binaries?.ffmpeg ?? "ffmpeg",
    args: [
      ...FFMPEG_PREAMBLE,
      "-i",
      assertSafeMediaPath(o.input, "input"),
      "-map",
      "0:v:0",
      "-vf",
      `fps=${ENCODER.fps},extractplanes=y,scale=${cols}:${rows}:flags=area`,
      "-an",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      assertSafeMediaPath(o.output, "output"),
    ],
  };
}

export interface MetadataFrame {
  readonly frame: number;
  readonly ptsTime: number | null;
  readonly values: Readonly<Record<string, number>>;
}

/**
 * Parses the `metadata=mode=print` text format:
 *   frame:0    pts:0       pts_time:0
 *   lavfi.signalstats.YAVG=16.000000
 * Frames come back in frame order; a frame without the key is kept with no value.
 */
export function parseMetadataPrint(text: string): MetadataFrame[] {
  const frames: { frame: number; ptsTime: number | null; values: Record<string, number> }[] = [];
  let cur: (typeof frames)[number] | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const head = /^frame:(\d+)\s+pts:(\S+)\s+pts_time:(\S+)/.exec(line);
    if (head) {
      const t = Number(head[3]);
      cur = { frame: Number(head[1]), ptsTime: Number.isFinite(t) ? t : null, values: {} };
      frames.push(cur);
      continue;
    }
    const kv = /^([A-Za-z0-9_.]+)=(.*)$/.exec(line);
    if (kv && cur) {
      const v = Number(kv[2]);
      if (Number.isFinite(v)) cur.values[kv[1] as string] = v;
      continue;
    }
    throw new SyntaxError(`unexpected metadata line: ${line.slice(0, 80)}`);
  }
  frames.sort((x, y) => x.frame - y.frame);
  return frames;
}

/** YAVG per frame (0–255 limited-range luma). Throws if a frame lacks it. */
export function parseSignalstatsMetadata(text: string): number[] {
  return parseMetadataPrint(text).map((f) => {
    const v = f.values[SIGNALSTATS_KEY];
    if (v === undefined) throw new SyntaxError(`frame ${f.frame} has no ${SIGNALSTATS_KEY}`);
    return v;
  });
}

/** Raw gray frames → one luma series per tile (row-major tile order). */
export function parseLumaGrid(bytes: Uint8Array, cols = 3, rows = 3): number[][] {
  const tiles = cols * rows;
  if (bytes.length % tiles !== 0)
    throw new RangeError(`${bytes.length} bytes is not a whole number of ${cols}x${rows} frames`);
  const series: number[][] = Array.from({ length: tiles }, () => []);
  for (let off = 0; off < bytes.length; off += tiles) {
    for (let t = 0; t < tiles; t++) (series[t] as number[]).push(bytes[off + t] as number);
  }
  return series;
}

/** Limited-range (16–235) or full-range 8-bit luma → approximate relative luminance 0–1. */
export function lumaToRelativeLuminance(y: number, range: "tv" | "pc" = "tv"): number {
  const v = range === "tv" ? (y - 16) / 219 : y / 255;
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export interface FlashCount {
  /** Frame indices at which a qualifying luminance transition completed. */
  readonly transitions: readonly number[];
  readonly maxTransitionsInAnySecond: number;
  /** maxTransitionsInAnySecond / 2. */
  readonly maxFlashesInAnySecond: number;
  /** Frame index where the worst 1 s window starts (−1 when there are no transitions). */
  readonly worstWindowStartFrame: number;
}

type Dir = -1 | 0 | 1;

/**
 * Direction of a transition completed by value `v`, or 0. `ext` is the extreme since the last
 * transition (its max after a rise, its min after a fall); `lo`/`hi` are the running min/max used
 * before the first transition. Rises are checked first.
 */
function transitionAt(
  dir: Dir,
  ext: number,
  lo: number,
  hi: number,
  v: number,
  minDelta: number,
  darkMax: number,
): Dir {
  const bottom = dir === -1 ? ext : lo;
  const top = dir === 1 ? ext : hi;
  if (dir !== 1 && v - bottom >= minDelta && bottom < darkMax) return 1;
  if (dir !== -1 && top - v >= minDelta && v < darkMax) return -1;
  return 0;
}

/** Frame indices where a qualifying luminance transition completes (hysteresis state machine). */
export function findTransitions(
  series: readonly number[],
  minDelta: number,
  darkMax: number,
): number[] {
  const out: number[] = [];
  const first = series[0];
  if (first === undefined) return out;
  let dir: Dir = 0;
  let ext = first;
  let lo = first;
  let hi = first;
  for (let i = 1; i < series.length; i++) {
    const v = series[i] as number;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    const t = transitionAt(dir, ext, lo, hi, v, minDelta, darkMax);
    if (t !== 0) {
      out.push(i);
      dir = t;
      ext = v;
    } else if (dir === 1) ext = Math.max(ext, v);
    else if (dir === -1) ext = Math.min(ext, v);
  }
  return out;
}

/** Counts WCAG general-flash transitions in a relative-luminance series sampled at `fps`. */
export function countFlashes(
  series: readonly number[],
  fps: number,
  opts: { minDelta?: number; darkMax?: number } = {},
): FlashCount {
  if (!(fps > 0)) throw new RangeError(`fps must be > 0, got ${fps}`);
  const transitions = findTransitions(
    series,
    opts.minDelta ?? WCAG_FLASH.minDelta,
    opts.darkMax ?? WCAG_FLASH.darkMax,
  );
  // Sliding 1 s window over transition frames: frames i..j are within one second when j − i < fps.
  let best = 0;
  let bestStart = -1;
  let lo = 0;
  for (let hi = 0; hi < transitions.length; hi++) {
    while ((transitions[hi] as number) - (transitions[lo] as number) >= fps) lo++;
    const n = hi - lo + 1;
    if (n > best) {
      best = n;
      bestStart = transitions[lo] as number;
    }
  }
  return {
    transitions,
    maxTransitionsInAnySecond: best,
    maxFlashesInAnySecond: best / 2,
    worstWindowStartFrame: bestStart,
  };
}

export interface FlashCheckResult {
  readonly passes: boolean;
  readonly maxFlashesInAnySecond: number;
  /** Region (tile) with the worst second; −1 when nothing flashed. */
  readonly worstRegion: number;
  readonly worstAtMs: number | null;
  readonly regions: number;
  readonly frames: number;
  readonly method: "wcag-2.3.1-general-flash/luma-approx";
}

/**
 * WCAG 2.3.1 general-flash check over one or more regions (relative-luminance series, all at
 * `fps`). Fails if any region has more than three flashes in any one-second period.
 */
export function flashCheck(
  regions: readonly (readonly number[])[],
  fps: number,
  opts: { minDelta?: number; darkMax?: number; maxFlashesPerSecond?: number } = {},
): FlashCheckResult {
  if (regions.length === 0) throw new RangeError("flash check needs at least one luminance series");
  const limit = opts.maxFlashesPerSecond ?? WCAG_FLASH.maxFlashesPerSecond;
  let worst = 0;
  let worstRegion = -1;
  let worstFrame = -1;
  regions.forEach((s, r) => {
    const c = countFlashes(s, fps, opts);
    if (c.maxFlashesInAnySecond > worst) {
      worst = c.maxFlashesInAnySecond;
      worstRegion = r;
      worstFrame = c.worstWindowStartFrame;
    }
  });
  return {
    passes: worst <= limit,
    maxFlashesInAnySecond: worst,
    worstRegion,
    worstAtMs: worstFrame < 0 ? null : Math.round((worstFrame * 1000) / fps),
    regions: regions.length,
    frames: Math.max(...regions.map((s) => s.length)),
    method: "wcag-2.3.1-general-flash/luma-approx",
  };
}

/** Convenience: 8-bit luma series (signalstats or grid) → flashCheck. */
export function flashCheckFromLuma(
  lumaRegions: readonly (readonly number[])[],
  fps: number = ENCODER.fps,
  range: "tv" | "pc" = "tv",
): FlashCheckResult {
  return flashCheck(
    lumaRegions.map((s) => s.map((y) => lumaToRelativeLuminance(y, range))),
    fps,
  );
}

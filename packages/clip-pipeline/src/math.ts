// Small deterministic maths shared by agreement, proposals, difficulty and flash checks.
// Statistics follow the field kit (`field-kit/nazar_stats.py`), which uses Python's `statistics`
// module: `median` averages the two middle values for an even count.
import { createHash } from "node:crypto";

export interface Interval {
  readonly aMs: number;
  readonly bMs: number;
}

/** Python `statistics.median`, but `null` for an empty input instead of raising. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid] as number;
  return ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Temporal intersection over union of two closed windows; 0 when disjoint or degenerate. */
export function iou(x: Interval, y: Interval): number {
  const inter = Math.max(0, Math.min(x.bMs, y.bMs) - Math.max(x.aMs, y.aMs));
  const union = x.bMs - x.aMs + (y.bMs - y.aMs) - inter;
  return union > 0 ? inter / union : 0;
}

/** True when the two windows share a positive-length stretch. */
export function overlaps(x: Interval, y: Interval): boolean {
  return x.aMs < y.bMs && y.aMs < x.bMs;
}

/**
 * Cohen's kappa for two raters' binary judgements. Returns null when it is undefined: no items,
 * or chance agreement of exactly 1 (both raters gave one constant answer).
 */
export function cohensKappa(pairs: readonly (readonly [boolean, boolean])[]): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  let agree = 0;
  let a1 = 0;
  let b1 = 0;
  for (const [a, b] of pairs) {
    if (a === b) agree++;
    if (a) a1++;
    if (b) b1++;
  }
  const po = agree / n;
  const pa = a1 / n;
  const pb = b1 / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}

/** Nearest frame boundary in integer milliseconds (ties round up, as Math.round does). */
export function snapToFrameMs(ms: number, fps: number): number {
  return Math.round((Math.round((ms * fps) / 1000) * 1000) / fps);
}

/** Canonical JSON: sorted keys, no whitespace, `undefined` members dropped. */
export function canonicalJSON(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`canonical JSON: non-finite number ${v}`);
    return JSON.stringify(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((e) => canonicalJSON(e)).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON: unsupported type ${typeof v}`);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Locale-independent string comparison (never `localeCompare`, so ordering is stable everywhere). */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

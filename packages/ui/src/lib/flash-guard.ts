/**
 * Flash-rate guard (WCAG 2.3.1 "Three Flashes or Below Threshold", MD-023, EC-18).
 *
 * Games and any animated surface must never produce more than 3 flashes in any 1-second window.
 * Callers pass the timestamps (ms) at which a flash (a luminance change of 10% or more, or any
 * saturated-red transition) starts; the guard checks every sliding 1 s window.
 */

export const MAX_FLASHES_PER_SECOND = 3;
const WINDOW_MS = 1000;

export interface FlashCheck {
  safe: boolean;
  /** Highest number of flashes found in any 1-second window. */
  peak: number;
  /** Start (ms) of the first window that broke the limit, if any. */
  firstViolationAt: number | null;
}

/** Checks a list of flash start times (ms, any order). */
export function checkFlashRate(
  flashTimesMs: readonly number[],
  maxPerSecond: number = MAX_FLASHES_PER_SECOND,
): FlashCheck {
  const times = [...flashTimesMs].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  let peak = 0;
  let firstViolationAt: number | null = null;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    const endTime = times[end] as number;
    while ((times[start] as number) <= endTime - WINDOW_MS) start++;
    const count = end - start + 1;
    if (count > peak) peak = count;
    if (count > maxPerSecond && firstViolationAt === null)
      firstViolationAt = times[start] as number;
  }
  return { safe: peak <= maxPerSecond, peak, firstViolationAt };
}

/** Convenience: is a periodic flash at `hz` for `durationMs` safe? (4 Hz is not; 3 Hz is.) */
export function isPeriodicFlashSafe(hz: number, durationMs = 2000): boolean {
  if (hz <= 0) return true;
  const period = 1000 / hz;
  const times: number[] = [];
  for (let i = 0; i * period < durationMs; i++) times.push(Math.round(i * period));
  return checkFlashRate(times).safe;
}

/**
 * Runtime guard for imperative effects: call `allow()` before starting a flash; it returns false
 * (and the caller must skip the flash) when one more would break the limit.
 */
export function createFlashLimiter(
  maxPerSecond: number = MAX_FLASHES_PER_SECOND,
  now: () => number = () => performance.now(),
) {
  const recent: number[] = [];
  return {
    allow(): boolean {
      const t = now();
      while (recent.length > 0 && (recent[0] as number) <= t - WINDOW_MS) recent.shift();
      if (recent.length >= maxPerSecond) return false;
      recent.push(t);
      return true;
    },
  };
}

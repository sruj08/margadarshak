import { describe, expect, it } from "vitest";
import { checkFlashRate, createFlashLimiter, isPeriodicFlashSafe } from "./flash-guard";

describe("flash guard (WCAG 2.3.1, MD-023, EC-18)", () => {
  it("rejects a 4 Hz flash sequence", () => {
    expect(isPeriodicFlashSafe(4)).toBe(false);
    const result = checkFlashRate([0, 250, 500, 750, 1000, 1250]);
    expect(result.safe).toBe(false);
    expect(result.peak).toBe(4);
    expect(result.firstViolationAt).toBe(0);
  });

  it("accepts 3 flashes per second", () => {
    expect(isPeriodicFlashSafe(3)).toBe(true);
    expect(checkFlashRate([0, 334, 667, 1001, 1334, 1667]).safe).toBe(true);
  });

  it("checks sliding windows, not fixed seconds", () => {
    // 4 flashes inside 600-1500 ms even though each calendar second has only 2-3.
    expect(checkFlashRate([100, 700, 900, 1100, 1300]).safe).toBe(false);
  });

  it("limiter refuses the fourth flash inside one second", () => {
    let t = 0;
    const limiter = createFlashLimiter(3, () => t);
    expect([limiter.allow(), limiter.allow(), limiter.allow()]).toEqual([true, true, true]);
    t = 900;
    expect(limiter.allow()).toBe(false);
    t = 1001;
    expect(limiter.allow()).toBe(true);
  });
});

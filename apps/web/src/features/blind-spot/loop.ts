"use client";

import { createFixedStepLoop } from "@margdarshak/game-core/sim";
import { useEffect, useRef } from "react";

/** Interval of the DOM loop (ms); logic still advances in exact 60 Hz steps. */
const TICK_MS = 16;

/**
 * Fixed-step loop for DOM games (the decision version's ride): elapsed time from
 * `performance.now()` goes through game-core's `createFixedStepLoop`, so the logic runs in 60 Hz
 * steps whatever the timer jitter. `onTick` runs after the steps of each tick (for throttled UI).
 */
export function useFixedLoop(
  running: boolean,
  step: (stepMs: number) => void,
  onTick?: () => void,
): void {
  const latest = useRef({ step, onTick });
  latest.current = { step, onTick };
  useEffect(() => {
    if (!running) return;
    const loop = createFixedStepLoop({ hz: 60, maxStepsPerAdvance: 30 });
    let last = performance.now();
    const h = setInterval(() => {
      const now = performance.now();
      const { steps } = loop.advance(Math.max(0, now - last));
      last = now;
      for (let i = 0; i < steps; i++) latest.current.step(loop.stepMs);
      latest.current.onTick?.();
    }, TICK_MS);
    return () => clearInterval(h);
  }, [running]);
}

// Fixed-timestep accumulator (GAME_SDK §6.2 rule 1). Pure: no timers, no clock. The host feeds
// elapsed milliseconds; logic advances in whole steps of 1/hz s and rendering interpolates with
// `alpha`. Time is accumulated in integer "ms × hz" units so integer-ms input never drifts.

export interface FixedStepLoop {
  readonly hz: number;
  readonly stepMs: number;
  /** Feeds elapsed ms; returns the number of logic steps to run now and the render alpha. */
  advance(elapsedMs: number): { steps: number; alpha: number };
  /** Total logic steps issued so far. */
  readonly totalSteps: number;
  reset(): void;
}

export function createFixedStepLoop(
  opts: { hz?: number; maxStepsPerAdvance?: number } = {},
): FixedStepLoop {
  const hz = opts.hz ?? 60;
  const maxSteps = opts.maxStepsPerAdvance ?? 240;
  if (!Number.isInteger(hz) || hz <= 0 || hz > 1000) throw new RangeError(`bad hz: ${hz}`);
  let acc = 0; // ms × hz
  let total = 0;
  return {
    hz,
    stepMs: 1000 / hz,
    get totalSteps() {
      return total;
    },
    advance(elapsedMs: number) {
      if (!(elapsedMs >= 0)) throw new RangeError(`elapsed must be ≥ 0, got ${elapsedMs}`);
      acc += elapsedMs * hz;
      let steps = Math.floor(acc / 1000);
      if (steps > maxSteps) {
        // Spiral-of-death guard for the live loop; replay never goes through here.
        steps = maxSteps;
        acc = 0;
      } else {
        acc -= steps * 1000;
      }
      total += steps;
      return { steps, alpha: acc / 1000 };
    },
    reset() {
      acc = 0;
      total = 0;
    },
  };
}

/** The logic step at which an event recorded at `tMs` takes effect: ⌊t·hz/1000⌋. */
export function stepIndexAt(tMs: number, hz = 60): number {
  return Math.floor((tMs * hz) / 1000);
}

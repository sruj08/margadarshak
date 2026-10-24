/**
 * Motion presets (DESIGN_SYSTEM §8 + Apple Fluid Motion). Durations in seconds for Motion; the CSS twins live in tokens.css.
 * Rules: UI changes <= 240 ms, animate transform + opacity only, reduced motion = opacity only.
 */

export type Bezier = [number, number, number, number];

export const ease: Record<"standard" | "outExpo" | "reveal" | "nav" | "exit", Bezier> = {
  standard: [0.22, 1, 0.36, 1],
  outExpo: [0.16, 1, 0.3, 1],
  reveal: [0.25, 1, 0.5, 1],
  nav: [0.22, 1, 0.36, 1],
  exit: [0.32, 0, 0.67, 0],
};

/** Apple-style critically damped spring presets for physical UI motion. */
export const spring = {
  snappy: { type: "spring" as const, bounce: 0, duration: 0.28 },
  default: { type: "spring" as const, bounce: 0, duration: 0.36 },
  gentle: { type: "spring" as const, bounce: 0.1, duration: 0.48 },
  reward: { type: "spring" as const, bounce: 0.25, duration: 0.55 },
} as const;

export const duration = {
  instant: 0.08,
  fast: 0.16,
  base: 0.24,
  slow: 0.4,
  reveal: 0.7,
} as const;

/** 16 px shared-axis shift used by page transitions and reveals. */
export const SHIFT_PX = 16;

export type RevealVariant = {
  hidden: { opacity: number; y?: number };
  show: {
    opacity: number;
    y?: number;
    transition: { duration: number; ease: Bezier; delay: number };
  };
};

/** Rise-and-fade reveal; collapses to an opacity fade when motion is reduced. */
export function revealVariants(reduced: boolean, distance = 8, delay = 0): RevealVariant {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { duration: duration.fast, ease: ease.standard, delay: 0 } },
    };
  }
  return {
    hidden: { opacity: 0, y: distance },
    show: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.reveal, delay } },
  };
}

/** Stagger for lists (plan rows, tiles): 40 ms apart, never more than 6 items animated. */
export function staggerDelay(index: number, reduced: boolean): number {
  if (reduced) return 0;
  return Math.min(index, 5) * 0.04;
}

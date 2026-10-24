/**
 * Stopping Distance UI choices [D]. None of these is physics: distances, reaction time and friction
 * come from game-core (`physics.ts`). These only size the controls and pace the street round.
 */
export const SD_UI = {
  /** Guess slider and ± stepper (m). The strip grows at the reveal when the real distance is longer. */
  guess: { min: 0, max: 100, start: 0, small: 1, big: 10 },
  /** Above this speed the guess range doubles (fixed, so its length never hints at the answer). */
  guessLongAboveKmh: 80,
  /** Round 3 speed stepper (UI_SPEC_LEARN_GAMES §5.2: 20–80 km/h in 5 km/h steps). */
  sightSpeed: { min: 20, max: 80, step: 5, start: 20 },
  /** Seeded wait before the child steps out (ms): unpredictable, so tapping early never helps. */
  stepOutMs: { min: 1500, max: 4000 },
  /** Anticipatory presses allowed in one street round before it ends with no valid brake. */
  maxRedeals: 2,
  /** Strip tick spacing (m). */
  tickM: 10,
} as const;

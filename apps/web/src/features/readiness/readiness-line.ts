import type { Readiness } from "@/features/learn/api-types";

/**
 * "N = knowledge K − calibration C" (F-21, UI_SPEC_LEARN_GAMES §2.7). The three numbers are read
 * straight from the API-33 fields `score`, `knowledge` and `calibration_penalty`. The client never
 * recomputes or "fixes" them, even if they disagree: the server's arithmetic is what is shown, so the
 * line is honest by construction (D-09, D-10: code computes every number, once, on the server).
 */

export type EquationParts = { s: number; k: number; c: number };

export function equationParts(r: Pick<Readiness, "score" | "knowledge" | "calibration_penalty">) {
  return { s: r.score, k: r.knowledge, c: r.calibration_penalty } satisfies EquationParts;
}

/** Fills the localised template (`{s} = knowledge {k} − calibration {c}`) from the fields only. */
export function readinessEquation(
  r: Pick<Readiness, "score" | "knowledge" | "calibration_penalty">,
  template: (parts: EquationParts) => string,
): string {
  return template(equationParts(r));
}

/** The dial's accessible name, from the same fields. */
export function dialLabel(
  r: Pick<Readiness, "score" | "knowledge" | "calibration_penalty" | "gate">,
  template: (parts: EquationParts & { g: number }) => string,
): string {
  return template({ ...equationParts(r), g: r.gate.threshold });
}

/** Topics under the advisory 0.7 line, weakest first (for "Practise the N weakest"). */
export function weakestTopics(r: Pick<Readiness, "topics">, n = 3): string[] {
  return [...r.topics]
    .sort((a, b) => a.mastery - b.mastery || (a.topic_id < b.topic_id ? -1 : 1))
    .slice(0, n)
    .map((t) => t.topic_id);
}

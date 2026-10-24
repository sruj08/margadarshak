// Clip difficulty: the curator rubric (NAZAR §7.1) and empirical difficulty from taker stats (§7.2).
// IRT (§7.3) is Phase 3+ and out of scope.
import { mean } from "./math.ts";
import type { Clip } from "./schema.ts";

/**
 * What the rubric talks about. The first four come from clip.json; the last three are visual
 * judgements only the curator can declare (undefined = not declared).
 */
export interface RubricFacts {
  readonly hazardCount: number;
  readonly anyOcclusion: boolean;
  /** dawn/dusk/night, or rain/fog/haze. */
  readonly poorLight: boolean;
  /** Two hazards whose windows overlap or are less than CLOSE_HAZARD_GAP_MS apart; null with < 2. */
  readonly hazardsClose: boolean | null;
  readonly subtleCues?: boolean;
  readonly busyScene?: boolean;
  readonly distractors?: boolean;
}

/** "Two hazards close together" vs "far apart" (§7.1) is not quantified in the spec; this is ours. */
export const CLOSE_HAZARD_GAP_MS = 3000;

export function rubricFactsFromClip(
  clip: Pick<Clip, "hazards" | "timeOfDay" | "weather">,
  declared: Pick<RubricFacts, "subtleCues" | "busyScene" | "distractors"> = {},
): RubricFacts {
  const ws = clip.hazards.map((h) => h.window).sort((x, y) => x.aMs - y.aMs);
  let hazardsClose: boolean | null = null;
  if (ws.length >= 2) {
    hazardsClose = false;
    for (let i = 1; i < ws.length; i++) {
      const prev = ws[i - 1];
      const cur = ws[i];
      if (prev && cur && cur.aMs - prev.bMs < CLOSE_HAZARD_GAP_MS) hazardsClose = true;
    }
  }
  return {
    hazardCount: clip.hazards.length,
    anyOcclusion: clip.hazards.some((h) => h.occlusion),
    poorLight:
      clip.timeOfDay !== "day" ||
      clip.weather === "rain" ||
      clip.weather === "fog" ||
      clip.weather === "haze",
    hazardsClose,
    ...declared,
  };
}

export interface RubricValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Checks a curator level against the §7.1 rubric. Errors are contradictions with facts in clip.json
 * (or with a declared `false`); warnings are rubric conditions only the curator can confirm.
 */
export function validateCuratorDifficulty(level: number, f: RubricFacts): RubricValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return {
      valid: false,
      errors: [`curator difficulty must be an integer 1–5, got ${level}`],
      warnings,
    };
  }
  if (f.hazardCount > 2) errors.push("more than two hazards: not a Kerala-format clip");
  if (f.hazardCount === 0) {
    warnings.push("quiet clip: the rubric describes hazards, so the level is not checked");
    return { valid: errors.length === 0, errors, warnings };
  }
  const out = { errors, warnings };
  for (const rule of RUBRIC_RULES) rule(level, f, out);
  return { valid: errors.length === 0, errors, warnings };
}

interface RubricOut {
  readonly errors: string[];
  readonly warnings: string[];
}
type RubricRule = (level: number, f: RubricFacts, out: RubricOut) => void;

/** A curator-declared condition: `false` contradicts the level, `undefined` asks for confirmation. */
function declared(value: boolean | undefined, need: string, out: RubricOut): void {
  if (value === false) out.errors.push(`${need} is required`);
  else if (value === undefined) out.warnings.push(`confirm: ${need}`);
}

const RUBRIC_RULES: readonly RubricRule[] = [
  (level, f, out) => {
    if (level <= 2 && f.hazardCount === 2)
      out.errors.push(`level ${level} is single-hazard; this clip has two`);
    if (f.hazardCount === 2 && f.hazardsClose === true && level < 4) {
      out.errors.push(
        `two hazards close together (< ${CLOSE_HAZARD_GAP_MS} ms apart) are level 4 or 5`,
      );
    }
  },
  (level, f, out) => {
    if (level !== 1) return;
    if (f.anyOcclusion) out.errors.push("level 1 is unoccluded");
    if (f.poorLight) out.errors.push("level 1 is daylight in clear conditions");
    if (f.busyScene === true) out.errors.push("level 1 is not a busy scene");
  },
  (level, f, out) => {
    if (level === 3 && f.hazardCount === 1 && !f.anyOcclusion) {
      declared(f.distractors, "level 3 with one unoccluded hazard: distractor movement", out);
    }
  },
  (level, f, out) => {
    if (level === 4 && f.hazardCount === 1)
      declared(f.subtleCues, "level 4 with one hazard: subtle cues", out);
  },
  (level, f, out) => {
    if (level !== 5) return;
    if (!f.poorLight) out.errors.push("level 5 needs poor light or rain");
    declared(f.subtleCues, "level 5: subtle cues", out);
    declared(f.busyScene, "level 5: a busy scene", out);
  },
];

/** One taker's attempt at one clip, as the nightly stats Workflow receives it from the API. */
export interface TakerAttempt {
  /** Pseudonymous user ID; never a name or phone. */
  readonly takerId: string;
  readonly attemptedAt: string;
  readonly verified: boolean;
  readonly trust: number;
  /** First exposure to this clip (DATA_PIPELINE §2.6: unseen mock attempts). */
  readonly unseen: boolean;
  /** UK-style points 0–5, one per hazard of the clip version (NAZAR §2.1). */
  readonly hazardPoints: readonly number[];
}

export interface EmpiricalOptions {
  readonly minTakers: number;
  readonly minTrust: number;
  readonly requireUnseen: boolean;
  /** Curator level, to flag disagreement of ≥ 2 levels (§7.2). */
  readonly curator: number | null;
}

export const DEFAULT_EMPIRICAL: EmpiricalOptions = {
  minTakers: 30,
  minTrust: 0.6,
  requireUnseen: true,
  curator: null,
};

export interface EmpiricalDifficulty {
  /** difficulty.empirical: mean points per hazard (0–5), null until nTakers ≥ minTakers. */
  readonly empirical: number | null;
  /** The same mean, even below the threshold (internal; not for display). */
  readonly meanPoints: number | null;
  readonly nTakers: number;
  /**
   * Points mapped onto the curator scale (5 points → level 1, 0 points → level 5), linear:
   * level = 1 + (5 − meanPoints) × 4/5. Higher points mean easier, so the scales run opposite.
   */
  readonly impliedLevel: number | null;
  readonly flagged: boolean;
}

/** Points to the curator 1–5 scale; see EmpiricalDifficulty.impliedLevel. */
export function pointsToLevel(meanPoints: number): number {
  return 1 + ((5 - meanPoints) * 4) / 5;
}

function eligible(a: TakerAttempt, o: EmpiricalOptions): boolean {
  return (
    a.verified &&
    a.trust >= o.minTrust &&
    (!o.requireUnseen || a.unseen) &&
    a.hazardPoints.length > 0
  );
}

/** Earliest eligible attempt per taker (ISO timestamps compare as strings). */
function firstEligibleAttempts(
  attempts: readonly TakerAttempt[],
  o: EmpiricalOptions,
): Map<string, TakerAttempt> {
  const first = new Map<string, TakerAttempt>();
  for (const a of attempts) {
    if (!eligible(a, o)) continue;
    const bad = a.hazardPoints.find((p) => !Number.isInteger(p) || p < 0 || p > 5);
    if (bad !== undefined) throw new RangeError(`hazard points must be integers 0–5, got ${bad}`);
    const prev = first.get(a.takerId);
    if (!prev || a.attemptedAt < prev.attemptedAt) first.set(a.takerId, a);
  }
  return first;
}

/**
 * §7.2 empirical difficulty. Eligible attempts are verified, trust ≥ 0.6 and (by default) unseen;
 * one attempt per taker (the earliest), so retakes do not count twice. Pure: takes the rows, reads
 * no clock. Rounded to 0.01.
 */
export function empiricalDifficulty(
  attempts: readonly TakerAttempt[],
  options: Partial<EmpiricalOptions> = {},
): EmpiricalDifficulty {
  const o: EmpiricalOptions = { ...DEFAULT_EMPIRICAL, ...options };
  const firstByTaker = firstEligibleAttempts(attempts, o);
  const points = [...firstByTaker.values()].flatMap((a) => a.hazardPoints);
  const raw = mean(points);
  const meanPoints = raw === null ? null : Math.round(raw * 100) / 100;
  const nTakers = firstByTaker.size;
  const shown = meanPoints !== null && nTakers >= o.minTakers;
  const impliedLevel =
    meanPoints === null ? null : Math.round(pointsToLevel(meanPoints) * 100) / 100;
  return {
    empirical: shown ? meanPoints : null,
    meanPoints,
    nTakers,
    impliedLevel,
    flagged:
      shown &&
      o.curator !== null &&
      impliedLevel !== null &&
      Math.abs(impliedLevel - o.curator) >= 2,
  };
}

// Deterministic findings → facts pack generator (DEBRIEF_SPEC §5.1). The scorers already emit the
// negative findings in `result.findings`; this step types the facts against the catalogue, ranks,
// takes the top 3, runs the positive detectors, builds the per-request allowlists (rules from
// ai_citable only, drills ranked by FSRS retrievability then staircase level) and marks
// template-only games. Pure: the same result + history + catalogue always yields the same pack.

import { FINDING_ID_RE, RULE_ID_RE } from "../schema/ids.ts";
import type { FactValue, Finding, SessionResult } from "../schema/result.ts";
import { rankFindings } from "../scoring/common.ts";
import { round1 } from "../sim/quantise.ts";
import {
  type CatalogueFinding,
  type CatalogueIndex,
  type DebriefCatalogue,
  DebriefError,
  indexCatalogue,
} from "./catalogue.ts";
import { factLocale } from "./format.ts";
import {
  type DebriefLocale,
  type DrillCandidate,
  type FactKind,
  FactsPack,
  type PositiveFinding,
  type ScoreBand,
} from "./schema.ts";

/** What the generator knows about the user beyond this session. Every field is optional. */
export interface DebriefHistory {
  /** Earlier debriefs of this game, newest first; prevFindings come from the last 3 (§5.1 step 9). */
  readonly lastDebriefs?: readonly { readonly findingIds: readonly string[] }[] | undefined;
  /** FSRS retrievability R ∈ [0, 1] by skill ID. A skill with no value counts as R = 0 (unseen). */
  readonly retrievability?: Readonly<Record<string, number>> | undefined;
  /** Staircase level 1–5 by skill ID for this game (GAME_SDK §7). Missing = 1. */
  readonly staircaseLevels?: Readonly<Record<string, number>> | undefined;
  /**
   * NAZ_IMPROVED inputs: mean late_s of the user's first Nazar sessions (oldest first; the first 3
   * are the baseline), this session's mean late_s and the clip speed for gain_m. SessionResult
   * carries only the worst late_s (in NAZ_LATE_RESPONSE), so the caller supplies the mean from the
   * replayed analysis (`analyseNazarClips`).
   */
  readonly nazarLateS?:
    | {
        readonly firstSessions: readonly number[];
        readonly current: number;
        readonly speedKmh: number;
      }
    | undefined;
}

export interface GenerateOptions {
  /** Narration locale of the pack (default "en"). */
  readonly locale?: DebriefLocale | undefined;
}

/** Thresholds of the positive detectors (DEBRIEF_SPEC §2). */
export const POSITIVE_RULES = {
  /** NAZ_IMPROVED: mean late_s improved ≥ 0.3 s vs the user's first 3 sessions (§2.1). */
  nazarImprovedMinGainS: 0.3,
  nazarBaselineSessions: 3,
  /** SD_SPEED_CHOICE_GOOD: every round-3 item ≤ v_max_opt = full speed_for_sight marks (§2.2). */
  sdSightComponentId: "speed_for_sight",
} as const;

const MAX_TOP = 3;
const MAX_DRILLS = 3;
const PREV_DEBRIEFS = 3;

/** strong ≥ 80, medium 50–79, weak < 50 (§9). */
export function scoreBand(pct: number): ScoreBand {
  if (pct >= 80) return "strong";
  if (pct >= 50) return "medium";
  return "weak";
}

const NUMERIC_KINDS: ReadonlySet<FactKind> = new Set([
  "seconds",
  "metres",
  "centimetres",
  "kmh",
  "percent",
  "times",
  "number",
  "ordinal",
  "ratio",
  "rate_per_min",
]);
const ENUM_RE = /^[A-Za-z0-9_]{1,32}$/;
const ENUM_LIST_RE = /^[A-Za-z0-9_]+([,|][A-Za-z0-9_]+)*$/;

/**
 * Keeps only the facts the catalogue declares for the finding, each with a value of its kind.
 * Facts are data, never instructions (§6.2 rule 7): free text cannot reach the pack.
 */
export function typedFacts(
  facts: Readonly<Record<string, FactValue>>,
  entry: CatalogueFinding,
): Record<string, FactValue> {
  const out: Record<string, FactValue> = {};
  for (const spec of [...entry.facts].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const value = facts[spec.key];
    if (value === undefined) continue;
    const ok = NUMERIC_KINDS.has(spec.kind)
      ? typeof value === "number" && Number.isFinite(value)
      : spec.kind === "boolean"
        ? typeof value === "boolean"
        : typeof value === "string" &&
          (spec.kind === "enum" ? ENUM_RE.test(value) : ENUM_LIST_RE.test(value));
    if (ok) out[spec.key] = value;
  }
  return out;
}

function nazarImproved(history: DebriefHistory): Record<string, FactValue> | null {
  const h = history.nazarLateS;
  if (h === undefined) return null;
  const first = h.firstSessions.slice(0, POSITIVE_RULES.nazarBaselineSessions);
  if (first.length < POSITIVE_RULES.nazarBaselineSessions) return null;
  if (![...first, h.current, h.speedKmh].every(Number.isFinite)) return null;
  const baseline = first.reduce((s, x) => s + x, 0) / first.length;
  const raw = baseline - h.current;
  // 1e-9 absorbs float noise in the mean (0.9 − 0.6 = 0.29999…); rounding happens after the test.
  if (raw < POSITIVE_RULES.nazarImprovedMinGainS - 1e-9) return null;
  const gain = round1(raw);
  return { gain_s: gain, gain_m: round1((gain * h.speedKmh) / 3.6) };
}

function sdSpeedChoiceGood(result: SessionResult, negatives: readonly Finding[]): boolean {
  const c = result.score.components.find((x) => x.id === POSITIVE_RULES.sdSightComponentId);
  return (
    c !== undefined &&
    c.max > 0 &&
    c.value >= c.max &&
    !negatives.some((f) => f.findingId === "SD_OVERSPEED_FOR_SIGHT")
  );
}

/** Positive findings: emitted by the scorer (LL_UNDERCONFIDENT) or detected here (§5.1 step 6). */
function positiveFindings(
  result: SessionResult,
  history: DebriefHistory,
  ix: CatalogueIndex,
  fromScorer: readonly PositiveFinding[],
  negatives: readonly Finding[],
): PositiveFinding[] {
  const out = new Map<string, PositiveFinding>(fromScorer.map((p) => [p.findingId, p]));
  const add = (findingId: string, facts: Record<string, FactValue>): void => {
    const entry = ix.findings.get(findingId);
    if (entry === undefined || entry.game_id !== result.gameId || out.has(findingId)) return;
    out.set(findingId, { findingId, facts: typedFacts(facts, entry) });
  };
  if (result.gameId === "nazar") {
    const facts = nazarImproved(history);
    if (facts !== null) add("NAZ_IMPROVED", facts);
  }
  // sight_m is not on SessionResult (it is seeded per item); the template does not need it.
  if (result.gameId === "stopping_distance" && sdSpeedChoiceGood(result, negatives)) {
    add("SD_SPEED_CHOICE_GOOD", {});
  }
  return [...out.values()].sort((a, b) => (a.findingId < b.findingId ? -1 : 1)).slice(0, MAX_TOP);
}

function drillCandidates(
  top: readonly Finding[],
  history: DebriefHistory,
  ix: CatalogueIndex,
  defaultDrill: string,
): DrillCandidate[] {
  const R = history.retrievability ?? {};
  const L = history.staircaseLevels ?? {};
  const levelOf = (skill: string | undefined): number => {
    const x = skill === undefined ? undefined : L[skill];
    return x !== undefined && Number.isFinite(x) ? x : 1;
  };
  const rows = top.flatMap((f, fi) =>
    f.drillIds
      .filter((d) => ix.drills.has(d))
      .map((drillId, di) => ({
        drillId,
        skill: f.skillId,
        r: Number.isFinite(R[f.skillId]) ? (R[f.skillId] as number) : 0,
        level: levelOf(f.skillId),
        fi,
        di,
      })),
  );
  rows.sort((a, b) => a.r - b.r || a.level - b.level || a.fi - b.fi || a.di - b.di);
  const picked: { drillId: string; skill: string | undefined }[] = [];
  for (const row of rows) {
    if (picked.length === MAX_DRILLS) break;
    if (!picked.some((p) => p.drillId === row.drillId)) picked.push(row);
  }
  if (picked.length === 0) {
    if (!ix.drills.has(defaultDrill)) {
      throw new DebriefError("UNKNOWN_DRILL", `default drill ${defaultDrill} not in catalogue`);
    }
    picked.push({ drillId: defaultDrill, skill: undefined });
  }
  return picked.map(({ drillId, skill }) => {
    const drill = ix.drills.get(drillId);
    const levels = drill?.levels;
    if (levels === undefined || levels.kind !== "range") return { drillId, level: null };
    const want = levelOf(skill ?? drill?.skill_ids[0]);
    return { drillId, level: Math.min(levels.max, Math.max(levels.min, Math.round(want))) };
  });
}

/** Splits the scorer's findings into catalogue-typed negatives and positives of this game. */
function splitFindings(
  result: SessionResult,
  ix: CatalogueIndex,
): { negatives: Finding[]; positives: PositiveFinding[] } {
  const negatives: Finding[] = [];
  const positives: PositiveFinding[] = [];
  for (const f of result.findings) {
    const entry = ix.findings.get(f.findingId);
    if (entry === undefined || entry.game_id !== result.gameId) continue;
    const facts = typedFacts(f.facts, entry);
    if (entry.polarity === "positive") positives.push({ findingId: f.findingId, facts });
    else negatives.push({ ...f, facts });
  }
  return { negatives, positives };
}

/** ∪ top.ruleIds ∩ ai_citable (§5.1 step 7). Track and sign refs are not RR IDs and never enter. */
function allowedRules(top: readonly Finding[], ix: CatalogueIndex): string[] {
  const ids = top.flatMap((f) => f.ruleIds);
  return [
    ...new Set(ids.filter((r) => RULE_ID_RE.test(r) && ix.rules.get(r)?.ai_citable === true)),
  ].sort();
}

/** prevFindings (last 3 debriefs, §5.1 step 9) and the ones this session no longer has. */
function previous(
  result: SessionResult,
  history: DebriefHistory,
  ix: CatalogueIndex,
): { prevFindings: string[]; resolvedSinceLast: string[] } {
  const prev = (history.lastDebriefs ?? []).slice(0, PREV_DEBRIEFS).flatMap((d) => d.findingIds);
  const prevFindings = [...new Set(prev.filter((id) => FINDING_ID_RE.test(id)))];
  const present = new Set(result.findings.map((f) => f.findingId));
  const resolvedSinceLast = prevFindings.filter(
    (id) => !present.has(id) && ix.findings.get(id)?.polarity === "negative",
  );
  return { prevFindings, resolvedSinceLast };
}

/** Labels of the enum facts present in the pack, in the pack's locale. */
function packLabels(
  findings: readonly { findingId: string; facts: Readonly<Record<string, FactValue>> }[],
  ix: CatalogueIndex,
  locale: DebriefLocale,
): Record<string, Record<string, string>> {
  const l = factLocale(locale);
  const out: Record<string, Record<string, string>> = {};
  for (const f of findings) {
    for (const [key, value] of Object.entries(f.facts)) {
      const kind = ix.factKinds.get(f.findingId)?.get(key);
      if ((kind !== "enum" && kind !== "enum_list") || typeof value !== "string") continue;
      for (const part of value.split(/[,|]/)) {
        const text = ix.labels.get(key)?.get(part)?.[l];
        if (text !== undefined) out[key] = { ...out[key], [part]: text };
      }
    }
  }
  return out;
}

/**
 * Builds the facts pack (§5.1). `history` may be `{}`; the catalogue is passed in (content JSON or
 * `debriefCatalogue(content)`). Findings the catalogue does not know for this game are dropped:
 * they could be neither narrated nor templated (the integration test keeps that set empty).
 */
export function generateFindings(
  result: SessionResult,
  history: DebriefHistory,
  catalogue: DebriefCatalogue,
  opts: GenerateOptions = {},
): FactsPack {
  const ix = indexCatalogue(catalogue);
  const game = ix.games.get(result.gameId);
  if (game === undefined) {
    throw new DebriefError("UNKNOWN_GAME", `${result.gameId} not in catalogue`);
  }
  const locale = opts.locale ?? "en";
  const split = splitFindings(result, ix);
  // Dedupe (worst instance) and rank exactly as the scorers do; informational findings last.
  const ranked = rankFindings(split.negatives);
  const top = ranked.slice(0, MAX_TOP);
  const positives = positiveFindings(result, history, ix, split.positives, ranked);
  const passMark = ranked
    .map((f) => f.facts["pass_mark"])
    .find((x): x is number => typeof x === "number");
  const templateOnly =
    game.debrief_mode === "template_only" ||
    top.some((f) => ix.findings.get(f.findingId)?.template_only === true);

  return FactsPack.parse({
    locale,
    gameId: result.gameId,
    mode: result.mode,
    debriefMode: templateOnly ? "template_only" : "ai_or_template",
    score: {
      pct: result.score.pct,
      passed: result.score.passed,
      ...(passMark === undefined ? {} : { pass_mark: passMark }),
      band: scoreBand(result.score.pct),
    },
    findings: top,
    positives,
    allowedRuleIds: allowedRules(top, ix),
    drillCandidates: drillCandidates(top, history, ix, game.default_drill_id),
    ...previous(result, history, ix),
    labels: packLabels([...top, ...positives], ix, locale),
  });
}

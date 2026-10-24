// Shared scorer plumbing: options, errors, the SessionResult builder, finding construction and the
// deterministic ranking (GAME_SDK §10 rule 3, DEBRIEF_SPEC §2).
import { ReplayError } from "../errors.ts";
import type { IntegrityAnalysis, IntegrityHints } from "../integrity/checks.ts";
import { computeTrust } from "../integrity/trust.ts";
import type { EventOf, GameEvent, GameEventType } from "../schema/events.ts";
import { FACT_KEY_RE, type HazardType } from "../schema/ids.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type {
  Calibration,
  Evidence,
  FactValue,
  Finding,
  PassRule,
  ScoreComponent,
  SessionResult,
} from "../schema/result.ts";
import { clamp, round2 } from "../sim/quantise.ts";

/** Everything a scorer needs besides (ctx, events, content). */
export interface ScoreOptions {
  gameVersion: string;
  scoringVersion: string;
  /** The encoded replay blob, echoed into `SessionResult.replay.inputs`. */
  replayInputs: string;
  /** Manifest event budget (INT_EVENT_CAP). */
  maxEvents?: number;
  hints?: IntegrityHints;
  /** true for a client-side preview; the verifier's result is never provisional. */
  provisional?: boolean;
}

export function requireAligned(ctx: SessionContext, n: number, what: string): void {
  if (n !== ctx.items.length) {
    throw new ReplayError(
      "CONTENT_MISMATCH",
      `${what}: content has ${n} items, the session has ${ctx.items.length}`,
    );
  }
}

export type { ReplayErrorCode } from "../errors.ts";
export { ReplayError };

// ---- events ----

export function eventsOfType<T extends GameEventType>(
  events: readonly GameEvent[],
  type: T,
): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

export function itemEvents(events: readonly GameEvent[], item: number): GameEvent[] {
  return events.filter((e) => e.item === item);
}

/** `t` of the item's first item_start, or null when the item never started. */
export function itemStartT(events: readonly GameEvent[], item: number): number | null {
  const e = events.find((x) => x.type === "item_start" && x.item === item);
  return e === undefined ? null : e.t;
}

export function itemEndReason(
  events: readonly GameEvent[],
  item: number,
): "done" | "voided" | "timeout" | null {
  const e = events.find((x): x is EventOf<"item_end"> => x.type === "item_end" && x.item === item);
  return e === undefined ? null : e.p.reason;
}

// ---- findings ----

export interface FindingSpec {
  findingId: string;
  severity: number;
  critical?: boolean;
  skillId: string;
  ruleIds?: readonly string[];
  drillIds?: readonly string[];
  facts: Record<string, FactValue | undefined>;
  itemRef?: string | undefined;
}

/** Builds a Finding: severity clamped to [0, 1] at 4 dp, facts keys checked, undefined facts dropped. */
export function finding(spec: FindingSpec): Finding {
  const facts: Record<string, FactValue> = {};
  for (const key of Object.keys(spec.facts).sort()) {
    const v = spec.facts[key];
    if (v === undefined) continue;
    if (!FACT_KEY_RE.test(key)) throw new Error(`bad facts key: ${key}`);
    facts[key] = v;
  }
  const f: Finding = {
    findingId: spec.findingId,
    severity: Math.round(clamp(spec.severity, 0, 1) * 10000) / 10000,
    critical: spec.critical ?? false,
    ruleIds: [...(spec.ruleIds ?? [])],
    skillId: spec.skillId,
    drillIds: [...(spec.drillIds ?? [])].slice(0, 3),
    facts,
  };
  if (spec.itemRef !== undefined) f.itemRef = spec.itemRef;
  return f;
}

/**
 * Informational findings that must never outrank a skill finding (DEBRIEF_SPEC §2.1:
 * NAZ_BELOW_KERALA_MARK "never the top finding if a skill finding exists"). They sort after every
 * other non-critical finding, which the plain (severity, id) key cannot guarantee.
 */
export const INFORMATIONAL_FINDINGS: ReadonlySet<string> = new Set(["NAZ_BELOW_KERALA_MARK"]);

/**
 * Ranks by (critical desc, informational last, severity desc, findingId asc), one per ID: the worst
 * instance wins, a critical instance always beating a non-critical one.
 */
export function rankFindings(findings: readonly Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const f of findings) {
    const prev = byId.get(f.findingId);
    const worse =
      prev === undefined ||
      (f.critical && !prev.critical) ||
      (f.critical === prev.critical && f.severity > prev.severity);
    if (worse) byId.set(f.findingId, f);
  }
  return [...byId.values()]
    .sort((a, b) => {
      if (a.critical !== b.critical) return a.critical ? -1 : 1;
      const ia = INFORMATIONAL_FINDINGS.has(a.findingId);
      const ib = INFORMATIONAL_FINDINGS.has(b.findingId);
      if (ia !== ib) return ia ? 1 : -1;
      if (a.severity !== b.severity) return b.severity - a.severity;
      return a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0;
    })
    .slice(0, 12);
}

/** `DR-NAZ-OCCL-<TYPE>` with the hazard type upper-cased (DEBRIEF_SPEC §4). */
export const hazardDrill = (t: HazardType): string => `DR-NAZ-OCCL-${t.toUpperCase()}`;

// ---- result ----

export interface ResultParts {
  components: ScoreComponent[];
  /** Overrides Σ component max (rarely needed). */
  max?: number;
  passed: boolean | null;
  passRule: PassRule | null;
  capApplied: string | null;
  findings: Finding[];
  evidence: Evidence[];
  calibration: Calibration | null;
  integrity: IntegrityAnalysis;
}

export function component(
  id: string,
  value: number,
  max: number,
  explainKey: string,
  weight = 1,
): ScoreComponent {
  return { id, value: round2(value), max: round2(max), weight, explainKey };
}

/** Assembles the SessionResult. raw = Σ component values (2 dp); pct = raw / max × 100 (2 dp). */
export function buildResult(
  ctx: SessionContext,
  opts: ScoreOptions,
  parts: ResultParts,
): SessionResult {
  const raw = round2(parts.components.reduce((s, c) => s + c.value, 0));
  const max = round2(parts.max ?? parts.components.reduce((s, c) => s + c.max, 0));
  const pct = max > 0 ? clamp(round2((raw / max) * 100), 0, 100) : 0;
  return {
    sid: ctx.sid,
    gameId: ctx.gameId,
    gameVersion: opts.gameVersion,
    scoringVersion: opts.scoringVersion,
    seed: ctx.seed,
    seedOrigin: ctx.seedOrigin,
    difficulty: ctx.difficulty,
    mode: ctx.mode,
    score: {
      raw,
      max,
      pct,
      passed: parts.passed,
      passRule: parts.passRule,
      components: parts.components,
      capApplied: parts.capApplied,
    },
    findings: rankFindings(parts.findings),
    evidence: parts.evidence,
    calibration: parts.calibration,
    integrity: {
      flags: parts.integrity.flags,
      trust: computeTrust(parts.integrity.flags),
      timingMode: parts.integrity.timingMode,
      provisional: opts.provisional ?? false,
    },
    replay: { seed: ctx.seed, inputs: opts.replayInputs },
  };
}

/** 1-based ordinal with zero padding for component IDs (`q01`). */
export const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

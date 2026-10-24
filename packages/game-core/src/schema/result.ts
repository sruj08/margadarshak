// Finding, Evidence, IntegrityReport, ReplayPackage and SessionResult (GAME_SDK §5.3, §6.5, §10).
// SessionResult is the one shape every downstream consumer reads; `score.raw = Σ components.value`
// after caps, always.
import { z } from "zod";
import { FactKey, GameId, GameMode, ScoringVersion, SeedOrigin, TimingMode } from "./ids.ts";

export const FactValue = z.union([z.number(), z.string().max(32), z.boolean()]);
export type FactValue = z.infer<typeof FactValue>;

export const Finding = z
  .object({
    findingId: z.string().max(40),
    severity: z.number().min(0).max(1),
    critical: z.boolean(),
    ruleIds: z.array(z.string().max(32)).max(8),
    skillId: z.string().max(24),
    drillIds: z.array(z.string().max(48)).max(3),
    facts: z.record(FactKey, FactValue),
    itemRef: z.string().max(64).optional(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;

export const ConfidenceTag = z.enum(["50", "75", "100"]);
export type ConfidenceTag = z.infer<typeof ConfidenceTag>;

export const Evidence = z
  .object({
    cardId: z.string().max(48),
    correct: z.boolean(),
    latencyMs: z.number().optional(),
    confidence: ConfidenceTag.optional(),
    rating: z.number().int().min(1).max(4),
    overconfident: z.boolean(),
  })
  .strict();
export type Evidence = z.infer<typeof Evidence>;

export const IntegrityFlag = z.enum([
  "INT_TAB_HIDDEN",
  "INT_CLOCK_DRIFT",
  "INT_TIMING_FALLBACK",
  "INT_RATE_IMPOSSIBLE",
  "INT_REPLAY_MISMATCH",
  "INT_SEEN_CLIP",
  "INT_RT_ANTICIPATORY",
  "INT_EVENT_CAP",
  "INT_SESSION_EXPIRED",
  "INT_OFFLINE_SEED",
]);
export type IntegrityFlag = z.infer<typeof IntegrityFlag>;

export const IntegrityReport = z
  .object({
    // INT_TAB_HIDDEN repeats once per voided item (trust is ×0.9 per item); other flags are unique.
    flags: z.array(z.string().max(32)).max(64),
    trust: z.number().min(0).max(1),
    timingMode: TimingMode,
    provisional: z.boolean(),
  })
  .strict();
export type IntegrityReport = z.infer<typeof IntegrityReport>;

export const ScoreComponent = z
  .object({
    id: z.string().max(40),
    value: z.number(),
    max: z.number(),
    weight: z.number(),
    explainKey: z.string().max(64),
  })
  .strict();
export type ScoreComponent = z.infer<typeof ScoreComponent>;

export const PassRule = z
  .object({ source: z.enum(["rule_pack", "design"]), ref: z.string().max(48) })
  .strict();
export type PassRule = z.infer<typeof PassRule>;

export const Calibration = z
  .object({
    n: z.number().int().nonnegative(),
    brier: z.number().nullable(),
    overconfidence: z.number().nullable(),
  })
  .strict();
export type Calibration = z.infer<typeof Calibration>;

export const SessionResult = z
  .object({
    sid: z.uuid(),
    gameId: GameId,
    gameVersion: z.string().max(24),
    scoringVersion: ScoringVersion,
    seed: z.number().int(),
    seedOrigin: SeedOrigin,
    difficulty: z.number().int().min(1).max(5),
    mode: GameMode,
    score: z
      .object({
        raw: z.number(),
        max: z.number(),
        pct: z.number().min(0).max(100),
        passed: z.boolean().nullable(),
        passRule: PassRule.nullable(),
        components: z.array(ScoreComponent).max(64),
        capApplied: z.string().max(48).nullable(),
      })
      .strict(),
    findings: z.array(Finding).max(12),
    evidence: z.array(Evidence).max(200),
    calibration: Calibration.nullable(),
    integrity: IntegrityReport,
    replay: z.object({ seed: z.number(), inputs: z.string() }).strict(),
  })
  .strict();
export type SessionResult = z.infer<typeof SessionResult>;

/** Replay encodings (see sdk/replay-codec.ts and the README for why the default is not gzip). */
export const ReplayEncoding = z.enum(["mdr1", "mdr1+gzip"]);
export type ReplayEncoding = z.infer<typeof ReplayEncoding>;

export const ReplayPackage = z
  .object({
    telemetryVersion: z.literal(1),
    encoding: ReplayEncoding,
    seed: z.number().int().nonnegative().max(4294967295),
    // Base64; 512 KB of base64 text is the API-35 ceiling.
    inputs: z
      .string()
      .max(524_288)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    eventCount: z.number().int().min(0).max(5000),
  })
  .strict();
export type ReplayPackage = z.infer<typeof ReplayPackage>;

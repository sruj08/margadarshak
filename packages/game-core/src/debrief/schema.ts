// Debrief wire schemas (DEBRIEF_SPEC §5.1, §7.1, §7.2): the facts pack the generator builds, the
// DebriefDraft the DebriefAgent returns (snake_case keys, as the Go struct) and the rendered
// DebriefCard that API-36 returns. All strict: the Go side decodes with DisallowUnknownFields (§6.4).
import { z } from "zod";
import {
  DRILL_ID_RE,
  FactKey,
  FINDING_ID_RE,
  GameId,
  GameMode,
  RULE_ID_RE,
} from "../schema/ids.ts";
import { FactValue, Finding } from "../schema/result.ts";

/** Narration locales (§6.2 rule 6). "hinglish" is Hindi in Latin script, AI narration only. */
export const DebriefLocale = z.enum(["en", "hi", "hinglish"]);
export type DebriefLocale = z.infer<typeof DebriefLocale>;

/** Template locales (§7.1 locale note): Hinglish falls back to `hi`. */
export const TemplateLocale = z.enum(["en", "hi"]);
export type TemplateLocale = z.infer<typeof TemplateLocale>;

/**
 * How a fact value is formatted (§5.2). Mirrors `FactKind` in packages/content/src/schema/findings.ts
 * (a test keeps the two lists equal; game-core never imports the content package).
 */
export const FactKind = z.enum([
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
  "enum",
  "enum_list",
  "boolean",
]);
export type FactKind = z.infer<typeof FactKind>;

/** `debrief.<gameId>.how.<band>`: strong ≥ 80, medium 50–79, weak < 50 (§9). */
export const ScoreBand = z.enum(["strong", "medium", "weak"]);
export type ScoreBand = z.infer<typeof ScoreBand>;

/** Golden Hour is `template_only`: the AI is never called (§0 line 5). */
export const DebriefMode = z.enum(["ai_or_template", "template_only"]);
export type DebriefMode = z.infer<typeof DebriefMode>;

export const FindingIdString = z.string().max(40).regex(FINDING_ID_RE);
export const DrillIdString = z.string().max(48).regex(DRILL_ID_RE);
export const RuleIdString = z.string().max(32).regex(RULE_ID_RE);

/** A positive finding (NAZ_IMPROVED, SD_SPEED_CHOICE_GOOD, LL_UNDERCONFIDENT) → `how_you_did`. */
export const PositiveFinding = z
  .object({ findingId: FindingIdString, facts: z.record(FactKey, FactValue) })
  .strict();
export type PositiveFinding = z.infer<typeof PositiveFinding>;

/** A drill the card may open, with the level already clamped by the drill's range (§4). */
export const DrillCandidate = z
  .object({
    drillId: DrillIdString,
    /** null for drills without a staircase level (mocks, LL concept sets). */
    level: z.number().int().min(1).max(5).nullable(),
  })
  .strict();
export type DrillCandidate = z.infer<typeof DrillCandidate>;

/** The facts pack (§5.1 step 10). No PII by construction: IDs, numbers and enum values only. */
export const FactsPack = z
  .object({
    locale: DebriefLocale,
    gameId: GameId,
    mode: GameMode,
    debriefMode: DebriefMode,
    score: z
      .object({
        pct: z.number().min(0).max(100),
        passed: z.boolean().nullable(),
        pass_mark: z.number().optional(),
        band: ScoreBand,
      })
      .strict(),
    /** Top 3 negative findings, ranked (critical desc, severity desc, findingId asc). */
    findings: z.array(Finding).max(3),
    positives: z.array(PositiveFinding).max(3),
    /** ∪ findings[].ruleIds ∩ ai_citable, sorted. Non-RR refs never enter (§5.1 step 7). */
    allowedRuleIds: z.array(RuleIdString).max(24),
    drillCandidates: z.array(DrillCandidate).min(1).max(3),
    /** Finding IDs of the last 3 debriefs, newest first, unique (§5.1 step 9). */
    prevFindings: z.array(FindingIdString).max(36),
    /** prevFindings that no finding of this session carries: the `improved_since_last` choices. */
    resolvedSinceLast: z.array(FindingIdString).max(36),
    /** i18n labels of the enum facts in this pack, in the pack's locale: labels[key][value]. */
    labels: z.record(FactKey, z.record(z.string().max(32), z.string().max(120))),
  })
  .strict();
export type FactsPack = z.infer<typeof FactsPack>;

// ---- DebriefDraft (§7.1). Bounds here only guard memory; V7/V8 enforce the real limits so a
// too-long or too-many draft gets a precise violation instead of a shape error. ----

const DraftText = z.string().max(2000);

export const DraftPoint = z
  .object({
    finding_id: z.string().max(64),
    rule_id: z.string().max(64),
    text: DraftText,
  })
  .strict();
export type DraftPoint = z.infer<typeof DraftPoint>;

export const DraftDrill = z.object({ drill_id: z.string().max(64), why: DraftText }).strict();
export type DraftDrill = z.infer<typeof DraftDrill>;

export const DebriefDraft = z
  .object({
    locale: DebriefLocale,
    how_you_did: DraftText,
    where_you_lacked: z.array(DraftPoint).max(12),
    what_you_could_have_done: z.array(DraftPoint).max(12),
    next_drill: DraftDrill,
    /** Go `*string` with omitempty: absent or null when nothing improved. */
    improved_since_last: z.string().max(64).nullable().optional(),
    unknown: z.boolean(),
  })
  .strict();
export type DebriefDraft = z.infer<typeof DebriefDraft>;

// ---- Validation result ----

export const ValidatorRuleId = z.enum([
  "MODE",
  "SCHEMA",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "V7",
  "V8",
  "V9",
  "V10",
]);
export type ValidatorRuleId = z.infer<typeof ValidatorRuleId>;

export const Violation = z
  .object({
    rule: ValidatorRuleId,
    /** JSON path into the draft, e.g. `where_you_lacked[0].text`. */
    path: z.string().max(80),
    message: z.string().max(400),
    /** The instruction for the retry prompt (retryHint). */
    hint: z.string().max(400),
  })
  .strict();
export type Violation = z.infer<typeof Violation>;

export interface ValidationResult {
  verdict: "pass" | "reject";
  violations: Violation[];
}

// ---- DebriefCard (§7.2) ----

/** A source chip: rule text + source from the catalogue (§0.1). Only verified rules get one. */
export const RuleChip = z
  .object({
    id: RuleIdString,
    text: z.string().max(400),
    source_title: z.string().max(300),
    source_url: z.string().max(500).nullable(),
    verified_on: z.iso.date().nullable(),
  })
  .strict();
export type RuleChip = z.infer<typeof RuleChip>;

export const CardPoint = z
  .object({
    findingId: FindingIdString,
    /** A rule ID or "UNKNOWN" (§0.1 section 3). */
    ruleId: z.string().max(32),
    /** Rendered, HTML-escaped (V9). */
    text: z.string().max(600),
    rule: RuleChip.nullable(),
  })
  .strict();
export type CardPoint = z.infer<typeof CardPoint>;

export const CardDrill = z
  .object({
    drillId: DrillIdString,
    level: z.number().int().min(1).max(5).nullable(),
    /** margdarshak://play/<gameId>?drill=<id>[&level=<n>] (§4). Not escaped: built from IDs. */
    deeplink: z.string().max(200),
    why: z.string().max(600),
  })
  .strict();
export type CardDrill = z.infer<typeof CardDrill>;

export const CardValidator = z
  .object({
    /** "fallback" = the template replaced a rejected AI draft (§8.5). */
    verdict: z.enum(["pass", "fallback"]),
    attempts: z.number().int().min(0).max(2),
    /** Rule IDs that rejected the AI draft, unique, e.g. ["V1", "V10"] (§8.5). */
    violations: z.array(ValidatorRuleId).max(12),
  })
  .strict();
export type CardValidator = z.infer<typeof CardValidator>;

export const DebriefCard = z
  .object({
    sid: z.uuid(),
    gameId: GameId,
    kind: z.enum(["coach_notes", "auto_notes"]),
    locale: DebriefLocale,
    /** The footer, as in the §7.2 example: "Practice and familiarisation, not certification". */
    label: z.string().max(120),
    /** "Coach notes" / "Auto notes" (§0 line 4, §9), localised. */
    notes_label: z.string().max(60),
    /** Extra labels, e.g. "Draft, not medical advice" on Golden Hour until sign-off (§8.4). */
    notices: z.array(z.string().max(120)).max(4),
    how_you_did: z.string().max(600),
    where_you_lacked: z.array(CardPoint).max(3),
    what_you_could_have_done: z.array(CardPoint).max(3),
    next_drill: CardDrill,
    improved_since_last: FindingIdString.nullable(),
    generator_version: z.string().max(40),
    /** null for auto_notes. */
    model: z.string().max(80).nullable(),
    validator: CardValidator,
    created_at: z.iso.datetime(),
  })
  .strict();
export type DebriefCard = z.infer<typeof DebriefCard>;

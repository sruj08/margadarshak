// Finding taxonomy (DEBRIEF_SPEC §2) with the reviewed template texts of the fallback card (§9).
import { z } from "zod";
import {
  DrillId,
  FactKey,
  FindingId,
  fileHeader,
  GameId,
  HiReviewStatus,
  LocalizedText,
  ReviewStatus,
  RuleId,
  RulepackRowId,
  SkillId,
} from "./common.ts";

/** How the renderer formats a fact value (DEBRIEF_SPEC §5.2). */
export const FactKind = z.enum([
  "seconds",
  "metres",
  "centimetres",
  "kmh",
  "percent",
  /** occurrences: "2 times" / "once" (EN), "2 बार" / "एक बार" (HI) */
  "times",
  /** a plain integer such as a score or a question count */
  "number",
  "ordinal",
  /** a decimal such as a Brier score */
  "ratio",
  "rate_per_min",
  /** i18n label */
  "enum",
  "enum_list",
  "boolean",
]);
export type FactKind = z.infer<typeof FactKind>;

export const FactSpec = z.object({ key: FactKey, kind: FactKind }).strict();

/**
 * A reference to a rule-pack row (rulepacks/ is read-only here). `spec_ref` is the name the spec
 * uses (`LLT-<state>`, `HPT-KL`, "track spec"); `row_pattern` is the real row ID with `{STATE}`
 * replaced by the tenant's state code; `fallback_row` is the base-pack row.
 */
export const RulepackRef = z
  .object({
    spec_ref: z.string().min(1),
    row_pattern: z.string().regex(/^(\{STATE\}-)?[A-Z][A-Z0-9-]*$/),
    fallback_row: RulepackRowId.nullable(),
  })
  .strict();

/** `DR-NAZ-OCCL-{hazard_type}`: the fact value is upper-cased and substituted. */
export const DrillPattern = z
  .object({
    template: z.string().regex(/^DR-[A-Z]{2,3}-[A-Z0-9-]*\{[a-z_]+\}$/),
    fact_key: FactKey,
  })
  .strict();

export const FindingTemplates = z
  .object({
    /** debrief.<findingId>.lacked — a point under "Where you lacked" (≤ 140 chars). */
    lacked: LocalizedText.optional(),
    /** debrief.<findingId>.could — a point under "What you could have done" (≤ 140 chars). */
    could: LocalizedText.optional(),
    /** Positive findings feed `how_you_did` (≤ 160 chars). */
    how: LocalizedText.optional(),
  })
  .strict();

export const Finding = z
  .object({
    finding_id: FindingId,
    game_id: GameId,
    polarity: z.enum(["negative", "positive"]),
    trigger: z.string().min(1),
    /** The spec's formula, as text. `null` for positives that have none. */
    severity: z.string().min(1).nullable(),
    critical: z.boolean(),
    facts: z.array(FactSpec),
    skill: z
      .object({
        id: SkillId.nullable(),
        resolution: z.enum(["fixed", "per_hazard_type", "per_topic", "calibration", "none"]),
      })
      .strict(),
    /** Every rule the finding may carry. `verified:false` rules are listed and filtered later. */
    rule_ids: z.array(RuleId),
    rule_resolution: z.enum(["fixed", "per_hazard_type", "per_topic", "per_sign_family", "none"]),
    rulepack_refs: z.array(RulepackRef),
    drill_ids: z.array(DrillId),
    drill_pattern: DrillPattern.nullable(),
    template_only: z.boolean(),
    templates: FindingTemplates,
    review_status: ReviewStatus,
    hi_review_status: HiReviewStatus,
    medical_review_required: z.boolean(),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.polarity === "negative" && (!f.templates.lacked || !f.templates.could)) {
      ctx.addIssue({
        code: "custom",
        message: "negative findings need lacked + could templates",
        path: ["templates"],
      });
    }
    if (f.polarity === "positive" && !f.templates.how) {
      ctx.addIssue({
        code: "custom",
        message: "positive findings need a how template",
        path: ["templates"],
      });
    }
    if (f.drill_pattern && !f.facts.some((x) => x.key === f.drill_pattern?.fact_key)) {
      ctx.addIssue({
        code: "custom",
        message: "drill_pattern.fact_key must be one of the facts",
        path: ["drill_pattern"],
      });
    }
  });
export type Finding = z.infer<typeof Finding>;

export const FindingsFile = z
  .object({
    ...fileHeader("findings"),
    findings: z.array(Finding).min(1),
  })
  .strict();
export type FindingsFile = z.infer<typeof FindingsFile>;

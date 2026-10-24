// Rule ID catalogue (DEBRIEF_SPEC §3). The first ten fields are the spec's entry shape, verbatim:
// {rule_id, kind, text_en, text_hi, source_title, source_url, verified_on, verified, reviewed_by,
//  ai_citable}. The remaining fields carry the review state the spec tracks in prose.
import { z } from "zod";
import { fileHeader, HiReviewStatus, IsoDate, ModuleId, RuleId, RuleKind } from "./common.ts";

export const RuleEntry = z
  .object({
    rule_id: RuleId,
    kind: RuleKind,
    text_en: z.string().min(1),
    text_hi: z.string().min(1),
    source_title: z.string().min(3),
    /** null = no URL can be supported yet (see `source_pin` / `source_note`). */
    source_url: z
      .string()
      .regex(/^https?:\/\/[^\s]+$/)
      .nullable(),
    /** Date the primary text was checked; null until the entry is verified. */
    verified_on: IsoDate.nullable(),
    verified: z.boolean(),
    /** Reviewer IDs (two-person check, CURRICULUM §5; medical sign-off for kind "medical"). */
    reviewed_by: z.array(z.string().min(3)),
    /** `verified && kind != "medical"` (DEBRIEF_SPEC §3). Checked by a refinement. */
    ai_citable: z.boolean(),
    /** Status as of the spec date: "review pending" / "no" / "no (draft)" (DEBRIEF_SPEC §3). */
    verification_status: z.enum([
      "review_pending",
      "not_verified",
      "draft_medical_signoff_required",
      "verified",
    ]),
    /**
     * "to_pin" = the section / regulation number or URL still has to be fetched and pinned;
     * "not_applicable" = a team practice statement citing the curriculum (needs review, not a fetch).
     */
    source_pin: z.enum(["pinned", "to_pin", "not_applicable"]),
    source_note: z.string().min(1),
    module_ids: z.array(ModuleId).min(1),
    hi_review_status: HiReviewStatus,
  })
  .strict()
  .superRefine((r, ctx) => {
    const expected = r.verified && r.kind !== "medical";
    if (r.ai_citable !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `ai_citable must equal verified && kind != "medical" (expected ${expected})`,
        path: ["ai_citable"],
      });
    }
    if (r.verified && (r.verified_on === null || r.reviewed_by.length < 2)) {
      ctx.addIssue({
        code: "custom",
        message: "a verified entry needs verified_on and two reviewers",
        path: ["verified"],
      });
    }
    if (r.verified !== (r.verification_status === "verified")) {
      ctx.addIssue({
        code: "custom",
        message: "verification_status must be 'verified' exactly when verified is true",
        path: ["verification_status"],
      });
    }
  });
export type RuleEntry = z.infer<typeof RuleEntry>;

export const RulesFile = z
  .object({
    ...fileHeader("rules"),
    as_of: IsoDate,
    rules: z.array(RuleEntry).min(1),
  })
  .strict();
export type RulesFile = z.infer<typeof RulesFile>;

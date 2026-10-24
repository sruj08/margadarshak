// Nazar hazard types (NAZAR §3.3) with their debrief mapping: skill, rules and occlusion drill.
import { z } from "zod";
import {
  DrillId,
  fileHeader,
  HazardType,
  HiReviewStatus,
  LocalizedText,
  ModuleId,
  RuleId,
  SkillId,
} from "./common.ts";

export const HazardTypeEntry = z
  .object({
    hazard_type: HazardType,
    /** Noun phrase for `{{fact:hazard_type}}` in templates (i18n label, DEBRIEF_SPEC §5.2). */
    label: LocalizedText,
    definition_en: z.string().min(1),
    module_ids: z.array(ModuleId),
    skill_id: SkillId.nullable(),
    rule_ids: z.array(RuleId),
    /** `DR-NAZ-OCCL-<hazard_type upper-cased>` */
    occlusion_drill_id: DrillId,
    /** NAZAR §3.3: `other` is not used in mocks until typed. */
    mock_eligible: z.boolean(),
    hi_review_status: HiReviewStatus,
  })
  .strict()
  .superRefine((h, ctx) => {
    if (h.occlusion_drill_id !== `DR-NAZ-OCCL-${h.hazard_type.toUpperCase()}`) {
      ctx.addIssue({
        code: "custom",
        message: "occlusion_drill_id must be DR-NAZ-OCCL-<HAZARD_TYPE>",
        path: ["occlusion_drill_id"],
      });
    }
  });
export type HazardTypeEntry = z.infer<typeof HazardTypeEntry>;

export const HazardTypesFile = z
  .object({
    ...fileHeader("hazard_types"),
    hazard_types: z.array(HazardTypeEntry).length(15),
  })
  .strict();
export type HazardTypesFile = z.infer<typeof HazardTypesFile>;

// Curriculum modules LL0–LL4, M1–M22 and DL1 (CURRICULUM §1–§4, §6), one file per module.
import { z } from "zod";
import {
  ConceptId,
  Confidence,
  DrillId,
  fileHeader,
  GameId,
  HiReviewStatus,
  KEY_FACT_ID_RE,
  LESSON_ID_RE,
  LocalizedText,
  MISCONCEPTION_ID_RE,
  ModuleId,
  OBJECTIVE_ID_RE,
  ReviewStatus,
  RuleId,
  RulepackRowId,
  SkillId,
  Source,
  VehicleScope,
} from "./common.ts";

export const KeyFact = z
  .object({
    id: z.string().regex(KEY_FACT_ID_RE),
    kind: z.enum(["law", "practice", "evidence", "physics", "medical", "format", "design"]),
    text: LocalizedText,
    sources: z.array(Source).min(1),
    confidence: Confidence,
    /** false until the primary text is fetched and checked (CURRICULUM §5 legal / source gates). */
    verified: z.boolean(),
    rule_id: RuleId.optional(),
    /** Rule-pack row the fact is rendered from (rulepacks/ owns the value). */
    rulepack_row: RulepackRowId.optional(),
  })
  .strict();
export type KeyFact = z.infer<typeof KeyFact>;

export const Misconception = z
  .object({
    id: z.string().regex(MISCONCEPTION_ID_RE),
    myth: LocalizedText,
    correction: LocalizedText,
    rule_id: RuleId.optional(),
  })
  .strict();

export const Module = z
  .object({
    ...fileHeader("module"),
    module_id: ModuleId,
    track: z.enum(["A_ll_syllabus", "B_road_safety", "DL_familiarisation"]),
    title: LocalizedText,
    /** P0 / P1 / P2 (CURRICULUM §3 key). `priority_tenants` set = this priority applies there. */
    priority: z.enum(["P0", "P1", "P2"]),
    priority_tenants: z.array(z.string().regex(/^[A-Z]{2}$/)).nullable(),
    vehicle_scope: VehicleScope,
    /** D-05: deep content only for these classes; others see "Learning content … is coming". */
    deep_content_classes: z.array(z.enum(["MCWOG", "MCWG", "LMV-NT"])),
    /** Tenant gating: "all" or the tenants the module is shown to. */
    available_to: z.union([z.literal("all"), z.array(z.string().regex(/^[A-Z]{2}$/)).min(1)]),
    phase_1_2_depth: z.string().min(1),
    skill_id: SkillId,
    game_ids: z.array(GameId),
    drill_ids: z.array(DrillId),
    rule_ids: z.array(RuleId),
    rulepack_rows: z.array(RulepackRowId),
    learning_objectives: z
      .array(z.object({ id: z.string().regex(OBJECTIVE_ID_RE), text: LocalizedText }).strict())
      .min(1),
    lessons: z
      .array(
        z
          .object({
            id: z.string().regex(LESSON_ID_RE),
            title: LocalizedText,
            /** Lesson shown only to these tenants (e.g. J&K hill signs). */
            tenants: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
          })
          .strict(),
      )
      .min(1),
    key_facts: z.array(KeyFact).min(1),
    misconceptions: z.array(Misconception),
    concepts: z
      .object({
        /** Target count from CURRICULUM §3/§4. */
        target: z.number().int().nonnegative(),
        /** Concepts authored in content/questions (LL1–LL4 only in this pack). */
        authored: z.array(ConceptId),
      })
      .strict(),
    assessment: z
      .object({
        criterion: LocalizedText,
        /** Which readiness the module feeds (CURRICULUM §6). */
        readiness: z.enum(["test", "road", "road_tenant", "none"]),
        readiness_tenants: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
        /** LL bank concept refs used for the module's assessment items. */
        item_refs: z.array(ConceptId),
      })
      .strict(),
    review: z
      .object({
        needs: z.array(z.string().min(1)).min(1),
        medical_review_required: z.boolean(),
        /** "Draft, not medical advice" until a qualified reviewer signs off (M19). */
        draft_label_until_reviewed: z.boolean(),
        reviewed_by: z.array(z.string()),
        reviewed_on: z.string().nullable(),
        status: ReviewStatus,
        hi_review_status: HiReviewStatus,
      })
      .strict(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.skill_id !== `SK-${m.module_id}`) {
      ctx.addIssue({
        code: "custom",
        message: "skill_id must be SK-<module_id>",
        path: ["skill_id"],
      });
    }
    const own = (id: string) => id.split("-")[1] === m.module_id;
    for (const [i, o] of m.learning_objectives.entries()) {
      if (!own(o.id))
        ctx.addIssue({
          code: "custom",
          message: "objective of another module",
          path: ["learning_objectives", i],
        });
    }
    for (const [i, l] of m.lessons.entries()) {
      if (!own(l.id))
        ctx.addIssue({ code: "custom", message: "lesson of another module", path: ["lessons", i] });
    }
    for (const [i, k] of m.key_facts.entries()) {
      if (!own(k.id))
        ctx.addIssue({
          code: "custom",
          message: "key fact of another module",
          path: ["key_facts", i],
        });
    }
    for (const [i, c] of m.concepts.authored.entries()) {
      if (!c.startsWith(`C-${m.module_id}-`)) {
        ctx.addIssue({
          code: "custom",
          message: "concept of another module",
          path: ["concepts", "authored", i],
        });
      }
    }
  });
export type Module = z.infer<typeof Module>;

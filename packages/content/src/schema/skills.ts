// Skill-tree nodes (GAMIFICATION_ENGINE §3.1; CURRICULUM §1.1 `SK-<module>`).
import { z } from "zod";
import { fileHeader, LocalizedText, ModuleId, SkillId } from "./common.ts";

export const Skill = z
  .object({
    skill_id: SkillId,
    module_id: ModuleId,
    title: LocalizedText,
    track: z.enum(["ll_syllabus", "survival", "dl_test"]),
    /** Drawn in GAMIFICATION_ENGINE §3.1 v0.1 (false = a CURRICULUM module not yet in the tree). */
    in_skill_tree: z.boolean(),
    /** Suggested predecessors (the arrows in CURRICULUM §1 / GAMIFICATION_ENGINE §3.1). */
    follows: z.array(SkillId),
    /** Hard prerequisites with the state they must reach (only SK-DL1 has them in v0.1). */
    requires: z.array(
      z.object({ skill_id: SkillId, state: z.enum(["learning", "mastered"]) }).strict(),
    ),
    /** States per GAMIFICATION_ENGINE §3.1; thresholds from §4.4 (shared, not per node). */
    mastered_threshold: z.literal(0.8),
    fading_threshold: z.literal(0.7),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.skill_id !== `SK-${s.module_id}`) {
      ctx.addIssue({
        code: "custom",
        message: "skill_id must be SK-<module_id>",
        path: ["skill_id"],
      });
    }
  });
export type Skill = z.infer<typeof Skill>;

export const SkillsFile = z
  .object({
    ...fileHeader("skills"),
    skills: z.array(Skill).min(1),
  })
  .strict();
export type SkillsFile = z.infer<typeof SkillsFile>;

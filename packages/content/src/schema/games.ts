// The ten games as the debrief sees them (GAME_SDK §2.2, GAME_DESIGN §1.4, DEBRIEF_SPEC §9).
import { z } from "zod";
import {
  DrillId,
  fileHeader,
  GameId,
  HiReviewStatus,
  LocalizedText,
  ModuleId,
  ReviewStatus,
  SkillId,
} from "./common.ts";

export const Game = z
  .object({
    game_id: GameId,
    code: z.enum(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10"]),
    title: LocalizedText,
    finding_prefix: z.string().regex(/^[A-Z]{2,3}_$/),
    module_ids: z.array(ModuleId).min(1),
    skill_ids: z.array(SkillId).min(1),
    debrief_mode: z.enum(["ai_or_template", "template_only"]),
    build_depth_phase_1_2: z.enum(["deep", "thin", "storyboard"]),
    /** Used when no finding suggests a drill (DEBRIEF_SPEC §5.1 step 8). */
    default_drill_id: DrillId,
    /** debrief.<gameId>.how.<band>: strong ≥ 80, medium 50–79, weak < 50 (no placeholders). */
    how_templates: z
      .object({ strong: LocalizedText, medium: LocalizedText, weak: LocalizedText })
      .strict(),
    review_status: ReviewStatus,
    hi_review_status: HiReviewStatus,
    medical_review_required: z.boolean(),
  })
  .strict();
export type Game = z.infer<typeof Game>;

export const GamesFile = z
  .object({
    ...fileHeader("games"),
    games: z.array(Game).length(10),
  })
  .strict();
export type GamesFile = z.infer<typeof GamesFile>;

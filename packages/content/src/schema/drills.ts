// Drill ID catalogue (DEBRIEF_SPEC §4). A drill is the deep link
// margdarshak://play/<gameId>?drill=<DR-ID>&level=<n>, the level clamped by `levels`.
import { z } from "zod";
import {
  DrillId,
  fileHeader,
  GameId,
  HazardType,
  HiReviewStatus,
  LlTopic,
  LocalizedText,
  ReviewStatus,
  SignFamily,
  SkillId,
} from "./common.ts";

export const DrillLevels = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("range"),
      min: z.number().int().min(1).max(5),
      max: z.number().int().min(1).max(5),
    })
    .strict(),
  /** `DR-NAZ-MOCK`, `DR-LL-MOCK`: a fresh mock in the state format; no staircase level. */
  z.object({ kind: z.literal("mock") }).strict(),
  /** ll_sim drills: FSRS picks due concepts; the staircase does not apply ("n/a"). */
  z.object({ kind: z.literal("none") }).strict(),
]);

export const Drill = z
  .object({
    drill_id: DrillId,
    game_id: GameId,
    opens: z.string().min(1),
    levels: DrillLevels,
    deeplink: z
      .string()
      .regex(/^margdarshak:\/\/play\/[a-z_]+\?drill=DR-[A-Z0-9_-]+(&level=\{level\})?$/),
    hazard_type: HazardType.optional(),
    sign_family: SignFamily.optional(),
    topic: LlTopic.optional(),
    skill_ids: z.array(SkillId),
    /** drill.<drillId>.why — the reason line on the card (≤ 120 chars, no digits). */
    why: LocalizedText,
    /** Whether the game behind the drill exists in the Phase 1–2 build (GAME_DESIGN §1.4). */
    availability: z.enum(["phase_1_2", "phase_3_plus"]),
    template_only: z.boolean(),
    review_status: ReviewStatus,
    hi_review_status: HiReviewStatus,
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.levels.kind === "range" && d.levels.min > d.levels.max) {
      ctx.addIssue({ code: "custom", message: "levels.min > levels.max", path: ["levels"] });
    }
    const hasLevel = d.deeplink.includes("&level={level}");
    if (hasLevel !== (d.levels.kind === "range")) {
      ctx.addIssue({
        code: "custom",
        message: "deeplink carries &level={level} exactly when levels is a range",
        path: ["deeplink"],
      });
    }
    if (!d.deeplink.startsWith(`margdarshak://play/${d.game_id}?drill=${d.drill_id}`)) {
      ctx.addIssue({
        code: "custom",
        message: "deeplink must name the game and drill",
        path: ["deeplink"],
      });
    }
  });
export type Drill = z.infer<typeof Drill>;

export const DrillsFile = z
  .object({
    ...fileHeader("drills"),
    drills: z.array(Drill).min(1),
  })
  .strict();
export type DrillsFile = z.infer<typeof DrillsFile>;

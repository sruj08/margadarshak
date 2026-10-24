// Per-agent ID allowlists generated from the catalogues (D-09; PROMPTS §2; AGENTS §1).
// The Go API reads content/generated/allowlists.json; per-request enums are subsets of these.
import { z } from "zod";
import {
  DrillId,
  ExplanationId,
  FactKey,
  FindingId,
  GameId,
  LICENCE,
  RuleId,
  SignId,
} from "./common.ts";

const sortedUnique = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).superRefine((xs, ctx) => {
    for (let i = 1; i < xs.length; i++) {
      const prev = xs[i - 1] as string;
      const cur = xs[i] as string;
      if (!(prev < cur)) {
        ctx.addIssue({ code: "custom", message: "must be sorted and unique", path: [i] });
      }
    }
  });

export const AllowlistsFile = z
  .object({
    $schema: z.string().optional(),
    file_kind: z.literal("allowlists"),
    generator: z.literal("@margdarshak/content allowlists v1"),
    licence: z.literal(LICENCE),
    /** sha256 of the canonical JSON of each input catalogue, so a stale file is detectable. */
    inputs: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
    policy: z
      .object({
        citable_rule: z.literal("verified && kind != 'medical'"),
        explanations: z.literal("review_status == 'approved' && hi_review_status == 'approved'"),
        drills_for_coach_and_voice: z.literal("availability == 'phase_1_2'"),
        template_only_games_excluded_from_ai: z.array(GameId),
      })
      .strict(),
    debrief_agent: z
      .object({
        finding_ids: sortedUnique(FindingId),
        rule_ids: sortedUnique(RuleId),
        drill_ids: sortedUnique(DrillId),
        /** Fact keys per finding: the only keys allowed in `{{fact:key}}` (V3). */
        fact_keys: z.record(FindingId, sortedUnique(FactKey)),
      })
      .strict(),
    tutor_agent: z
      .object({
        explanation_ids: sortedUnique(ExplanationId),
        rule_ids: sortedUnique(RuleId),
      })
      .strict(),
    voice_guide_agent: z
      .object({
        get_rule_ids: sortedUnique(RuleId),
        open_drill_ids: sortedUnique(DrillId),
      })
      .strict(),
    coach_agent: z
      .object({
        drill_ids: sortedUnique(DrillId),
      })
      .strict(),
    sign_snap: z
      .object({
        sign_ids: sortedUnique(SignId),
      })
      .strict(),
  })
  .strict();
export type AllowlistsFile = z.infer<typeof AllowlistsFile>;

// LL question bank (CURRICULUM §2.1–§2.2, GAME_DESIGN §11). One file per topic, concepts with
// their item variants nested. SERVER-ONLY fields: every item's `key` and every concept's
// `explanation` (they reveal the answer). `splitQuestionBank` (src/split.ts) produces the
// client-safe bank, the practice feedback pack and the server-only key.
import { z } from "zod";
import {
  AssetId,
  ConceptId,
  Confidence,
  ExplanationId,
  fileHeader,
  HiReviewStatus,
  ItemId,
  LlTopic,
  LocalizedText,
  ReviewStatus,
  RuleId,
  SignFamily,
  SignId,
  Source,
} from "./common.ts";

export const OptionId = z.enum(["a", "b", "c", "d"]);
export type OptionId = z.infer<typeof OptionId>;

export const ItemForm = z.enum([
  /** (a) clean vector of a sign → name it */
  "sign_to_meaning",
  /** (c) reverse: a meaning → pick the sign (options are sign images with alt text) */
  "meaning_to_sign",
  /** (d) a sign or situation in context → choose the action */
  "scenario",
  /** reworded rule question */
  "rule_mcq",
  /** a statement → true / false */
  "true_false",
  /** picture of a hand signal or light → its meaning */
  "picture_to_meaning",
]);
export type ItemForm = z.infer<typeof ItemForm>;

export const ItemOption = z
  .object({
    option_id: OptionId,
    text: LocalizedText,
    /** Sign or illustration shown as the option (meaning_to_sign). `text` is then its alt text. */
    asset_id: AssetId.optional(),
  })
  .strict();

/** SERVER-ONLY. Never sent to a client in mock mode (GAME_DESIGN §11.10 "no answer keys"). */
export const ItemKey = z
  .object({
    correct_option_id: OptionId,
    /** The sign each text option names (sign_to_meaning); used to compute similarity. */
    option_refs: z.partialRecord(OptionId, SignId).optional(),
  })
  .strict();

export const Item = z
  .object({
    item_id: ItemId,
    variant: z.number().int().min(1).max(9),
    form: ItemForm,
    /**
     * "practice": key may be served after an answer (practice feedback pack).
     * "mock": reserved for mock forms; its key stays on the server (score verifier).
     */
    pool: z.enum(["practice", "mock"]),
    /**
     * Staircase distractor similarity L1–L5 (GAME_DESIGN §11.8). "computed" = derived from the
     * sign catalogue and re-checked by tests; "authored" = set by the author for text options.
     */
    similarity: z
      .object({
        level: z.number().int().min(1).max(5),
        basis: z.enum(["computed", "authored"]),
      })
      .strict(),
    stem: LocalizedText,
    stem_assets: z.array(AssetId).max(2),
    options: z.array(ItemOption).min(2).max(4),
    key: ItemKey,
  })
  .strict()
  .superRefine((it, ctx) => {
    if (it.item_id.split(":v")[1] !== String(it.variant)) {
      ctx.addIssue({
        code: "custom",
        message: "item_id must end with :v<variant>",
        path: ["item_id"],
      });
    }
    const ids = it.options.map((o) => o.option_id);
    const expected = OptionId.options.slice(0, ids.length);
    if (ids.join() !== expected.join()) {
      ctx.addIssue({
        code: "custom",
        message: `option ids must be ${expected.join(",")}`,
        path: ["options"],
      });
    }
    if (!ids.includes(it.key.correct_option_id)) {
      ctx.addIssue({
        code: "custom",
        message: "correct_option_id is not an option",
        path: ["key"],
      });
    }
    if (it.form === "true_false" && it.options.length !== 2) {
      ctx.addIssue({
        code: "custom",
        message: "true_false items have exactly 2 options",
        path: ["options"],
      });
    }
    if (it.form !== "true_false" && it.options.length < 3) {
      ctx.addIssue({
        code: "custom",
        message: "choice items have 3 or 4 options",
        path: ["options"],
      });
    }
    if (it.form === "meaning_to_sign" && it.options.some((o) => !o.asset_id)) {
      ctx.addIssue({
        code: "custom",
        message: "meaning_to_sign options need asset_id",
        path: ["options"],
      });
    }
    if (
      (it.form === "sign_to_meaning" || it.form === "picture_to_meaning") &&
      it.stem_assets.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "this form needs a stem asset",
        path: ["stem_assets"],
      });
    }
  });
export type Item = z.infer<typeof Item>;

export const Concept = z
  .object({
    concept_id: ConceptId,
    topic: LlTopic,
    title: LocalizedText,
    /** For LL1: the family (drives DR-LL-SIGNS-<FAMILY> and LL_SIGN_FAMILY_CONFUSION). */
    sign_family: SignFamily.nullable(),
    /** The sign this concept teaches (LL1), if any. */
    sign_id: SignId.nullable(),
    rule_ids: z.array(RuleId),
    /**
     * Rule-pack values quoted in item text. Tests resolve `rulepacks/<file>` row `id` at `path`
     * and fail if the value drifted from `expected`.
     */
    rulepack_facts: z.array(
      z
        .object({
          file: z.string().regex(/^(base\/cmvr|classes|states\/[A-Z]{2})\.json$/),
          id: z.string().min(1),
          path: z.string().regex(/^[A-Za-z0-9_.]+$/),
          expected: z.union([z.number(), z.string(), z.boolean()]),
        })
        .strict(),
    ),
    /** SERVER-ONLY until answered: the reviewed explanation (TutorAgent may only re-phrase it). */
    explanation: z
      .object({
        explanation_id: ExplanationId,
        text: LocalizedText,
        review_status: ReviewStatus,
        hi_review_status: HiReviewStatus,
      })
      .strict(),
    sources: z.array(Source).min(1),
    confidence: Confidence,
    /** true only after the meaning/rule is checked against the fetched primary text. */
    verified: z.boolean(),
    vehicle_scope: z.enum(["All", "2W", "Car"]),
    available_to: z.union([z.literal("all"), z.array(z.string().regex(/^[A-Z]{2}$/)).min(1)]),
    review_status: ReviewStatus,
    items: z.array(Item).min(3).max(6),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.explanation.explanation_id !== `EX-${c.concept_id}`) {
      ctx.addIssue({
        code: "custom",
        message: "explanation_id must be EX-<concept_id>",
        path: ["explanation"],
      });
    }
    if (!c.concept_id.startsWith(`C-${c.topic}-`)) {
      ctx.addIssue({
        code: "custom",
        message: "concept_id must carry its topic",
        path: ["concept_id"],
      });
    }
    for (const [i, it] of c.items.entries()) {
      if (!it.item_id.startsWith(`${c.concept_id}:v`)) {
        ctx.addIssue({
          code: "custom",
          message: "item_id must start with concept_id",
          path: ["items", i],
        });
      }
      if (it.variant !== i + 1) {
        ctx.addIssue({
          code: "custom",
          message: "variants are numbered 1..n in order",
          path: ["items", i],
        });
      }
    }
    if (!c.items.some((it) => it.pool === "mock")) {
      ctx.addIssue({
        code: "custom",
        message: "each concept reserves ≥ 1 mock variant",
        path: ["items"],
      });
    }
    if (c.items.filter((it) => it.pool === "practice").length < 2) {
      ctx.addIssue({
        code: "custom",
        message: "each concept keeps ≥ 2 practice variants",
        path: ["items"],
      });
    }
  });
export type Concept = z.infer<typeof Concept>;

export const QuestionBankFile = z
  .object({
    ...fileHeader("question_bank"),
    topic: LlTopic,
    /** Confidence capture (CURRICULUM §2.2): asked before feedback in practice, once after a mock. */
    confidence_levels: z.tuple([z.literal(50), z.literal(75), z.literal(100)]),
    answer_mode: z.literal("single_choice"),
    concepts: z.array(Concept).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    for (const [i, c] of f.concepts.entries()) {
      if (c.topic !== f.topic) {
        ctx.addIssue({
          code: "custom",
          message: "concept topic differs from file topic",
          path: ["concepts", i],
        });
      }
    }
  });
export type QuestionBankFile = z.infer<typeof QuestionBankFile>;

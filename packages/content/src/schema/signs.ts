// Sign catalogue (CURRICULUM §1.1 `SIGN-<category>-<nnn>`; IRC:67 families; PROMPTS §2.5 SignSnap
// shortlist fields) and the illustration catalogue used by LL3 hand-signal items.
import { z } from "zod";
import {
  fileHeader,
  HiReviewStatus,
  IllustrationId,
  LocalizedText,
  ReviewStatus,
  SignFamily,
  SignId,
  Source,
} from "./common.ts";

export const SignShape = z.enum([
  "octagon",
  "inverted_triangle",
  "circle",
  "triangle",
  "rectangle",
  "road_marking",
  "signal_head",
]);

/** Shape + colour treatment. Two signs share a scheme when only the symbol tells them apart. */
export const ColourScheme = z.enum([
  "red_octagon_white_text",
  "white_inverted_triangle_red_border",
  "red_disc_white_bar",
  "white_disc_red_border",
  "blue_disc_white_symbol",
  "white_triangle_red_border",
  "blue_rectangle_white_panel",
  "white_road_marking",
  "signal_lamp",
]);

export const SignAsset = z
  .object({
    path: z.string().regex(/^(signs|illustrations)\/[A-Z0-9-]+\.svg$/),
    /** We draw our own vectors and cite the standard; we do not reproduce IRC pages. */
    status: z.enum(["to_draw", "drawn", "reviewed"]),
  })
  .strict();

const CODE_BY_FAMILY: Record<string, string> = {
  MANDATORY: "MAN",
  CAUTIONARY: "CAU",
  INFORMATORY: "INF",
  MARKINGS: "MRK",
  SIGNALS: "SIG",
};

export const Sign = z
  .object({
    sign_id: SignId,
    family: SignFamily,
    subfamily: z.enum([
      "stop",
      "give_way",
      "prohibitory",
      "compulsory",
      "limit",
      "warning",
      "facility",
      "route",
      "marking",
      "signal",
    ]),
    shape: SignShape,
    colour_scheme: ColourScheme,
    colours: z.array(z.enum(["red", "white", "blue", "black", "yellow", "amber", "green"])).min(1),
    /** Symbol class: same family + scheme + class = near-identical (similarity level 5). */
    symbol_class: z.string().regex(/^[a-z_]+$/),
    /** Alt text: describes shape and symbol, never the meaning (GAME_DESIGN §11.9). */
    alt: LocalizedText,
    /** Short name used as option text and in lessons. */
    name: LocalizedText,
    /** Reviewed meaning sentence (shown by SignSnap and lessons, never model-authored). */
    meaning: LocalizedText,
    mirror_of: SignId.nullable(),
    standard: z.enum(["IRC:67", "IRC:35", "MV Act Schedule", "signals"]),
    sources: z.array(Source).min(1),
    verified: z.boolean(),
    /** What a reviewer must check against the cited standard before `verified` flips. */
    check_note: z.string().optional(),
    asset: SignAsset,
    review_status: ReviewStatus,
    hi_review_status: HiReviewStatus,
  })
  .strict()
  .superRefine((s, ctx) => {
    if (!s.sign_id.startsWith(`SIGN-${CODE_BY_FAMILY[s.family]}-`)) {
      ctx.addIssue({
        code: "custom",
        message: "sign_id category must match family",
        path: ["sign_id"],
      });
    }
    if (s.asset.path !== `signs/${s.sign_id}.svg`) {
      ctx.addIssue({
        code: "custom",
        message: "asset.path must be signs/<sign_id>.svg",
        path: ["asset"],
      });
    }
  });
export type Sign = z.infer<typeof Sign>;

export const SignsFile = z
  .object({
    ...fileHeader("signs"),
    signs: z.array(Sign).min(1),
  })
  .strict();
export type SignsFile = z.infer<typeof SignsFile>;

export const Illustration = z
  .object({
    illustration_id: IllustrationId,
    subject: z.enum(["hand_signal", "vehicle_lights", "scene"]),
    /** What the picture depicts (internal key, e.g. "slow_down"); never shown to learners. */
    depicts: z.string().regex(/^[a-z_]+$/),
    view: z.enum(["front", "rear", "side", "top"]),
    alt: LocalizedText,
    asset: SignAsset,
    review_status: ReviewStatus,
    hi_review_status: HiReviewStatus,
  })
  .strict()
  .superRefine((i, ctx) => {
    if (i.asset.path !== `illustrations/${i.illustration_id}.svg`) {
      ctx.addIssue({
        code: "custom",
        message: "asset.path must be illustrations/<illustration_id>.svg",
        path: ["asset"],
      });
    }
  });
export type Illustration = z.infer<typeof Illustration>;

export const IllustrationsFile = z
  .object({
    ...fileHeader("illustrations"),
    illustrations: z.array(Illustration).min(1),
  })
  .strict();
export type IllustrationsFile = z.infer<typeof IllustrationsFile>;

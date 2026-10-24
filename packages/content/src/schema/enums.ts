// i18n labels for enum-valued facts (DEBRIEF_SPEC §5.2), the sets drill patterns expand over (§4).
import { z } from "zod";
import { fileHeader, HiReviewStatus, LocalizedText } from "./common.ts";

export const EnumValue = z
  .object({
    value: z.string().regex(/^[A-Za-z0-9_]+$/),
    label: LocalizedText,
    /**
     * false: the value has no pattern-expanded drill (LL0 → the scorer names DR-LL-MOCK), so
     * drill-pattern checks skip it. Absent = true.
     */
    pattern_drill: z.boolean().optional(),
  })
  .strict();

export const FactEnum = z
  .object({
    fact_key: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
    values: z.array(EnumValue).min(1),
    hi_review_status: HiReviewStatus,
  })
  .strict();
export type FactEnum = z.infer<typeof FactEnum>;

export const EnumsFile = z
  .object({
    ...fileHeader("enums"),
    enums: z.array(FactEnum).min(1),
  })
  .strict();
export type EnumsFile = z.infer<typeof EnumsFile>;

// Shared ID patterns, enums and building blocks for every content file (content/**).
// IDs follow CURRICULUM §1.1, DEBRIEF_SPEC §2–§4, GAME_SDK §2 and NAZAR §3.3.
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// ID patterns
// ---------------------------------------------------------------------------------------------

export const MODULE_ID_RE = /^(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)$/;
export const SKILL_ID_RE = /^SK-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)$/;
/**
 * Rule IDs (DEBRIEF_SPEC §3). The domain part allows digits after the first letter because the
 * spec's own `RR-U18-001` has one (GAME_SDK's `[A-Z]{2,4}` would reject it).
 */
export const RULE_ID_RE = /^RR-[A-Z][A-Z0-9]{1,3}-\d{3}$/;
/** Drill IDs (DEBRIEF_SPEC §4). `_` is allowed for upper-snake hazard types. */
export const DRILL_ID_RE = /^DR-[A-Z]{2,3}-[A-Z0-9_-]+$/;
export const FINDING_ID_RE = /^[A-Z]{2,3}_[A-Z0-9_]+$/;
/** Facts keys (GAME_SDK §10): snake_case, at most 24 characters. */
export const FACT_KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
export const SIGN_ID_RE = /^SIGN-(MAN|CAU|INF|MRK|SIG)-\d{3}$/;
export const ILLUSTRATION_ID_RE = /^ILL-[A-Z0-9]+(-[A-Z0-9]+)*$/;
export const CONCEPT_ID_RE = /^C-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)-\d{3}$/;
/** Item variant ID = `<concept>:v<n>`, the GAME_SDK `contentVersion` form (`q:C-LL1-042:v4`). */
export const ITEM_ID_RE = /^C-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)-\d{3}:v[1-9]$/;
export const EXPLANATION_ID_RE = /^EX-C-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)-\d{3}$/;
export const OBJECTIVE_ID_RE = /^LO-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)-\d+$/;
export const LESSON_ID_RE = /^LS-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)-\d+$/;
export const KEY_FACT_ID_RE = /^KF-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)-\d+$/;
export const MISCONCEPTION_ID_RE = /^MC-(LL[0-4]|M([1-9]|1\d|2[0-2])|DL1)-\d+$/;
/** Rule-pack row IDs as they appear in rulepacks/ (read-only here). */
export const RULEPACK_ROW_ID_RE = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CALVER_RE = /^\d{4}\.\d{2}\.\d+$/;
/** `{{fact:key}}` placeholders inside templates (DEBRIEF_SPEC §6.3 V1/V3). */
export const PLACEHOLDER_RE = /\{\{fact:([a-z0-9_]+)\}\}/g;

export const ModuleId = z.string().regex(MODULE_ID_RE);
export const SkillId = z.string().regex(SKILL_ID_RE);
export const RuleId = z.string().regex(RULE_ID_RE);
export const DrillId = z.string().regex(DRILL_ID_RE);
export const FindingId = z.string().regex(FINDING_ID_RE);
export const FactKey = z.string().regex(FACT_KEY_RE);
export const SignId = z.string().regex(SIGN_ID_RE);
export const IllustrationId = z.string().regex(ILLUSTRATION_ID_RE);
export const AssetId = z.union([SignId, IllustrationId]);
export const ConceptId = z.string().regex(CONCEPT_ID_RE);
export const ItemId = z.string().regex(ITEM_ID_RE);
export const ExplanationId = z.string().regex(EXPLANATION_ID_RE);
export const RulepackRowId = z.string().regex(RULEPACK_ROW_ID_RE).max(64);
export const IsoDate = z.string().regex(DATE_RE);

// ---------------------------------------------------------------------------------------------
// Closed enums shared with game-core (packages/game-core/src/schema/ids.ts)
// ---------------------------------------------------------------------------------------------

export const GAME_IDS = [
  "nazar",
  "stopping_distance",
  "blind_spot",
  "junction_scan",
  "track_twin",
  "helmet_fit",
  "golden_hour",
  "night_glare",
  "hill_road",
  "ll_sim",
] as const;
export const GameId = z.enum(GAME_IDS);
export type GameId = z.infer<typeof GameId>;

/** NAZAR §3.3. Drives `DR-NAZ-OCCL-<TYPE>` (TYPE = the value upper-cased). */
export const HAZARD_TYPES = [
  "bus_stop_pedestrian",
  "door_opening",
  "auto_cut_in",
  "wrong_side_2w",
  "cattle_animal",
  "child_school",
  "pedestrian_median",
  "vehicle_pulling_out",
  "truck_left_turn",
  "junction_emerging",
  "overtaking_oncoming",
  "parked_vehicle_hidden",
  "cyclist",
  "surface_hazard",
  "other",
] as const;
export const HazardType = z.enum(HAZARD_TYPES);
export type HazardType = z.infer<typeof HazardType>;

/** IRC:67 families plus markings and signals (DEBRIEF_SPEC §4 `<FAMILY>`), upper case as in game-core. */
export const SIGN_FAMILIES = [
  "MANDATORY",
  "CAUTIONARY",
  "INFORMATORY",
  "MARKINGS",
  "SIGNALS",
] as const;
export const SignFamily = z.enum(SIGN_FAMILIES);
export type SignFamily = z.infer<typeof SignFamily>;

export const LL_TOPICS = ["LL1", "LL2", "LL3", "LL4"] as const;
export const LlTopic = z.enum(LL_TOPICS);
export type LlTopic = z.infer<typeof LlTopic>;

export const RuleKind = z.enum(["law", "practice", "medical", "evidence"]);
export type RuleKind = z.infer<typeof RuleKind>;

/** Same grade scale as rulepacks/schema (OBS, P, P-state, S, MK, unknown). */
export const Grade = z.enum(["OBS", "P", "P-state", "S", "MK", "unknown"]);
export const Confidence = z.enum(["high", "medium", "low"]);

/** Content review state (CURRICULUM §5: two-person review before publish). */
export const ReviewStatus = z.enum(["draft", "in_review", "approved"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;
/** Hindi strings need a native-speaker review (LOCALIZATION §11). */
export const HiReviewStatus = z.enum(["pending_native_review", "approved"]);

export const VehicleScope = z.enum(["2W", "Car", "Both", "All", "per_class"]);

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

export const LocalizedText = z
  .object({
    en: z.string().min(1),
    hi: z.string().min(1),
  })
  .strict();
export type LocalizedText = z.infer<typeof LocalizedText>;

const URL_RE = /^https?:\/\/[^\s]+$/;

/**
 * A cited source. `url: null` with `pin_status: "to_pin"` means the source is named but its
 * primary text has not been fetched and pinned yet (CURRICULUM §5 "Source pinned" gate).
 * "not_applicable" marks a team practice statement that cites the curriculum itself: it needs the
 * two-person review, not a fetch.
 */
export const Source = z
  .object({
    title: z.string().min(3),
    url: z.string().regex(URL_RE).nullable(),
    grade: Grade,
    pin_status: z.enum(["pinned", "to_pin", "not_applicable"]),
    checked_on: IsoDate.nullable(),
    note: z.string().optional(),
  })
  .strict();
export type Source = z.infer<typeof Source>;

export const LICENCE = "CC-BY-4.0" as const;
export const ATTRIBUTION =
  "Margdarshak content pack, team Chanakya (Nestiq Private Limited), 2026" as const;

/** Header shared by every data file in content/ (mirrors rulepacks' `$schema` + version). */
export function fileHeader<K extends string>(kind: K) {
  return {
    $schema: z.string().optional(),
    file_kind: z.literal(kind),
    version: z.string().regex(CALVER_RE),
    status: z.enum(["draft", "published"]),
    licence: z.literal(LICENCE),
    attribution: z.literal(ATTRIBUTION),
    notes: z.string().optional(),
  };
}

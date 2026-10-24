// Shared enums and ID patterns (GAME_SDK §2–§5, NAZAR §3.3, DEBRIEF_SPEC §2–§4).
// Enum-first: every string a game can emit is a closed set unless a bounded pattern is needed.
import { z } from "zod";

/** The ten stable game IDs. G-codes are display only (GAME_SDK §2.2). */
export const GameId = z.enum([
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
]);
export type GameId = z.infer<typeof GameId>;

export const A11yMode = z.enum([
  "no_audio",
  "colour_safe",
  "one_hand",
  "reduced_motion",
  "tap_only",
  "screen_reader_alt",
  "large_text",
  "safe_luminance",
]);
export type A11yMode = z.infer<typeof A11yMode>;

export const GameMode = z.enum(["learn", "practice", "mock", "pair"]);
export type GameMode = z.infer<typeof GameMode>;

export const SeedOrigin = z.enum(["server", "client_offline"]);
export type SeedOrigin = z.infer<typeof SeedOrigin>;

export const TimingMode = z.enum(["rvfc", "fallback", "sim", "none"]);
export type TimingMode = z.infer<typeof TimingMode>;

/** Hazard types (NAZAR §3.3), shared with DEBRIEF_SPEC and the drill catalogue. */
export const HazardType = z.enum([
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
]);
export type HazardType = z.infer<typeof HazardType>;

export const Surface = z.enum(["dry", "wet"]);
export type Surface = z.infer<typeof Surface>;

export const SignFamily = z.enum(["MANDATORY", "CAUTIONARY", "INFORMATORY", "MARKINGS", "SIGNALS"]);
export type SignFamily = z.infer<typeof SignFamily>;

export const LlTopic = z.enum(["LL0", "LL1", "LL2", "LL3", "LL4"]);
export type LlTopic = z.infer<typeof LlTopic>;

/** Semver of a game module, e.g. "1.3.0". */
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);
/** Scoring version `major.minor` (GAME_SDK §9). */
export const ScoringVersion = z.string().regex(/^\d+\.\d+$/);

/**
 * Item reference: `<kind>:<id>` with an optional `@<version>` or `:v<n>`, e.g. `clip:JMU-0012@3`,
 * `q:C-LL1-042:v4`, `track:generic-8@1`. No path separators, never starts with a dot, so a
 * directory-backed content store can map it to a file name safely.
 */
export const ItemRef = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z]{1,8}:[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,54}$/);

/** A bounded short string (GAME_SDK §5.4: payload strings ≤ 24 chars). */
export const Short = z
  .string()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9_.:@-]+$/);

/** Facts keys: snake_case, ≤ 24 chars (GAME_SDK §10). */
export const FACT_KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
export const FactKey = z.string().regex(FACT_KEY_RE);

/** Finding IDs (DEBRIEF_SPEC §2), e.g. `NAZ_LATE_RESPONSE`. */
export const FINDING_ID_RE = /^[A-Z]{2,3}_[A-Z0-9_]+$/;
/** Rule IDs (DEBRIEF_SPEC §3), e.g. `RR-HVY-001`; the domain may hold digits after its first letter (`RR-U18-001`). */
export const RULE_ID_RE = /^RR-[A-Z][A-Z0-9]{1,3}-\d{3}$/;
/**
 * Drill IDs (DEBRIEF_SPEC §4). The spec's manifest pattern `[A-Z0-9-]+` cannot match its own
 * `DR-NAZ-OCCL-BUS_STOP_PEDESTRIAN` (upper snake case hazard types), so `_` is allowed here.
 */
export const DRILL_ID_RE = /^DR-[A-Z]{2,3}-[A-Z0-9_-]+$/;

/**
 * Wire types for the clip admin (API-55 and the P2 delta), aliased from the generated client
 * (`@margdarshak/api-client`, api/openapi.yaml). The enum lists below drive the forms and mirror
 * clip-pipeline (`CLIP_STATUSES`, `HAZARD_TYPES`); `@margdarshak/clip-pipeline` is not a web
 * dependency.
 */
import type { Schemas } from "@margdarshak/api-client";

export const CLIP_STATUSES = [
  "raw",
  "transcoded",
  "blurred",
  "audited",
  "proposed",
  "rated",
  "adjudication",
  "published",
  "retired",
] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

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
export type HazardType = (typeof HAZARD_TYPES)[number];

export const ROAD_TYPES = [
  "urban_arterial",
  "market_street",
  "residential_lane",
  "school_zone",
  "highway",
  "hill_road",
  "rural_road",
] as const;
export const TIMES_OF_DAY = ["dawn", "day", "dusk", "night"] as const;
export const WEATHERS = ["clear", "overcast", "haze", "rain", "fog"] as const;
export const POVS = ["2W", "4W"] as const;
export const SPEED_SOURCES = [
  "rider_log",
  "speedometer",
  "passenger_estimate",
  "not_logged",
] as const;
export const FILMED_BY = ["passenger", "fixed_mount"] as const;
export const MISS_KINDS = ["face", "plate", "other_pii"] as const;
export type MissKind = (typeof MISS_KINDS)[number];
export const ADJ_REASONS = [
  "type_resolved",
  "window_resolved",
  "presence_resolved",
  "proposal_checked",
  "too_many_hazards",
  "other",
] as const;
export type AdjReason = (typeof ADJ_REASONS)[number];

export type AgreementReason =
  | "unmatched_hazard"
  | "type_mismatch"
  | "onset_delta"
  | "end_delta"
  | "too_many_hazards"
  | "unconfirmed_proposal";

/** One rater mark: a = onset, b = end (NAZAR §6.1), milliseconds of media time. */
export type ClipMark = Schemas["ClipMark"];

export type ClipRating = Schemas["ClipRating"];

export type ClipRatingCreate = Schemas["ClipRatingCreate"];

export type FinalHazard = NonNullable<Schemas["Clip"]["hazards"]>[number];

export type ClipAgreement = Schemas["ClipAgreement"];

export type AgreementCluster = ClipAgreement["clusters"][number];

export type AgreementPair = NonNullable<ClipAgreement["pairs"]>[number];

export type BlurAuditSummary = NonNullable<Schemas["Clip"]["blur_audit"]>;

export type ClipReviewTask = Schemas["ClipReviewTask"];

export type JobRunWire = Schemas["JobRun"];

/**
 * E-20 admin view. Fields the caller may not see are omitted by the server (NAZAR §6.2). `origin`
 * is always sent (`filmed` by default).
 */
export type Clip = Schemas["Clip"];

export type ClipAdminPage = Schemas["ClipAdminPage"];

/** API-55 register body; `duration_ms` is required by the server (422 without it). */
export type ClipRegister = Omit<Schemas["ClipRegister"], "duration_ms" | "speed_kmh_est"> & {
  duration_ms: number;
  speed_kmh_est: number | null;
};

export type ClipBlurAuditCreate = Schemas["ClipBlurAuditCreate"];

export type ClipAdjudicationCreate = Schemas["ClipAdjudicationCreate"];

/** `PUT /v1/admin/clips/{id}/cue-texts`: cue texts (en + hi) per final hazard and the curator difficulty. */
export type ClipCueTextsUpdate = Schemas["ClipCueTextsSet"];

/** Who is using the admin screens. `pseudonym` is null when the server does not say. */
export interface AdminIdentity {
  admin: boolean;
  pseudonym: string | null;
  roles: ("curator" | "rater")[];
  source: "server" | "mock";
}

// ---------- AI-generated clips (product decision 2026-10-24; Go ops TBD, proposed here) ----------

export const CLIP_ORIGINS = ["filmed", "ai_generated"] as const;
export type ClipOrigin = (typeof CLIP_ORIGINS)[number];

/**
 * The synthetic review of an AI clip (replaces the blur audit for `origin: ai_generated`): every
 * check must be ticked by a named reviewer pseudonym, with a timestamp, before publish.
 */
export const SYNTHETIC_CHECKS = [
  "no_real_likeness",
  "no_readable_plates",
  "no_real_brands",
  "no_collision_or_injury",
  "hazard_visible",
] as const;
export type SyntheticCheck = (typeof SYNTHETIC_CHECKS)[number];

export type SyntheticReview = NonNullable<Schemas["ClipSyntheticReview"]>;

/** `POST /v1/admin/clips/{clipId}/synthetic-review` (reviewer and time from the server). */
export type ClipSyntheticReviewCreate = Schemas["ClipSyntheticReviewCreate"];

/**
 * `POST /v1/admin/clips/generate`: start the clip_generate workflow for one scene revision. The
 * 202 body is the workflow run (`ClipGenerateAccepted`), not a Clip: the clip is registered later
 * by the task, and `clip` is present only once it exists (a repeat after registration).
 */
export type ClipGenerate = Schemas["ClipGenerate"];

export type ClipGenerateAccepted = Schemas["ClipGenerateAccepted"];

/**
 * A generation scene of `content/nazar/scenes.json` as the curator screen shows it (trimmed on the
 * server by scenes.server.ts; the shot prompts never reach the browser). `revision` is the scene
 * version the generate call must name.
 */
export interface NazarScene {
  scene_id: string;
  revision: number;
  title: { en: string; hi: string };
  hazard_type?: HazardType;
  road_type?: (typeof ROAD_TYPES)[number];
  duration_s?: number;
  speed_kmh_est?: number;
}

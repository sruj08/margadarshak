/**
 * Wire types of the online Nazar study (FIELD_STUDY §4): `POST /v1/study/nazar/enrolments`,
 * `POST …/{participantCode}/near-miss`, the `field_study` consent (API-60) and the public counters
 * (API-71), aliased from the generated client (`@margdarshak/api-client`).
 */
import type { Schemas } from "@margdarshak/api-client";

export const AGE_BANDS = ["18_20", "21_24", "25_34", "35_plus"] as const;
export const LICENCES = ["ll", "2w", "4w", "both"] as const;
export const YEARS = ["0_1", "1_3", "3_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export type Licence = (typeof LICENCES)[number];
export type Years = (typeof YEARS)[number];

export const FORMS = ["A", "B", "C"] as const;
export type StudyForm = (typeof FORMS)[number];

/**
 * Bands only: never a name, phone, licence number, face or location. The body has no consent flag
 * (unknown fields answer 422): the active `field_study` consent is stored first through API-60 and
 * the server looks it up (403 CONSENT_REQUIRED otherwise); `age_ok` must be true.
 */
export type StudyEnrolmentCreate = Schemas["StudyEnrolmentCreate"];

export type StudyEnrolment = Schemas["StudyEnrolment"];

export type StudyPhase = StudyEnrolment["phases"][number];

export type StudyNearMissCreate = Schemas["StudyNearMissCreate"];

export interface ConsentArtefactWire {
  consent_id: string;
  purpose: string;
  status: "active" | "revoked" | "expired";
  granted_at: string;
  notice_version: string;
}

/** API-71 `PublicStats` (the parts the study panel shows). */
export interface PublicStatsWire {
  as_of: string;
  nazar?: {
    status?: "collecting" | "published";
    sample?: "convenience";
    participants?: number;
    below_kerala_60_pct?: number | null;
    ci95?: [number, number] | null;
    median_late_s?: number | null;
    prereg_hash?: string | null;
    [k: string]: unknown;
  };
  counters?: Record<string, number>;
  disclaimer_key?: string;
}

/** The default phase list (FIELD_STUDY §4.3) when the server sends none. */
export const DEFAULT_PHASES: StudyPhase[] = [
  { phase: "ll_mock", game_id: "ll_sim", item_count: 15 },
  { phase: "test", game_id: "nazar", item_count: 10 },
  { phase: "feedback", game_id: "nazar", item_count: 2 },
  { phase: "fresh", game_id: "nazar", item_count: 5 },
];

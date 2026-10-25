import type { Schemas } from "@margdarshak/api-client";
import type { Plan, PlanInput } from "@margdarshak/rules";
import type { StateCode } from "./rules";

/**
 * The three plan answers (SCR-010..012) and how they become engine and API inputs.
 *
 * Age can be a band (one tap), a full date of birth (exact dates), or a year only (EC-01, "my
 * Aadhaar shows only the year"). A band is turned into the latest possible birthday for the band's
 * lower age, so minimum ages are never claimed early (same principle as the year-only rule: 31 Dec
 * for minimum ages). The date of birth stays on this device; only the plan facts are kept.
 */

export const AGE_BANDS = ["under_16", "16_17", "18_19", "20_39", "40_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

const BAND_MIN_AGE: Record<AgeBand, number> = {
  under_16: 15,
  "16_17": 16,
  "18_19": 18,
  "20_39": 20,
  "40_plus": 40,
};

export type AgeAnswer =
  | { kind: "band"; band: AgeBand }
  | { kind: "dob"; dob: string }
  | { kind: "year"; year: number };

export type AadhaarAnswer = "yes" | "no" | "none";

/** What the person came for (SCR-009): a first licence, or a DL with an LL already held (EC-22). */
export type PlanIntent = "first" | "have_ll";

export interface PlanAnswers {
  intent?: PlanIntent;
  /** EC-22: issue date of the LL already held (intent "have_ll"). */
  llIssuedOn?: string | null;
  /** Age and address came from Aadhaar over DigiLocker (simulated), not typed. */
  aadhaarLinked?: boolean;
  age: AgeAnswer;
  /** Picture IDs from classes.json (`bike_gear`, `car`, ...). */
  vehicles: string[];
  state: StateCode;
  aadhaar: AadhaarAnswer | null;
  /** Facts learnt later (application questions, blocker fixes); null = not asked yet. */
  relationLine?: boolean | null;
  mobileLinked?: boolean | null;
  homeTestDevice?: boolean | null;
  hasTestVehicle?: boolean | null;
}

export interface PlanRecord {
  id: string;
  createdAt: string;
  /** IST calendar date the plan was evaluated on. */
  asOf: string;
  answers: PlanAnswers;
  plan: Plan;
  /** "server" = API-01 answered; "device" = computed on this phone with the TS mirror. */
  source: "server" | "device";
  serverPlanId: string | null;
  /** Issues marked "sorted" (rule ID -> answers hash at the time; MD-107). */
  dismissed?: Record<string, string>;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** asOf (YYYY-MM-DD) minus `years`, clamping 29 Feb to 28 Feb. */
export function yearsBefore(asOf: string, years: number): string {
  const [y, m, d] = asOf.split("-").map(Number) as [number, number, number];
  const yy = y - years;
  const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d;
  return `${pad(yy, 4)}-${pad(m)}-${pad(dd)}`;
}

/** Whole years between an ISO date of birth and asOf. */
export function ageFromDob(dob: string, asOf: string): number {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const [y, m, d] = asOf.split("-").map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export function bandForAge(age: number): AgeBand {
  if (age < 16) return "under_16";
  if (age < 18) return "16_17";
  if (age < 20) return "18_19";
  if (age < 40) return "20_39";
  return "40_plus";
}

export function bandOf(answer: AgeAnswer, asOf: string): AgeBand {
  if (answer.kind === "band") return answer.band;
  if (answer.kind === "dob") return bandForAge(ageFromDob(answer.dob, asOf));
  // Year only: the lower bound (31 Dec) for minimum ages.
  return bandForAge(ageFromDob(`${answer.year}-12-31`, asOf));
}

export function isApproximateAge(answer: AgeAnswer): boolean {
  return answer.kind === "band";
}

function triState(v: boolean | null | undefined): boolean | null {
  return v === undefined ? null : v;
}

/** Engine input for the TS mirror (and the field set the Go engine reads). */
export function toEngineInput(a: PlanAnswers, asOf: string): PlanInput {
  const input: PlanInput = {
    as_of: asOf,
    state: a.state,
    dob:
      a.age.kind === "dob"
        ? a.age.dob
        : a.age.kind === "year"
          ? String(a.age.year)
          : yearsBefore(asOf, BAND_MIN_AGE[a.age.band]),
    dob_precision: a.age.kind === "year" ? "year" : "day",
    vehicles: [...a.vehicles],
    aadhaar_address_matches_residence:
      a.aadhaar === "yes" ? true : a.aadhaar === "no" ? false : null,
    aadhaar_has_relation_line: triState(a.relationLine),
    aadhaar_mobile_linked: triState(a.mobileLinked),
    home_test_device: triState(a.homeTestDevice),
    has_test_vehicle: triState(a.hasTestVehicle),
  };
  if (a.intent === "have_ll" && a.llIssuedOn) input.ll_issued_on = a.llIssuedOn;
  return input;
}

/**
 * API-01 PlanRequest (api/openapi.yaml). The contract accepts the rule-pack picture IDs from
 * classes.json as they are, so the server engine sees exactly what the TS mirror sees and the
 * offline plan equals the online one (MD-108). Every non-personal fact the engine reads is sent.
 * Returns null only when the answers are outside the contract (no vehicle, more than 4).
 */
export type ApiPlanRequest = Schemas["PlanRequest"];
type ApiVehicle = NonNullable<ApiPlanRequest["vehicles"]>[number];

export function toApiRequest(
  a: PlanAnswers,
  _asOf: string,
  language: string,
): ApiPlanRequest | null {
  const vehicles = [...new Set(a.vehicles)] as ApiVehicle[];
  if (vehicles.length === 0 || vehicles.length > 4) return null;
  const req: ApiPlanRequest = {
    state: a.state as ApiPlanRequest["state"],
    vehicles,
    dob_precision: "day",
  };
  if (a.age.kind === "dob") {
    req.dob = a.age.dob;
  } else if (a.age.kind === "year") {
    req.dob = `${a.age.year}-12-31`;
    req.dob_precision = "year_only";
  } else {
    req.age_years = Math.max(10, BAND_MIN_AGE[a.age.band]);
  }
  if (a.aadhaar === "yes") req.aadhaar_address_matches_residence = true;
  if (a.aadhaar === "no") req.aadhaar_address_matches_residence = false;
  if (typeof a.relationLine === "boolean") req.aadhaar_has_relation_line = a.relationLine;
  if (typeof a.mobileLinked === "boolean") req.aadhaar_mobile_linked = a.mobileLinked;
  if (typeof a.homeTestDevice === "boolean") req.home_test_device = a.homeTestDevice;
  if (typeof a.hasTestVehicle === "boolean") req.has_test_vehicle = a.hasTestVehicle;
  if (a.intent === "have_ll" && a.llIssuedOn) {
    req.already_holds_ll = true;
    req.ll_issued_on = a.llIssuedOn;
  }
  if (language === "en" || language === "hi") req.language = language;
  return req;
}

/** Case facts (PlanFacts) for API-10/12: the yes/no answers the server blocker engine reads. */
export function toCaseFacts(a: PlanAnswers): Schemas["PlanFacts"] {
  return {
    aadhaar_address_matches_residence:
      a.aadhaar === "yes" ? true : a.aadhaar === "no" ? false : null,
    aadhaar_has_relation_line: triState(a.relationLine),
    aadhaar_mobile_linked: triState(a.mobileLinked),
    home_test_device: triState(a.homeTestDevice),
    has_test_vehicle: triState(a.hasTestVehicle),
  };
}

/** Every issue on the plan, worst first: blockers, then warnings, then notices. */
export function issuesOf(p: Plan) {
  return [...p.blockers, ...p.warnings, ...p.notices];
}

/** The path the user is on: forced to non-Aadhaar when they have no Aadhaar. */
export function chosenPath(p: Plan, a: PlanAnswers) {
  const id = a.aadhaar === "none" ? "non_aadhaar" : p.recommended_path;
  return p.paths.find((x) => x.path_id === id) ?? p.paths[0];
}

export function maxVisits(p: Plan, a: PlanAnswers): number {
  if (a.aadhaar !== "none") return p.max_rto_visits;
  const path = p.paths.find((x) => x.path_id === "non_aadhaar");
  return Math.max(p.max_rto_visits, path?.max_rto_visits ?? p.max_rto_visits);
}

/** Share payload (no date of birth): band, vehicles, state, Aadhaar answer. */
export interface SharePayload {
  b: AgeBand;
  v: string[];
  s: string;
  a: AadhaarAnswer | null;
}

export function toSharePayload(a: PlanAnswers, asOf: string): SharePayload {
  return { b: bandOf(a.age, asOf), v: a.vehicles, s: a.state, a: a.aadhaar };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShare(p: SharePayload): string {
  return toBase64Url(JSON.stringify(p));
}

export function decodeShare(s: string): SharePayload | null {
  try {
    const v = JSON.parse(fromBase64Url(s)) as Partial<SharePayload>;
    if (
      typeof v.b !== "string" ||
      !(AGE_BANDS as readonly string[]).includes(v.b) ||
      !Array.isArray(v.v) ||
      typeof v.s !== "string"
    )
      return null;
    const a = v.a === "yes" || v.a === "no" || v.a === "none" ? v.a : null;
    return { b: v.b as AgeBand, v: v.v.filter((x) => typeof x === "string"), s: v.s, a };
  } catch {
    return null;
  }
}

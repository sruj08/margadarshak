import type { Case, DisplayStage, JourneyState, PrimaryActionId, StageCode } from "./api-types";
import { daysBetween } from "./dates";

/**
 * Journey state -> stage -> one primary action (F-08, UI_SPEC_JOURNEY §3). The Go journey machine
 * is authoritative (MD-121); `deriveCase` mirrors its clock-driven rules for the mock API, and
 * `stageView` turns any Case (real or mock) into what the stage-aware home shows.
 */

export const STAGE_OF: Record<DisplayStage, StageCode> = {
  PLAN: "S1",
  LL_APPLYING: "S2",
  HANDED_OFF: "S2",
  PAYMENT_PENDING: "S2",
  LL_TEST: "S3",
  BRIDGE: "S4",
  DL_BOOKABLE: "S5",
  LL_EXPIRING: "S5",
  TEST_BOOKED: "S6",
  TEST_FAILED: "S6F",
  AWAITING_APPROVAL: "S7",
  DL_ISSUED: "S7",
  DL_HOLDER: "S8",
  LL_EXPIRED: "S2",
  RENEWAL_DUE: "S9",
};

export const ACTION_OF: Record<DisplayStage, PrimaryActionId> = {
  PLAN: "RESUME_STEP",
  LL_APPLYING: "RESUME_STEP",
  HANDED_OFF: "OPEN_HANDOFF",
  PAYMENT_PENDING: "CHECK_PAYMENT",
  LL_TEST: "TAKE_MOCK_TEST",
  BRIDGE: "PRACTISE_NAZAR",
  DL_BOOKABLE: "BOOK_TEST",
  LL_EXPIRING: "BOOK_TEST",
  TEST_BOOKED: "OPEN_TEST_DAY",
  TEST_FAILED: "SEE_RETEST_PLAN",
  AWAITING_APPROVAL: "CHASE_APPROVAL",
  DL_ISSUED: "SHOW_CARD",
  DL_HOLDER: "SHOW_CARD",
  LL_EXPIRED: "START_PLAN",
  RENEWAL_DUE: "RENEW",
};

/** Where each primary action goes inside this app (no dead links: unbuilt stages show honest pages). */
export const ACTION_HREF: Record<PrimaryActionId, string> = {
  START_PLAN: "/plan",
  RESUME_STEP: "/apply",
  OPEN_HANDOFF: "/apply/handoff/return",
  CHECK_PAYMENT: "/apply/payment-pending",
  TAKE_MOCK_TEST: "/test/ll",
  PRACTISE_NAZAR: "/learn",
  BOOK_TEST: "/dl/apply",
  OPEN_TEST_DAY: "/dl/test-day",
  SEE_RETEST_PLAN: "/dl/retest",
  CHASE_APPROVAL: "/dl/issued",
  SHOW_CARD: "/licence",
  RENEW: "/services/renew",
};

const EXPIRY_WARN_DAYS = 30;
const RENEWAL_WINDOW_DAYS = 365;

/**
 * Clock-driven transitions (system events, not client events): day-30 unlock, LL expiry and the
 * renewal window. `today` is the server's IST date.
 */
export function deriveCase(c: Case, today: string): Case {
  let state: JourneyState = c.state;
  const alerts = new Set<Case["alerts"][number]>(c.alerts.filter((a) => a !== "LL_EXPIRING"));
  const unlock = c.key_dates?.["dl_test_unlock"] ?? null;
  const expires = c.ll?.expires_on ?? c.key_dates?.["ll_expires_on"] ?? null;

  if (state === "BRIDGE" && unlock && daysBetween(unlock, today) >= 0) state = "DL_BOOKABLE";
  let display: DisplayStage = state;
  if ((state === "BRIDGE" || state === "DL_BOOKABLE") && expires) {
    const left = daysBetween(today, expires);
    if (left < 0) {
      state = "LL_EXPIRED";
      display = "LL_EXPIRED";
    } else if (left <= EXPIRY_WARN_DAYS) {
      display = "LL_EXPIRING";
      alerts.add("LL_EXPIRING");
    }
  }
  if (state === "DL_HOLDER" && c.dl?.valid_to_non_transport) {
    const left = daysBetween(today, c.dl.valid_to_non_transport);
    if (left <= RENEWAL_WINDOW_DAYS) {
      state = "RENEWAL_DUE";
      display = "RENEWAL_DUE";
    }
  }
  const action = ACTION_OF[display];
  return {
    ...c,
    state,
    display_stage: display,
    stage: STAGE_OF[display],
    alerts: [...alerts],
    next_action: {
      action_id: action,
      stage: STAGE_OF[display],
      title_key: `next.${action.toLowerCase()}`,
      due_at: null,
      deep_link: ACTION_HREF[action],
    },
  };
}

export type ClockKind = "unlock" | "expiry" | "renewal" | "payment" | "expired";

export interface StageClock {
  kind: ClockKind;
  /** Whole days (never seconds, never a fake timer). */
  days: number;
  date: string;
  /** For a progress bar: from-date and to-date. */
  from?: string;
  /** Rule-pack row the deadline comes from (DP-01: countdowns only from the rules engine). */
  ruleId: string;
}

export interface StageView {
  display: DisplayStage;
  stage: StageCode;
  action: PrimaryActionId;
  href: string;
  /** Message keys under `stage.<display>`. */
  key: string;
  tone: "calm" | "caution" | "danger";
  clock: StageClock | null;
  secondary: Array<{ id: string; href: string }>;
}

const SECONDARY: Partial<Record<DisplayStage, Array<{ id: string; href: string }>>> = {
  PLAN: [
    { id: "share", href: "/plan" },
    { id: "blockers", href: "/apply" },
  ],
  LL_APPLYING: [
    { id: "check", href: "/apply/check" },
    { id: "photo", href: "/apply/documents" },
  ],
  HANDED_OFF: [{ id: "pack", href: "/apply/handoff/pack" }],
  PAYMENT_PENDING: [{ id: "stuck", href: "/apply/payment-pending" }],
  LL_TEST: [
    { id: "ll_test", href: "/test/ll" },
    { id: "taken", href: "/licence" },
  ],
  BRIDGE: [
    { id: "track", href: "/dl/track" },
    { id: "tracker", href: "/licence" },
  ],
  DL_BOOKABLE: [
    { id: "track", href: "/dl/track" },
    { id: "tracker", href: "/licence" },
  ],
  LL_EXPIRING: [
    { id: "slot_early", href: "/dl/apply" },
    { id: "what_if", href: "/services/ll-expiry" },
  ],
  TEST_BOOKED: [{ id: "track", href: "/dl/track" }],
  TEST_FAILED: [
    { id: "track", href: "/dl/track" },
    { id: "tracker", href: "/licence" },
  ],
  AWAITING_APPROVAL: [{ id: "digilocker", href: "/dl/issued" }],
  DL_ISSUED: [{ id: "digilocker", href: "/dl/issued" }],
  DL_HOLDER: [
    { id: "first_vehicle", href: "/services/first-vehicle" },
    { id: "challan", href: "/services/challan" },
  ],
  RENEWAL_DUE: [{ id: "form1a", href: "/services/form-1a" }],
  LL_EXPIRED: [{ id: "why", href: "/services/ll-expiry" }],
};

export function stageView(c: Case, today: string): StageView {
  const display = c.display_stage;
  const action = c.next_action?.action_id ?? ACTION_OF[display];
  const unlock = c.key_dates?.["dl_test_unlock"] ?? null;
  const issued = c.ll?.issued_on ?? c.key_dates?.["ll_issued_on"] ?? null;
  const expires = c.ll?.expires_on ?? c.key_dates?.["ll_expires_on"] ?? null;
  let clock: StageClock | null = null;
  if (display === "BRIDGE" && unlock) {
    clock = {
      kind: "unlock",
      days: Math.max(0, daysBetween(today, unlock)),
      date: unlock,
      ruleId: "PRM-MIN-WAIT-DAYS",
      ...(issued ? { from: issued } : {}),
    };
  } else if ((display === "DL_BOOKABLE" || display === "LL_EXPIRING") && expires) {
    clock = {
      kind: "expiry",
      days: Math.max(0, daysBetween(today, expires)),
      date: expires,
      ruleId: "PRM-LL-VALIDITY-MONTHS",
    };
  } else if (display === "LL_EXPIRED" && expires) {
    clock = {
      kind: "expired",
      days: Math.max(0, daysBetween(expires, today)),
      date: expires,
      ruleId: "PRM-LL-VALIDITY-MONTHS",
    };
  } else if (display === "RENEWAL_DUE" && c.dl?.valid_to_non_transport) {
    const to = c.dl.valid_to_non_transport;
    clock = {
      kind: "renewal",
      days: daysBetween(today, to),
      date: to,
      ruleId: "DL-VALIDITY-MIRROR",
    };
  } else if (display === "PAYMENT_PENDING") {
    const paid = c.key_dates?.["payment_on"] ?? null;
    if (paid)
      clock = {
        kind: "payment",
        days: daysBetween(paid, today) + 1,
        date: paid,
        ruleId: "SARATHI-FAQ-PAY-PENDING-3D",
      };
  }
  const tone =
    display === "LL_EXPIRING" || display === "LL_EXPIRED"
      ? "danger"
      : display === "PAYMENT_PENDING" || (display === "RENEWAL_DUE" && (clock?.days ?? 1) < 0)
        ? "caution"
        : "calm";
  return {
    display,
    stage: STAGE_OF[display],
    action,
    href: ACTION_HREF[action] ?? "/",
    key: display,
    tone,
    clock,
    secondary: SECONDARY[display] ?? [],
  };
}

/** The parcel tracker's steps (SCR-070), from the case and its key dates. */
export type TrackStatus = "done" | "now" | "later";
export interface TrackStep {
  id: string;
  status: TrackStatus;
  date: string | null;
  who: "you" | "sarathi" | "rto" | "post";
}

const ORDER: readonly { id: string; who: TrackStep["who"]; doneFrom: readonly DisplayStage[] }[] = [
  {
    id: "plan",
    who: "you",
    doneFrom: [
      "LL_APPLYING",
      "HANDED_OFF",
      "PAYMENT_PENDING",
      "LL_TEST",
      "BRIDGE",
      "DL_BOOKABLE",
      "LL_EXPIRING",
      "TEST_BOOKED",
      "TEST_FAILED",
      "AWAITING_APPROVAL",
      "DL_ISSUED",
      "DL_HOLDER",
      "RENEWAL_DUE",
    ],
  },
  {
    id: "applied",
    who: "sarathi",
    doneFrom: [
      "LL_TEST",
      "BRIDGE",
      "DL_BOOKABLE",
      "LL_EXPIRING",
      "TEST_BOOKED",
      "TEST_FAILED",
      "AWAITING_APPROVAL",
      "DL_ISSUED",
      "DL_HOLDER",
      "RENEWAL_DUE",
    ],
  },
  {
    id: "ll_test",
    who: "you",
    doneFrom: [
      "BRIDGE",
      "DL_BOOKABLE",
      "LL_EXPIRING",
      "TEST_BOOKED",
      "TEST_FAILED",
      "AWAITING_APPROVAL",
      "DL_ISSUED",
      "DL_HOLDER",
      "RENEWAL_DUE",
    ],
  },
  {
    id: "practice",
    who: "you",
    doneFrom: [
      "DL_BOOKABLE",
      "LL_EXPIRING",
      "TEST_BOOKED",
      "TEST_FAILED",
      "AWAITING_APPROVAL",
      "DL_ISSUED",
      "DL_HOLDER",
      "RENEWAL_DUE",
    ],
  },
  {
    id: "book",
    who: "you",
    doneFrom: [
      "TEST_BOOKED",
      "TEST_FAILED",
      "AWAITING_APPROVAL",
      "DL_ISSUED",
      "DL_HOLDER",
      "RENEWAL_DUE",
    ],
  },
  {
    id: "dl_test",
    who: "rto",
    doneFrom: ["AWAITING_APPROVAL", "DL_ISSUED", "DL_HOLDER", "RENEWAL_DUE"],
  },
  { id: "approval", who: "rto", doneFrom: ["DL_ISSUED", "DL_HOLDER", "RENEWAL_DUE"] },
  { id: "card", who: "post", doneFrom: ["DL_HOLDER", "RENEWAL_DUE"] },
  { id: "digilocker", who: "sarathi", doneFrom: ["DL_HOLDER", "RENEWAL_DUE"] },
];

export function trackerSteps(c: Case): TrackStep[] {
  const d = c.display_stage;
  const kd = c.key_dates ?? {};
  const dateFor: Record<string, string | null> = {
    plan: c.created_at ? c.created_at.slice(0, 10) : null,
    applied: kd["applied_on"] ?? null,
    ll_test: c.ll?.issued_on ?? kd["ll_issued_on"] ?? null,
    practice: kd["dl_test_unlock"] ?? null,
    book: kd["slot_date"] ?? kd["dl_test_unlock"] ?? null,
    dl_test: kd["slot_date"] ?? kd["test_passed_on"] ?? null,
    approval: kd["approved_on"] ?? null,
    card: c.dl?.issued_on ?? null,
    digilocker: c.dl?.issued_on ?? null,
  };
  let nowAssigned = false;
  return ORDER.map((s) => {
    const done = s.doneFrom.includes(d);
    let status: TrackStatus = done ? "done" : "later";
    if (!done && !nowAssigned) {
      status = "now";
      nowAssigned = true;
    }
    return { id: s.id, status, date: dateFor[s.id] ?? null, who: s.who };
  });
}

import type { Plan } from "@margdarshak/rules";
import type {
  Case,
  CaseCreate,
  CaseEventCreate,
  CaseEventResult,
  CasePatch,
  ConsentArtefact,
  ConsentPurpose,
  FamilyMember,
  HandoffPack,
  JourneyState,
  LabTrialCreate,
  TimelineEvent,
  TimelinePage,
} from "./api-types";
import { addDays, addMonths, istToday } from "./dates";
import { type ApiPlanRequest, type PlanAnswers, toEngineInput } from "./plan-model";
import { planOnDevice } from "./rules";
import { deriveCase } from "./stage";
import { KEYS, newId, readJson, writeJson } from "./storage";

/**
 * Local mock of the Go API (NEXT_PUBLIC_API_MOCK=1, or no NEXT_PUBLIC_API_URL). Every function
 * returns the api/openapi.yaml shape, so the UI is the same against the real server. State lives in
 * this browser's localStorage under one key. It behaves like a network service: when the browser is
 * offline it throws, so offline and outbox paths are exercised in mock mode too.
 */

export class MockNetworkError extends Error {
  constructor() {
    super("Failed to fetch (mock API offline)");
    this.name = "TypeError";
  }
}

export class MockProblem extends Error {
  constructor(
    public status: number,
    public title: string,
    public code?: string,
  ) {
    super(title);
  }
}

interface MockDb {
  cases: Record<string, Case>;
  events: Record<
    string,
    Array<{ seq: number; type: string; occurred_on: string; recorded_at: string }>
  >;
  consents: ConsentArtefact[];
  members: FamilyMember[];
  trials: Array<LabTrialCreate & { trial_id: string }>;
  plans: Record<string, { created_at: string; state: string }>;
}

const EMPTY: MockDb = { cases: {}, events: {}, consents: [], members: [], trials: [], plans: {} };

function db(): MockDb {
  const v = readJson<MockDb>(KEYS.mock, EMPTY);
  return { ...EMPTY, ...v };
}

function save(d: MockDb): void {
  writeJson(KEYS.mock, d);
}

function online(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new MockNetworkError();
}

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return istToday();
}

function withServerTime(c: Case): Case {
  return deriveCase({ ...c, server_time: now() }, today());
}

// ---------- API-01 plans ----------

export async function createPlan(
  req: ApiPlanRequest,
  answers: PlanAnswers,
): Promise<Plan & { plan_id: string; expires_at: string }> {
  online();
  if (!req.state || (req.vehicles?.length ?? 0) === 0)
    throw new MockProblem(422, "Invalid plan request");
  const asOf = today();
  const plan = planOnDevice(toEngineInput(answers, asOf));
  const id = newId("pln");
  const d = db();
  d.plans[id] = { created_at: now(), state: req.state };
  save(d);
  return { ...plan, plan_id: id, expires_at: `${addDays(asOf, 7)}T18:29:59Z` };
}

// ---------- API-10..17 cases ----------

export async function createCase(
  body: CaseCreate & { answers?: Record<string, unknown> },
  opts: { onDevice?: boolean } = {},
): Promise<Case> {
  if (!opts.onDevice) online();
  const id = newId("cas");
  const t = now();
  const c: Case = {
    case_id: id,
    tenant: body.state ?? "JK",
    state: "PLAN",
    stage: "S1",
    display_stage: "PLAN",
    alerts: [],
    path: body.path ?? "aadhaar_contactless",
    classes: body.classes.map((code) => ({ class_code: code, status: "planned" as const })),
    answers: body.answers ?? {},
    ll: body.existing_ll ?? null,
    dl: body.existing_dl ?? null,
    key_dates: {},
    next_action: { action_id: "RESUME_STEP", stage: "S1", title_key: "next.resume_step" },
    rule_pack_version: "2026.10.0",
    version: 1,
    flags: body.for_family_member ? ["for_minor_family_member"] : [],
    server_time: t,
    created_at: t,
    updated_at: t,
  };
  const d = db();
  d.cases[id] = c;
  d.events[id] = [];
  save(d);
  return withServerTime(c);
}

export async function getCase(id: string): Promise<Case> {
  online();
  const c = db().cases[id];
  if (!c) throw new MockProblem(404, "Case not found");
  return withServerTime(c);
}

const PROHIBITED =
  /(aadhaar_?(no|num|number)|otp|captcha|password|biometric|^name|^relation|^address)/i;

export async function patchCase(id: string, patch: CasePatch, ifMatch?: number): Promise<Case> {
  online();
  const d = db();
  const c = d.cases[id];
  if (!c) throw new MockProblem(404, "Case not found");
  if (ifMatch !== undefined && ifMatch !== c.version)
    throw new MockProblem(412, "Someone else changed this case", "VERSION_CONFLICT");
  for (const k of Object.keys(patch.answers ?? {}))
    if (PROHIBITED.test(k)) throw new MockProblem(422, "Prohibited field", "prohibited-field");
  const answers = { ...(c.answers ?? {}) };
  for (const [k, v] of Object.entries(patch.answers ?? {})) {
    if (v === null) delete answers[k];
    else answers[k] = v;
  }
  const next: Case = {
    ...c,
    answers,
    ...(patch.path ? { path: patch.path } : {}),
    ...(patch.classes
      ? { classes: patch.classes.map((code) => ({ class_code: code, status: "planned" as const })) }
      : {}),
    state: c.state === "PLAN" && Object.keys(answers).length > 0 ? "LL_APPLYING" : c.state,
    version: c.version + 1,
    updated_at: now(),
  };
  d.cases[id] = next;
  save(d);
  return withServerTime(next);
}

const TRANSITION: Partial<Record<CaseEventCreate["type"], JourneyState>> = {
  application_started: "LL_APPLYING",
  handoff_done: "HANDED_OFF",
  payment_pending: "PAYMENT_PENDING",
  payment_confirmed: "LL_TEST",
  ll_issued: "BRIDGE",
  ll_test_failed: "LL_TEST",
  slot_booked: "TEST_BOOKED",
  test_failed: "TEST_FAILED",
  test_passed: "AWAITING_APPROVAL",
  approved: "DL_ISSUED",
  card_received: "DL_HOLDER",
  reapply: "PLAN",
  renewed: "DL_HOLDER",
};

export async function postEvent(id: string, ev: CaseEventCreate): Promise<CaseEventResult> {
  online();
  const d = db();
  const c = d.cases[id];
  if (!c) throw new MockProblem(404, "Case not found");
  const unlockOn = c.key_dates?.["dl_test_unlock"];
  const slotOn = ev.payload?.slot_date ?? ev.occurred_on;
  if (ev.type === "slot_booked" && unlockOn && slotOn < unlockOn)
    throw new MockProblem(
      409,
      "Driving test not allowed before the unlock date",
      "JOURNEY_TOO_EARLY",
    );
  const list = d.events[id] ?? [];
  const recorded = {
    seq: list.length + 1,
    type: ev.type,
    occurred_on: ev.occurred_on,
    recorded_at: now(),
  };
  list.push(recorded);
  d.events[id] = list;
  const kd = { ...(c.key_dates ?? {}) };
  let ll = c.ll ?? null;
  let dl = c.dl ?? null;
  const classes = c.classes.map((x) => x.class_code);
  switch (ev.type) {
    case "handoff_done":
      kd["handoff_on"] = ev.occurred_on;
      break;
    case "payment_pending":
      kd["payment_on"] = ev.occurred_on;
      break;
    case "payment_confirmed":
      kd["applied_on"] = ev.occurred_on;
      break;
    case "ll_issued": {
      const expires = addMonths(ev.occurred_on, 6);
      ll = {
        issued_on: ev.occurred_on,
        expires_on: expires,
        classes: ev.payload?.classes ?? classes,
        ...(ev.payload?.number_last4 ? { number_last4: ev.payload.number_last4 } : {}),
        source: "user_entered",
      };
      kd["ll_issued_on"] = ev.occurred_on;
      kd["dl_test_unlock"] = addDays(ev.occurred_on, 30);
      kd["ll_expires_on"] = expires;
      kd["applied_on"] ??= ev.occurred_on;
      break;
    }
    case "slot_booked":
      kd["slot_date"] = ev.payload?.slot_date ?? ev.occurred_on;
      break;
    case "test_passed":
      kd["test_passed_on"] = ev.occurred_on;
      break;
    case "approved":
    case "card_received":
      kd["approved_on"] ??= ev.occurred_on;
      dl ??= {
        issued_on: ev.occurred_on,
        valid_to_non_transport: addMonths(ev.occurred_on, 12 * 20),
        classes,
        ...(ev.payload?.number_last4 ? { number_last4: ev.payload.number_last4 } : {}),
        source: "user_entered",
      };
      break;
    default:
      break;
  }
  const next: Case = {
    ...c,
    state: TRANSITION[ev.type] ?? c.state,
    key_dates: kd,
    ll,
    dl,
    version: c.version + 1,
    updated_at: now(),
  };
  d.cases[id] = next;
  save(d);
  const derived = withServerTime(next);
  return {
    event: recorded as CaseEventResult["event"],
    case: { case_id: id, state: derived.state, stage: derived.stage, version: derived.version },
    timeline_changes: {
      scheduled: timelineFor(derived)
        .filter((t) => t.status === "scheduled")
        .map((t) => t.code),
      cancelled: [],
    },
    warnings: [],
  };
}

/**
 * Demo tenant only: moves every date on a case `days` into the past, so a recording can show
 * "LL day 0" then "LL day 31" without waiting a month. The clock rules (deriveCase) then apply.
 */
export async function demoSkipDays(id: string, days: number): Promise<Case> {
  const d = db();
  const c = d.cases[id];
  if (!c) throw new MockProblem(404, "Case not found");
  const back = (v: string) => addDays(v, -days);
  const kd: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.key_dates ?? {})) if (v) kd[k] = back(v);
  const next: Case = {
    ...c,
    key_dates: kd,
    ll: c.ll
      ? { ...c.ll, issued_on: back(c.ll.issued_on), expires_on: back(c.ll.expires_on) }
      : null,
    dl: c.dl?.issued_on ? { ...c.dl, issued_on: back(c.dl.issued_on) } : (c.dl ?? null),
    version: c.version + 1,
    updated_at: now(),
  };
  d.cases[id] = next;
  save(d);
  return withServerTime(next);
}

function due(date: string): string {
  return `${date}T03:30:00Z`;
}

/** API-14: facts plus scheduled milestones (idempotency key {caseId}:{code}:{dueOn}). */
export function timelineFor(c: Case): TimelineEvent[] {
  const kd = c.key_dates ?? {};
  const items: TimelineEvent[] = [];
  const t = today();
  const push = (
    code: string,
    kind: TimelineEvent["kind"],
    date: string | null | undefined,
    rule?: string,
  ) => {
    if (!date) return;
    const past = date <= t;
    items.push({
      event_id: `tle_${code.toLowerCase()}_${date}`,
      kind,
      code,
      ...(kind === "fact" ? { occurred_at: due(date) } : { due_at: due(date) }),
      status: kind === "fact" || past ? "done" : "scheduled",
      source: kind === "fact" ? "user" : "system",
      ...(rule ? { rule_id: rule } : {}),
      idempotency_key: `${c.case_id}:${code}:${date}`,
    });
  };
  push("APPLIED", "fact", kd["applied_on"]);
  push("LL_ISSUED", "fact", c.ll?.issued_on ?? kd["ll_issued_on"]);
  const unlock = kd["dl_test_unlock"];
  if (unlock) push("LL_DAY_25_PREP", "reminder", addDays(unlock, -5), "PRM-MIN-WAIT-DAYS");
  push("LL_DAY_30_UNLOCK", "milestone", unlock, "PRM-MIN-WAIT-DAYS");
  const exp = c.ll?.expires_on ?? kd["ll_expires_on"];
  if (exp && c.state !== "DL_HOLDER" && c.state !== "RENEWAL_DUE") {
    push("LL_EXPIRY_M30", "reminder", addDays(exp, -30), "PRM-LL-VALIDITY-MONTHS");
    push("LL_EXPIRY_M7", "reminder", addDays(exp, -7), "PRM-LL-VALIDITY-MONTHS");
    push("LL_EXPIRY", "deadline", exp, "PRM-LL-VALIDITY-MONTHS");
  }
  push("TEST_DAY", "milestone", kd["slot_date"]);
  if (c.dl?.valid_to_non_transport) {
    push("DL_RENEWAL_M60", "reminder", addDays(c.dl.valid_to_non_transport, -60));
    push("DL_EXPIRY", "deadline", c.dl.valid_to_non_transport);
  }
  if (kd["payment_on"] && c.state === "PAYMENT_PENDING")
    push("PAYMENT_PENDING_D3", "reminder", addDays(kd["payment_on"], 3));
  return items.sort((a, b) =>
    (a.occurred_at ?? a.due_at ?? "").localeCompare(b.occurred_at ?? b.due_at ?? ""),
  );
}

export async function getTimeline(id: string): Promise<TimelinePage> {
  const c = await getCase(id);
  return { server_time: now(), items: timelineFor(c), next_cursor: null };
}

/** API-17: delete a case; scheduled reminders are cancelled (EC-26). */
export async function deleteCase(id: string): Promise<{ cancelled: string[] }> {
  online();
  const d = db();
  const c = d.cases[id];
  if (!c) return { cancelled: [] };
  const cancelled = timelineFor(withServerTime(c))
    .filter((e) => e.status === "scheduled")
    .map((e) => e.idempotency_key ?? e.code);
  delete d.cases[id];
  delete d.events[id];
  save(d);
  return { cancelled };
}

// ---------- API-16 hand-off ----------

export async function getHandoff(id: string, stateName: string): Promise<HandoffPack> {
  const c = await getCase(id);
  const classes = c.classes.map((x) => x.class_code).join(", ");
  const nonAadhaar = c.path === "non_aadhaar_rto";
  return {
    case_id: id,
    step: "ll_application",
    mode: "A",
    adapter: "mock",
    simulated: true,
    target_url: "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do",
    prohibited_note_key: "handoff.never_share_otp_with_us",
    steps: [
      {
        order: 1,
        screen_hint_key: "select_state",
        fields: [{ label_key: "state", vault_key: null, value: stateName, copyable: true }],
      },
      {
        order: 2,
        screen_hint_key: "new_ll_form",
        fields: [
          {
            label_key: "category",
            vault_key: null,
            value: String(c.answers?.["category"] ?? "general"),
            copyable: true,
          },
          {
            label_key: "licence_held",
            vault_key: null,
            value: String(c.answers?.["licence_held"] ?? "none"),
            copyable: true,
          },
          {
            label_key: "country_of_birth",
            vault_key: null,
            value: c.answers?.["born_in_india"] === "no" ? "other" : "india",
            copyable: true,
          },
        ],
      },
      {
        order: 3,
        screen_hint_key: nonAadhaar ? "mobile_auth" : "aadhaar_ekyc",
        note_key: nonAadhaar ? "mobile_auth_on_sarathi" : "ekyc_on_sarathi",
        fields: [],
      },
      ...(nonAadhaar
        ? [
            {
              order: 4,
              screen_hint_key: "personal_details",
              fields: [
                { label_key: "full_name", vault_key: "full_name", value: null, copyable: true },
                {
                  label_key: "relative_name",
                  vault_key: "relative_name",
                  value: null,
                  copyable: true,
                },
                { label_key: "home", vault_key: "home", value: null, copyable: true },
              ],
            },
          ]
        : []),
      {
        order: nonAadhaar ? 5 : 4,
        screen_hint_key: "class_of_vehicle",
        fields: [{ label_key: "classes", vault_key: null, value: classes, copyable: true }],
      },
      {
        order: nonAadhaar ? 6 : 5,
        screen_hint_key: "date_of_birth",
        note_key: "dob_type_only",
        fields: [{ label_key: "dob", vault_key: "dob", value: null, copyable: false }],
      },
    ],
    expires_at: `${addDays(today(), 1)}T18:29:59Z`,
  };
}

/** Adapter health (API-64 `adapters.sarathi`). Outage can be injected for EC-11 demos and tests. */
export async function sarathiStatus(): Promise<"ok" | "degraded" | "down"> {
  online();
  try {
    if (localStorage.getItem("md.mock.sarathi") === "down") return "down";
  } catch {
    // ignore
  }
  return "ok";
}

// ---------- API-60..62 privacy ----------

export async function listConsents(): Promise<ConsentArtefact[]> {
  online();
  return db().consents;
}

export async function changeConsent(
  purpose: ConsentPurpose,
  action: "grant" | "revoke",
  noticeVersion: string,
  language: string,
): Promise<ConsentArtefact> {
  online();
  const d = db();
  const t = now();
  const existing = d.consents.find((c) => c.purpose === purpose && c.status === "active");
  if (action === "revoke") {
    if (existing) {
      existing.status = "revoked";
      existing.revoked_at = t;
      save(d);
      return existing;
    }
    throw new MockProblem(404, "No active consent for this purpose");
  }
  if (existing) return existing;
  const art: ConsentArtefact = {
    consent_id: newId("cns"),
    purpose,
    data_categories: [],
    recipient: null,
    status: "active",
    granted_at: t,
    expires_at: null,
    revoked_at: null,
    notice_version: noticeVersion,
    language,
  };
  d.consents.push(art);
  save(d);
  return art;
}

export async function addFamilyMember(body: {
  relation: FamilyMember["relation"];
  label?: string;
  age_band: FamilyMember["age_band"];
  is_minor: boolean;
}): Promise<FamilyMember> {
  online();
  const d = db();
  const m: FamilyMember = {
    member_id: newId("fam"),
    relation: body.relation,
    label: body.label ?? null,
    age_band: body.age_band,
    is_minor: body.is_minor,
    parental_consent: { status: body.is_minor ? "required" : "not_required", consent_id: null },
    created_at: now(),
  };
  d.members.push(m);
  save(d);
  return m;
}

export async function setParentalConsent(
  memberId: string,
  action: "grant" | "revoke",
  noticeVersion: string,
  language: string,
): Promise<FamilyMember> {
  online();
  const d = db();
  const m = d.members.find((x) => x.member_id === memberId);
  if (!m) throw new MockProblem(404, "Family member not found");
  const art = await changeConsent("parental_consent", action, noticeVersion, language);
  m.parental_consent = {
    status: action === "grant" ? "granted" : "revoked",
    consent_id: art.consent_id,
  };
  const fresh = db();
  fresh.members = fresh.members.map((x) => (x.member_id === memberId ? m : x));
  save(fresh);
  return m;
}

export function listMembers(): FamilyMember[] {
  return db().members;
}

/** API-61: everything the mock server holds for this device (the client adds the device vault). */
export async function exportServerData(): Promise<Record<string, unknown>> {
  online();
  const d = db();
  return {
    cases: Object.values(d.cases),
    events: d.events,
    consents: d.consents,
    family_members: d.members,
    lab_trials: d.trials,
  };
}

/** API-62: erase the account (all cases, their reminders, consents except the withdrawal record). */
export async function deleteMe(): Promise<{ cancelled: string[] }> {
  online();
  const d = db();
  const cancelled: string[] = [];
  for (const c of Object.values(d.cases)) {
    for (const e of timelineFor(withServerTime(c)))
      if (e.status === "scheduled") cancelled.push(e.idempotency_key ?? e.code);
  }
  save(EMPTY);
  return { cancelled };
}

// ---------- API-70 lab trials ----------

export async function recordLabTrial(
  body: LabTrialCreate,
): Promise<LabTrialCreate & { trial_id: string }> {
  online();
  const d = db();
  const row = { ...body, trial_id: newId("trl") };
  d.trials.push(row);
  save(d);
  return row;
}

// ---------- demo personas ----------

export function seedPersonaCase(
  c: Case | null,
  member: FamilyMember | null,
  consents: string[],
): void {
  const d: MockDb = {
    ...EMPTY,
    cases: {},
    events: {},
    consents: [],
    members: [],
    trials: db().trials,
    plans: {},
  };
  if (c) {
    d.cases[c.case_id] = c;
    d.events[c.case_id] = [];
  }
  if (member) d.members.push(member);
  const t = now();
  for (const p of consents) {
    d.consents.push({
      consent_id: newId("cns"),
      purpose: p as ConsentPurpose,
      data_categories: [],
      recipient: null,
      status: "active",
      granted_at: t,
      expires_at: null,
      revoked_at: null,
      notice_version: "notice-2026.10.24",
      language: "en",
    });
  }
  save(d);
}

// ---------- API-07 / API-08 sign-in (mock) ----------

const AUTH = "md.mock.auth.v1";

interface MockAuth {
  signedIn: boolean;
  /** The single-use code the simulated e-mail carries (the mock has no e-mail server). */
  code: string | null;
}

function auth(): MockAuth {
  return readJson<MockAuth>(AUTH, { signedIn: false, code: null });
}

/** API-59 GET /v1/me: a demo persona is a signed-in account; otherwise the mock sign-in state. */
export async function getMe(): Promise<{ scope: "anon" | "user" }> {
  online();
  return { scope: auth().signedIn || readJson(KEYS.persona, null) !== null ? "user" : "anon" };
}

/** API-07: "sends" the magic link. Returns the code so the UI can show the simulated e-mail. */
export async function requestMagicLink(email: string): Promise<{ code: string }> {
  online();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new MockProblem(422, "Validation failed", "VALIDATION_FAILED");
  const code = newId("ml");
  writeJson(AUTH, { ...auth(), code });
  return { code };
}

/** API-08: redeems the single-use code; the device's cases stay with the new account. */
export async function exchangeMagicLink(code: string): Promise<{ scope: "user" }> {
  online();
  const a = auth();
  if (!a.code || a.code !== code)
    throw new MockProblem(401, "This sign-in link has expired or was used", "UNAUTHENTICATED");
  writeJson(AUTH, { signedIn: true, code: null });
  return { scope: "user" };
}

/** API-09. */
export async function logout(): Promise<void> {
  writeJson(AUTH, null);
}

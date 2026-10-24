// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AnalyticsDeps, BATCH, createAnalytics, sanitize } from "./analytics";
import { fromServerBlocker, serverIssues } from "./blockers";
import { paymentReturn, paymentStatus } from "./payment";
import { K_MIN, statCells } from "./stats";

/**
 * P1 gap closing: API-13 blockers, API-19 payment intents, API-63 analytics, API-71 stats and the
 * API-07/08 sign-in. Pure mappings first, then the client calls against a fake API (real mode).
 */

const BLOCKER = {
  blocker_id: "EC-02",
  severity: "warn" as const,
  kind: "warning" as const,
  title_key: "rule.JK-B02.text",
  fix_key: "rule.JK-B02.fix",
  rule_id: "JK-B02",
  confidence: "medium" as const,
  verify_at_rto: true,
  refs: ["EC-02"],
  provenance: {
    source_title: "J&K Transport LL flow",
    source_url: "https://jktransport.gov.in",
    verified_on: "2026-10-22",
    confidence: "medium" as const,
    verified: false,
  },
};

describe("API-13 server blockers as engine issues", () => {
  it("maps block/warn/info and the provenance chip", () => {
    const i = fromServerBlocker(BLOCKER);
    expect(i).toMatchObject({
      rule_id: "JK-B02",
      severity: "warning",
      text_key: "rule.JK-B02.text",
      fix_key: "rule.JK-B02.fix",
      verify_at_rto: true,
      refs: ["EC-02"],
    });
    expect(i.provenance).toMatchObject({ checked_on: "2026-10-22", verified: false });
    expect(fromServerBlocker({ ...BLOCKER, severity: "block" }).severity).toBe("blocker");
    const { fix_key: _drop, ...noFix } = BLOCKER;
    expect(fromServerBlocker({ ...noFix, severity: "info" }).fix_key).toBe(null);
  });

  it("keeps blockers and warnings, never notices", () => {
    const out = serverIssues({
      case_id: "cas_X",
      rule_pack_version: "2026.10.0",
      blockers: [BLOCKER, { ...BLOCKER, rule_id: "JK-N01", severity: "info" }],
    });
    expect(out.map((i) => i.rule_id)).toEqual(["JK-B02"]);
  });
});

describe("API-19 payment state comes from the server case (EC-09)", () => {
  it("pending state wins; paid needs the confirmed date", () => {
    expect(paymentStatus({ state: "PAYMENT_PENDING", key_dates: {} })).toBe("pending");
    expect(
      paymentStatus({ state: "LL_TEST", key_dates: { payment_confirmed_on: "2026-10-24" } }),
    ).toBe("paid");
    expect(paymentStatus({ state: "LL_APPLYING", key_dates: {} })).toBe("none");
    expect(paymentStatus(null)).toBe("none");
  });

  it("reads the gateway's return hint and rejects a forged ref", () => {
    expect(paymentReturn("?payment=success&ref=pay_01JB8ZH")).toEqual({
      hint: "success",
      ref: "pay_01JB8ZH",
    });
    expect(paymentReturn("?payment=pending&ref=<script>")).toEqual({ hint: "pending", ref: null });
    expect(paymentReturn("?payment=hacked")).toBeNull();
  });
});

describe("API-71 stats: counts under 5 are suppressed", () => {
  it("suppresses small counts and medians with too few participants", () => {
    const cells = statCells({
      as_of: "2026-10-24T10:00:00Z",
      counters: { plans_computed: 311, cases_started: 4, lab_trials_recorded: 5 },
      journey_test: {
        participants: 3,
        median_seconds_find_fee_docs: { portal_replica: 412, margdarshak: "suppressed (n < 5)" },
      },
      nazar: { participants: 0 },
    });
    const by = Object.fromEntries(cells.map((c) => [c.id, c]));
    expect(by["plans_computed"]).toMatchObject({ value: 311, suppressed: false });
    expect(by["cases_started"]).toMatchObject({ value: null, suppressed: true });
    expect(by["lab_trials_recorded"]).toMatchObject({ value: K_MIN, suppressed: false });
    expect(by["journey_participants"]?.suppressed).toBe(true);
    expect(by["median_portal"]?.suppressed).toBe(true);
    expect(by["median_margdarshak"]?.suppressed).toBe(true);
  });

  it("shows a median once its sample reaches 5", () => {
    const cells = statCells({
      as_of: "2026-10-24T10:00:00Z",
      journey_test: { participants: 6, median_seconds_find_fee_docs: { portal: 411.6 } },
    });
    expect(cells.find((c) => c.id === "median_portal")).toMatchObject({ value: 412 });
  });
});

describe("API-63 analytics queue", () => {
  function deps(over: Partial<AnalyticsDeps> = {}) {
    const sent: Array<{ events: unknown[]; caseId?: string }> = [];
    const timers: Array<() => void> = [];
    const d: AnalyticsDeps = {
      enabled: () => true,
      consent: () => true,
      refreshConsent: async () => true,
      activeCase: () => ({ caseId: "cas_ADULT1", minor: false }),
      send: async (events, caseId) => {
        sent.push({ events, ...(caseId ? { caseId } : {}) });
        return true;
      },
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      cancel: () => undefined,
      ...over,
    };
    return {
      d,
      sent,
      fire: () => {
        for (const f of timers.splice(0)) f();
      },
    };
  }

  it("allowlist only: unknown events, unknown props and free text are dropped", () => {
    expect(sanitize("plan_viewed", { classes_count: 2 })).toMatchObject({ name: "plan_viewed" });
    expect(sanitize("page_scrolled")).toBeNull();
    expect(sanitize("plan_viewed", { email: "a@b.in" })).toBeNull();
    expect(sanitize("blocker_shown", { rule_id: "JK B02 has spaces" })).toBeNull();
    expect(sanitize("consent_changed", { purpose: "9876543210", action: "grant" })).toBeNull();
    expect(sanitize("handoff_opened", { mode: "C" })).toBeNull();
  });

  it("batches, sends with the case id, and only with consent", async () => {
    const { d, sent, fire } = deps();
    const a = createAnalytics(d);
    expect(a.track("check_answers_viewed")).toBe(true);
    expect(a.track("handoff_opened", { mode: "A" })).toBe(true);
    expect(sent).toHaveLength(0);
    fire();
    await a.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.events).toHaveLength(2);
    expect(sent[0]?.caseId).toBe("cas_ADULT1");
  });

  it("sends nothing without the analytics consent", async () => {
    const { d, sent } = deps({ consent: () => false });
    const a = createAnalytics(d);
    expect(a.track("check_answers_viewed")).toBe(false);
    await a.flush();
    expect(sent).toHaveLength(0);

    const unknown = deps({ consent: () => null, refreshConsent: async () => false });
    const b = createAnalytics(unknown.d);
    b.track("check_answers_viewed");
    await b.flush();
    expect(unknown.sent).toHaveLength(0);
  });

  it("never queues anything about a minor family member's case (D-13 revised)", async () => {
    const { d, sent } = deps({ activeCase: () => ({ caseId: "cas_MINOR1", minor: true }) });
    const a = createAnalytics(d);
    expect(a.track("check_answers_viewed")).toBe(false);
    await a.flush();
    expect(sent).toHaveLength(0);
    expect(a.pending()).toBe(0);
  });

  it("drops a failed batch (no retry, nothing kept)", async () => {
    let calls = 0;
    const { d } = deps({
      send: async () => {
        calls++;
        return false;
      },
    });
    const a = createAnalytics(d);
    for (let i = 0; i < BATCH + 3; i++) a.track("check_answers_viewed");
    await a.flush();
    // One request per batch (20, then 3); each failed batch is dropped, never re-sent.
    expect(calls).toBe(2);
    expect(a.pending()).toBe(0);
    await a.flush();
    expect(calls).toBe(2);
  });
});

// ---------- client calls against a fake API (real mode) ----------

type Handler = (req: Request) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
  });
}

describe("real-mode client calls", () => {
  const seen: Request[] = [];
  let routes: Record<string, Handler> = {};
  let api: typeof import("./api");

  beforeEach(async () => {
    seen.length = 0;
    routes = {
      "GET /v1/me": () => json(200, { subject: "dev_1", scope: "anon", user_band: "unknown" }),
    };
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request) => {
        const req = input instanceof Request ? input : new Request(input);
        seen.push(req.clone());
        const u = new URL(req.url);
        const h = routes[`${req.method} ${u.pathname}`];
        return h ? h(req) : json(404, { title: "Not found", status: 404, code: "NOT_FOUND" });
      }),
    );
    vi.resetModules();
    api = await import("./api");
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const last = (method: string, path: string) =>
    [...seen].reverse().find((r) => r.method === method && new URL(r.url).pathname === path);

  it("API-13: reads the server's blockers for a server case", async () => {
    routes["GET /v1/cases/cas_01JB8ZC/blockers"] = () =>
      json(200, {
        case_id: "cas_01JB8ZC",
        rule_pack_version: "2026.10.0",
        status: "has_blockers",
        blockers: [BLOCKER],
      });
    expect(api.API_MODE).toBe("real");
    const r = await api.serverBlockers("cas_01JB8ZC");
    expect(r?.blockers[0]?.rule_id).toBe("JK-B02");
    // Unreachable or not found: null, the caller falls back to the device engine.
    expect(await api.serverBlockers("cas_GONE00")).toBeNull();
  });

  it("API-06: a failed device session is retried on the next call (no reload needed)", async () => {
    let attempts = 0;
    routes["GET /v1/me"] = () => json(401, { title: "Unauthorised", status: 401, code: "AUTH" });
    routes["POST /v1/sessions/device"] = () =>
      ++attempts === 1
        ? json(429, { title: "Too many requests", status: 429, code: "RATE_LIMITED" })
        : json(201, { scope: "anon" });
    routes["GET /v1/cases/cas_01JB8ZC/blockers"] = () =>
      json(200, { case_id: "cas_01JB8ZC", status: "clear", blockers: [] });
    await api.serverBlockers("cas_01JB8ZC");
    await api.serverBlockers("cas_01JB8ZC");
    await api.serverBlockers("cas_01JB8ZC");
    // Refused once, created on the retry, then kept.
    expect(attempts).toBe(2);
  });

  it("API-19: creates an intent for the case's quote; 409 PAYMENT_PENDING is 'pending'", async () => {
    routes["POST /v1/cases/cas_01JB8ZC/payment-intents"] = () =>
      json(201, {
        payment_intent_id: "pay_01JB8ZH",
        adapter: "mock",
        redirect_url: "http://api.test/mock/payment/pay_01JB8ZH?return=x",
        amount_paise: 95000,
        collected_by: "state_gateway",
        status: "redirected",
      });
    const r = await api.startPayment("cas_01JB8ZC", "qte_01JB8ZD", "/en/apply/fee", "ll");
    expect(r.kind).toBe("redirect");
    const req = last("POST", "/v1/cases/cas_01JB8ZC/payment-intents");
    expect(await req?.json()).toEqual({
      quote_id: "qte_01JB8ZD",
      return_path: "/en/apply/fee",
      stage: "ll",
    });
    expect(req?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(req?.headers.get("X-Requested-With")).toBe("margdarshak");

    routes["POST /v1/cases/cas_01JB8ZC/payment-intents"] = () =>
      json(409, {
        type: "https://margdarshak.example/problems/conflict",
        title: "Conflict",
        status: 409,
        code: "PAYMENT_PENDING",
      });
    expect(await api.startPayment("cas_01JB8ZC", "qte_01JB8ZD", "/en/apply/fee")).toEqual({
      kind: "pending",
    });
    routes["POST /v1/cases/cas_01JB8ZC/payment-intents"] = () =>
      json(409, { title: "Conflict", status: 409, code: "QUOTE_STALE" });
    expect((await api.startPayment("cas_01JB8ZC", "qte_01JB8ZD", "/en/apply/fee")).kind).toBe(
      "stale",
    );
  });

  it("API-63: posts one allowlisted batch with the case id", async () => {
    routes["POST /v1/events/analytics"] = () => new Response(null, { status: 202 });
    const ok = await api.sendAnalytics(
      [{ name: "check_answers_viewed", at: "2026-10-24T10:00:00Z" }],
      "cas_01JB8ZC",
    );
    expect(ok).toBe(true);
    const body = await last("POST", "/v1/events/analytics")?.json();
    expect(body).toEqual({
      events: [{ name: "check_answers_viewed", at: "2026-10-24T10:00:00Z" }],
      case_id: "cas_01JB8ZC",
    });
    routes["POST /v1/events/analytics"] = () => json(503, { title: "Down", status: 503 });
    expect(await api.sendAnalytics([{ name: "x_y_z", at: "2026-10-24T10:00:00Z" }])).toBe(false);
  });

  it("API-60: reading the consents records whether analytics is granted", async () => {
    routes["GET /v1/me/consents"] = () =>
      json(200, { items: [{ consent_id: "cns_1", purpose: "analytics", status: "active" }] });
    await api.listConsents();
    expect(JSON.parse(localStorage.getItem("md.analytics.consent.v1") ?? "null")).toBe(true);
  });

  it("API-71: public stats without a session", async () => {
    routes["GET /v1/stats/public"] = () =>
      json(200, { as_of: "2026-10-24T10:00:00Z", counters: { plans_computed: 12 } });
    const s = await api.publicStats();
    expect(s?.counters?.["plans_computed"]).toBe(12);
    expect(seen.some((r) => new URL(r.url).pathname === "/v1/sessions/device")).toBe(false);
  });

  it("API-07/08: e-mail link, then the code upgrades the session", async () => {
    routes["POST /v1/auth/magic-link"] = () => json(202, { status: "accepted" });
    routes["POST /v1/auth/token"] = async (req) => {
      const b = (await req.json()) as { grant_type: string; code: string };
      return b.code === "ml_good"
        ? json(200, { scope: "user", subject: "usr_1", expires_at: "2027-01-01T00:00:00Z" })
        : json(401, { title: "Unauthorized", status: 401, code: "UNAUTHENTICATED" });
    };
    expect(await api.requestSignInLink("parent@example.com")).toEqual({ simulatedCode: null });
    expect(await last("POST", "/v1/auth/magic-link")?.json()).toEqual({
      email: "parent@example.com",
      language: "en",
    });
    await api.signInWithCode("ml_good");
    expect(await last("POST", "/v1/auth/token")?.json()).toEqual({
      grant_type: "magic_link",
      code: "ml_good",
    });
    await expect(api.signInWithCode("ml_bad")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect((await api.whoAmI()).signedIn).toBe(false);
    routes["GET /v1/me"] = () => json(200, { subject: "usr_1", scope: "user", user_band: "adult" });
    expect((await api.whoAmI()).signedIn).toBe(true);
  });
});

describe("mock mode sign-in (no e-mail server: the link is shown, labelled simulated)", () => {
  it("issues a single-use code and signs in with it", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.resetModules();
    const api = await import("./api");
    localStorage.clear();
    expect(api.API_MODE).toBe("mock");
    expect((await api.whoAmI()).signedIn).toBe(false);
    const { simulatedCode } = await api.requestSignInLink("parent@example.com");
    expect(simulatedCode).toMatch(/^ml_/);
    await expect(api.signInWithCode("ml_wrong")).rejects.toMatchObject({ status: 401 });
    await api.signInWithCode(simulatedCode as string);
    expect((await api.whoAmI()).signedIn).toBe(true);
    await expect(api.signInWithCode(simulatedCode as string)).rejects.toMatchObject({
      status: 401,
    });
    await api.signOut();
    expect((await api.whoAmI()).signedIn).toBe(false);
    vi.unstubAllEnvs();
  });
});

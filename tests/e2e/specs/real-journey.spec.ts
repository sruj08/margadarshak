import { existsSync, readFileSync } from "node:fs";
import { type Cookie, expect, type Page, test } from "@playwright/test";
import { REAL } from "../real-env.mjs";
import { onboard } from "./helpers";
import { answer, cardFacts, loadPersona, makePlan } from "./journey-helpers";
import {
  activeCase,
  apiCall,
  expectApi,
  internalCall,
  istDate,
  type Json,
  loggedEnvelopes,
  serverNow,
  useServerClock,
} from "./real-helpers";

/**
 * P1 on the full stack (E2E_MODE=real): apps/web built with NEXT_PUBLIC_API_URL against the Go API
 * on embedded PostgreSQL with the synthetic seed personas. Every step asserts that the server
 * answered (no silent fall-back to the on-device mock): plan from API-01, case from API-10,
 * persona sessions from /v1/demo/personas, the W02 envelope from the case-clock sweep.
 */
/**
 * The API allows 10 anonymous device sessions per hour per IP (API-06, createDeviceSession). The
 * suite has more tests than that, so an anonymous device session that is still valid after a test
 * is carried into the next one (cookie only; each test still starts with an empty phone). Persona
 * and signed-in sessions are never carried over.
 */
let sharedDevice: Cookie | null = null;

test.beforeEach(async ({ context, baseURL, page }) => {
  await onboard(context, baseURL ?? "", "en");
  if (sharedDevice) await context.addCookies([sharedDevice]);
  await useServerClock(page);
});

test.afterEach(async ({ context, page }) => {
  const sid = (await context.cookies(REAL.apiUrl)).find((c) => c.name === "md_sid");
  if (!sid) return;
  const me = await apiCall(page, "GET", "/v1/me").catch(() => null);
  if (me?.status === 200 && me.json?.scope === "anon") sharedDevice = sid;
  else if (sharedDevice?.value === sid.value) sharedDevice = null;
});

/** Plan card from API-01 (201), saved with a server plan ID; never "computed on your phone". */
async function serverPlan(page: Page, opts: Parameters<typeof makePlan>[1]) {
  const res = await expectApi(page, "POST", "/v1/plans", () => makePlan(page, opts));
  expect(res.status, "API-01").toBe(201);
  expect(res.json.plan_id).toMatch(/^pln_/);
  await expect(page.getByTestId("plan-saved")).toBeVisible();
  await expect(page.getByTestId("computed-on-phone")).toHaveCount(0);
  return res.json;
}

async function startFromPlan(page: Page) {
  await page.getByTestId("start-application").click();
  await expect(page.locator("[data-screen='SCR-018']")).toBeVisible();
  const res = await expectApi(page, "POST", "/v1/cases", () =>
    page.getByTestId("start-case").click(),
  );
  expect(res.status, "API-10").toBe(201);
  await expect(page).toHaveURL(/\/apply\/q\/for_whom/);
  const active = await activeCase(page);
  expect(active?.caseId).toBe(res.json.case_id);
  expect(active?.local).toBe(false);
  return res.json.case_id as string;
}

async function nextTask(page: Page) {
  await expect(page.locator("[data-screen='SCR-030']")).toBeVisible();
  await page.getByTestId("continue-task").click();
}

/** Loads a persona through the API (POST /v1/demo/personas/{id}/session). */
async function serverPersona(page: Page, name: string, personaId: string) {
  const res = await expectApi(page, "POST", `/v1/demo/personas/${personaId}/session`, () =>
    loadPersona(page, name),
  );
  expect(res.status, "persona session").toBe(201);
  expect(res.json.scope).toBe("user");
  // The switcher finishes asynchronously (GET /v1/me/licences, GET /v1/cases/{id}, API-01): wait
  // for the server persona's case to become the active one (never a device "cas_demo_*" stand-in).
  await expect
    .poll(async () => (await activeCase(page))?.persona ?? null, { timeout: 10_000 })
    .toBe(personaId);
  const active = await activeCase(page);
  expect(active?.caseId).toMatch(/^cas_[0-9A-Z]{6,26}$/);
  return active;
}

test("P1 demo checkpoint: Kabir plan -> application -> hand-off -> LL day 0 -> LL day 31 -> sweep sends W02", async ({
  page,
}) => {
  // The longest flow, and the first test on a cold API and database: ~28 s cold, ~11 s warm.
  test.slow();
  // Home -> plan in 3 taps (API-01).
  await page.goto("/en");
  await expect(page.getByTestId("verb-tiles").getByRole("link")).toHaveCount(4);
  const plan = await serverPlan(page, {
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/, /^Car/],
    aadhaar: "Yes",
  });
  expect(plan.fees.total_paise).toBe(135000);
  const facts = await cardFacts(page);
  expect(facts.classes).toEqual(["MCWG", "LMV-NT"]);
  expect(facts.fee).toMatch(/1,350/);

  // "Start my application" -> case on the server (API-10), answers autosaved (API-12).
  const caseId = await startFromPlan(page);
  const questions = new Set<string>(["for_whom"]);
  page.on("framenavigated", (f) => {
    const m = /\/apply\/q\/([a-z_0-9]+)/.exec(f.url());
    if (m?.[1]) questions.add(m[1]);
  });
  await answer(page, "Me");
  await answer(page, "General");
  await nextTask(page);
  await answer(page, "No licence yet");
  await nextTask(page);
  await answer(page, "Yes"); // mobile linked
  await answer(page, "Yes"); // relation line on Aadhaar
  await nextTask(page);
  await page.getByRole("checkbox", { name: "I've read what Form 1 covers" }).check({ force: true });
  await page.getByTestId("q-continue").click();
  await nextTask(page);
  await expect(page.locator("[data-screen='SCR-034']")).toBeVisible();
  await page.getByTestId("fix-signature").click();
  await page.getByTestId("sign-later").click();
  await page.getByRole("link", { name: "Back to the task list" }).last().click();
  expect([...questions].length, [...questions].join(", ")).toBeLessThanOrEqual(6);

  await expect
    .poll(async () => (await apiCall(page, "GET", `/v1/cases/${caseId}`)).json.answers?.category)
    .toBe("general");

  // Check answers -> fee -> hand-off with the Simulated chip.
  await nextTask(page);
  await expect(page.locator("[data-screen='SCR-038']")).toBeVisible();
  await page.getByRole("checkbox", { name: /checked these answers/ }).check({ force: true });
  await page.getByTestId("check-continue").click();
  await expect(page.locator("[data-screen='SCR-039']")).toBeVisible();
  await expect(page.getByTestId("fee-now")).toHaveText(/950/);
  await page.getByTestId("fee-continue").click();
  await expect(page.locator("[data-screen='SCR-040']")).toBeVisible();
  await expect(page.getByTestId("simulated-chip")).toBeVisible();
  await expect(page.getByTestId("open-sarathi")).toHaveAttribute(
    "href",
    /sarathi\.parivahan\.gov\.in/,
  );
  const pack = await expectApi(page, "GET", `/v1/cases/${caseId}/handoff`, () =>
    page.getByTestId("open-pack").click(),
  );
  expect(pack.status, "API-16").toBe(200);
  expect(JSON.stringify(pack.json)).not.toMatch(/aadhaar_number|"otp"/i);
  await expect(page.locator("[data-screen='SCR-041']")).toBeVisible();

  // Back from Sarathi with an application number -> LL test next (server state).
  await page.goto("/en/apply/handoff/return");
  await page
    .getByRole("radio", { name: "Paid and got an application number" })
    .check({ force: true });
  await page.getByTestId("return-continue").click();
  await expect(page).toHaveURL(/application-number/);
  await page.getByLabel("Application number").fill("2026001234");
  await page.getByTestId("app-number-save").click();
  await expect(page.getByTestId("stage-h1")).toHaveText("Your LL test is next.");
  expect((await apiCall(page, "GET", `/v1/cases/${caseId}`)).json.state).toBe("LL_TEST");

  // LL issued today -> home shows LL day 0 (the 30-day wait starts; API-15).
  await page.goto("/en/licence");
  await page.getByTestId("update-step").click();
  await page.getByRole("radio", { name: "My learner's licence was issued" }).check({ force: true });
  const ev = await expectApi(page, "POST", `/v1/cases/${caseId}/events`, () =>
    page.getByTestId("record-event").click(),
  );
  expect(ev.status, "API-15").toBe(201);
  await expect(page.getByText("Saved. Your road is updated.")).toBeVisible();
  await page.goto("/en");
  await expect(page.getByTestId("stage-home")).toHaveAttribute("data-stage", "BRIDGE");
  await expect(page.getByTestId("stage-h1")).toHaveText("Driving test unlocks in 30 days.");

  // Switch persona to Kabir on LL day 31 -> "Book your driving test".
  const day31 = await serverPersona(page, "Kabir, LL day 31", "kabir_day31");
  await expect(page.getByTestId("stage-home")).toHaveAttribute("data-stage", "DL_BOOKABLE");
  await expect(page.getByTestId("stage-h1")).toHaveText("You can book your driving test now.");
  await page.getByTestId("stage-primary").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book your driving test");
  const caseDay31 = day31?.caseId as string;

  // He books a slot for tomorrow on Sarathi and turns on WhatsApp updates (API-04 records the
  // whatsapp_updates consent and sends the plan card: the first W02 envelope).
  const now = await serverNow(page.request);
  const slot = await apiCall(page, "POST", `/v1/cases/${caseDay31}/events`, {
    type: "slot_booked",
    occurred_on: istDate(now),
    payload: { slot_date: istDate(now, 1) },
  });
  expect(slot.status).toBe(201);
  const p = await apiCall(page, "POST", "/v1/plans", {
    state: "JK",
    dob: "2007-06-15",
    dob_precision: "day",
    vehicles: ["bike_gear"],
  });
  const before = loggedEnvelopes().length;
  const wa = await apiCall(page, "POST", `/v1/plans/${p.json.plan_id}/whatsapp`, {
    phone_e164: "+919876500001",
    consent: { purpose: "whatsapp_updates", notice_version: "notice-2026.10.23-en", granted: true },
    language: "en",
  });
  expect(wa.status, "API-04").toBe(202);
  await expect
    .poll(() =>
      loggedEnvelopes()
        .slice(before)
        .map((e) => e.event),
    )
    .toContain("plan_card");

  // W1 -> RW-2: the case-clock sweep (HMAC + bearer) fires TEST_EVE as a W02 envelope.
  const sweep = await internalCall(page.request, "/internal/clock/sweep", {
    sweep_id: `e2e-${Date.now()}`,
    as_of: now.toISOString(),
    tenants: ["JK"],
  });
  expect(sweep.status, "API-65").toBe(202);
  await expect
    .poll(() =>
      loggedEnvelopes()
        .slice(before)
        .filter((e) => e.event === "clock_batch" && e.payload.includes(`${caseDay31}:TEST_EVE`)),
    )
    .toHaveLength(1);
  const tl = await apiCall(page, "GET", `/v1/cases/${caseDay31}/timeline`);
  const eve = (tl.json.items as Array<{ code: string; status: string }>).find(
    (e) => e.code === "TEST_EVE",
  );
  expect(eve?.status).toBe("sent");

  // RW-2 is idempotent: a second sweep the same day sends nothing again (≤ 1 nudge a day).
  const again = await internalCall(page.request, "/internal/clock/sweep", {
    sweep_id: `e2e-again-${Date.now()}`,
    as_of: now.toISOString(),
    tenants: ["JK"],
  });
  expect(again.status).toBe(202);
  await page.waitForTimeout(1000);
  expect(
    loggedEnvelopes()
      .slice(before)
      .filter((e) => e.event === "clock_batch" && e.payload.includes(`${caseDay31}:TEST_EVE`)),
  ).toHaveLength(1);
  // The internal channel refuses an unsigned call.
  const unsigned = await page.request.post(`${REAL.apiUrl}/internal/clock/sweep`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${REAL.internalToken}` },
    data: JSON.stringify({ sweep_id: "x", as_of: now.toISOString() }),
  });
  expect(unsigned.status()).toBe(401);
});

test("Tanvi: both blockers caught before the hand-off, on the plan and on the server case (EC-02, EC-03)", async ({
  page,
}) => {
  const plan = await serverPlan(page, {
    age: { dob: ["07", "07", "2007"] },
    vehicles: [/Scooter, no gears/],
    aadhaar: "No, it's elsewhere",
  });
  const issues = [...plan.blockers, ...plan.warnings, ...plan.notices] as Array<{
    rule_id: string;
  }>;
  expect(issues.map((b) => b.rule_id)).toContain("JK-B02");
  await expect(page.locator("[data-rule='JK-B02']")).toBeVisible();

  const tanvi = await serverPersona(page, "Tanvi, with blockers", "tanvi");
  // API-13: the task list and check answers read the blockers the server evaluated for the stored
  // case (labelled "server"), not the device engine.
  const blockersPath = `/v1/cases/${tanvi?.caseId}/blockers`;
  const blockers = await expectApi(page, "GET", blockersPath, () => page.goto("/en/apply"));
  expect(blockers.status, "API-13").toBe(200);
  const ids = JSON.stringify(blockers.json.blockers);
  expect(ids).toContain("JK-B02");
  expect(ids).toContain("JK-B03");
  const onApply = page.getByTestId("case-issues");
  await expect(onApply.getByTestId("issues-source")).toHaveAttribute("data-source", "server");
  await expect(onApply.locator("[data-rule='JK-B02']")).toBeVisible();
  await expect(onApply.locator("[data-rule='JK-B03']")).toBeVisible();
  const onCheck = await expectApi(page, "GET", blockersPath, () => page.goto("/en/apply/check"));
  expect(onCheck.status).toBe(200);
  const check = page.getByTestId("check-issues");
  await expect(check.getByTestId("issues-source")).toHaveAttribute("data-source", "server");
  await expect(check.locator("[data-rule='JK-B02']")).toBeVisible();
  await expect(check.locator("[data-rule='JK-B03']")).toBeVisible();
});

test("Mohan-ji (52): Form 1A on the server plan; his renewal case is RENEWAL_DUE (P-03)", async ({
  page,
}) => {
  const plan = await serverPlan(page, {
    age: { dob: ["11", "02", "1974"] },
    vehicles: [/^Car/],
    aadhaar: "Yes",
  });
  expect(JSON.stringify(plan.blockers)).toContain("JK-B04");
  await expect(page.locator("[data-rule='JK-B04']")).toContainText("Form 1A");
  await expect(page.getByTestId("plan-doc").filter({ hasText: "Form 1A" }).first()).toBeVisible();

  await serverPersona(page, "Mohan-ji, 52", "mohan");
  await expect(page.getByTestId("stage-home")).toHaveAttribute("data-stage", "RENEWAL_DUE");
  await expect(page.getByTestId("stage-primary")).toHaveText("Plan my renewal");
});

test("Rahul (17) via a parent: family mode with parental consent, no age gate anywhere (D-13 revised)", async ({
  page,
}) => {
  // Anyone can plan for a 16-17-year-old: the server plan says family mode, nothing is refused.
  await page.goto("/en/plan");
  const res = await expectApi(page, "POST", "/v1/plans", async () => {
    await page.getByRole("radio", { name: "16 or 17", exact: true }).check({ force: true });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("checkbox", { name: /Up to 50 cc/ }).check({ force: true });
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("radio", { name: "Yes", exact: true }).check({ force: true });
    await page.getByRole("button", { name: "Show my plan" }).click();
  });
  expect(res.status).toBe(201);
  expect(res.json.family_mode_required).toBe(true);
  await expect(page.getByTestId("plan-card")).toBeVisible();

  // The parent's account (persona): Rahul's case in family mode, every feature reachable.
  const parent = await serverPersona(page, "Rahul, 17", "rahul");
  expect(parent?.memberId).toMatch(/^fam_/);
  await expect(page.getByText("Family mode · Rahul")).toBeVisible();
  await page.goto("/en/privacy");
  await expect(page.getByTestId("consent-ai_coach").getByRole("switch")).toBeEnabled();

  // A second minor: the case waits for the parent's verifiable consent (403), then opens (201).
  const member = await apiCall(page, "POST", "/v1/me/family-members", {
    relation: "child",
    label: "Riya",
    dob: "2009-11-02",
    dob_precision: "day",
  });
  expect(member.status).toBe(201);
  expect(member.json.is_minor).toBe(true);
  expect(member.json.parental_consent.status).toBe("required");
  const create = {
    state: "JK",
    classes: ["MC50CC"],
    for_family_member: true,
    family_member_id: member.json.member_id,
  };
  const refused = await apiCall(page, "POST", "/v1/cases", create);
  expect(refused.status).toBe(403);
  expect(refused.json.code).toBe("PARENT_CONSENT_REQUIRED");
  const consent = await apiCall(
    page,
    "POST",
    `/v1/me/family-members/${member.json.member_id}/parental-consent`,
    { action: "grant", notice_version: "notice-2026.10.23-en", language: "en" },
  );
  expect(consent.status).toBe(201);
  expect(consent.json.parental_consent.status).toBe("granted");
  const opened = await apiCall(page, "POST", "/v1/cases", create);
  expect(opened.status).toBe(201);
  expect(opened.json.family_member_id).toBe(member.json.member_id);
});

test("Privacy: export is the server bundle; delete cancels the scheduled reminders (API-61/62, EC-26)", async ({
  page,
}) => {
  const kabir = await serverPersona(page, "Kabir, LL day 12", "kabir_day12");
  const caseId = kabir?.caseId as string;
  await page.goto("/en/privacy");
  const dl = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const file = await dl;
  const json = JSON.parse(readFileSync((await file.path()) as string, "utf8"));
  expect(json.server.source).toBe("server");
  expect(json.server.data.export_id).toMatch(/^exp_/);
  expect(JSON.stringify(json.server.data.sections)).toContain(caseId);
  expect(JSON.stringify({ s: json.server, p: json.this_phone })).not.toMatch(
    /aadhaar_number|"otp"/i,
  );

  const tl = await apiCall(page, "GET", `/v1/cases/${caseId}/timeline`);
  const scheduled = (tl.json.items as Array<{ status: string }>).filter(
    (e) => e.status === "scheduled",
  ).length;
  expect(scheduled).toBeGreaterThan(0);

  await page.getByTestId("delete-open").click();
  await page.getByTestId("delete-word").fill("DELETE");
  await page.getByTestId("delete-confirm").click();
  await expect(page.getByText("Your account and case are deleted")).toBeVisible();
  await expect(
    page.getByText(new RegExp(`${scheduled} scheduled reminders? (was|were) cancelled`)),
  ).toBeVisible();
  // The session is gone and the case is no longer served.
  const gone = await apiCall(page, "GET", `/v1/cases/${caseId}`);
  expect([401, 403, 404, 410]).toContain(gone.status);
  // The clock sweep has nothing left to send for the deleted case.
  const due = await internalCall(page.request, "/internal/job-steps/clock.plan_pages", {
    run_id: `e2e-${Date.now()}`,
    args: {
      sweep_id: "e2e-delete",
      tenants: ["JK"],
      as_of: istDate(await serverNow(page.request)),
    },
  });
  expect(due.status).toBe(200);
  expect(JSON.stringify(due.json.events)).not.toContain(caseId);
  await page.goto("/en");
  await expect(page.locator("[data-screen='SCR-003']")).toBeVisible();
});

const GOLDEN: Array<{ name: string } & Parameters<typeof makePlan>[1]> = [
  {
    name: "P-01 Kabir bike",
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  },
  {
    name: "P-01 Kabir bike + car",
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/, /^Car/],
    aadhaar: "Yes",
  },
  {
    name: "P-02 Tanvi",
    age: { dob: ["07", "07", "2007"] },
    vehicles: [/Scooter, no gears/],
    aadhaar: "No, it's elsewhere",
  },
  { name: "P-03 Mohan-ji", age: { dob: ["11", "02", "1974"] }, vehicles: [/^Car/], aadhaar: "Yes" },
];

for (const g of GOLDEN) {
  test(`MD-108 offline plan equals the server plan: ${g.name}`, async ({ page, context }) => {
    await serverPlan(page, g);
    const online = await cardFacts(page);
    await page.getByRole("link", { name: "Change my answers" }).click();
    await expect(page.locator("[data-screen='SCR-010']")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("radio", { name: new RegExp(`^${g.aadhaar}`) }).check({ force: true });
    await page.getByRole("button", { name: "Show my plan" }).click();
    await expect(page.getByTestId("computed-on-phone")).toBeVisible();
    const offline = await cardFacts(page);
    await context.setOffline(false);
    expect(offline).toEqual(online);
  });
}

test("Lab trials reach API-70 only with the lab token (X-Lab-Token, MD-140)", async ({
  page,
  request,
}) => {
  // Without X-Lab-Token the route answers 404, like the lab replica itself (a session is needed
  // first: without one every write is 401).
  if ((await apiCall(page, "GET", "/v1/me")).status !== 200) {
    const device = await apiCall(page, "POST", "/v1/sessions/device", {
      device_public_key: "e2e-lab-device-key-0001",
      platform: "pwa",
    });
    expect(device.status).toBe(201);
  }
  const denied = await apiCall(page, "POST", "/v1/lab/trials", {
    participant_code: "P-001",
    arm: "portal_replica",
    task_id: "start_ll_application",
    started_at: new Date(Date.now() - 60_000).toISOString(),
    ended_at: new Date().toISOString(),
    completed: true,
    consent_id: "cns_0000000000",
  });
  expect(denied.status).toBe(404);
  await page.goto(`/en/lab/sarathi-sequence?token=${REAL.labToken}`);
  await page.getByTestId("lab-start").click();
  const replica = page.getByTestId("replica");
  await replica.getByRole("combobox", { name: "State Name" }).selectOption("Jammu and Kashmir");
  await replica.getByRole("button", { name: "ISSUE OF LEARNERS LICENCE" }).click();
  await page.getByTestId("lab-stop").click();
  const res = await expectApi(page, "POST", "/v1/lab/trials", () =>
    page.getByTestId("lab-send").click(),
  );
  expect(res.status, "API-70").toBe(201);
  expect(res.json.trial_id).toBeTruthy();
  expect(res.json.consent_id).toMatch(/^cns_/);
  await expect(page.getByText("1 trial sent")).toBeVisible();
  const stats = await request.get(`${REAL.apiUrl}/v1/stats/public`, {
    headers: { "X-Tenant": "JK" },
  });
  expect(stats.status(), "API-71").toBe(200);
});

// ---------- P1 gap closing: API-19, API-63, API-07/08 family mode, API-71 ----------

const KABIR_BIKE: Parameters<typeof makePlan>[1] = {
  age: { dob: ["14", "03", "2007"] },
  vehicles: [/Bike with gears/],
  aadhaar: "Yes",
};

/** Pays on the API's simulated gateway page (/mock/payment/{intent}) and comes back to the fee. */
async function payOnGateway(page: Page, caseId: string, outcome: RegExp) {
  await page.goto("/en/apply/fee");
  await expect(page.getByTestId("pay-online")).toBeVisible();
  // The page leaves for the gateway as soon as API-19 answers, so read the answer on the way through.
  const intentUrl = `${REAL.apiUrl}/v1/cases/${caseId}/payment-intents`;
  const intent: { status: number; json: Json } = { status: 0, json: null };
  await page.route(intentUrl, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const res = await route.fetch();
    intent.status = res.status();
    intent.json = await res.json();
    await route.fulfill({ response: res, json: intent.json });
  });
  await page.getByTestId("pay-intent").click();
  await page.waitForURL(/\/mock\/payment\/pay_/);
  await page.unroute(intentUrl);
  expect(intent.status, "API-19").toBe(201);
  expect(intent.json.payment_intent_id).toMatch(/^pay_/);
  expect(intent.json.collected_by).toBe("state_gateway");
  expect(intent.json.adapter).toBe("mock");
  await expect(page.getByRole("heading", { name: "Simulated payment page" })).toBeVisible();
  await page.getByRole("button", { name: outcome }).click();
  await page.waitForURL(/\/en\/apply\/fee\?payment=/);
  return intent.json as { payment_intent_id: string; amount_paise: number };
}

test("API-19: payment intent -> simulated gateway -> signed callback -> paid; EC-09 pending blocks a second intent", async ({
  page,
}) => {
  await serverPlan(page, KABIR_BIKE);
  const caseId = await startFromPlan(page);
  const before = await apiCall(page, "GET", `/v1/cases/${caseId}`);
  expect(before.json.fees?.quote_id, "the case carries a stored fee quote").toMatch(/^(fq|qte)_/);
  const paid = await payOnGateway(page, caseId, /Pay \(success\)/);
  // The LL-stage amount comes from the case's quote (fees.json), never a literal.
  expect(paid.amount_paise).toBe(before.json.fees.ll_stage_paise);
  await expect(page.getByTestId("payment-paid")).toBeVisible();
  const after = await apiCall(page, "GET", `/v1/cases/${caseId}`);
  expect(after.json.state, "API-24 callback moved the case").toBe("LL_TEST");
  expect(after.json.key_dates.payment_confirmed_on).toBeTruthy();
  await expect(page.getByTestId("pay-intent")).toHaveCount(0);

  // EC-09: a new application (another class: one open case per class, CASE_EXISTS); the gateway
  // says "debited but pending".
  await serverPlan(page, { ...KABIR_BIKE, vehicles: [/Scooter, no gears/] });
  const second = await startFromPlan(page);
  await payOnGateway(page, second, /Debited but pending/);
  await expect(page.getByTestId("payment-pending")).toBeVisible();
  const pending = await apiCall(page, "GET", `/v1/cases/${second}`);
  expect(pending.json.state).toBe("PAYMENT_PENDING");
  // No second intent while one is pending: 409 PAYMENT_PENDING, and the UI offers no pay button.
  const again = await apiCall(page, "POST", `/v1/cases/${second}/payment-intents`, {
    quote_id: pending.json.fees.quote_id,
    return_path: "/en/apply/fee",
    stage: "ll",
  });
  expect(again.status).toBe(409);
  expect(again.json.code).toBe("PAYMENT_PENDING");
  await page.goto("/en/apply/fee");
  await expect(page.getByTestId("payment-pending")).toBeVisible();
  await expect(page.getByTestId("pay-intent")).toHaveCount(0);
  await page.getByRole("link", { name: "What to do while it's pending" }).first().click();
  await expect(page.locator("[data-screen='SCR-043']")).toBeVisible();
});

/** Collects every API-63 batch the browser sends. */
function analyticsBatches(page: Page) {
  const batches: Json[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url() === `${REAL.apiUrl}/v1/events/analytics`)
      batches.push(JSON.parse(r.postData() ?? "{}"));
  });
  return batches;
}

test("API-63: analytics are sent only with the analytics consent, allowlisted and PII-free", async ({
  page,
}) => {
  const batches = analyticsBatches(page);
  // No consent yet: the plan card's plan_viewed is dropped on the phone.
  await serverPlan(page, KABIR_BIKE);
  await page.waitForTimeout(3500);
  expect(batches).toHaveLength(0);

  // Granting the consent (API-60) lets events through, in a batch with only allowlisted fields.
  await page.goto("/en/privacy");
  const sw = page.getByTestId("consent-analytics").getByRole("switch");
  await expect(sw).toBeEnabled();
  const sent = page.waitForResponse(
    (r) => r.url() === `${REAL.apiUrl}/v1/events/analytics` && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  // The switch follows the server artefact, so it flips once API-60 has answered.
  await sw.click({ force: true });
  expect((await sent).status(), "API-63").toBe(202);
  const names = batches.flatMap((b) => (b.events as Array<{ name: string }>).map((e) => e.name));
  expect(names).toContain("consent_changed");
  const raw = JSON.stringify(batches);
  expect(raw).not.toMatch(/@|\d{10}|dob|aadhaar_number|"otp"/i);
  for (const b of batches)
    for (const e of b.events as Array<Record<string, unknown>>)
      expect(Object.keys(e).sort()).toEqual(
        Object.keys(e)
          .filter((k) => ["at", "name", "props"].includes(k))
          .sort(),
      );

  // Revoked: nothing more is sent.
  await sw.click({ force: true });
  await expect(sw).not.toBeChecked();
  const count = batches.length;
  await serverPlan(page, KABIR_BIKE);
  await page.waitForTimeout(3500);
  expect(batches.length).toBe(count);
});

/** The magic links the dev API printed (console notifier, N8N/SMTP unset), oldest first. */
function loggedMagicLinks(): Array<{ link: string; code: string }> {
  if (!existsSync(REAL.apiLog)) return [];
  const out: Array<{ link: string; code: string }> = [];
  for (const line of readFileSync(REAL.apiLog, "utf8").split("\n")) {
    if (!line.includes("console notification (dev only)") || !line.includes("auth.magic_link"))
      continue;
    try {
      const body = String((JSON.parse(line) as { body?: string }).body ?? "");
      const m = /(\S+\/auth\/magic\?code=(ml_[A-Za-z0-9_-]+))/.exec(body);
      if (m?.[1] && m[2]) out.push({ link: m[1], code: m[2] });
    } catch {
      // not a JSON log line
    }
  }
  return out;
}

test("Family mode: sign in (API-07/08) -> device case merged -> add a member -> parental consent -> the minor's case, AI reachable, no analytics", async ({
  page,
}) => {
  const batches = analyticsBatches(page);
  // An anonymous device plans for a 16-17-year-old and starts the application.
  await page.goto("/en/plan");
  await page.getByRole("radio", { name: "16 or 17", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: /Up to 50 cc/ }).check({ force: true });
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("radio", { name: "Yes", exact: true }).check({ force: true });
  const plan = await expectApi(page, "POST", "/v1/plans", () =>
    page.getByRole("button", { name: "Show my plan" }).click(),
  );
  expect(plan.json.family_mode_required).toBe(true);
  const deviceCase = await startFromPlan(page);
  expect((await apiCall(page, "GET", "/v1/me")).json.scope).toBe("anon");
  await answer(page, "Someone in my family");
  await answer(page, "My child");

  // Adding a family member needs a signed-in adult account holder.
  await expect(page.getByTestId("family-signin-gate")).toBeVisible();
  await page.getByTestId("family-signin").click();
  await expect(page.locator("[data-screen='SCR-155']")).toBeVisible();
  const email = `parent.${Date.now()}@example.com`;
  await page.getByTestId("signin-email").fill(email);
  const known = loggedMagicLinks().length;
  const link = await expectApi(page, "POST", "/v1/auth/magic-link", () =>
    page.getByTestId("signin-send").click(),
  );
  expect(link.status, "API-07").toBe(202);
  await expect(page.getByTestId("signin-sent")).toBeVisible();
  // The dev API prints the link (console notifier). The log redactor can mask a code whose digits
  // look like an OTP near the word "code"; ask again in that rare case.
  let magic = "";
  for (let attempt = 0; attempt < 3 && !magic; attempt++) {
    if (attempt > 0) {
      const re = await apiCall(page, "POST", "/v1/auth/magic-link", { email, language: "en" });
      expect(re.status).toBe(202);
    }
    await expect.poll(() => loggedMagicLinks().length, { timeout: 10_000 }).toBeGreaterThan(known);
    const latest = loggedMagicLinks().at(-1);
    if (latest && /^ml_[A-Za-z0-9_-]{32}$/.test(latest.code)) magic = latest.link;
  }
  expect(magic, "magic link in the API log").not.toBe("");
  // Follow the link exactly as e-mailed: WEB_BASE_URL/auth/magic?code=… -> /en/signin?code=….
  expect(magic.startsWith(`${REAL.webUrl}/auth/magic?code=ml_`), magic).toBe(true);
  const token = await expectApi(page, "POST", "/v1/auth/token", () => page.goto(magic));
  expect(token.status, "API-08").toBe(200);
  expect(token.json.scope).toBe("user");
  await expect(page).toHaveURL(/\/apply\/q\/parental_consent/);
  // The device's case moved into the account (the server merges on sign-in).
  expect((await apiCall(page, "GET", "/v1/me")).json.scope).toBe("user");
  expect((await apiCall(page, "GET", `/v1/cases/${deviceCase}`)).status).toBe(200);

  // Parental consent -> member (API-59) -> consent artefact (API-60) -> the member's case (API-10).
  await page.getByRole("checkbox", { name: /I'm 18 or over, and I agree/ }).check({ force: true });
  const member = page.waitForResponse(
    (r) => r.url() === `${REAL.apiUrl}/v1/me/family-members` && r.request().method() === "POST",
  );
  const consent = page.waitForResponse(
    (r) => /\/parental-consent$/.test(r.url()) && r.request().method() === "POST",
  );
  const opened = page.waitForResponse(
    (r) => r.url() === `${REAL.apiUrl}/v1/cases` && r.request().method() === "POST",
  );
  await page.getByTestId("q-continue").click();
  const m = await member;
  expect(m.status(), "API-59 add member").toBe(201);
  const memberJson = (await m.json()) as Json;
  expect(memberJson.is_minor).toBe(true);
  expect((await consent).status(), "API-60 parental consent").toBe(201);
  const o = await opened;
  expect(o.status(), "API-10 member case").toBe(201);
  const memberCase = ((await o.json()) as Json).case_id as string;
  await expect(page).toHaveURL(/\/apply\/q\/category/);
  await expect
    .poll(async () => (await activeCase(page))?.caseId, { timeout: 10_000 })
    .toBe(memberCase);
  const active = await activeCase(page);
  expect(active?.memberId).toBe(memberJson.member_id);
  const c = await apiCall(page, "GET", `/v1/cases/${memberCase}`);
  expect(c.json.family_member_id).toBe(memberJson.member_id);
  expect(c.json.for_family_member).toBe(true);
  // The stand-in case is gone: one application, one case.
  expect([403, 404, 410]).toContain((await apiCall(page, "GET", `/v1/cases/${deviceCase}`)).status);

  // The minor's plan and application, every feature reachable (no age gate).
  await page.goto("/en/apply");
  await expect(page.getByText(/Family mode/).first()).toBeVisible();
  await page.goto("/en");
  await expect(page.getByTestId("stage-home")).toBeVisible();
  await page.goto("/en/privacy");
  await expect(page.getByTestId("account")).toContainText("You're signed in");
  const ai = page.getByTestId("consent-ai_coach").getByRole("switch");
  await expect(ai).toBeEnabled();

  // Analytics never about a minor family member's case, even with the consent granted.
  const sw = page.getByTestId("consent-analytics").getByRole("switch");
  // The switch follows the server artefact, so it flips once API-60 has answered.
  await sw.click({ force: true });
  await expect(sw).toBeChecked();
  await page.goto("/en/apply/check");
  await page.waitForTimeout(3500);
  expect(batches).toHaveLength(0);
});

test("API-71: public counters for judges, n < 5 suppressed (services card and lab page)", async ({
  page,
  request,
}) => {
  const res = await request.get(`${REAL.apiUrl}/v1/stats/public`);
  expect(res.status(), "API-71").toBe(200);
  const stats = (await res.json()) as Json;
  const expectCell = async (scope: ReturnType<Page["getByTestId"]>, id: string, n: number) => {
    const cell = scope.getByTestId(`stat-${id}`);
    await expect(cell).toBeVisible();
    if (n < 5) await expect(cell).toContainText("fewer than 5");
    else await expect(cell).toContainText(new Intl.NumberFormat("en-IN").format(n));
  };

  await page.goto("/en/services");
  const card = page.getByTestId("public-stats-card");
  await expect(card).toHaveAttribute("data-source", "server");
  await expect(card.getByRole("heading", { name: "Field study so far" })).toBeVisible();
  await expectCell(card, "plans_computed", stats.counters.plans_computed);
  await expectCell(card, "cases_started", stats.counters.cases_started);
  await expectCell(card, "journey_participants", stats.journey_test.participants);

  await page.goto(`/en/lab/sarathi-sequence?token=${REAL.labToken}`);
  const lab = page.getByTestId("public-stats-lab");
  await expect(lab).toHaveAttribute("data-source", "server");
  await expectCell(lab, "lab_trials_recorded", stats.counters.lab_trials_recorded);
  await expectCell(lab, "journey_participants", stats.journey_test.participants);
  if (stats.journey_test.participants < 5)
    await expect(lab.getByTestId("stat-median_margdarshak")).toContainText("fewer than 5");
});

test("API-10 409 CASE_EXISTS: the phone forgot its case, so starting again reopens the open case", async ({
  context,
  page,
}) => {
  // A fresh device, so the account holds exactly the one case this test opens.
  await context.clearCookies({ name: "md_sid" });
  await serverPlan(page, KABIR_BIKE);
  const first = await startFromPlan(page);
  // The phone loses its active case (cleared storage), the session stays.
  await page.evaluate(() => localStorage.removeItem("md.case.active.v1"));

  await serverPlan(page, KABIR_BIKE);
  await page.getByTestId("start-application").click();
  await expect(page.locator("[data-screen='SCR-018']")).toBeVisible();
  const res = await expectApi(page, "POST", "/v1/cases", () =>
    page.getByTestId("start-case").click(),
  );
  expect(res.status, "one open case per class").toBe(409);
  expect(res.json.code).toBe("CASE_EXISTS");
  // No second application and no error banner: the open case becomes the active one.
  await expect(page).toHaveURL(/\/en\/apply$/);
  await expect.poll(async () => (await activeCase(page))?.caseId).toBe(first);
  expect((await activeCase(page))?.local).toBe(false);
});

test("API-07 link: /auth/magic?code= opens sign-in in the reader's language", async ({
  context,
  page,
  baseURL,
}) => {
  await page.goto("/auth/magic?code=ml_e2e_redirect_check");
  await expect(page).toHaveURL(/\/en\/signin\?code=ml_e2e_redirect_check$/);
  await context.addCookies([
    { name: "NEXT_LOCALE", value: "hi", domain: new URL(baseURL ?? "").hostname, path: "/" },
  ]);
  await page.goto("/auth/magic?code=ml_e2e_redirect_check");
  await expect(page).toHaveURL(/\/hi\/signin\?code=ml_e2e_redirect_check$/);
  await expect(page.locator("[data-screen='SCR-155']")).toBeVisible();
});

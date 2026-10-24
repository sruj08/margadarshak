// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computePlan, serverPlan } from "./api";
import { addDays } from "./dates";
import { buildPersona } from "./personas";
import {
  decodeShare,
  encodeShare,
  type PlanAnswers,
  toApiRequest,
  toEngineInput,
  yearsBefore,
} from "./plan-model";
import { planOnDevice } from "./rules";
import { deriveCase, stageView } from "./stage";

const KABIR: PlanAnswers = {
  age: { kind: "dob", dob: "2007-03-14" },
  vehicles: ["bike_gear", "car"],
  state: "JK",
  aadhaar: "yes",
};

describe("plan on the device (MD-108)", () => {
  it("matches the golden personas (tests/golden/personas.json)", () => {
    const golden = JSON.parse(
      readFileSync(
        join(__dirname, "..", "..", "..", "..", "..", "tests", "golden", "personas.json"),
        "utf8",
      ),
    ) as {
      cases: Array<{ id: string; input: Record<string, unknown>; expect: Record<string, unknown> }>;
    };
    for (const g of golden.cases) {
      const p = planOnDevice(g.input as never);
      const e = g.expect as {
        max_rto_visits?: number;
        recommended_path?: string;
        fees?: { total_paise?: number };
      };
      if (e.max_rto_visits !== undefined) expect(p.max_rto_visits, g.id).toBe(e.max_rto_visits);
      if (e.recommended_path) expect(p.recommended_path, g.id).toBe(e.recommended_path);
      if (e.fees?.total_paise) expect(p.fees?.total_paise, g.id).toBe(e.fees.total_paise);
    }
  });

  it("an age band plans conservatively from the band's lower age", () => {
    const asOf = "2026-10-24";
    const input = toEngineInput({ ...KABIR, age: { kind: "band", band: "18_19" } }, asOf);
    expect(input.dob).toBe(yearsBefore(asOf, 18));
    expect(planOnDevice(input).classes.every((c) => c.eligible)).toBe(true);
    const under20 = planOnDevice(
      toEngineInput({ ...KABIR, vehicles: ["truck"], age: { kind: "band", band: "18_19" } }, asOf),
    );
    expect(under20.classes[0]?.eligible).toBe(false);
  });

  it("a year-only DOB uses year precision (EC-01)", () => {
    const input = toEngineInput({ ...KABIR, age: { kind: "year", year: 2007 } }, "2026-10-24");
    expect(input.dob_precision).toBe("year");
    const ids = planOnDevice(input).blockers.map((b) => b.rule_id);
    expect(ids).toContain("JK-B10");
  });
});

describe("API-01 request mapping", () => {
  it("sends the rule-pack picture IDs and the facts, never the full answers", () => {
    const req = toApiRequest(KABIR, "2026-10-24", "hi");
    expect(req).toEqual({
      state: "JK",
      vehicles: ["bike_gear", "car"],
      dob_precision: "day",
      dob: "2007-03-14",
      aadhaar_address_matches_residence: true,
      language: "hi",
    });
    const tanvi = toApiRequest(
      { ...KABIR, aadhaar: "no", relationLine: false, hasTestVehicle: false, mobileLinked: true },
      "2026-10-24",
      "en",
    );
    expect(tanvi).toMatchObject({
      aadhaar_address_matches_residence: false,
      aadhaar_has_relation_line: false,
      aadhaar_mobile_linked: true,
      has_test_vehicle: false,
    });
  });
  it("every classes.json picture goes to the API; only an empty or oversize pick stays local", () => {
    const req = toApiRequest({ ...KABIR, vehicles: ["e_cart"] }, "2026-10-24", "en");
    expect(req?.vehicles).toEqual(["e_cart"]);
    expect(toApiRequest({ ...KABIR, vehicles: [] }, "2026-10-24", "en")).toBeNull();
  });
  it("share payload carries only a band, vehicles, state and the Aadhaar answer", () => {
    const s = encodeShare({ b: "18_19", v: ["car"], s: "JK", a: "yes" });
    expect(decodeShare(s)).toEqual({ b: "18_19", v: ["car"], s: "JK", a: "yes" });
    expect(decodeShare("not-base64!")).toBeNull();
  });
});

describe("plan fallback: API primary, device when unreachable", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("online (mock API): the plan is saved with a plan ID from the API", async () => {
    const rec = await computePlan(KABIR);
    expect(rec.source).toBe("server");
    expect(rec.serverPlanId).toMatch(/^pln_/);
    expect(rec.plan.fees?.total_paise).toBe(135000);
  });

  it("offline: the TS mirror computes the same plan and says so", async () => {
    const online = await computePlan(KABIR);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const offline = await computePlan(KABIR);
    expect(offline.source).toBe("device");
    expect(offline.serverPlanId).toBeNull();
    const strip = (p: typeof online.plan) => {
      const {
        plan_id: _a,
        expires_at: _b,
        ...rest
      } = p as typeof p & { plan_id?: string; expires_at?: string };
      return rest;
    };
    expect(strip(offline.plan)).toEqual(strip(online.plan));
  });

  it("the API plan is used as is; a body that is not an engine plan is ignored", () => {
    const local = planOnDevice(toEngineInput(KABIR, "2026-10-24"));
    const body = { ...local, plan_id: "pln_x", quote_id: "fq_x", age_band: "18_25" };
    expect(serverPlan(body)).toBe(body);
    expect(serverPlan({ plan_id: "pln_x", max_rto_visits: 2 })).toBeNull();
  });
});

describe("stage-aware home from the journey state (MD-122)", () => {
  const today = "2026-10-24";
  it("Kabir LL day 12 -> BRIDGE with an 18-day unlock countdown from the rule pack", () => {
    const p = buildPersona("kabir_day12", today);
    const c = deriveCase(p.case as never, today);
    const v = stageView(c, today);
    expect(c.display_stage).toBe("BRIDGE");
    expect(v.clock).toMatchObject({ kind: "unlock", days: 18, ruleId: "PRM-MIN-WAIT-DAYS" });
    expect(v.href).toBe("/learn");
  });
  it("Kabir LL day 31 -> DL_BOOKABLE (book the test)", () => {
    const c = deriveCase(buildPersona("kabir_day31", today).case as never, today);
    expect(c.display_stage).toBe("DL_BOOKABLE");
    expect(c.next_action.action_id).toBe("BOOK_TEST");
  });
  it("LL expiring within 30 days -> LL_EXPIRING (red, a real deadline)", () => {
    const p = buildPersona("kabir_day12", today);
    const c = deriveCase(p.case as never, addDays(today, 160));
    expect(c.display_stage).toBe("LL_EXPIRING");
    expect(stageView(c, addDays(today, 160)).tone).toBe("danger");
  });
  it("Mohan-ji: DL expiring within a year -> RENEWAL_DUE", () => {
    const c = deriveCase(buildPersona("mohan", today).case as never, today);
    expect(c.display_stage).toBe("RENEWAL_DUE");
  });
});

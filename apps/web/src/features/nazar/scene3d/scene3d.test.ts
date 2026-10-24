import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs generator shared with the catalogue build
import { derive, SCENES_JSON } from "../../../../../../scripts/gen-scene3d-catalogue.mjs";
import { SCENES } from "./catalogue.data";
import { buildPlan } from "./choreo";
import { clipIdOf, pickRow, planFor } from "./resolve";

const rows = SCENES.filter((s) => s.aMs !== null && s.bMs !== null);

describe("scene catalogue", () => {
  it("matches content/nazar/scenes.json (run scripts/gen-scene3d-catalogue.mjs after editing it)", () => {
    expect(SCENES).toEqual(SCENES_JSON.scenes.map(derive));
  });
  it("has a sane window for every hazard scene", () => {
    for (const s of rows) {
      expect(s.aMs as number).toBeGreaterThan(5000);
      expect(s.bMs as number).toBeGreaterThan(s.aMs as number);
      expect(s.bMs as number).toBeLessThan(s.durationMs);
    }
  });
});

describe("choreography", () => {
  it.each(rows.map((r) => [r.id, r] as const))(
    "%s is deterministic and the learner eases off",
    (_id, row) => {
      const a = row.aMs as number;
      const plan = planFor(row.id, null);
      expect(plan.poses(a + 1234)).toEqual(plan.poses(a + 1234));
      expect(plan.egoV(a + 3000)).toBeLessThan(plan.egoV(0) * 0.9);
      expect(plan.egoZ(a)).toBeLessThan(plan.egoZ(a - 1000));
    },
  );

  it.each(rows.map((r) => [r.id, r] as const))(
    "%s shows no conflict before the onset",
    (_id, row) => {
      if (["truck_left_turn", "surface_hazard"].includes(row.hazardType)) return;
      const plan = planFor(row.id, null);
      const t = (row.aMs as number) - 300;
      const ez = plan.egoZ(t);
      for (const p of plan.poses(t).filter((q) => q.hazard)) {
        const ahead = ez - p.z;
        expect(ahead > 0 && ahead < 25 && Math.abs(p.x - plan.egoX(t)) < 0.8).toBe(false);
      }
    },
  );

  it("stages every one of the 15 hazard types", () => {
    expect(new Set(rows.map((r) => r.hazardType)).size).toBe(15);
    for (const r of rows)
      expect(
        planFor(r.id, null)
          .poses(r.aMs as number)
          .some((p) => p.hazard),
      ).toBe(true);
  });

  it("quiet scenes stage no hazard actor", () => {
    for (const r of SCENES.filter((s) => s.hazardType === "quiet"))
      expect(
        planFor(r.id, null)
          .poses(15000)
          .some((p) => p.hazard),
      ).toBe(false);
  });

  it("moves the onset with the window it is given (sample-bank clips)", () => {
    const plan = planFor("JMU-0012", [{ type: "door_opening", aMs: 12400, bMs: 16900 }], 38000);
    const door = (t: number) => plan.poses(t).find((p) => p.id.endsWith(":door"))?.aux ?? 0;
    expect(door(12400)).toBeCloseTo(0, 5);
    expect(door(15000)).toBeGreaterThan(0.5);
    expect(plan.durationMs).toBe(38000);
  });
});

describe("resolve", () => {
  it("reads the clip id from an item ref", () => {
    expect(clipIdOf("clip:SCN-001@2")).toBe("SCN-001");
    expect(clipIdOf("JMU-0012")).toBe("JMU-0012");
  });
  it("uses the named scene, else a scene of the same hazard type, else a quiet one", () => {
    expect(pickRow("SCN-009", null).id).toBe("SCN-009");
    expect(pickRow("X1", [{ type: "cyclist", aMs: 1, bMs: 2 }]).hazardType).toBe("cyclist");
    expect(pickRow("X2", []).hazardType).toBe("quiet");
  });
  it("builds a plan with no hazards", () => {
    expect(() => buildPlan(SCENES[0]!, [])).not.toThrow();
  });
});

describe("the learner never drives through anyone", () => {
  it.each(SCENES.map((r) => [r.id, r] as const))("%s keeps clear of every actor", (_id, row) => {
    const plan = planFor(row.id, null);
    let worst = { d: 99, id: "", t: 0 };
    for (let t = 0; t <= plan.durationMs; t += 100) {
      const ez = plan.egoZ(t);
      const ex = plan.egoX(t);
      for (const p of plan.poses(t)) {
        if (p.kind === "puddle" || p.kind === "gravel") continue;
        // A body overlap: within a car length along the road and a body width across it.
        const d = Math.hypot((ez - p.z) / 2.5, (p.x - ex) / 1.0);
        if (d < worst.d) worst = { d, id: p.id, t };
      }
    }
    expect(worst, `${row.id} ${JSON.stringify(worst)}`).toSatisfy((w: { d: number }) => w.d > 1);
  });
});

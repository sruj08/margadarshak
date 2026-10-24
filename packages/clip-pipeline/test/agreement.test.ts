import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  adjudicate,
  batchAgreementStats,
  type ClipAgreement,
  computeAgreement,
  fieldKitH4MedianOnsetS,
  finalWindow,
  NAZAR_63_PER_HAZARD,
  type RaterMark,
  raterDrift,
} from "../src/agreement.ts";
import { matchWindows } from "../src/match.ts";
import { mark, rating } from "./helpers.ts";

const A = (marks: RaterMark[]) => rating("rater-01", marks);
const B = (marks: RaterMark[]) => rating("rater-02", marks);

/** Everything except the rater labels, for comparing A/B-swapped runs. */
function symmetricView(g: ClipAgreement) {
  return {
    accepted: g.accepted,
    reasons: g.reasons,
    finalHazards: g.finalHazards,
    pairs: g.pairs.map((p) => ({
      id: p.clusterId,
      dOn: p.deltaOnsetMs,
      dEnd: p.deltaEndMs,
      iou: p.iou,
      ok: p.accepted,
    })),
    unmatched: [...g.onlyA, ...g.onlyB].sort((x, y) => x.aMs - y.aMs),
    clusterIds: g.clusters.map((c) => c.clusterId),
  };
}

describe("computeAgreement", () => {
  it("perfect match: accepted, Δ 0, final window = the marks", () => {
    const g = computeAgreement(
      A([mark("bus_stop_pedestrian", 12000, 16500)]),
      B([mark("bus_stop_pedestrian", 12000, 16500)]),
      { durationMs: 38000 },
    );
    assert.equal(g.accepted, true);
    assert.equal(g.needsThirdRater, false);
    assert.deepEqual(g.reasons, []);
    assert.equal(g.pairs[0]?.iou, 1);
    assert.equal(g.metrics.kappaPerSecond, 1);
    assert.deepEqual(g.finalHazards, [
      {
        hazardId: "h1",
        hazardType: "bus_stop_pedestrian",
        window: { aMs: 12000, bMs: 16500 },
        raterCount: 2,
        deltaOnsetMs: 0,
        deltaEndMs: 0,
        adjudicated: false,
        occlusion: false,
        cues: [],
      },
    ]);
  });

  it("onset Δ exactly 0.5 s is accepted", () => {
    const g = computeAgreement(
      A([mark("bus_stop_pedestrian", 12000, 16500)]),
      B([mark("bus_stop_pedestrian", 12500, 17000)]),
    );
    assert.equal(g.accepted, true);
    assert.equal(g.pairs[0]?.deltaOnsetMs, 500);
  });

  it("onset Δ 0.6 s needs a third rater (and passes under NAZAR §6.3's looser bound)", () => {
    const a = A([mark("bus_stop_pedestrian", 12000, 16500)]);
    const b = B([mark("bus_stop_pedestrian", 12600, 16500)]);
    const g = computeAgreement(a, b);
    assert.equal(g.accepted, false);
    assert.equal(g.needsThirdRater, true);
    assert.deepEqual(g.reasons, ["onset_delta"]);
    assert.deepEqual(g.finalHazards, []);
    assert.equal(computeAgreement(a, b, {}, NAZAR_63_PER_HAZARD).accepted, true);
  });

  it("a missed hazard and an extra hazard are unmatched", () => {
    const two = [mark("bus_stop_pedestrian", 12000, 16500), mark("auto_cut_in", 25000, 28000)];
    const one = [mark("bus_stop_pedestrian", 12100, 16400)];
    const missed = computeAgreement(A(two), B(one));
    assert.deepEqual(missed.reasons, ["unmatched_hazard"]);
    assert.equal(missed.onlyA.length, 1);
    assert.equal(missed.onlyA[0]?.hazardType, "auto_cut_in");
    const extra = computeAgreement(A(one), B(two));
    assert.equal(extra.onlyB.length, 1);
    assert.ok(extra.needsThirdRater);
  });

  it("submission order does not matter (deterministic matching)", () => {
    const m1 = mark("bus_stop_pedestrian", 12000, 16500);
    const m2 = mark("wrong_side_2w", 30000, 34000);
    const n1 = mark("bus_stop_pedestrian", 12300, 16200);
    const n2 = mark("wrong_side_2w", 29800, 34600);
    const g1 = computeAgreement(A([m1, m2]), B([n1, n2]));
    const g2 = computeAgreement(A([m2, m1]), B([n2, n1]));
    assert.deepEqual(g1, g2);
    assert.deepEqual(
      g1.pairs.map((p) => p.a.hazardType),
      ["bus_stop_pedestrian", "wrong_side_2w"],
    );
    // Swapping which rater is "A" gives the same decision, deltas and final windows.
    assert.deepEqual(symmetricView(computeAgreement(B([n2, n1]), A([m1, m2]))), symmetricView(g1));
  });

  it("prefers the same-type partner when windows overlap; ties break by IoU", () => {
    const left = [mark("bus_stop_pedestrian", 10000, 15000), mark("auto_cut_in", 11000, 15000)];
    const right = [mark("auto_cut_in", 10000, 15000), mark("bus_stop_pedestrian", 11000, 15000)];
    const m = matchWindows(left, right, 0.3);
    assert.deepEqual(
      m.pairs.map((p) => [p.i, p.j]),
      [
        [0, 1],
        [1, 0],
      ],
    );
  });

  it("type mismatch, too many hazards and an unconfirmed proposal go to adjudication", () => {
    const tm = computeAgreement(
      A([mark("door_opening", 8000, 11000)]),
      B([mark("parked_vehicle_hidden", 8000, 11000)]),
    );
    assert.deepEqual(tm.reasons, ["type_mismatch"]);
    const three = [
      mark("cyclist", 2000, 5000),
      mark("cattle_animal", 12000, 15000),
      mark("auto_cut_in", 25000, 28000),
    ];
    assert.deepEqual(computeAgreement(A(three), B(three)).reasons, ["too_many_hazards"]);
    const g = computeAgreement(A([mark("cyclist", 2000, 5000)]), B([mark("cyclist", 2000, 5000)]), {
      proposals: [
        { aMs: 2000, bMs: 6000, hazardType: "cyclist", why: "cyclist wobbles" },
        { aMs: 20000, bMs: 23000, hazardType: "cattle_animal", why: "cow steps out" },
      ],
    });
    assert.deepEqual(g.reasons, ["unconfirmed_proposal"]);
    assert.equal(g.unconfirmedProposals.length, 1);
    assert.equal(g.clusters.at(-1)?.kind, "proposal_only");
  });

  it("a quiet clip both raters left empty is accepted with no hazards", () => {
    const g = computeAgreement(A([]), B([]), { durationMs: 30000 });
    assert.equal(g.accepted, true);
    assert.deepEqual(g.finalHazards, []);
    assert.equal(
      g.metrics.kappaPerSecond,
      null,
      "κ is undefined when both raters say 'absent' everywhere",
    );
  });

  it("refuses a self-agreement or mismatched clip versions", () => {
    assert.throws(
      () => computeAgreement(rating("rater-01", []), rating("rater-01", [])),
      /two raters/,
    );
    assert.throws(
      () => computeAgreement(rating("rater-01", []), rating("rater-02", [], "JMU-0012", 4)),
      /different clips/,
    );
    assert.throws(() => computeAgreement(A([mark("cyclist", 5000, 5000)]), B([])));
  });

  it("carries cues and occlusion into the final hazard", () => {
    const g = computeAgreement(
      A([mark("bus_stop_pedestrian", 12000, 16500, { cue: "feet at bus front", occlusion: true })]),
      B([mark("bus_stop_pedestrian", 12000, 16500, { cue: "person behind bus" })]),
    );
    assert.equal(g.finalHazards[0]?.occlusion, true);
    assert.deepEqual(g.finalHazards[0]?.cues, ["feet at bus front", "person behind bus"]);
  });
});

describe("golden vectors (for the Go clip.agreement mirror)", () => {
  const golden = JSON.parse(
    readFileSync(new URL("./fixtures/agreement-golden.json", import.meta.url), "utf8"),
  ) as {
    cases: {
      name: string;
      raterA: RaterMark[];
      raterB: RaterMark[];
      expected: {
        accepted: boolean;
        reasons: string[];
        pairs: { deltaOnsetMs: number; deltaEndMs: number }[];
        onlyA: number;
        onlyB: number;
        finalHazards: { hazardId: string; hazardType: string; aMs: number; bMs: number }[];
      };
    }[];
  };
  for (const c of golden.cases) {
    it(c.name, () => {
      const g = computeAgreement(A(c.raterA), B(c.raterB));
      assert.equal(g.accepted, c.expected.accepted);
      assert.equal(g.needsThirdRater, !c.expected.accepted);
      assert.deepEqual(g.reasons, c.expected.reasons);
      assert.deepEqual(
        g.pairs.map((p) => ({ deltaOnsetMs: p.deltaOnsetMs, deltaEndMs: p.deltaEndMs })),
        c.expected.pairs,
      );
      assert.equal(g.onlyA.length, c.expected.onlyA);
      assert.equal(g.onlyB.length, c.expected.onlyB);
      assert.deepEqual(
        g.finalHazards.map((h) => ({
          hazardId: h.hazardId,
          hazardType: h.hazardType,
          aMs: h.window.aMs,
          bMs: h.window.bMs,
        })),
        c.expected.finalHazards,
      );
    });
  }
});

describe("finalWindow", () => {
  it("two marks: mean, snapped to the nearest 30 fps frame", () => {
    assert.deepEqual(
      finalWindow([
        { aMs: 12000, bMs: 16500 },
        { aMs: 12500, bMs: 17000 },
      ]),
      { aMs: 12267, bMs: 16767 },
    );
    assert.deepEqual(
      finalWindow(
        [
          { aMs: 12000, bMs: 16500 },
          { aMs: 12500, bMs: 17000 },
        ],
        { fps: 30, snapToFrame: false },
      ),
      {
        aMs: 12250,
        bMs: 16750,
      },
    );
  });

  it("three marks: median", () => {
    assert.deepEqual(
      finalWindow([
        { aMs: 12000, bMs: 16500 },
        { aMs: 12600, bMs: 16500 },
        { aMs: 12300, bMs: 16700 },
      ]),
      { aMs: 12300, bMs: 16500 },
    );
  });

  it("refuses one or four marks and a collapsed window", () => {
    assert.throws(() => finalWindow([{ aMs: 1, bMs: 2 }]), /2 or 3/);
    assert.throws(() => finalWindow(Array(4).fill({ aMs: 1000, bMs: 2000 })), /2 or 3/);
    assert.throws(
      () =>
        finalWindow([
          { aMs: 1000, bMs: 1010 },
          { aMs: 1000, bMs: 1010 },
        ]),
      /collapsed/,
    );
  });
});

describe("adjudicate", () => {
  const disagreement = computeAgreement(
    A([mark("bus_stop_pedestrian", 12000, 16500)]),
    B([mark("bus_stop_pedestrian", 12600, 16500)]),
  );
  const base = {
    adjudicator: "rater-03",
    decidedAt: "2026-10-24T08:00:00Z",
    reasonCode: "window_resolved" as const,
  };

  it("median of the three marks, adjudicated, raterCount 3", () => {
    const r = adjudicate(disagreement, {
      ...base,
      decisions: [
        { clusterId: "c1", verdict: "hazard", mark: mark("bus_stop_pedestrian", 12300, 16700) },
      ],
    });
    assert.equal(r.resolved, true);
    assert.deepEqual(r.hazards, [
      {
        hazardId: "h1",
        hazardType: "bus_stop_pedestrian",
        window: { aMs: 12300, bMs: 16500 },
        raterCount: 3,
        deltaOnsetMs: 600,
        deltaEndMs: 200,
        adjudicated: true,
        occlusion: false,
        cues: [],
      },
    ]);
  });

  it("a single-rater hazard confirmed by the adjudicator uses the mean of two marks; not_hazard drops", () => {
    const g = computeAgreement(
      A([mark("bus_stop_pedestrian", 12000, 16500), mark("auto_cut_in", 25000, 28000)]),
      B([mark("bus_stop_pedestrian", 12000, 16500), mark("cattle_animal", 31000, 34000)]),
    );
    assert.deepEqual(
      g.clusters.map((c) => [c.clusterId, c.kind]),
      [
        ["c1", "pair"],
        ["c2", "only_a"],
        ["c3", "only_b"],
      ],
    );
    const r = adjudicate(g, {
      ...base,
      reasonCode: "presence_resolved",
      decisions: [
        { clusterId: "c1", verdict: "hazard", mark: mark("bus_stop_pedestrian", 12000, 16500) },
        { clusterId: "c2", verdict: "hazard", mark: mark("auto_cut_in", 25200, 28000) },
        { clusterId: "c3", verdict: "not_hazard" },
      ],
    });
    assert.equal(r.resolved, true);
    assert.deepEqual(r.dropped, ["c3"]);
    assert.deepEqual(r.hazards[1]?.window, { aMs: 25100, bMs: 28000 });
    assert.equal(r.hazards[1]?.raterCount, 2);
  });

  it("a proposal nobody marked cannot become final on one human mark", () => {
    const g = computeAgreement(A([]), B([]), {
      proposals: [{ aMs: 20000, bMs: 23000, hazardType: "cattle_animal", why: "cow" }],
    });
    assert.ok(g.needsThirdRater);
    const r = adjudicate(g, {
      ...base,
      reasonCode: "proposal_checked",
      decisions: [
        { clusterId: "c1", verdict: "hazard", mark: mark("cattle_animal", 20500, 23000) },
      ],
    });
    assert.equal(r.resolved, false);
    assert.match(r.issues.join(), /second rater/);
    assert.ok(
      adjudicate(g, {
        ...base,
        reasonCode: "proposal_checked",
        decisions: [{ clusterId: "c1", verdict: "not_hazard" }],
      }).resolved,
    );
  });

  it("needs a decision per cluster, a mark per hazard verdict and a third person", () => {
    assert.match(adjudicate(disagreement, { ...base, decisions: [] }).issues.join(), /no decision/);
    assert.match(
      adjudicate(disagreement, {
        ...base,
        decisions: [{ clusterId: "c1", verdict: "hazard" }],
      }).issues.join(),
      /own mark/,
    );
    assert.throws(
      () => adjudicate(disagreement, { ...base, adjudicator: "rater-01", decisions: [] }),
      /third person/,
    );
    assert.throws(
      () =>
        adjudicate(disagreement, {
          ...base,
          decisions: [{ clusterId: "c9", verdict: "not_hazard" }],
        }),
      /unknown cluster/,
    );
  });
});

describe("batch statistics and drift", () => {
  const g1 = computeAgreement(
    A([mark("bus_stop_pedestrian", 12000, 16500)]),
    B([mark("bus_stop_pedestrian", 12400, 17300)]),
  );
  const g2 = computeAgreement(A([mark("cyclist", 2000, 5000)]), B([mark("cyclist", 2200, 5100)]));
  const g3 = computeAgreement(A([]), B([]));
  const g4 = computeAgreement(A([mark("cattle_animal", 9000, 12000)]), B([]));

  it("medians over matched pairs, κ over candidate hazards incl. quiet clips", () => {
    const s = batchAgreementStats([g1, g2, g3, g4]);
    assert.equal(s.clips, 4);
    assert.equal(s.matchedPairs, 2);
    assert.equal(s.medianDeltaOnsetMs, 300);
    assert.equal(s.medianDeltaEndMs, 450);
    // presence pairs: (1,1) (1,1) (0,0) (1,0) → po 0.75, pe 0.75·0.5 + 0.25·0.5 = 0.5 → κ 0.5
    assert.equal(s.kappa, 0.5);
    assert.deepEqual(s.targets, { onset: true, end: true, kappa: false });
  });

  it("ports the field kit's H4 line", () => {
    assert.equal(
      fieldKitH4MedianOnsetS([
        { raterAOnsetS: 12.0, raterBOnsetS: 12.4 },
        { raterAOnsetS: 2.0, raterBOnsetS: 2.2 },
        { raterAOnsetS: 7.5, raterBOnsetS: 6.5 },
      ]),
      0.40000000000000036,
    );
    assert.equal(fieldKitH4MedianOnsetS([]), null);
  });

  it("tracks each rater's mean signed onset against the pair consensus", () => {
    assert.deepEqual(raterDrift([g1, g2]), [
      { rater: "rater-01", n: 2, meanSignedOnsetMs: -150 },
      { rater: "rater-02", n: 2, meanSignedOnsetMs: 150 },
    ]);
  });
});

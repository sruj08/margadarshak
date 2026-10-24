import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLIP_STATUSES, type ClipStatus } from "../src/schema.ts";
import {
  checkInvariants,
  clipBlurAuditPasses,
  isAllowedTransition,
  mockEligibility,
  TRANSITIONS,
  transition,
} from "../src/status.ts";
import { clipWith, pipelineClip, specClip } from "./helpers.ts";

function codes(r: ReturnType<typeof transition>): string[] {
  return r.ok ? [] : r.violations.map((v) => v.code);
}

describe("status state machine", () => {
  it("follows the spec order and nothing skips ahead to published", () => {
    const happy: ClipStatus[] = [
      "raw",
      "transcoded",
      "blurred",
      "audited",
      "proposed",
      "rated",
      "published",
      "retired",
    ];
    for (let i = 1; i < happy.length; i++)
      assert.ok(isAllowedTransition(happy[i - 1] as ClipStatus, happy[i] as ClipStatus));
    assert.ok(isAllowedTransition("proposed", "adjudication"));
    assert.ok(isAllowedTransition("adjudication", "rated"));
    assert.ok(
      isAllowedTransition("blurred", "proposed"),
      "ARCHITECTURE §8 order: propose before the human audit",
    );
    assert.ok(isAllowedTransition("blurred", "blurred"), "re-blur with manual masks");
    for (const s of CLIP_STATUSES) {
      if (s !== "rated")
        assert.ok(!isAllowedTransition(s, "published"), `${s} → published must be refused`);
    }
    assert.ok(!isAllowedTransition("published", "rated"));
    assert.ok(!isAllowedTransition("adjudication", "published"));
    assert.deepEqual(TRANSITIONS.retired, []);
  });

  it("lets every live status retire (takedown)", () => {
    for (const s of CLIP_STATUSES)
      if (s !== "retired") assert.ok(isAllowedTransition(s, "retired"));
  });

  it("refuses a disallowed edge", () => {
    assert.deepEqual(codes(transition(pipelineClip("raw"), "published")), ["transition"]);
  });

  it("needs both renditions once blurred", () => {
    const c = { ...pipelineClip("transcoded"), media: [] };
    assert.deepEqual(codes(transition(c, "blurred")), ["missing_rendition", "missing_rendition"]);
    assert.ok(transition(pipelineClip("transcoded"), "blurred").ok);
  });

  it("needs a passing audit for audited", () => {
    assert.deepEqual(codes(transition(pipelineClip("blurred"), "audited")), ["blur_audit"]);
    const audited = { ...pipelineClip("blurred"), blurAudit: specClip().blurAudit };
    assert.ok(transition(audited, "audited").ok);
  });

  it("refuses final windows before agreement", () => {
    const c = { ...specClip(), status: "blurred" as const, blurAudit: null };
    assert.ok(checkInvariants(c).some((v) => v.code === "premature_windows"));
  });

  it("rated needs two agreeing raters or an adjudication", () => {
    const base = specClip();
    const h = base.hazards[0];
    assert.ok(h);
    const rated = { ...base, status: "proposed" as const };
    assert.ok(transition(rated, "rated").ok);
    const tooFar = { ...rated, hazards: [{ ...h, deltaOnsetMs: 600 }] };
    assert.deepEqual(codes(transition(tooFar, "rated")), ["raters_disagree"]);
    const adjudicated = {
      ...rated,
      hazards: [{ ...h, deltaOnsetMs: 1400, raterCount: 3, adjudicated: true }],
    };
    assert.ok(transition(adjudicated, "rated").ok);
    assert.ok(
      transition({ ...rated, hazards: [{ ...h, deltaOnsetMs: 900 }] }, "rated", {
        onsetToleranceMs: 1000,
      }).ok,
    );
  });

  it("cannot publish without a 100% blur audit with zero misses", () => {
    const rated = { ...specClip(), status: "rated" as const };
    assert.ok(transition(rated, "published").ok);
    const audit = specClip().blurAudit;
    assert.ok(audit);
    assert.deepEqual(codes(transition({ ...rated, blurAudit: null }, "published")), ["blur_audit"]);
    assert.deepEqual(
      codes(transition({ ...rated, blurAudit: { ...audit, misses: 1 } }, "published")),
      ["blur_audit"],
    );
    assert.deepEqual(
      codes(transition({ ...rated, blurAudit: { ...audit, framesChecked: 1139 } }, "published")),
      ["blur_audit"],
    );
  });

  it("cannot publish without final windows from agreeing raters", () => {
    const h = specClip().hazards[0];
    assert.ok(h);
    const rated = {
      ...specClip(),
      status: "rated" as const,
      hazards: [{ ...h, deltaEndMs: 1200 }],
    };
    assert.deepEqual(codes(transition(rated, "published")), ["raters_disagree"]);
  });

  it("checks duration and curator difficulty at publish", () => {
    const rated = { ...specClip(), status: "rated" as const };
    assert.deepEqual(
      codes(
        transition({ ...rated, difficulty: { ...rated.difficulty, curator: null } }, "published"),
      ),
      ["curator_difficulty"],
    );
    assert.deepEqual(
      codes(transition({ ...rated, difficulty: { ...rated.difficulty, curator: 5 } }, "published")),
      ["curator_rubric"],
    );
    const short = {
      ...rated,
      durationMs: 15000,
      hazards: [],
      quietSegments: [],
      blurAudit: { ...rated.blurAudit, framesChecked: 450 },
    };
    assert.ok(codes(transition(short as typeof rated, "published")).includes("duration"));
  });

  it("cannot publish without a speed estimate (the metres fact needs it)", () => {
    const rated = { ...specClip(), status: "rated" as const };
    const noSpeed = { ...rated, speedKmhEst: null, speedSource: "not_logged" as const };
    assert.deepEqual(codes(transition(noSpeed, "published")), ["speed"]);
  });

  it("reports schema problems as violations instead of throwing", () => {
    const bad = { ...specClip(), city: "12 MG Road" };
    assert.equal(checkInvariants(bad)[0]?.code, "schema");
  });

  it("derives the audit pass from clip.json", () => {
    assert.ok(clipBlurAuditPasses(specClip()));
    assert.ok(!clipBlurAuditPasses(clipWith({ blurAudit: null })));
  });

  it("mock eligibility excludes flash failures, quiet clips, `other` and difficulty outside 2–4", () => {
    assert.deepEqual(mockEligibility(specClip(), { flashPassed: true }), {
      eligible: true,
      reasons: [],
    });
    assert.ok(!mockEligibility(specClip(), { flashPassed: false }).eligible);
    assert.ok(!mockEligibility(clipWith({ hazards: [] }), { flashPassed: true }).eligible);
    const h = specClip().hazards[0];
    assert.ok(h);
    assert.ok(
      !mockEligibility(clipWith({ hazards: [{ ...h, hazardType: "other" }] }), {
        flashPassed: true,
      }).eligible,
    );
    assert.ok(
      !mockEligibility(
        clipWith({ difficulty: { curator: 1, empirical: null, irt: null, nTakers: 0 } }),
        { flashPassed: true },
      ).eligible,
    );
    assert.ok(!mockEligibility(clipWith({ status: "rated" }), { flashPassed: true }).eligible);
  });
});

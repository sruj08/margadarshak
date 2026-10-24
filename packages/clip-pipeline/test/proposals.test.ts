import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ClipProposalSchema,
  compareProposals,
  mergeChunkProposals,
  mmssToSeconds,
  PROMPT_LABEL_MAP,
  proposalToWindows,
} from "../src/proposals.ts";
import { HAZARD_TYPES } from "../src/schema.ts";

describe("ClipProposal schema (M-06 output)", () => {
  it("accepts a proposal and an explicit no-hazard answer", () => {
    assert.ok(
      ClipProposalSchema.safeParse({
        windows: [
          {
            start: "00:12",
            end: "00:17",
            hazard_type: "bus_stop_pedestrian",
            why: "boy runs from behind bus on left",
          },
        ],
        no_hazard: false,
      }).success,
    );
    assert.ok(ClipProposalSchema.safeParse({ windows: [], no_hazard: true }).success);
  });

  it("rejects inconsistent no_hazard, sub-second timestamps, unknown labels and extra keys", () => {
    assert.ok(!ClipProposalSchema.safeParse({ windows: [], no_hazard: false }).success);
    assert.ok(
      !ClipProposalSchema.safeParse({
        windows: [{ start: "00:12.4", end: "00:17", hazard_type: "cattle", why: "x" }],
        no_hazard: false,
      }).success,
    );
    assert.ok(
      !ClipProposalSchema.safeParse({
        windows: [{ start: "00:12", end: "00:17", hazard_type: "speeding", why: "x" }],
        no_hazard: false,
      }).success,
    );
    assert.ok(!ClipProposalSchema.safeParse({ windows: [], no_hazard: true, final: true }).success);
  });

  it("maps every prompt label onto the §3.3 enum", () => {
    for (const v of Object.values(PROMPT_LABEL_MAP))
      assert.ok((HAZARD_TYPES as readonly string[]).includes(v));
    assert.equal(PROMPT_LABEL_MAP["wrong_side_rider"], "wrong_side_2w");
  });
});

describe("proposalToWindows / mergeChunkProposals", () => {
  it("adds the chunk offset, maps labels and drops impossible windows", () => {
    assert.equal(mmssToSeconds("01:05"), 65);
    const { windows, dropped } = proposalToWindows(
      {
        no_hazard: false,
        windows: [
          { start: "00:12", end: "00:17", hazard_type: "cattle", why: "cow steps onto the road" },
          { start: "00:20", end: "00:19", hazard_type: "child", why: "backwards" },
          { start: "00:01", end: "00:40", hazard_type: "other", why: "too long" },
          { start: "05:00", end: "05:03", hazard_type: "other", why: "past the chunk" },
        ],
      },
      { chunkOffsetS: 300, chunkLenS: 60 },
    );
    assert.deepEqual(windows, [
      { aMs: 312000, bMs: 317000, hazardType: "cattle_animal", why: "cow steps onto the road" },
    ]);
    assert.deepEqual(
      dropped.map((d) => d.index),
      [1, 2, 3],
    );
  });

  it("merges one hazard seen at a chunk boundary", () => {
    const merged = mergeChunkProposals([
      [{ aMs: 297000, bMs: 300000, hazardType: "auto_cut_in", why: "a" }],
      [
        { aMs: 298000, bMs: 302000, hazardType: "auto_cut_in", why: "b" },
        { aMs: 310000, bMs: 313000, hazardType: "cyclist", why: "c" },
      ],
    ]);
    assert.deepEqual(
      merged.map((w) => [w.aMs, w.bMs, w.hazardType]),
      [
        [297000, 302000, "auto_cut_in"],
        [310000, 313000, "cyclist"],
      ],
    );
  });
});

describe("compareProposals (never authoritative)", () => {
  it("reports recall, misses, false proposals and onset error", () => {
    const r = compareProposals(
      [
        { aMs: 12000, bMs: 17000, hazardType: "bus_stop_pedestrian", why: "a" },
        { aMs: 30000, bMs: 33000, hazardType: "cattle_animal", why: "b" },
      ],
      [
        { hazardId: "h1", hazardType: "bus_stop_pedestrian", window: { aMs: 12400, bMs: 16900 } },
        { hazardId: "h2", hazardType: "auto_cut_in", window: { aMs: 22000, bMs: 25000 } },
      ],
    );
    assert.equal(r.recall, 0.5);
    assert.deepEqual(r.missedHazardIds, ["h2"]);
    assert.equal(r.falseProposals, 1);
    assert.equal(r.falseProposalRate, 0.5);
    assert.equal(r.medianAbsOnsetErrorMs, 400);
    assert.equal(r.medianSignedOnsetErrorMs, -400);
    assert.equal(r.typeAgreement, 1);
  });

  it("handles a quiet clip", () => {
    const r = compareProposals([], []);
    assert.equal(r.recall, null);
    assert.equal(r.falseProposalRate, null);
  });
});

// Integrity: trust, comparison, eligibility, rate checks and the replay entry point's errors.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReplayError } from "../src/errors.ts";
import { ctxFor, StreamBuilder } from "../src/fixtures/builders.ts";
import { goldenVectors } from "../src/fixtures/index.ts";
import {
  compareResults,
  computeTrust,
  eligibility,
  rateImpossible,
  runIntegrityChecks,
  withIntegrityFlags,
} from "../src/integrity/index.ts";
import type { SessionResult } from "../src/schema/index.ts";
import { replay, SCORING_VERSIONS } from "../src/scoring/index.ts";
import { decodeReplay, encodeReplay } from "../src/sdk/index.ts";

const vec = (name: string) => {
  const v = goldenVectors().find((x) => x.name === name);
  if (v === undefined) throw new Error(name);
  return v;
};

describe("trust", () => {
  it("is multiplicative per occurrence and ignores unknown flags", () => {
    assert.equal(computeTrust([]), 1);
    assert.equal(computeTrust(["INT_TAB_HIDDEN", "INT_TAB_HIDDEN"]), 0.81);
    assert.equal(computeTrust(["INT_CLOCK_DRIFT", "INT_REPLAY_MISMATCH"]), 0.35);
    assert.equal(
      computeTrust(["INT_TIMING_FALLBACK", "INT_SEEN_CLIP", "INT_RT_ANTICIPATORY", "NOPE"]),
      1,
    );
    assert.equal(
      computeTrust([
        "INT_OFFLINE_SEED",
        "INT_EVENT_CAP",
        "INT_SESSION_EXPIRED",
        "INT_RATE_IMPOSSIBLE",
      ]),
      0.256,
    );
  });
});

describe("compareResults", () => {
  const server = vec("nazar-medium").expectedResult;
  it("matches within 0.5 pct points with identical finding IDs", () => {
    const client = { ...server, score: { ...server.score, pct: server.score.pct + 0.5 } };
    assert.equal(compareResults(client, server).match, true);
    const off = { ...server, score: { ...server.score, pct: server.score.pct + 0.51 } };
    assert.equal(compareResults(off, server).match, false);
    const reordered = { ...server, findings: [...server.findings].reverse() };
    assert.equal(compareResults(reordered, server).match, true, "order does not matter");
    const missing = { ...server, findings: server.findings.slice(1) };
    const c = compareResults(missing, server);
    assert.equal(c.match, false);
    assert.equal(c.findingIdsMatch, false);
  });
  it("withIntegrityFlags adds INT_REPLAY_MISMATCH and recomputes trust", () => {
    const r = withIntegrityFlags(server, ["INT_REPLAY_MISMATCH"]);
    assert.deepEqual(r.integrity.flags, ["INT_REPLAY_MISMATCH"]);
    assert.equal(r.integrity.trust, 0.7);
  });
});

describe("eligibility", () => {
  const mock = vec("nazar-strong").expectedResult;
  it("Nazar Score needs mock, server seed, unseen clips, trust ≥ 0.6, rVFC and verification", () => {
    assert.deepEqual(eligibility(mock, "nazar_score"), { eligible: true, reasons: [] });
    const fallback = vec("nazar-fallback-drift").expectedResult;
    assert.deepEqual(eligibility(fallback, "nazar_score").reasons, [
      "low_trust",
      "timing_not_rvfc",
    ]);
    const prov: SessionResult = { ...mock, integrity: { ...mock.integrity, provisional: true } };
    assert.deepEqual(eligibility(prov, "fsrs").reasons, ["not_verified"]);
    const seen = withIntegrityFlags(mock, ["INT_SEEN_CLIP"]);
    assert.deepEqual(eligibility(seen, "nazar_score").reasons, ["seen_clip"]);
    const practice = vec("nazar-edge-practice").expectedResult;
    assert.ok(eligibility(practice, "nazar_score").reasons.includes("not_mock"));
    assert.equal(eligibility(practice, "xp").eligible, true);
  });
  it("percentiles need a baseline; the field study needs cohort, consent and adulthood", () => {
    assert.deepEqual(eligibility(mock, "percentile", { baselineCount: 199 }).reasons, [
      "baseline_too_small",
    ]);
    assert.equal(eligibility(mock, "percentile", { baselineCount: 200 }).eligible, true);
    assert.equal(
      eligibility(mock, "field_study", { cohort: "field_test", consented: true, userBand: "adult" })
        .eligible,
      true,
    );
    assert.deepEqual(
      eligibility(mock, "field_study", { cohort: "field_test", consented: true, userBand: "u18" })
        .reasons,
      ["not_adult"],
    );
  });
});

describe("integrity checks", () => {
  const SID = "00000000-0000-4000-8000-0000000000bb";
  it("flags more than 20 taps in a second and impossible lateral speed", () => {
    const s = new StreamBuilder(SID);
    for (let i = 0; i < 21; i++) s.push("tap", { x: 0.5, y: 0.5 }, { t: 1000 + i * 40 });
    assert.equal(rateImpossible(s.build()), true);
    const lane = new StreamBuilder(SID);
    for (let i = 0; i < 10; i++)
      lane.push("lane_pos", { lateralCm: i % 2 === 0 ? 0 : 600, progressDm: i }, { t: i * 100 });
    assert.equal(rateImpossible(lane.build()), true, "6 m in 100 ms, sustained");
    const ok = new StreamBuilder(SID);
    for (let i = 0; i < 10; i++)
      ok.push("lane_pos", { lateralCm: i * 10, progressDm: i * 10 }, { t: i * 100 });
    assert.equal(rateImpossible(ok.build()), false);
  });
  it("offline seeds, expiry, seen clips and the event cap", () => {
    const ctx = ctxFor({
      n: 950,
      gameId: "nazar",
      mode: "practice",
      seed: 1,
      items: [],
      seedOrigin: "client_offline",
    });
    const s = new StreamBuilder(ctx.sid);
    s.push("session_end", { reason: "event_cap" }, { t: 5 });
    const a = runIntegrityChecks(ctx, s.build(), {
      maxEvents: 2000,
      defaultTimingMode: "none",
      hints: { seenClip: true, sessionExpired: true },
    });
    assert.deepEqual(a.flags, [
      "INT_SEEN_CLIP",
      "INT_EVENT_CAP",
      "INT_SESSION_EXPIRED",
      "INT_OFFLINE_SEED",
    ]);
  });
});

describe("replay entry point", () => {
  const v = vec("nazar-strong");
  const code = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      return e instanceof ReplayError ? e.code : `OTHER ${String(e)}`;
    }
    return "NONE";
  };
  it("rejects unsupported games and versions", () => {
    assert.equal(
      code(() =>
        replay({ ...v.manifest, scoringVersion: "9.9" }, v.ctx, v.replayPackage, v.content),
      ),
      "UNSUPPORTED_VERSION",
    );
    assert.equal(
      code(() =>
        replay({ ...v.manifest, gameId: "helmet_fit" }, v.ctx, v.replayPackage, v.content),
      ),
      "UNSUPPORTED_GAME",
    );
    assert.equal(SCORING_VERSIONS.golden_hour, undefined);
  });
  it("rejects mismatched context, seed and content", () => {
    assert.equal(
      code(() =>
        replay(v.manifest, { ...v.ctx, seed: v.ctx.seed + 1 }, v.replayPackage, v.content),
      ),
      "CONTEXT_MISMATCH",
    );
    assert.equal(
      code(() =>
        replay(v.manifest, v.ctx, v.replayPackage, {
          ...v.content,
          clips: v.content.gameId === "nazar" ? v.content.clips.slice(1) : [],
        } as never),
      ),
      "CONTENT_MISMATCH",
    );
    const other = vec("ll-mock-strong");
    assert.equal(
      code(() => replay(v.manifest, v.ctx, v.replayPackage, other.content)),
      "CONTENT_MISMATCH",
    );
    assert.equal(
      code(() => replay(v.manifest, { ...v.ctx, name: "x" } as never, v.replayPackage, v.content)),
      "CONTEXT_MISMATCH",
    );
  });
  it("the server result ignores what the client claims: hazard_response events do not score", () => {
    const events = decodeReplay(v.replayPackage, v.ctx.sid);
    const s = new StreamBuilder(v.ctx.sid);
    for (const e of events) s.events.push(e);
    s.push("hazard_response", { hazardId: "h1", band: 5, firstValidMt: 0 }, { t: 999999, item: 0 });
    const pkg = encodeReplay(s.build(), v.ctx.seed);
    const r = replay(v.manifest, v.ctx, pkg, v.content);
    assert.equal(r.score.raw, v.expectedResult.score.raw);
  });
});

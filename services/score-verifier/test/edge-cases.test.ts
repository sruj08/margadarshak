// Edge cases the verifier owns (EDGE_CASES EC-18, test T-EC-18a): spam-tapping is caught by the
// server replay, whatever the client claims.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { post, type Running, requestFor, startVerifier, vector } from "./helpers.ts";

describe("EC-18 on the verifier", () => {
  let v: Running;
  before(async () => {
    v = await startVerifier();
  });
  after(async () => {
    await v.close();
  });

  it("EC-18: a spam-tapped clip scores 0 on the server even when the client claims full marks", async () => {
    const g = vector("nazar-voided");
    const claimed = {
      ...g.expectedResult,
      score: {
        ...g.expectedResult.score,
        components: g.expectedResult.score.components.map((c) => ({ ...c, value: c.max })),
        raw: 100,
        pct: 100,
        passed: true,
      },
      findings: [],
    };
    const r = await post(v.url, requestFor(g, { clientResult: claimed }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const result = r.body["result"] as typeof g.expectedResult;
    assert.equal(result.score.pct, g.expectedResult.score.pct, "server score wins");
    assert.equal(result.score.passed, false);
    const pattern = result.findings.find((f) => f.findingId === "NAZ_PATTERN_CLICK");
    assert.ok(pattern, "the pattern finding explains the 0");
    const ordinal = g.ctx.items.findIndex((i) => i.ref === pattern.itemRef) + 1;
    const clip = result.score.components.find((c) => c.id === `clip_${ordinal}`);
    assert.equal(clip?.value, 0);
    assert.ok(result.integrity.flags.includes("INT_REPLAY_MISMATCH"));
  });
});

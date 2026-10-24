// Drift test for fixtures/golden.json (scripts/export-golden.ts): the committed contract file the Go
// contract test and the verifier's replay CLI read must match the golden vectors exactly.
// Regenerate with `node --experimental-strip-types scripts/export-golden.ts` and format with biome.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { GOLDEN_PATH, GOLDEN_SCHEMA, goldenExport } from "../scripts/export-golden.ts";
import { goldenVectors } from "../src/fixtures/index.ts";
import { SessionResult } from "../src/schema/index.ts";
import { canonicalDigest } from "../src/sdk/index.ts";

type GoldenFile = ReturnType<typeof goldenExport>;
const committed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;

describe("fixtures/golden.json", () => {
  it("matches the generator (run scripts/export-golden.ts when vectors change)", () => {
    assert.deepEqual(committed, JSON.parse(JSON.stringify(goldenExport())));
  });

  it("covers every golden vector once, with a valid result and its digest", () => {
    const names = goldenVectors().map((v) => v.name);
    assert.equal(committed.schema, GOLDEN_SCHEMA);
    assert.equal(committed.count, names.length);
    assert.deepEqual(
      committed.vectors.map((v) => v.name),
      names,
    );
    for (const v of committed.vectors) {
      const full = {
        ...v.expected.result,
        replay: { ...v.expected.result.replay, inputs: v.request.inputs },
      };
      assert.ok(SessionResult.safeParse(full).success, v.name);
      assert.equal(canonicalDigest(full), v.expected.digest, v.name);
      assert.equal(v.expected.eventsDigest, v.request.digest, v.name);
    }
  });

  it("Nazar requests carry their clip documents inline, other games do not", () => {
    for (const v of committed.vectors) {
      const content = (v.request as { content?: { items: { clipId: string }[] } }).content;
      if (v.gameId === "nazar") {
        assert.ok(content, v.name);
        assert.deepEqual(
          content.items.map((c) => `clip:${c.clipId}@1`),
          v.request.items.map((i) => i.ref),
          v.name,
        );
      } else {
        assert.equal(content, undefined, v.name);
      }
    }
  });
});

// P2 /verify extensions over HTTP: inline content documents (CompositeContentStore), the per-clip
// Nazar analysis, and fixtures/golden.json replayed through the real server (the Go contract).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fixtureContentDocs, fixtureFormats } from "@margdarshak/game-core/fixtures";
import {
  CompositeContentStore,
  DirectoryContentStore,
  FixtureContentStore,
  indexInline,
  inlineKey,
} from "../src/content-store.ts";
import type { ClipAnalysisJson, NazarAnalysis } from "../src/verify.ts";
import { call, type Reply, type Running, requestFor, startVerifier, vector } from "./helpers.ts";

const problem = (r: Reply, status: number, slug: string): void => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.match(r.type, /^application\/problem\+json/);
  assert.equal(r.body["type"], `https://margdarshak.example/problems/${slug}`);
};

const clipDocs = (name: string): unknown[] => {
  const docs = fixtureContentDocs();
  return vector(name).ctx.items.map((i) => docs[i.ref]);
};

describe("inline content keys", () => {
  it("derives refs from self-identifying documents and envelopes", () => {
    const docs = fixtureContentDocs();
    assert.deepEqual(inlineKey(docs["track:generic-8@1"]), {
      kind: "doc",
      ref: "track:generic-8@1",
      doc: docs["track:generic-8@1"],
    });
    assert.equal((inlineKey(docs["q:C-LL1-001:v1"]) as { ref: string }).ref, "q:C-LL1-001:v1");
    assert.deepEqual(inlineKey({ ref: "sd:r1-40-dry", doc: { round: 1 } }), {
      kind: "doc",
      ref: "sd:r1-40-dry",
      doc: { round: 1 },
    });
    assert.deepEqual(inlineKey(fixtureFormats()["HPT-KL"]), { kind: "format", id: "HPT-KL" });
    assert.equal(inlineKey({ round: 1, speedKmh: 40 }), null, "an sd round needs an envelope");
    assert.equal(inlineKey({ ref: "../../x", doc: {} }), null);
    assert.equal(inlineKey("clip"), null);
  });

  it("inline documents win over the base store, which serves everything else", async () => {
    const base = new FixtureContentStore();
    const own = { clipId: "KL-9999", version: 1 };
    const store = new CompositeContentStore(indexInline([own]), base);
    assert.equal(await store.doc("clip:KL-9999@1"), own);
    assert.deepEqual(await store.doc("q:C-LL1-001:v1"), await base.doc("q:C-LL1-001:v1"));
    assert.deepEqual(await store.format("HPT-KL"), fixtureFormats()["HPT-KL"]);
  });
});

describe("/verify with inline content", () => {
  let dir: string;
  let v: Running;
  before(async () => {
    // A store with format rows only: clip documents must come inline, as from the Go API.
    dir = mkdtempSync(join(tmpdir(), "verifier-inline-"));
    mkdirSync(join(dir, "formats"));
    for (const [id, row] of Object.entries(fixtureFormats()))
      writeFileSync(join(dir, "formats", `${id}.json`), JSON.stringify(row));
    v = await startVerifier({ store: new DirectoryContentStore(dir) });
  });
  after(async () => {
    await v.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("scores Nazar from inline clip documents and the store's HPT-KL row", async () => {
    const g = vector("nazar-medium");
    const missing = await call(v.url, "/verify", requestFor(g));
    problem(missing, 422, "content-not-found");
    const r = await call(v.url, "/verify", requestFor(g, { content: { items: clipDocs(g.name) } }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body["result"], g.expectedResult);
    assert.equal(r.body["analysis"], undefined, "no analysis unless asked");
  });

  it("an inline format row is used before the store's", async () => {
    const g = vector("nazar-medium");
    assert.equal(g.expectedResult.score.passed, true, "passes on the store's row (pass 60)");
    const strict = { ...(fixtureFormats()["HPT-KL"] as object), pass: 100 };
    const r = await call(
      v.url,
      "/verify",
      requestFor(g, { content: { items: [...clipDocs(g.name), strict] } }),
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const result = r.body["result"] as typeof g.expectedResult;
    assert.equal(result.score.passed, false, "pass mark 100 from the inline row");
  });

  it("rejects unkeyed, duplicate and malformed inline content (422, strict)", async () => {
    const g = vector("nazar-strong");
    const docs = clipDocs(g.name);
    const unkeyed = await call(
      v.url,
      "/verify",
      requestFor(g, { content: { items: [{ hello: 1 }] } }),
    );
    problem(unkeyed, 422, "validation-failed");
    assert.ok(
      (unkeyed.body["errors"] as { path: string }[]).some((e) => e.path === "content.items.0"),
    );
    const dup = await call(
      v.url,
      "/verify",
      requestFor(g, { content: { items: [docs[0], docs[0]] } }),
    );
    problem(dup, 422, "validation-failed");
    const extra = await call(
      v.url,
      "/verify",
      requestFor(g, { content: { items: docs, more: true } }),
    );
    problem(extra, 422, "validation-failed");
    const bad = structuredClone(docs) as { speedKmhEst: unknown }[];
    (bad[0] as { speedKmhEst: unknown }).speedKmhEst = null;
    const mismatch = await call(v.url, "/verify", requestFor(g, { content: { items: bad } }));
    problem(mismatch, 422, "content-mismatch");
  });
});

describe("/verify analysis", () => {
  let v: Running;
  before(async () => {
    v = await startVerifier();
  });
  after(async () => {
    await v.close();
  });

  it("returns per-clip analysis under both rules, consistent with the result", async () => {
    const g = vector("nazar-medium");
    const r = await call(
      v.url,
      "/verify",
      requestFor(g, { analysis: ["nazar_clips", "nazar_clips_linear"] }),
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body["result"], g.expectedResult, "analysis never changes the result");
    const analysis = r.body["analysis"] as Record<string, NazarAnalysis>;
    assert.deepEqual(Object.keys(analysis).sort(), ["nazar_clips", "nazar_clips_linear"]);
    assert.equal(analysis["nazar_clips"]?.rule, "kerala_5band");
    assert.equal(analysis["nazar_clips_linear"]?.rule, "field_kit_linear");
    for (const a of Object.values(analysis)) {
      assert.deepEqual(
        a.clips.map((c) => [c.ordinal, c.ref]),
        g.ctx.items.map((it, i) => [i + 1, it.ref]),
      );
    }
    // Kerala marks per clip equal the result's clip components (max 10 each before scaling).
    const kerala = analysis["nazar_clips"]?.clips as ClipAnalysisJson[];
    for (const c of kerala) {
      const comp = g.expectedResult.score.components.find((x) => x.id === `clip_${c.ordinal}`);
      assert.equal(comp?.value, c.marks, `clip ${c.ordinal}`);
      for (const h of c.hazards) {
        assert.ok(
          Object.keys(h).every((k) => !k.startsWith("window")),
          "no windows echoed",
        );
        if (h.credit === 0) assert.equal(h.lateS, null);
      }
    }
    // The worst late_s the scorer reports is in the per-clip analysis.
    const late = g.expectedResult.findings.find((f) => f.findingId === "NAZ_LATE_RESPONSE");
    if (late !== undefined) {
      const worst = Math.max(...kerala.flatMap((c) => c.hazards.map((h) => h.lateS ?? 0)));
      assert.equal(worst, late.facts["late_s"]);
    }
  });

  it("marks a spam-tapped clip as voided by the pattern rule", async () => {
    const g = vector("nazar-voided");
    const r = await call(v.url, "/verify", requestFor(g, { analysis: ["nazar_clips"] }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const clips = (r.body["analysis"] as Record<string, NazarAnalysis>)["nazar_clips"]?.clips ?? [];
    const pattern = g.expectedResult.findings.find((f) => f.findingId === "NAZ_PATTERN_CLICK");
    const voided = clips.find((c) => c.ref === pattern?.itemRef);
    assert.equal(voided?.voided, "pattern");
    assert.equal(voided?.marks, 0);
    assert.ok((voided?.maxTapsInWindow ?? 0) > 3);
  });

  it("analysis is Nazar-only, strict and unique", async () => {
    const ll = await call(
      v.url,
      "/verify",
      requestFor(vector("ll-mock-strong"), { analysis: ["nazar_clips"] }),
    );
    problem(ll, 422, "validation-failed");
    const g = vector("nazar-strong");
    for (const analysis of [["nazar_clips", "nazar_clips"], ["late"], []]) {
      const r = await call(v.url, "/verify", requestFor(g, { analysis }));
      problem(r, 422, "validation-failed");
    }
  });
});

describe("fixtures/golden.json over HTTP (the Go contract test's view)", () => {
  let v: Running;
  before(async () => {
    v = await startVerifier();
  });
  after(async () => {
    await v.close();
  });

  it("every vector's request reproduces the expected result and digest", async () => {
    const file = JSON.parse(
      readFileSync(
        new URL("../../../packages/game-core/fixtures/golden.json", import.meta.url),
        "utf8",
      ),
    ) as {
      count: number;
      vectors: {
        name: string;
        request: { inputs: string };
        expected: { result: { replay: object }; digest: string; eventsDigest: string };
      }[];
    };
    assert.equal(file.vectors.length, file.count);
    assert.ok(file.count >= 35);
    for (const g of file.vectors) {
      const r = await call(v.url, "/verify", g.request);
      assert.equal(r.status, 200, `${g.name}: ${JSON.stringify(r.body)}`);
      const want = {
        ...g.expected.result,
        replay: { ...g.expected.result.replay, inputs: g.request.inputs },
      };
      assert.deepEqual(r.body["result"], want, g.name);
      assert.equal(r.body["digest"], g.expected.digest, g.name);
      assert.equal(r.body["eventsDigest"], g.expected.eventsDigest, g.name);
    }
  });
});

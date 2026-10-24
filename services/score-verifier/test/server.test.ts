// End-to-end tests of the verifier over real HTTP.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fixtureContentDocs, fixtureFormats, goldenVectors } from "@margdarshak/game-core/fixtures";
import { canonicalDigest } from "@margdarshak/game-core/sdk";
import { DirectoryContentStore, refToPath } from "../src/content-store.ts";
import { sign } from "../src/hmac.ts";
import {
  NOW,
  post,
  type Reply,
  type Running,
  requestFor,
  SECRET,
  startVerifier,
  vector,
} from "./helpers.ts";

const problem = (r: Reply, status: number, typeSlug: string): void => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.match(r.type, /^application\/problem\+json/);
  assert.equal(r.body["type"], `https://margdarshak.example/problems/${typeSlug}`);
  assert.equal(r.body["status"], status);
};

describe("score verifier over HTTP", () => {
  let v: Running;
  before(async () => {
    v = await startVerifier();
  });
  after(async () => {
    await v.close();
  });

  it("GET /healthz and /versions", async () => {
    const h = await fetch(`${v.url}/healthz`);
    assert.equal(h.status, 200);
    assert.deepEqual(await h.json(), {
      status: "ok",
      service: "score-verifier",
      version: "0.1.0",
      content: "fixtures",
    });
    const ver = (await (await fetch(`${v.url}/versions`)).json()) as Record<string, unknown>;
    assert.deepEqual((ver["scoringVersions"] as Record<string, string[]>)["nazar"], ["1.0"]);
    assert.ok((ver["games"] as string[]).includes("ll_sim"));
  });

  it("verifies every golden vector and returns the expected server result", async () => {
    for (const g of goldenVectors()) {
      const r = await post(v.url, requestFor(g, { encoding: "mdr1" }), { signAt: NOW });
      assert.equal(r.status, 200, `${g.name}: ${JSON.stringify(r.body)}`);
      assert.deepEqual(r.body["result"], g.expectedResult, g.name);
      assert.equal(r.body["digest"], canonicalDigest(g.expectedResult), g.name);
      assert.equal(r.body["eventsDigest"], g.replayPackage.digest);
      assert.equal(r.body["comparison"], null);
      assert.equal(r.body["serverChecked"], true);
    }
  });

  it("a tampered client score is overwritten and flagged INT_REPLAY_MISMATCH", async () => {
    const g = vector("nazar-medium");
    const tampered = { ...g.expectedResult, score: { ...g.expectedResult.score, pct: 95 } };
    const r = await post(v.url, requestFor(g, { clientResult: tampered }));
    assert.equal(r.status, 200);
    const result = r.body["result"] as typeof g.expectedResult;
    assert.equal(result.score.pct, g.expectedResult.score.pct, "server score wins");
    assert.deepEqual(result.integrity.flags, ["INT_REPLAY_MISMATCH"]);
    assert.equal(result.integrity.trust, 0.7);
    const cmp = r.body["comparison"] as Record<string, unknown>;
    assert.equal(cmp["match"], false);
    assert.equal(cmp["clientPct"], 95);
    // An honest preview matches and costs nothing.
    const honest = await post(v.url, requestFor(g, { clientResult: g.expectedResult }), {
      signAt: NOW - 1,
    });
    assert.equal(honest.status, 200);
    assert.deepEqual((honest.body["result"] as typeof g.expectedResult).integrity.flags, []);
    assert.equal((honest.body["comparison"] as Record<string, unknown>)["match"], true);
  });

  it("passes server hints into the integrity flags", async () => {
    const g = vector("nazar-strong");
    const r = await post(v.url, requestFor(g, { hints: { seenClip: true, sessionExpired: true } }));
    assert.equal(r.status, 200);
    const result = r.body["result"] as typeof g.expectedResult;
    assert.deepEqual(result.integrity.flags, ["INT_SEEN_CLIP", "INT_SESSION_EXPIRED"]);
    assert.equal(result.integrity.trust, 0.8);
  });

  describe("HMAC", () => {
    const body = (): Record<string, unknown> => requestFor(vector("ll-mock-strong"));
    it("accepts a fresh signature once and rejects the replay", async () => {
      const text = JSON.stringify(body());
      const header = sign(SECRET, NOW - 10, text);
      assert.equal((await post(v.url, text, { header })).status, 200);
      const again = await post(v.url, text, { header });
      problem(again, 401, "unauthorized");
      assert.equal(again.body["code"], "signature_replayed");
    });
    it("rejects missing, malformed, stale and mismatched signatures", async () => {
      const text = JSON.stringify(body());
      const missing = await post(v.url, text, { header: null });
      problem(missing, 401, "unauthorized");
      assert.equal(missing.body["code"], "signature_missing");
      for (const header of ["t=abc,v1=00", "garbage", `t=${NOW},v1=xyz`, `v1=${"a".repeat(64)}`]) {
        const r = await post(v.url, text, { header });
        problem(r, 401, "unauthorized");
        assert.equal(r.body["code"], "signature_malformed", header);
      }
      const stale = await post(v.url, text, { signAt: NOW - 301 });
      assert.equal(stale.body["code"], "signature_stale");
      const future = await post(v.url, text, { signAt: NOW + 301 });
      assert.equal(future.body["code"], "signature_stale");
      const edge = await post(v.url, text, { signAt: NOW - 300 });
      assert.equal(edge.status, 200, "±300 s is inside the window");
      const wrongKey = await post(v.url, text, { secret: "another-secret", signAt: NOW - 2 });
      assert.equal(wrongKey.body["code"], "signature_mismatch");
      const header = sign(SECRET, NOW - 3, text);
      const altered = await post(v.url, text.replace('"mode":"mock"', '"mode":"practice"'), {
        header,
      });
      assert.equal(altered.body["code"], "signature_mismatch");
    });
  });

  describe("errors are problem+json", () => {
    it("unknown game, unsupported game and unsupported version", async () => {
      const g = vector("nazar-strong");
      const unknown = await post(v.url, requestFor(g, { gameId: "chess" }), { signAt: NOW - 20 });
      problem(unknown, 422, "validation-failed");
      assert.ok((unknown.body["errors"] as { path: string }[]).some((e) => e.path === "gameId"));
      const notYet = await post(v.url, requestFor(g, { gameId: "helmet_fit" }), {
        signAt: NOW - 21,
      });
      problem(notYet, 422, "unsupported-game");
      const version = await post(v.url, requestFor(g, { scoringVersion: "9.9" }), {
        signAt: NOW - 22,
      });
      problem(version, 422, "unsupported-version");
    });
    it("missing content, a forged digest and malformed JSON", async () => {
      const g = vector("nazar-strong");
      const items = [...g.ctx.items];
      items[0] = { ref: "clip:NOPE-0001@1", contentVersion: "1" };
      const missing = await post(v.url, requestFor(g, { items }), { signAt: NOW - 30 });
      problem(missing, 422, "content-not-found");
      const forged = await post(v.url, requestFor(g, { digest: `sha256:${"0".repeat(64)}` }), {
        signAt: NOW - 31,
      });
      problem(forged, 422, "digest-mismatch");
      const junk = await post(v.url, "{not json", { signAt: NOW - 32 });
      problem(junk, 400, "bad-request");
      const extra = await post(v.url, requestFor(g, { name: "Kabir" }), { signAt: NOW - 33 });
      problem(extra, 422, "validation-failed");
    });
    it("body limit, content type, unknown route and wrong method", async () => {
      const big = JSON.stringify({ pad: "x".repeat(300 * 1024) });
      const tooBig = await post(v.url, big, { signAt: NOW - 40 });
      problem(tooBig, 413, "payload-too-large");
      const text = await post(v.url, "a=b", { contentType: "text/plain", signAt: NOW - 41 });
      problem(text, 415, "unsupported-media-type");
      const nf = await fetch(`${v.url}/nope`);
      assert.equal(nf.status, 404);
      assert.match(nf.headers.get("content-type") ?? "", /problem\+json/);
      const get = await fetch(`${v.url}/verify`);
      assert.equal(get.status, 405);
      assert.equal(get.headers.get("allow"), "POST");
    });
  });

  it("logs one JSON line per request without bodies or signatures", async () => {
    const g = vector("sd-strong");
    await post(v.url, requestFor(g), { signAt: NOW - 50 });
    const joined = v.logs.join("\n");
    assert.ok(!joined.includes(g.replayPackage.inputs.slice(0, 40)), "replay inputs never logged");
    assert.ok(!joined.includes("v1="), "signatures never logged");
    assert.ok(!joined.includes(SECRET));
    const last = JSON.parse(v.logs.at(-1) as string) as Record<string, unknown>;
    assert.equal(last["msg"], "request");
    assert.equal(last["status"], 200);
    assert.equal(last["gameId"], "stopping_distance");
  });
});

describe("directory content store", () => {
  let dir: string;
  let v: Running;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "verifier-content-"));
    for (const [ref, doc] of Object.entries(fixtureContentDocs())) {
      const p = join(dir, refToPath(ref));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(doc));
    }
    mkdirSync(join(dir, "formats"));
    for (const [id, row] of Object.entries(fixtureFormats()))
      writeFileSync(join(dir, "formats", `${id}.json`), JSON.stringify(row));
    v = await startVerifier({ store: new DirectoryContentStore(dir) });
  });
  after(async () => {
    await v.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("maps refs to safe file names", () => {
    assert.equal(refToPath("clip:KL-0001@1"), join("clip", "KL-0001@1.json"));
    assert.equal(refToPath("q:C-LL1-001:v1"), join("q", "C-LL1-001_v1.json"));
    assert.throws(() => refToPath("clip:../../etc/passwd"));
    assert.throws(() => refToPath("clip:..json"));
    assert.throws(() => refToPath("nokind"));
  });

  it("verifies vectors from files, including the default LL format when a tenant has no row", async () => {
    for (const name of [
      "nazar-voided",
      "ll-mock-weak",
      "ll-mock-default-format",
      "tt-medium",
      "bs-left-overtake",
    ]) {
      const g = vector(name);
      const r = await post(v.url, requestFor(g), { signAt: NOW - 60 - name.length });
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
      assert.deepEqual(r.body["result"], g.expectedResult, name);
    }
  });
});

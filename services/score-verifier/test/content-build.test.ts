// scripts/build-content.ts: server keys for every bank item, honest format rows, fixture sim
// documents, the committed game-items index (drift), and a verifier serving the built directory.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { splitQuestionBank } from "@margdarshak/content";
import { loadContent } from "@margdarshak/content/node";
import { fixtureContentDocs, goldenVectors } from "@margdarshak/game-core/fixtures";
import { HptFormat, LlAnswerKey, LlExamFormat } from "@margdarshak/game-core/schema";
import { SCORING_VERSIONS, SUPPORTED_GAMES } from "@margdarshak/game-core/scoring";
import {
  type BuiltContent,
  buildContent,
  type GameItemsIndex,
  readGameItems,
  writeContent,
} from "../scripts/build-content.ts";
import { DirectoryContentStore, refToPath } from "../src/content-store.ts";
import { call, type Running, requestFor, startVerifier } from "./helpers.ts";

const built: BuiltContent = buildContent();
const bankItems = splitQuestionBank(loadContent().questionBanks).serverKey.keys;
const llVectors = goldenVectors().filter((v) => v.ctx.gameId === "ll_sim");
// States whose rule pack has a PRM-LL-FORMAT row with a known exam shape.
const LL_FORMAT_STATES = ["CG", "GJ", "JK", "KL", "MH", "PY", "RJ", "TS"];

describe("build-content: LL answer keys", () => {
  it("writes one valid LlAnswerKey per bank item at the directory store's path", () => {
    assert.ok(bankItems.length >= 200);
    for (const k of bankItems) {
      const rel = refToPath(`q:${k.item_id}`).replaceAll("\\", "/");
      const doc = built.files.get(rel);
      assert.ok(doc !== undefined, `no key for ${k.item_id}`);
      const key = LlAnswerKey.parse(doc);
      assert.equal(key.qref, k.item_id);
      assert.equal(key.correctOptionId, k.correct_option_id);
      assert.equal(key.cardId, k.concept_id);
    }
    const qFiles = [...built.files.keys()].filter((p) => p.startsWith("q/"));
    assert.equal(qFiles.length, bankItems.length, "no stray keys");
  });

  it("covers every item ref the LL golden vectors use (same concept card and topic)", () => {
    const fixture = fixtureContentDocs();
    for (const v of llVectors) {
      for (const it of v.ctx.items) {
        const doc = built.files.get(refToPath(it.ref).replaceAll("\\", "/"));
        assert.ok(doc !== undefined, `${v.name}: no key for ${it.ref}`);
        const real = LlAnswerKey.parse(doc);
        const fx = LlAnswerKey.parse(fixture[it.ref]);
        assert.equal(real.cardId, fx.cardId, it.ref);
        assert.equal(real.topic, fx.topic, it.ref);
      }
    }
  });
});

describe("build-content: formats and fixtures", () => {
  it("LLT-JK and HPT-KL come from the state packs with their own provenance", () => {
    const jk = LlExamFormat.parse(built.files.get("formats/LLT-JK.json"));
    assert.deepEqual(
      { known: jk.known, questions: jk.questions, pass: jk.pass },
      { known: true, questions: 10, pass: 6 },
    );
    assert.equal(jk.per_q_timer_s, null, "the pack has no timer: never invented");
    assert.equal(jk.total_timer_s, null);
    assert.equal(jk.confidence, "medium");
    assert.equal(jk.verified_on, "2026-10-22");
    assert.match(jk.source_url ?? "", /^https:\/\//);
    const kl = HptFormat.parse(built.files.get("formats/HPT-KL.json"));
    assert.deepEqual(
      [kl.clips, kl.marks_per_clip, kl.pass, kl.total_marks, kl.status],
      [10, 10, 60, 100, "announced"],
    );
    const formats = [...built.files.keys()].filter((p) => p.startsWith("formats/")).sort();
    assert.deepEqual(formats, [
      "formats/HPT-KL.json",
      ...LL_FORMAT_STATES.map((s) => `formats/LLT-${s}.json`),
    ]);
    // Kerala's pack sets timerSeconds: per question, as the web LL simulator reads it.
    const klLl = LlExamFormat.parse(built.files.get("formats/LLT-KL.json"));
    assert.equal(klLl.per_q_timer_s, 30);
    assert.equal(klLl.total_timer_s, null);
    const derived = built.index.formats.find((f) => f.ruleId === "HPT-KL")?.derived ?? [];
    assert.ok(
      derived.some((d) => d.startsWith("max_hazards_per_clip")),
      "derivations recorded",
    );
  });

  it("copies the sim fixtures and no clip documents", () => {
    const kinds = new Set([...built.files.keys()].map((p) => p.split("/")[0]));
    for (const k of ["q", "formats", "sd", "bs", "js", "track"]) assert.ok(kinds.has(k), k);
    assert.ok(!kinds.has("clip"), "clips come inline from the API");
    assert.ok(built.files.has("track/generic-8@1.json"));
  });
});

describe("content/generated/game-items.json", () => {
  const index = built.index;

  it("matches the generator (run `pnpm build:content` when content changes)", () => {
    assert.deepEqual(readGameItems(), JSON.parse(JSON.stringify(index)));
  });

  it("lists every supported game with game-core's versions, sorted, without keys", () => {
    const games = index.games.map((g) => g.gameId);
    assert.deepEqual(games, [...SUPPORTED_GAMES].sort());
    for (const g of index.games) {
      assert.deepEqual(g.scoringVersions, SCORING_VERSIONS[g.gameId]);
      const refs = g.items.map((i) => i.ref);
      assert.deepEqual(refs, [...refs].sort(), `${g.gameId} items sorted`);
      for (const i of g.items) assert.ok(i.ref.startsWith(`${g.itemKind}:`), i.ref);
    }
    const ll = index.games.find((g) => g.gameId === "ll_sim") as GameItemsIndex["games"][number];
    assert.equal(ll.items.length, bankItems.length);
    assert.ok(
      ll.items.some((i) => i.pool === "mock") && ll.items.some((i) => i.pool === "practice"),
    );
    assert.deepEqual(
      ll.formats,
      LL_FORMAT_STATES.map((s) => `LLT-${s}`),
    );
    const text = readFileSync(
      new URL("../../../content/generated/game-items.json", import.meta.url),
      "utf8",
    );
    assert.ok(!/correctOptionId|correct_option_id|"window"/.test(text), "no answers or windows");
    const sd = index.games.find((g) => g.gameId === "stopping_distance");
    assert.equal(sd?.source, "game-core-fixtures");
    assert.equal(index.games.find((g) => g.gameId === "nazar")?.items.length, 0);
  });
});

describe("the verifier serving a built content directory", () => {
  let dir: string;
  let v: Running;
  before(async () => {
    dir = join(mkdtempSync(join(tmpdir(), "verifier-built-")), "content");
    writeContent(built, dir, null);
    v = await startVerifier({ store: new DirectoryContentStore(dir) });
  });
  after(async () => {
    await v.close();
    rmSync(join(dir, ".."), { recursive: true, force: true });
  });

  it("writes the directory layout (and refuses to replace a foreign directory)", () => {
    assert.ok(existsSync(join(dir, "BUILD.json")));
    assert.equal(readdirSync(join(dir, "q")).length, bankItems.length);
    const foreign = mkdtempSync(join(tmpdir(), "verifier-foreign-"));
    assert.throws(() => writeContent(built, foreign, null), /refusing/);
    rmSync(foreign, { recursive: true, force: true });
  });

  it("replays the LL golden vectors' sessions with the real keys and LLT-JK", async () => {
    for (const g of llVectors) {
      const r = await call(v.url, "/verify", requestFor(g));
      assert.equal(r.status, 200, `${g.name}: ${JSON.stringify(r.body)}`);
      const result = r.body["result"] as typeof g.expectedResult;
      assert.equal(result.score.max, g.ctx.items.length);
      if (g.ctx.mode === "mock" && g.ctx.tenant === "JK") {
        assert.deepEqual(result.score.passRule, { source: "rule_pack", ref: "LLT-JK" });
      }
    }
  });

  it("replays the sim golden vectors from the copied fixtures unchanged", async () => {
    for (const g of goldenVectors().filter((x) => !["nazar", "ll_sim"].includes(x.ctx.gameId))) {
      const r = await call(v.url, "/verify", requestFor(g));
      assert.equal(r.status, 200, `${g.name}: ${JSON.stringify(r.body)}`);
      assert.deepEqual(r.body["result"], g.expectedResult, g.name);
    }
  });
});

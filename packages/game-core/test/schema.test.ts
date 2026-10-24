// Contract tests for the schemas: PII guard, strictness of every event type, JSON Schema drift.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manifestFor } from "../src/fixtures/builders.ts";
import { goldenVectors } from "../src/fixtures/index.ts";
import {
  DRILL_ID_RE,
  EXPORTED_SCHEMAS,
  FACT_KEY_RE,
  GAME_EVENT_TYPES,
  GameEvent,
  GameManifest,
  ReplayPackage,
  SessionContext,
  SessionResult,
  toJsonSchemas,
} from "../src/schema/index.ts";
import { SUPPORTED_GAMES } from "../src/scoring/index.ts";
import { decodeReplay } from "../src/sdk/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** One valid sample per event type, from the golden streams plus a few hand-written ones. */
function sampleEvents(): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const v of goldenVectors()) {
    for (const e of decodeReplay(v.replayPackage, v.ctx.sid))
      if (!out.has(e.type)) out.set(e.type, e as never);
  }
  const base = { sid: "00000000-0000-4000-8000-000000000001", seq: 0, t: 10 };
  const extra: [string, Record<string, unknown>][] = [
    ["hazard_response", { hazardId: "h1", band: 3, firstValidMt: 1200 }],
    ["prediction", { choice: "door_opening" }],
    ["indicator", { side: "left" }],
    ["gear_choice", { gear: 2 }],
    ["horn", {}],
    ["beam_toggle", { state: "low" }],
    ["camera_check", { faceCentred: true, chinVisible: false }],
    ["step_confirm", { stepId: "strap" }],
    ["card_order", { cardId: "call_112", position: 1 }],
    ["commentary_marker", { startMt: 100, endMt: 900 }],
    ["pause", { cause: "user" }],
    ["resume", { cause: "user" }],
    ["a11y_toggle", { mode: "tap_only", on: true }],
  ];
  for (const [type, p] of extra) if (!out.has(type)) out.set(type, { ...base, type, p });
  return out;
}

/** Field names that read like personal data. Short ambiguous names match whole tokens only. */
const PII_TOKENS = new Set(["name", "dob", "lat", "lng", "lon", "latitude", "longitude"]);
const PII_SUBSTRINGS = ["phone", "email", "aadhaar", "aadhar", "address", "mobile", "birth"];
function looksPersonal(field: string): boolean {
  const lower = field.toLowerCase();
  if (PII_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  const tokens = field
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\-.]/);
  return tokens.some((t) => PII_TOKENS.has(t));
}

function propertyNames(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const x of node) propertyNames(x, acc);
  } else if (node !== null && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o["properties"] !== null && typeof o["properties"] === "object") {
      acc.push(...Object.keys(o["properties"] as object));
    }
    for (const v of Object.values(o)) propertyNames(v, acc);
  }
  return acc;
}

describe("schema", () => {
  it("PII guard: no exported schema has a field named like personal data", () => {
    const docs = toJsonSchemas();
    const offenders: string[] = [];
    for (const [name, doc] of Object.entries(docs)) {
      for (const field of propertyNames(doc))
        if (looksPersonal(field)) offenders.push(`${name}.${field}`);
    }
    assert.deepEqual(offenders, []);
    // The guard itself catches the names the spec lists.
    for (const bad of [
      "name",
      "dob",
      "phone",
      "email",
      "aadhaar",
      "lat",
      "lng",
      "address",
      "userName",
      "phoneNumber",
    ]) {
      assert.ok(looksPersonal(bad), bad);
    }
    for (const ok of ["lateralCm", "progressDm", "clipId", "hazardType", "explainKey"])
      assert.ok(!looksPersonal(ok), ok);
  });

  it("SessionContext rejects any extra key (no personal data by construction)", () => {
    const ctx = goldenVectors()[0]?.ctx;
    assert.ok(ctx !== undefined);
    assert.equal(SessionContext.safeParse(ctx).success, true);
    for (const k of ["name", "dob", "phone", "caseId", "gps"]) {
      assert.equal(SessionContext.safeParse({ ...ctx, [k]: "x" }).success, false, k);
    }
  });

  it("every event type has a sample and rejects an extra key in the envelope and the payload", () => {
    const samples = sampleEvents();
    for (const type of GAME_EVENT_TYPES) {
      const e = samples.get(type);
      assert.ok(e !== undefined, `no sample for ${type}`);
      assert.equal(GameEvent.safeParse(e).success, true, `valid ${type}`);
      assert.equal(
        GameEvent.safeParse({ ...e, extra: 1 }).success,
        false,
        `envelope extra on ${type}`,
      );
      const p = e["p"] as Record<string, unknown>;
      assert.equal(
        GameEvent.safeParse({ ...e, p: { ...p, extra: 1 } }).success,
        false,
        `payload extra on ${type}`,
      );
    }
  });

  it("event bounds: quantised taps, bounded strings, integer times, seq cap", () => {
    const tap = {
      sid: "00000000-0000-4000-8000-000000000001",
      seq: 1,
      t: 10,
      mt: 5,
      type: "tap",
      p: { x: 0.25, y: 0.5 },
    };
    assert.equal(GameEvent.safeParse(tap).success, true);
    assert.equal(
      GameEvent.safeParse({ ...tap, p: { x: 0.251, y: 0.5 } }).success,
      false,
      "3 dp tap",
    );
    assert.equal(
      GameEvent.safeParse({ ...tap, p: { x: 1.2, y: 0.5 } }).success,
      false,
      "out of range",
    );
    assert.equal(GameEvent.safeParse({ ...tap, t: 10.5 }).success, false, "fractional t");
    assert.equal(
      GameEvent.safeParse({ ...tap, seq: 5000 }).success,
      false,
      "seq beyond the event cap",
    );
    const decision = { ...tap, type: "decision", p: { node: "go", choice: "x".repeat(25) } };
    assert.equal(GameEvent.safeParse(decision).success, false, "string > 24");
  });

  it("JSON Schema export matches the committed schema/*.json (drift check for the Go API)", () => {
    const dir = join(here, "..", "schema");
    const docs = toJsonSchemas();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
    assert.deepEqual(
      files,
      Object.keys(docs).sort(),
      "schema files vs exported schemas (run `pnpm schemas`)",
    );
    for (const [name, doc] of Object.entries(docs)) {
      const committed = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
      assert.deepEqual(
        committed,
        doc,
        `${name}.json drifted: run node --experimental-strip-types scripts/write-schemas.ts`,
      );
    }
    assert.equal(Object.keys(EXPORTED_SCHEMAS).length, Object.keys(docs).length);
  });

  it("reference manifests and golden results validate", () => {
    for (const g of SUPPORTED_GAMES)
      assert.equal(GameManifest.safeParse(manifestFor(g)).success, true, g);
    for (const v of goldenVectors()) {
      assert.equal(ReplayPackage.safeParse(v.replayPackage).success, true, v.name);
      const r = SessionResult.safeParse(v.expectedResult);
      assert.equal(
        r.success,
        true,
        `${v.name}: ${r.success ? "" : JSON.stringify(r.error.issues[0])}`,
      );
      for (const f of v.expectedResult.findings) {
        for (const k of Object.keys(f.facts))
          assert.match(k, FACT_KEY_RE, `${v.name} ${f.findingId}.${k}`);
        for (const d of f.drillIds) assert.match(d, DRILL_ID_RE, `${v.name} ${d}`);
        assert.ok(
          v.manifest.findingIds.includes(f.findingId),
          `${v.name}: ${f.findingId} not in the manifest`,
        );
      }
    }
  });

  it("the manifest label is the fixed practice line", () => {
    const m = manifestFor("nazar");
    assert.equal(
      GameManifest.safeParse({ ...m, label: { en: "Any other label", hi: m.label.hi } }).success,
      false,
    );
  });
});

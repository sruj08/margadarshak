// biome-ignore-all lint/complexity/useLiteralKeys: tsconfig.base sets noPropertyAccessFromIndexSignature, which requires bracket access on index signatures.
// Conformance: the TS mirror must produce byte-identical canonical JSON to the
// Go engine on every golden case (tests/golden/snapshots are written by the Go
// engine), and must satisfy every `expect` subset.
//   node --test --experimental-strip-types packages/rules/test/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { PackFile, PackSources, PlanInput } from "../src/index.ts";
import { canonicalJSON, compileAll, InputError, plan, sha256Hex } from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const readJSON = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

function loadSources(): PackSources {
  const rp = join(root, "rulepacks");
  const states: { [k: string]: PackFile } = {};
  for (const f of readdirSync(join(rp, "states"))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const pf = readJSON(join(rp, "states", f)) as PackFile;
    states[pf.packId] = pf;
  }
  return {
    base: readJSON(join(rp, "base", "cmvr.json")) as PackSources["base"],
    states,
    fees: readJSON(join(rp, "fees.json")) as PackSources["fees"],
    classes: readJSON(join(rp, "classes.json")) as PackSources["classes"],
  };
}

type J = null | boolean | number | string | J[] | { [k: string]: J };

// Same matcher as golden_test.go (matchSubset).
function matchSubset(exp: J, act: J, path: string): string[] {
  if (exp !== null && typeof exp === "object" && !Array.isArray(exp)) {
    if ("$includes" in exp || "$excludes" in exp || "$len" in exp) {
      if (!Array.isArray(act)) return [`${path}: expected an array`];
      const out: string[] = [];
      const inc = exp["$includes"];
      if (Array.isArray(inc)) {
        inc.forEach((item, i) => {
          if (!act.some((a) => matchSubset(item, a, path).length === 0))
            out.push(`${path}: $includes[${i}] ${canonicalJSON(item)} not found`);
        });
      }
      const exc = exp["$excludes"];
      if (Array.isArray(exc)) {
        exc.forEach((item, i) => {
          if (act.some((a) => matchSubset(item, a, path).length === 0))
            out.push(`${path}: $excludes[${i}] ${canonicalJSON(item)} found`);
        });
      }
      if ("$len" in exp && act.length !== exp["$len"])
        out.push(`${path}: length ${act.length}, want ${String(exp["$len"])}`);
      return out;
    }
    if (act === null || typeof act !== "object" || Array.isArray(act))
      return [`${path}: expected an object`];
    const out: string[] = [];
    for (const k of Object.keys(exp).sort()) {
      if (!(k in act)) {
        out.push(`${path}.${k}: missing`);
        continue;
      }
      out.push(...matchSubset(exp[k] as J, act[k] as J, `${path}.${k}`));
    }
    return out;
  }
  if (Array.isArray(exp)) {
    if (!Array.isArray(act)) return [`${path}: expected an array`];
    if (act.length !== exp.length) return [`${path}: length ${act.length}, want ${exp.length}`];
    return exp.flatMap((e, i) => matchSubset(e, act[i] as J, `${path}[${i}]`));
  }
  const a = canonicalJSON(act);
  const e = canonicalJSON(exp);
  return a === e ? [] : [`${path}: got ${a}, want ${e}`];
}

interface GoldenCase {
  id: string;
  refs?: string[];
  input: PlanInput;
  expect?: J;
  expect_error?: { code: string; field: string };
}

const packs = compileAll(loadSources());
const goldenDir = join(root, "tests", "golden");
const files = readdirSync(goldenDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

function run(input: PlanInput): J {
  try {
    return JSON.parse(JSON.stringify(plan(packs, input))) as J;
  } catch (e) {
    if (e instanceof InputError) return { error: { code: e.code, field: e.field } };
    throw e;
  }
}

let total = 0;
for (const f of files) {
  const gf = readJSON(join(goldenDir, f)) as { cases: GoldenCase[] };
  const snaps = readJSON(join(goldenDir, "snapshots", f)) as { [id: string]: J };
  describe(f, () => {
    for (const gc of gf.cases) {
      total++;
      it(gc.id, () => {
        const out = run(gc.input);
        const exp: J = gc.expect_error ? { error: gc.expect_error } : (gc.expect as J);
        assert.ok(exp !== undefined, "case has neither expect nor expect_error");
        assert.deepEqual(matchSubset(exp, out, "$"), []);
        const snap = snaps[gc.id];
        assert.ok(snap !== undefined, `no Go snapshot for ${gc.id}`);
        assert.equal(
          canonicalJSON(out),
          canonicalJSON(snap),
          "TS output differs from the Go engine",
        );
      });
    }
  });
}

describe("suite", () => {
  it("has at least 80 golden cases (MD-034)", () => assert.ok(total >= 80, `only ${total} cases`));
  it("sha256 matches node:crypto", () => {
    for (const s of [
      "",
      "abc",
      "x".repeat(1000),
      'हिन्दी ₹   "q" \\ \n',
      canonicalJSON({ b: [1, 2], a: null }),
    ]) {
      assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });
  it("canonical JSON sorts keys and keeps integers", () => {
    assert.equal(canonicalJSON({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
    assert.throws(() => canonicalJSON({ a: 1.5 }));
  });
});

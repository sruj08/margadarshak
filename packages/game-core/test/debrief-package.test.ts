// Package hygiene for ./debrief: the subpath export follows the three-condition pattern, the
// debrief schemas are exported as JSON Schema for the Go side, the root re-exports the main entry
// points, and src/debrief never reads the clock or Math.random (callers pass `now`).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as rootIndex from "../src/index.ts";
import { toJsonSchemas } from "../src/schema/index.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
  exports: Record<string, Record<string, string>>;
};

describe("debrief package", () => {
  it("./debrief maps margdarshak-source → src, types → dist .d.ts, default → dist .js", () => {
    const e = pkg.exports["./debrief"];
    assert.ok(e !== undefined);
    assert.deepEqual(Object.keys(e), ["margdarshak-source", "types", "default"]);
    assert.equal(e["margdarshak-source"], "./src/debrief/index.ts");
    assert.ok(existsSync(join(pkgRoot, "src/debrief/index.ts")));
    assert.equal(e["types"], "./dist/debrief/index.d.ts");
    assert.equal(e["default"], "./dist/debrief/index.js");
  });

  it("FactsPack, DebriefDraft and DebriefCard are exported as JSON Schema", () => {
    const docs = toJsonSchemas();
    for (const name of ["FactsPack", "DebriefDraft", "DebriefCard"] as const) {
      assert.equal(docs[name]?.["title"], name);
      assert.equal(docs[name]?.["type"], "object");
      assert.equal(docs[name]?.["additionalProperties"], false, `${name} is strict`);
    }
  });

  it("the package root re-exports the debrief entry points", () => {
    for (const name of [
      "generateFindings",
      "renderTemplateCard",
      "renderDraft",
      "validateDraft",
      "FactsPack",
      "DebriefDraft",
      "DebriefCard",
    ]) {
      assert.ok(name in rootIndex, name);
    }
  });

  it("src/debrief reads no clock and no randomness", () => {
    const dir = join(pkgRoot, "src/debrief");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(src, /Date\.now|new Date\(|Math\.random|performance\.now/, f);
    }
  });
});

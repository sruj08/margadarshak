// Package hygiene: version constant in step with package.json; every subpath export resolves to a
// source entry and a dist entry with the same name.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GAME_CORE_VERSION } from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version: string;
  exports: Record<string, string | Record<string, string>>;
  dependencies: Record<string, string>;
};

describe("package", () => {
  it("GAME_CORE_VERSION matches package.json", () => {
    assert.equal(GAME_CORE_VERSION, pkg.version);
  });
  it("has zero runtime dependencies beyond zod", () => {
    assert.deepEqual(Object.keys(pkg.dependencies), ["zod"]);
  });
  it("every subpath maps margdarshak-source → src/*.ts and default → dist/*.js", () => {
    // Code subpaths only ("./package.json" is a plain file export).
    const subpaths = Object.keys(pkg.exports).filter((sp) => typeof pkg.exports[sp] === "object");
    for (const sp of [".", "./schema", "./scoring", "./sdk", "./sdk/browser", "./debrief"]) {
      assert.ok(subpaths.includes(sp), `${sp} is exported`);
    }
    for (const sp of subpaths) {
      const e = pkg.exports[sp];
      assert.ok(typeof e === "object", sp);
      const src = e["margdarshak-source"] as string;
      assert.ok(existsSync(join(root, src)), `${sp} → ${src}`);
      assert.equal(e["default"], src.replace("./src/", "./dist/").replace(/\.ts$/, ".js"), sp);
      assert.equal(e["types"], src.replace("./src/", "./dist/").replace(/\.ts$/, ".d.ts"), sp);
    }
  });
});

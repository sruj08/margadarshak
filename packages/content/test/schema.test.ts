// Every content file validates against its Zod schema, and the committed JSON Schemas
// (content/schema/*.schema.json) never drift from Zod.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ContentError, parseContent } from "../src/model.ts";
import { CONTENT_DIR, readJson, readRawContent } from "../src/node.ts";
import { SCHEMAS, toJsonSchema } from "../src/schema/registry.ts";
import { content } from "./helpers.ts";

describe("schemas", () => {
  it("every content file parses against its Zod schema", () => {
    const c = content();
    assert.equal(c.modules.length, 28);
    assert.equal(c.questionBanks.length, 4);
  });

  it("every data file points $schema at the matching JSON Schema", () => {
    const raw = readRawContent() as unknown as Record<string, unknown>;
    const expect: Record<string, string> = {
      rules: "../schema/rules.schema.json",
      findings: "../schema/findings.schema.json",
      drills: "../schema/drills.schema.json",
      skills: "../schema/skills.schema.json",
      games: "../schema/games.schema.json",
      hazardTypes: "../schema/hazard-types.schema.json",
      enums: "../schema/enums.schema.json",
      signs: "../schema/signs.schema.json",
      illustrations: "../schema/illustrations.schema.json",
    };
    for (const [k, path] of Object.entries(expect)) {
      assert.equal((raw[k] as { $schema?: string }).$schema, path, k);
    }
    for (const m of raw["modules"] as { $schema?: string }[]) {
      assert.equal(m.$schema, "../schema/module.schema.json");
    }
    for (const b of raw["questionBanks"] as { $schema?: string }[]) {
      assert.equal(b.$schema, "../schema/question-bank.schema.json");
    }
  });

  it("committed JSON Schemas match the Zod schemas (regenerate with gen:schemas)", () => {
    for (const entry of SCHEMAS) {
      const committed = readJson(join(CONTENT_DIR, "schema", entry.file));
      assert.deepEqual(committed, toJsonSchema(entry), `${entry.file} drifted from Zod`);
    }
  });

  it("content/schema holds exactly the registry's files", () => {
    const files = readdirSync(join(CONTENT_DIR, "schema")).sort();
    assert.deepEqual(files, SCHEMAS.map((s) => s.file).sort());
  });

  it("JSON Schemas are draft 2020-12 with a stable $id", () => {
    for (const entry of SCHEMAS) {
      const s = toJsonSchema(entry);
      assert.equal(s["$schema"], "https://json-schema.org/draft/2020-12/schema");
      assert.match(String(s["$id"]), new RegExp(`${entry.file.replace(".", "\\.")}$`));
    }
  });

  it("rejects a malformed file with a readable issue list", () => {
    const raw = readRawContent();
    const broken = structuredClone(raw) as unknown as { rules: { rules: { rule_id: string }[] } };
    (broken.rules.rules[0] as { rule_id: string }).rule_id = "not-a-rule";
    assert.throws(
      () => parseContent(broken as unknown as ReturnType<typeof readRawContent>),
      (e: unknown) =>
        e instanceof ContentError && e.issues.some((i) => i.includes("rules.0.rule_id")),
    );
  });

  it("rejects unknown keys (strict objects)", () => {
    const raw = structuredClone(readRawContent()) as unknown as {
      drills: { drills: Record<string, unknown>[] };
    };
    (raw.drills.drills[0] as Record<string, unknown>)["surprise"] = true;
    assert.throws(
      () => parseContent(raw as unknown as ReturnType<typeof readRawContent>),
      ContentError,
    );
  });
});

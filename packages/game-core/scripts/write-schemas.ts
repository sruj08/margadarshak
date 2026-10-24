// Writes packages/game-core/schema/<Name>.json from toJsonSchemas(). The Go API consumes these;
// test/json-schema.test.ts fails when the committed files drift from the Zod schemas.
//   node --experimental-strip-types scripts/write-schemas.ts
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toJsonSchemas } from "../src/schema/json-schema.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(dir, { recursive: true });
const docs = toJsonSchemas();
for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f));
for (const [name, doc] of Object.entries(docs)) {
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
}
process.stdout.write(`wrote ${Object.keys(docs).length} JSON Schemas to ${dir}\n`);

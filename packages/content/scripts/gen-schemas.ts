// Writes content/schema/*.schema.json (JSON Schema 2020-12) from the Zod schemas.
//   node --experimental-strip-types scripts/gen-schemas.ts
// A test fails if the committed files drift from Zod. Output is Biome-formatted.
import { join } from "node:path";
import { CONTENT_DIR, writeJson } from "../src/node.ts";
import { SCHEMAS, toJsonSchema } from "../src/schema/registry.ts";
import { formatWithBiome } from "./format.ts";

const written = SCHEMAS.map((entry) => {
  const path = join(CONTENT_DIR, "schema", entry.file);
  writeJson(path, toJsonSchema(entry));
  return path;
});
formatWithBiome(written);
console.warn(`wrote ${SCHEMAS.length} schemas to content/schema/`);

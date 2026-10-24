// Writes schema/clip.schema.json from the Zod schema. Run: node --experimental-strip-types scripts/gen-schema.ts
// test/schema.test.ts fails if the committed file drifts from the generator.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clipJsonSchema } from "../src/schema.ts";

export function renderClipSchema(): string {
  return `${JSON.stringify(clipJsonSchema(), null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL("../schema/clip.schema.json", import.meta.url));
  writeFileSync(out, renderClipSchema(), "utf8");
  console.warn(`wrote ${out}`);
}

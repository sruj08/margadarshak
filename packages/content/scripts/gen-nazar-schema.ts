// Writes content/nazar/scenes.schema.json (JSON Schema 2020-12) from the Zod schema (ADR-0013).
//   node --experimental-strip-types scripts/gen-nazar-schema.ts
// test/nazar-scenes.test.ts fails if the committed file drifts from Zod. Output is Biome-formatted.
import { nazarScenesJsonSchema } from "../src/nazar.ts";
import { NAZAR_SCENES_SCHEMA_PATH, writeJson } from "../src/node.ts";
import { formatWithBiome } from "./format.ts";

writeJson(NAZAR_SCENES_SCHEMA_PATH, nazarScenesJsonSchema());
formatWithBiome([NAZAR_SCENES_SCHEMA_PATH]);
console.warn(`wrote ${NAZAR_SCENES_SCHEMA_PATH}`);

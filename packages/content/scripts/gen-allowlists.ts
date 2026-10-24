// Writes content/generated/allowlists.json from the validated catalogues.
//   node --experimental-strip-types scripts/gen-allowlists.ts
// Deterministic (sorted, no timestamps). A test fails if the committed file drifts.
import { join } from "node:path";
import { CONTENT_DIR, generateAllowlists, loadContent, writeJson } from "../src/node.ts";
import { formatWithBiome } from "./format.ts";

const allowlists = generateAllowlists(loadContent());
const path = join(CONTENT_DIR, "generated", "allowlists.json");
writeJson(path, allowlists);
formatWithBiome([path]);
console.warn(
  `wrote content/generated/allowlists.json: ${allowlists.debrief_agent.finding_ids.length} findings, ` +
    `${allowlists.debrief_agent.rule_ids.length} citable rules, ${allowlists.coach_agent.drill_ids.length} coach drills`,
);

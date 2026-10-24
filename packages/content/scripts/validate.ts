// Validates the whole content pack: schemas, cross-file checks, rule-pack references, wording.
//   node --experimental-strip-types scripts/validate.ts

import { join } from "node:path";
import {
  checkAllowlists,
  checkRulepackRefs,
  checkWording,
  runContentChecks,
} from "../src/checks.ts";
import {
  CONTENT_DIR,
  loadContent,
  loadNazarScenes,
  readJson,
  readRulepacks,
  readWordingTerms,
} from "../src/node.ts";
import { AllowlistsFile } from "../src/schema/allowlists.ts";

const content = loadContent();
const nazar = loadNazarScenes();
const results: { [k: string]: string[] } = {
  ...runContentChecks(content),
  ...Object.fromEntries(Object.entries(nazar.issues).map(([k, v]) => [`nazarScenes.${k}`, v])),
  rulepackRefs: checkRulepackRefs(content, { files: readRulepacks() }),
  wording: checkWording(content, readWordingTerms()),
  allowlists: checkAllowlists(
    content,
    AllowlistsFile.parse(readJson(join(CONTENT_DIR, "generated", "allowlists.json"))),
  ),
};
let failed = 0;
for (const [name, issues] of Object.entries(results)) {
  if (issues.length === 0) continue;
  failed += issues.length;
  console.error(`${name}: ${issues.length} issue(s)`);
  for (const i of issues) console.error(`  ${i}`);
}
if (failed > 0) process.exitCode = 1;
else console.warn(`content valid (${Object.keys(results).length} checks).`);

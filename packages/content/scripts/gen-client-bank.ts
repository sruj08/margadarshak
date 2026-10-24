// Writes the client-safe LL bank and the practice feedback pack to content/generated/ (committed,
// drift-tested by test/client-bank.test.ts) so the web app can import them and play offline.
// The server key is never written here: the score verifier builds its own answer keys.
//   node --experimental-strip-types scripts/gen-client-bank.ts
import { join } from "node:path";
import { CONTENT_DIR, loadContent, writeJson } from "../src/node.ts";
import { splitQuestionBank } from "../src/split.ts";

const split = splitQuestionBank(loadContent().questionBanks);
writeJson(join(CONTENT_DIR, "generated", "ll-bank.client.json"), split.client);
writeJson(join(CONTENT_DIR, "generated", "ll-bank.practice-key.json"), split.practiceKey);
console.warn(
  `wrote ${split.client.items.length} client items and ${split.practiceKey.keys.length} practice keys to content/generated/`,
);

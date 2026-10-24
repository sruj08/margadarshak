// Splits the LL bank (server-side content) into the client-safe bank, the practice feedback
// pack and the server-only key. Run by the build that publishes content; output is not committed.
//   node --experimental-strip-types scripts/split-questions.ts --out <dir>
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadContent, writeJson } from "../src/node.ts";
import { splitQuestionBank } from "../src/split.ts";

const i = process.argv.indexOf("--out");
const outArg = i >= 0 ? process.argv[i + 1] : undefined;
if (!outArg) {
  console.error("usage: split-questions.ts --out <dir>");
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const split = splitQuestionBank(loadContent().questionBanks);
writeJson(join(out, "ll-bank.client.json"), split.client);
writeJson(join(out, "ll-bank.practice-key.json"), split.practiceKey);
writeJson(join(out, "ll-bank.server-key.json"), split.serverKey);
console.warn(
  `wrote ${split.client.items.length} client items, ${split.practiceKey.keys.length} practice keys, ` +
    `${split.serverKey.keys.length} server keys to ${out}`,
);

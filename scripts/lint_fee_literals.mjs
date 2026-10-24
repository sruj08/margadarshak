#!/usr/bin/env node
/**
 * Fee-literal lint (MD-004, D-06): no rupee amount may be typed into UI copy, UI source or prompts.
 * Fees come from rulepacks/fees.json (integer paise) and are formatted by Intl at render time:
 * messages carry ICU placeholders such as {fee_one_class, number, inr}.
 *
 *   node scripts/lint_fee_literals.mjs [--docs] [--self-test] [files...]
 */
import { join, resolve } from "node:path";
import { defaultTargets, loadAllowlist, ROOT, report, scan } from "./lint_wording.lib.mjs";

const DIGIT = "[0-9०-९]";

export const FEE_RULES = [
  {
    id: "rupee-sign",
    re: new RegExp(`₹\\s?${DIGIT}`),
    reason: "D-06: ₹ followed by digits; use an ICU {x, number, inr} placeholder",
  },
  {
    id: "rs-prefix",
    re: new RegExp(`\\bRs\\.?\\s?${DIGIT}`, "i"),
    reason: "D-06: 'Rs' amount literal",
  },
  { id: "inr-prefix", re: new RegExp(`\\bINR\\s?${DIGIT}`), reason: "D-06: 'INR' amount literal" },
  {
    id: "rupees-word",
    re: new RegExp(`${DIGIT}[\\d,]*\\s?(rupees?|रुपये|रुपए|रुपया)`, "i"),
    reason: "D-06: spelled-out rupee amount",
  },
];

function selfTest() {
  const dir = join(ROOT, "scripts", "lint_wording.fixtures");
  const bad = scan([join(dir, "bad-copy.json"), join(dir, "bad-source.tsx")], FEE_RULES);
  const good = scan([join(dir, "good-copy.json")], FEE_RULES);
  const hit = new Set(bad.map((v) => v.rule));
  const missing = FEE_RULES.map((r) => r.id).filter((id) => !hit.has(id));
  const problems = [];
  if (missing.length) problems.push(`seeded fee literals not caught: ${missing.join(", ")}`);
  if (good.length)
    problems.push(`clean fixture flagged: ${good.map((v) => `${v.rule} "${v.match}"`).join(", ")}`);
  if (problems.length) {
    console.error(`lint_fee_literals self-test FAILED:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  console.warn(
    `lint_fee_literals self-test passed (${bad.length} seeded literals caught, clean fixture clean).`,
  );
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const explicit = argv.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
  const files = explicit.length ? explicit : defaultTargets({ docs: argv.includes("--docs") });
  const allow = loadAllowlist(join(ROOT, "scripts", "lint_wording.allow.json"));
  return report("lint_fee_literals (D-06)", scan(files, FEE_RULES, allow), files.length);
}

process.exitCode = main(process.argv.slice(2));

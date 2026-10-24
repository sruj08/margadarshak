#!/usr/bin/env node
/**
 * Wording-ban lint (MD-004, D-19). Fails on banned terms in UI copy, UI source, prompts and n8n
 * templates (EN + HI). See lint_wording.lib.mjs for the scope and the exception mechanism.
 *
 *   node scripts/lint_wording.mjs            # product surfaces
 *   node scripts/lint_wording.mjs --docs     # + README and docs/00-overview (judge-facing)
 *   node scripts/lint_wording.mjs --self-test
 *   node scripts/lint_wording.mjs path/a.json path/b.tsx   # explicit files
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultTargets, loadAllowlist, ROOT, report, scan } from "./lint_wording.lib.mjs";

export function loadRules() {
  const { terms } = JSON.parse(
    readFileSync(join(ROOT, "scripts", "lint_wording.terms.json"), "utf8"),
  );
  return terms.map((t) => ({
    id: t.id,
    re: new RegExp(t.pattern, t.lang === "en" ? "i" : ""),
    reason: t.reason,
  }));
}

function selfTest() {
  const rules = loadRules();
  const dir = join(ROOT, "scripts", "lint_wording.fixtures");
  const bad = scan([join(dir, "bad-copy.json"), join(dir, "bad-source.tsx")], rules);
  const good = scan([join(dir, "good-copy.json")], rules);
  const expected = [
    "official",
    "official-hi",
    "first-ever",
    "dpdp-compliant",
    "integrated-with-sarathi",
    "lives-saved",
    "verified-licence",
    "unsafe-driver",
    "you-would-crash",
    "saarthi",
    "lives-saved-hi",
  ];
  const hit = new Set(bad.map((v) => v.rule));
  const missing = expected.filter((id) => !hit.has(id));
  const commentHits = bad.filter(
    (v) => v.file.endsWith("bad-source.tsx") && v.match === "Saarthi" && v.line === 1,
  );
  const problems = [];
  if (missing.length) problems.push(`seeded violations not caught: ${missing.join(", ")}`);
  if (good.length) problems.push(`clean fixture flagged: ${good.map((v) => v.rule).join(", ")}`);
  if (commentHits.length) problems.push("a code comment was scanned (comments must be ignored)");
  if (problems.length) {
    console.error(`lint_wording self-test FAILED:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  console.warn(
    `lint_wording self-test passed (${bad.length} seeded violations caught, clean fixture clean).`,
  );
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const explicit = argv.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
  const files = explicit.length ? explicit : defaultTargets({ docs: argv.includes("--docs") });
  const allow = loadAllowlist(join(ROOT, "scripts", "lint_wording.allow.json"));
  return report("lint_wording (D-19)", scan(files, loadRules(), allow), files.length);
}

process.exitCode = main(process.argv.slice(2));

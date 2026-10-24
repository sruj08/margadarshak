#!/usr/bin/env node
/**
 * Dark-pattern lint (MD-235, GAMIFICATION_ENGINE §12, CCPA Guidelines for Prevention and Regulation
 * of Dark Patterns, 2023). The rules come from `patternLintSpec` in
 * packages/gamification/src/patterns.ts, the single source of truth (imported directly; Node ≥ 22.18
 * strips the types).
 *
 *   copy rules      banned phrases per locale from the spec (DP-01, DP-03, DP-11, DP-15, DP-17) and
 *                   APK links (DP-13), on UI message values and comment-free UI source
 *   component rules JSX in UI source: a `…Countdown` without `sourceRuleId` (DP-01), a `requiresShare`
 *                   prop (DP-04), a pre-ticked Checkbox / Switch / checkbox input (DP-06; stricter than
 *                   "on consent screens": a literal pre-tick is banned everywhere)
 *
 * The rest of §12 (DP-02, 05, 07, 09, 10, 12, 14, 16, 18) is e2e, unit or review work, and DP-08
 * (rupee literals) is lint_fee_literals.mjs.
 *
 *   node scripts/lint_patterns.mjs              # product surfaces (as lint_wording, minus prompts)
 *   node scripts/lint_patterns.mjs --self-test
 *   node scripts/lint_patterns.mjs path/a.json path/b.tsx
 *
 * Exceptions: a line containing `copy-ok: <reason>` (on the tag's line or the line above it for
 * component rules), or an entry in scripts/lint_patterns.allow.json. Waivers need the product
 * lead's sign-off in the PR and a CHANGELOG line (§12).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultTargets,
  loadAllowlist,
  ROOT,
  rel,
  report,
  scan,
  stripComments,
} from "./lint_wording.lib.mjs";

const { patternLintSpec } = await import(
  pathToFileURL(join(ROOT, "packages", "gamification", "src", "patterns.ts")).href
);

/** What a `*` in a spec phrase may span: a few words inside one sentence and one copy string. */
const GAP = '[^.!?\\n"{}]{1,40}?';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A spec phrase ("only * left", where `*` stands for a few words) as a RegExp. */
export function phraseRegExp(phrase, locale) {
  const body = phrase.trim().split("*").map(escapeRe).join(GAP);
  if (locale !== "en") return new RegExp(body);
  const start = /^\w/.test(phrase.trim()) ? "\\b" : "";
  const end = /\w$/.test(phrase.trim()) ? "\\b" : "";
  return new RegExp(`${start}${body}${end}`, "i");
}

export function copyRules(spec = patternLintSpec) {
  const rules = [];
  for (const r of spec) {
    for (const [locale, phrases] of Object.entries(r.copy?.banned ?? {})) {
      for (const p of phrases) {
        rules.push({
          id: r.id,
          re: phraseRegExp(p, locale),
          reason: `${r.pattern}: ${r.rule}`,
        });
      }
    }
  }
  const apk = spec.find((r) => r.id === "DP-13");
  rules.push({
    id: "DP-13",
    re: /\.apk\b/i,
    reason: `${apk?.pattern ?? "Rogue malware"}: no APK links anywhere`,
  });
  return rules;
}

/**
 * Opening JSX tags of a comment-free source: { name, attrs: Map<name, value|true>, index }.
 * Attribute values are kept as written (`"x"`, `{true}`); spreads are ignored.
 */
export function jsxTags(code) {
  const tags = [];
  const open = /<([A-Z][\w.]*|input)(?=[\s/>])/g;
  for (let m = open.exec(code); m !== null; m = open.exec(code)) {
    const attrs = new Map();
    let i = m.index + m[0].length;
    for (let a = readAttr(code, i); a !== null; a = readAttr(code, i)) {
      if (a.name !== null) attrs.set(a.name, a.value);
      i = a.end;
    }
    tags.push({ name: m[1], attrs, index: m.index });
  }
  return tags;
}

const skipSpace = (code, i) => {
  let j = i;
  while (/\s/.test(code[j] ?? "")) j++;
  return j;
};

/**
 * The attribute starting at or after `i` as { name, value, end }, a spread as { name: null }, or
 * null at the end of the tag (or when the text turns out not to be JSX, such as `Array<Foo>`).
 */
function readAttr(code, i) {
  const at = skipSpace(code, i);
  const c = code[at];
  if (c === undefined || c === ">" || (c === "/" && code[at + 1] === ">")) return null;
  if (c === "{") return { name: null, value: null, end: skipBraces(code, at) };
  const name = /^[A-Za-z_][\w:-]*/.exec(code.slice(at));
  if (name === null) return null;
  const afterName = skipSpace(code, at + name[0].length);
  if (code[afterName] !== "=") return { name: name[0], value: true, end: afterName };
  const start = skipSpace(code, afterName + 1);
  const q = code[start];
  let end;
  if (q === '"' || q === "'") end = code.indexOf(q, start + 1) + 1 || code.length;
  else if (q === "{") end = skipBraces(code, start);
  else return null;
  return { name: name[0], value: code.slice(start, end), end };
}

/** Index just past the `}` matching the `{` at `i`, skipping strings and template literals. */
function skipBraces(code, i) {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === "`") {
      j = skipString(code, j);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return code.length;
}

function skipString(code, i) {
  const q = code[i];
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === "\\") j++;
    else if (code[j] === q) return j;
  }
  return code.length;
}

const isTrue = (v) => v === true || v === "{true}" || v === '"true"' || v === "'true'";

/** Component-rule violations of one tag, as [ruleId, message] pairs. */
export function tagViolations(tag) {
  const out = [];
  if (/Countdown$/.test(tag.name) && !tag.attrs.has("sourceRuleId")) {
    out.push([
      "DP-01",
      `<${tag.name}> without sourceRuleId: countdowns come from the rules engine`,
    ]);
  }
  if (tag.attrs.has("requiresShare")) {
    out.push(["DP-04", `<${tag.name} requiresShare>: sharing never unlocks anything`]);
  }
  const checkbox =
    /(^|\.)(Checkbox|Switch)$/.test(tag.name) ||
    (tag.name === "input" && /^["']checkbox["']$/.test(String(tag.attrs.get("type"))));
  if (checkbox) {
    for (const a of ["defaultChecked", "defaultSelected", "checked", "isSelected"]) {
      if (isTrue(tag.attrs.get(a)))
        out.push(["DP-06", `<${tag.name} ${a}>: nothing is pre-ticked; the user ticks it`]);
    }
  }
  return out;
}

const RULE_REASON = Object.fromEntries(patternLintSpec.map((r) => [r.id, r.pattern]));

export function componentScan(files, allowlist = []) {
  const violations = [];
  for (const file of files) {
    if (!/\.(tsx|jsx)$/.test(file)) continue;
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const code = stripComments(raw);
    const rawLines = raw.split(/\r?\n/);
    const r = rel(file);
    for (const tag of jsxTags(code)) {
      const line = code.slice(0, tag.index).split("\n").length;
      const waived = [rawLines[line - 1], rawLines[line - 2]].some((l) => /copy-ok:/.test(l ?? ""));
      if (waived) continue;
      for (const [rule, message] of tagViolations(tag)) {
        const allowed = allowlist.some(
          (a) =>
            (a.path === r || (a.path.endsWith("/") && r.startsWith(a.path))) && a.rule === rule,
        );
        if (!allowed)
          violations.push({
            file: r,
            line,
            rule,
            match: `<${tag.name}>`,
            reason: `${RULE_REASON[rule]}: ${message}`,
          });
      }
    }
  }
  return violations;
}

export function lint(files, allowlist = []) {
  return [...scan(files, copyRules(), allowlist), ...componentScan(files, allowlist)].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
}

function selfTest() {
  const dir = join(ROOT, "scripts", "lint_patterns.fixtures");
  const bad = lint([join(dir, "bad-copy.json"), join(dir, "bad-source.tsx")]);
  const good = lint([join(dir, "good-copy.json"), join(dir, "good-source.tsx")]);
  // MD-235 acceptance: a pre-ticked checkbox, an un-sourced countdown and an APK link all fail.
  const expected = ["DP-01", "DP-03", "DP-04", "DP-06", "DP-11", "DP-13", "DP-15", "DP-17"];
  const hit = new Set(bad.map((v) => v.rule));
  const missing = expected.filter((id) => !hit.has(id));
  const problems = [];
  if (missing.length) problems.push(`seeded violations not caught: ${missing.join(", ")}`);
  if (!bad.some((v) => v.rule === "DP-06" && v.file.endsWith(".tsx")))
    problems.push("the pre-ticked checkbox was not caught");
  if (bad.some((v) => v.line === 1 && v.file.endsWith("bad-source.tsx")))
    problems.push("a code comment was scanned (comments must be ignored)");
  if (good.length)
    problems.push(`clean fixtures flagged: ${good.map((v) => `${v.rule}@${v.line}`).join(", ")}`);
  if (problems.length) {
    console.error(`lint_patterns self-test FAILED:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  console.warn(
    `lint_patterns self-test passed (${bad.length} seeded violations caught, clean fixtures clean).`,
  );
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const explicit = argv.filter((a) => !a.startsWith("--"));
  const files = explicit.length
    ? explicit.map((f) => resolve(f))
    : defaultTargets().filter((f) => !rel(f).startsWith("ai/prompts/"));
  const allowlist = loadAllowlist(join(ROOT, "scripts", "lint_patterns.allow.json"));
  return report("lint_patterns", lint(files, allowlist), files.length);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}

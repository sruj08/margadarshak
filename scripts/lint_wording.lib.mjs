/**
 * Shared engine for the copy lints (MD-004): lint_wording.mjs (D-19 bans) and lint_fee_literals.mjs
 * (D-06: no rupee amounts typed into UI copy or prompts). Plain Node ESM, no dependencies.
 *
 * What is scanned by default (the product surfaces a user, judge or model reads):
 *   - UI message catalogues: apps/<app>/messages/<locale>.json (values only)
 *   - UI source: apps/<app>/src/<...>.ts(x) and packages/ui/src/<...>.ts(x), with comments removed
 *     (tests and fixtures are skipped; they quote banned text on purpose)
 *   - AI prompts: ai/prompts/<...>.md
 *   - n8n templates: n8n/workflows/<...>.json
 * `--docs` adds the user- and judge-facing docs (README.md, docs/00-overview/<...>.md).
 *
 * Exceptions: a line containing `copy-ok: <reason>` is skipped, or add an entry with a reason to
 * scripts/lint_wording.allow.json (code-owner review required, see CODEOWNERS / PD).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  "test-results",
  "playwright-report",
  "generated",
]);

function walk(dir, accept, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /fixture/i.test(f);

export function defaultTargets({ docs = false } = {}) {
  const files = [];
  for (const app of safeList(join(ROOT, "apps"))) {
    const appDir = join(ROOT, "apps", app);
    files.push(...walk(join(appDir, "messages"), (f) => f.endsWith(".json")));
    files.push(...walk(join(appDir, "src"), (f) => /\.(ts|tsx)$/.test(f) && !isTest(f)));
  }
  files.push(
    ...walk(join(ROOT, "packages", "ui", "src"), (f) => /\.(ts|tsx)$/.test(f) && !isTest(f)),
  );
  files.push(...walk(join(ROOT, "ai", "prompts"), (f) => f.endsWith(".md")));
  files.push(...walk(join(ROOT, "n8n", "workflows"), (f) => f.endsWith(".json")));
  if (docs) {
    files.push(join(ROOT, "README.md"));
    files.push(...walk(join(ROOT, "docs", "00-overview"), (f) => f.endsWith(".md")));
  }
  return files;
}

function safeList(dir) {
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
  } catch {
    return [];
  }
}

/** Removes // and /* *\/ comments from TS/JS while keeping strings, templates and line numbers. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | sq | dq | tpl | line | block
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      i++;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      }
      i++;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      if (c === "\n") out += c;
      i++;
      continue;
    }
    // inside a string or template
    if (c === "\\") {
      out += c + (n ?? "");
      i += 2;
      continue;
    }
    if (
      (mode === "sq" && c === "'") ||
      (mode === "dq" && c === '"') ||
      (mode === "tpl" && c === "`")
    ) {
      mode = "code";
    } else if ((mode === "sq" || mode === "dq") && c === "\n") {
      mode = "code"; // unterminated: JSX text with an apostrophe; recover at end of line
    }
    out += c;
    i++;
  }
  return out;
}

/** Yields { line, text } units to check for one file. JSON catalogues yield their string values. */
export function unitsOf(file) {
  const raw = readFileSync(file, "utf8");
  const rawLines = raw.split(/\r?\n/);
  if (file.endsWith(".json")) {
    const units = [];
    rawLines.forEach((text, idx) => {
      // Values only: drop the key part of `"key": "value"` lines.
      const m = /^\s*"[^"]*"\s*:\s*(.*)$/.exec(text);
      units.push({ line: idx + 1, text: m ? m[1] : text, raw: text });
    });
    return units;
  }
  const code = /\.(ts|tsx|js|mjs)$/.test(file) ? stripComments(raw) : raw;
  return code
    .split(/\r?\n/)
    .map((text, idx) => ({ line: idx + 1, text, raw: rawLines[idx] ?? "" }));
}

export function loadAllowlist(path) {
  try {
    const list = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(list.entries) ? list.entries : [];
  } catch {
    return [];
  }
}

export function rel(file) {
  return relative(ROOT, file).split(sep).join("/");
}

/**
 * Runs `rules` ({ id, re: RegExp, reason }) over `files`. Returns violations
 * { file, line, rule, match, reason } not covered by `copy-ok:` or the allowlist.
 */
export function scan(files, rules, allowlist = []) {
  const violations = [];
  for (const file of files) {
    let units;
    try {
      units = unitsOf(file);
    } catch {
      continue;
    }
    const r = rel(file);
    for (const u of units) {
      if (/copy-ok:/.test(u.raw)) continue;
      for (const rule of rules) {
        rule.re.lastIndex = 0;
        const m = rule.re.exec(u.text);
        if (!m) continue;
        const allowed = allowlist.some(
          (a) =>
            (a.path === r || (a.path.endsWith("/") && r.startsWith(a.path))) && a.rule === rule.id,
        );
        if (!allowed)
          violations.push({
            file: r,
            line: u.line,
            rule: rule.id,
            match: m[0],
            reason: rule.reason,
          });
      }
    }
  }
  return violations;
}

export function report(name, violations, fileCount) {
  if (violations.length === 0) {
    console.warn(`${name}: clean (${fileCount} files checked).`);
    return 0;
  }
  console.error(`${name}: ${violations.length} problem(s) in ${fileCount} files checked`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}] "${v.match}"  ${v.reason}`);
  }
  console.error(
    "Fix the copy, or add `copy-ok: <reason>` on the line / an allowlist entry (PD review).",
  );
  return 1;
}

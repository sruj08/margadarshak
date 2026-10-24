#!/usr/bin/env node
/**
 * Import docs/08-project/BACKLOG.md into GitHub Issues with the gh CLI.
 *
 * Margdarshak (team Chanakya). Node standard library only; needs `gh` (authenticated) for --apply.
 * (Node port of the former gh_import_backlog.py; same modes and output.)
 *
 * Usage
 *   node scripts/gh_import_backlog.mjs --check                 # validate the backlog, no network
 *   node scripts/gh_import_backlog.mjs --plan-tables           # print per-phase task tables (for IMPLEMENTATION_PLAN)
 *   node scripts/gh_import_backlog.mjs --dry-run               # show what would be created (default)
 *   node scripts/gh_import_backlog.mjs --apply --repo OWNER/margdarshak [--phase P0] [--epics]
 *
 * What --apply does (idempotent; safe to re-run)
 *   1. Creates/updates labels: phase:*, epic:*, owner:*, est:*, ec:*, game:*, n8n:*, rw:*, agent:*.
 *   2. Creates milestones P0..P7 if missing.
 *   3. Creates one issue per MD ticket whose title "MD-xxx · ..." does not already exist.
 *   4. Second pass: rewrites "Depends on" with #issue numbers once every ticket exists.
 *   5. With --epics, creates one tracking issue per epic with a task list of its tickets.
 *
 * Never run --apply before gate G0 (confirmed hackathon start; MD-001).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** print() like Python: arguments joined by spaces, newline-terminated, to stdout. */
const print = (...args) => process.stdout.write(`${args.join(" ")}\n`);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKLOG = join(ROOT, "docs", "08-project", "BACKLOG.md");

const PHASES = new Map([
  ["P0", "Foundations"],
  ["P1", "Journey core"],
  ["P2", "Learning and games core"],
  ["P3", "AI layer"],
  ["P4", "DL test and after"],
  ["P5", "Ecosystem"],
  ["P6", "Hardening"],
  ["P7", "Adoption"],
]);
const PHASE_RANGES = {
  P0: [1, 99],
  P1: [101, 199],
  P2: [201, 299],
  P3: [301, 399],
  P4: [401, 499],
  P5: [501, 599],
  P6: [601, 699],
  P7: [701, 799],
};
const EST_DAYS = { XS: 0.5, S: 1, M: 2.5, L: 4.5, XL: 8 };
const OWNERS = new Set(["PD", "FE", "BE", "AG"]);
const COLORS = {
  phase: "1d76db",
  epic: "5319e7",
  owner: "0e8a16",
  est: "c2e0c6",
  ec: "d93f0b",
  game: "fbca04",
  n8n: "ff7619",
  rw: "0052cc",
  agent: "b60205",
};

const TICKET_RE = /^### (MD-\d{3}) · (.+)$/;
const EPIC_RE = /^## (EP-\d{2}[a-z]?) · (.+)$/;
const META_RE = /^- \*\*Meta:\*\* (.+)$/;
// Python str.splitlines() boundaries.
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are exactly the str.splitlines() boundaries
const LINE_SPLIT = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

const has = (o, k) => Object.hasOwn(o, k);

/** Python's format(x, ".0f"): round half to even (inputs here are exact multiples of 0.5). */
function fmt0(x) {
  const f = Math.floor(x);
  const diff = x - f;
  const r = diff > 0.5 ? f + 1 : diff < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return String(r === 0 ? 0 : r);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: line-for-line port of the Python parser; kept flat for review against it
export function parse(path = BACKLOG) {
  const tickets = new Map();
  const epics = new Map();
  let current = null;
  const text = readFileSync(path, "utf8");
  const lines = text.split(LINE_SPLIT);
  if (lines.length && lines[lines.length - 1] === "" && LINE_SPLIT.test(text.slice(-2)))
    lines.pop();
  for (const line of lines) {
    const mEp = EPIC_RE.exec(line);
    if (mEp) epics.set(mEp[1], mEp[2]);
    const m = TICKET_RE.exec(line);
    if (m) {
      current = { id: m[1], title: m[2].trim(), body: [], meta: {} };
      tickets.set(current.id, current);
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("---")) {
      current = null;
      continue;
    }
    if (current === null) continue;
    current.body.push(line);
    const mm = META_RE.exec(line);
    if (mm) {
      for (const part of mm[1].split(" · ")) {
        const i = part.indexOf("=");
        if (i >= 0) current.meta[part.slice(0, i).trim()] = part.slice(i + 1).trim();
      }
    }
  }
  for (const t of tickets.values()) {
    const meta = t.meta;
    const deps = has(meta, "depends") ? meta.depends : "—";
    t.depends = ["—", "-", ""].includes(deps) ? [] : deps.split(",").map((d) => d.trim());
    t.refs = (has(meta, "refs") ? meta.refs : "")
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r && r !== "—");
    t.owners = (has(meta, "owner") ? meta.owner : "").split("+").filter((o) => o);
    t.body_text = t.body.join("\n").trim();
  }
  return { tickets, epics };
}

/** Expand 'EC-01..EC-20' style ranges. */
export function expandRefs(refs) {
  const out = [];
  for (const r of refs) {
    const m = /^([A-Z]+)-(\d+)\.\.([A-Z]+)-(\d+)$/.exec(r);
    if (m && m[1] === m[3]) {
      const width = m[2].length;
      for (let i = Number(m[2]); i <= Number(m[4]); i++)
        out.push(`${m[1]}-${String(i).padStart(width, "0")}`);
    } else out.push(r);
  }
  return out;
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const pad2 = (i) => String(i).padStart(2, "0");

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: line-for-line port of the Python checks; kept flat for review against it
export function check(tickets, epics) {
  const errors = [];
  for (const [tid, t] of tickets) {
    const meta = t.meta;
    for (const key of ["phase", "epic", "owner", "estimate", "depends", "refs"]) {
      if (!has(meta, key)) errors.push(`${tid}: missing meta '${key}'`);
    }
    const n = Number.parseInt(tid.slice(3), 10);
    const ph = meta.phase;
    const phStr = ph === undefined ? "None" : ph;
    if (n >= 801 && n <= 830) {
      if (!PHASES.has(ph)) errors.push(`${tid}: bad phase ${phStr}`);
    } else if (ph !== undefined && has(PHASE_RANGES, ph)) {
      const [lo, hi] = PHASE_RANGES[ph];
      if (!(lo <= n && n <= hi)) errors.push(`${tid}: number outside ${ph} range ${lo}..${hi}`);
    } else errors.push(`${tid}: bad phase ${phStr}`);
    if (!(meta.estimate !== undefined && has(EST_DAYS, meta.estimate))) {
      errors.push(`${tid}: bad estimate ${meta.estimate === undefined ? "None" : meta.estimate}`);
    }
    if (t.owners.length === 0 || t.owners.some((o) => !OWNERS.has(o))) {
      errors.push(`${tid}: bad owner ${meta.owner === undefined ? "None" : meta.owner}`);
    }
    if (t.owners.length && t.owners[0] === "AG")
      errors.push(`${tid}: an AI agent cannot be the accountable owner`);
    if (!epics.has(meta.epic))
      errors.push(`${tid}: unknown epic ${meta.epic === undefined ? "None" : meta.epic}`);
    for (const d of t.depends) if (!tickets.has(d)) errors.push(`${tid}: depends on unknown ${d}`);
    if (!t.body_text.includes("**Acceptance:**")) errors.push(`${tid}: no acceptance criteria`);
  }
  // cycle check
  const state = new Map();
  const visit = (x, stack) => {
    if (state.get(x) === 1) {
      errors.push(`dependency cycle: ${[...stack, x].join(" -> ")}`);
      return;
    }
    if (state.get(x) === 2) return;
    state.set(x, 1);
    for (const d of tickets.get(x).depends) if (tickets.has(d)) visit(d, [...stack, x]);
    state.set(x, 2);
  };
  for (const tid of tickets.keys()) visit(tid, []);
  // coverage
  const allRefs = new Set();
  for (const t of tickets.values()) for (const r of expandRefs(t.refs)) allRefs.add(r);
  const required = [
    ...[...range(1, 18), ...range(20, 29), ...range(30, 34), 40, 41, 42, ...range(50, 59)].map(
      (i) => `F-${pad2(i)}`,
    ),
    ...range(1, 31).map((i) => `EC-${pad2(i)}`),
    ...range(1, 10).map((i) => `M-${pad2(i)}`),
    ...range(1, 16).map((i) => `W${i}`),
    ...range(1, 11).map((i) => `G${i}`),
    ...range(1, 5).map((i) => `RW-${i}`),
  ];
  const missing = required.filter((r) => !allRefs.has(r));
  if (missing.length) errors.push(`coverage gaps: ${missing.join(", ")}`);
  for (const e of errors) print("ERROR", e);
  print(`${tickets.size} tickets, ${epics.size} epics, ${errors.length} errors`);
  return errors.length ? 1 : 0;
}

export function planTables(tickets) {
  const byPhase = new Map();
  for (const t of tickets.values()) {
    const ph = t.meta.phase;
    if (!byPhase.has(ph)) byPhase.set(ph, []);
    byPhase.get(ph).push(t);
  }
  for (const [ph] of PHASES) {
    const rows = byPhase.get(ph) ?? [];
    const days = rows.reduce((s, t) => s + EST_DAYS[t.meta.estimate], 0);
    const perOwner = new Map();
    let agent = 0;
    for (const t of rows) {
      const d = EST_DAYS[t.meta.estimate];
      perOwner.set(t.owners[0], (perOwner.get(t.owners[0]) ?? 0) + d);
      if (t.owners.includes("AG")) agent += d;
    }
    const owners = [...perOwner.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([o, v]) => `${o} ${fmt0(v)}`)
      .join(", ");
    print(
      `\n#### ${ph} task table (${rows.length} tickets, ~${fmt0(days)} ideal person-days; ${owners}; agent-assisted ${fmt0(agent)})\n`,
    );
    print("| ID | Task | Epic | Owner | Est | Depends on |");
    print("|---|---|---|---|---|---|");
    for (const t of rows) {
      const deps = t.depends.join(", ") || "—";
      print(
        `| ${t.id} | ${t.title} | ${t.meta.epic} | ${t.meta.owner} | ${t.meta.estimate} | ${deps} |`,
      );
    }
  }
}

export function labelsFor(t) {
  const meta = t.meta;
  const labels = [`phase:${meta.phase}`, `epic:${meta.epic}`, `est:${meta.estimate}`];
  for (const o of t.owners) labels.push(`owner:${o}`);
  for (const r of expandRefs(t.refs)) {
    if (r.startsWith("EC-")) labels.push(`ec:${r}`);
    else if (/^G\d+$/.test(r)) labels.push(`game:${r}`);
    else if (/^W\d+$/.test(r)) labels.push(`n8n:${r}`);
    else if (r.startsWith("RW-")) labels.push(`rw:${r}`);
    else if (/^M-\d{2}$/.test(r)) labels.push(`agent:${r}`);
  }
  if (t.owners.includes("AG")) labels.push("agent-ready");
  return [...new Set(labels)].sort();
}

function gh(args, repo) {
  const cmd = [...args, ...(repo && args[0] !== "api" ? ["--repo", repo] : [])];
  const res = spawnSync("gh", cmd, { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    throw new Error(`gh failed: gh ${cmd.join(" ")}\n${res.stderr ?? res.error?.message ?? ""}`);
  }
  return res.stdout;
}

let tmpDir;
function tempFile(text) {
  tmpDir ??= mkdtempSync(join(tmpdir(), "md-backlog-"));
  const p = join(tmpDir, `body-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(p, text, "utf8");
  return p;
}

const pyList = (xs) => `[${xs.map((x) => `'${x}'`).join(", ")}]`;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: line-for-line port of the Python importer; kept flat for review against it
function apply(tickets, epics, repo, phaseFilter, makeEpics, dry) {
  const selected = [...tickets.values()].filter(
    (t) => !phaseFilter || t.meta.phase === phaseFilter,
  );
  const allLabels = [...new Set(selected.flatMap(labelsFor))].sort();
  if (dry) {
    print(
      `[dry-run] would ensure ${allLabels.length} labels, ${PHASES.size} milestones, ${selected.length} issues`,
    );
    for (const t of selected.slice(0, 10)) {
      print(`  ${t.id} · ${t.title}  labels=${pyList(labelsFor(t))}  milestone=${t.meta.phase}`);
    }
    print("  ...");
    return;
  }
  for (const lab of allLabels) {
    const prefix = lab.split(":")[0];
    gh(["label", "create", lab, "--force", "--color", COLORS[prefix] ?? "ededed"], repo);
  }
  const existingMs = JSON.parse(
    gh(["api", `repos/${repo}/milestones?state=all&per_page=100`], null),
  );
  const msTitles = new Set(existingMs.map((m) => m.title));
  for (const [ph, name] of PHASES) {
    const title = `${ph} ${name}`;
    if (!msTitles.has(title)) gh(["api", `repos/${repo}/milestones`, "-f", `title=${title}`], null);
  }
  const issues = JSON.parse(
    gh(["issue", "list", "--state", "all", "--limit", "2000", "--json", "number,title"], repo),
  );
  const numberOf = new Map();
  for (const i of issues) {
    const m = /^(MD-\d{3}) · /.exec(i.title);
    if (m) numberOf.set(m[1], i.number);
  }
  for (const t of selected) {
    if (numberOf.has(t.id)) continue;
    const bodyPath = tempFile(`${t.body_text}\n\n_Imported from docs/08-project/BACKLOG.md._\n`);
    const args = [
      "issue",
      "create",
      "--title",
      `${t.id} · ${t.title}`,
      "--body-file",
      bodyPath,
      "--milestone",
      `${t.meta.phase} ${PHASES.get(t.meta.phase)}`,
    ];
    for (const lab of labelsFor(t)) args.push("--label", lab);
    const url = gh(args, repo).trim();
    numberOf.set(t.id, Number.parseInt(url.replace(/\/+$/, "").split("/").pop(), 10));
    print("created", t.id, url);
  }
  // second pass: dependency links
  for (const t of selected) {
    if (!t.depends.length) continue;
    const links = t.depends
      .map((d) => (numberOf.has(d) ? `#${numberOf.get(d)} (${d})` : d))
      .join(", ");
    const bodyPath = tempFile(
      `${t.body_text}\n\n**Depends on:** ${links}\n\n_Imported from docs/08-project/BACKLOG.md._\n`,
    );
    gh(["issue", "edit", String(numberOf.get(t.id)), "--body-file", bodyPath], repo);
  }
  if (makeEpics) {
    const titles = new Set(issues.map((i) => i.title));
    for (const [ep, name] of epics) {
      const title = `${ep} · ${name}`;
      if (titles.has(title)) continue;
      const items = selected.filter((t) => t.meta.epic === ep);
      if (!items.length) continue;
      const body = items.map((t) => `- [ ] #${numberOf.get(t.id)} ${t.id} · ${t.title}`).join("\n");
      gh(
        [
          "issue",
          "create",
          "--title",
          title,
          "--body-file",
          tempFile(body),
          "--label",
          `epic:${ep}`,
        ],
        repo,
      );
      print("created epic", ep);
    }
  }
}

const USAGE =
  "usage: gh_import_backlog.mjs [-h] [--check] [--plan-tables] [--apply] [--dry-run] [--repo REPO] [--phase {P0,P1,P2,P3,P4,P5,P6,P7}] [--epics]";

function parseArgs(argv) {
  const a = {
    check: false,
    planTables: false,
    apply: false,
    dryRun: false,
    repo: undefined,
    phase: undefined,
    epics: false,
  };
  const fail = (msg) => {
    console.error(`${USAGE}\ngh_import_backlog.mjs: error: ${msg}`);
    process.exit(2);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] =
      arg.startsWith("--") && arg.includes("=")
        ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
        : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      if (i + 1 >= argv.length) fail(`argument ${flag}: expected one argument`);
      return argv[++i];
    };
    switch (flag) {
      case "-h":
      case "--help":
        print(`${USAGE}\n\nSee the header of scripts/gh_import_backlog.mjs for details.`);
        process.exit(0);
        break;
      case "--check":
        a.check = true;
        break;
      case "--plan-tables":
        a.planTables = true;
        break;
      case "--apply":
        a.apply = true;
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--epics":
        a.epics = true;
        break;
      case "--repo":
        a.repo = value();
        break;
      case "--phase": {
        const v = value();
        if (!PHASES.has(v))
          fail(
            `argument --phase: invalid choice: '${v}' (choose from ${[...PHASES.keys()].map((p) => `'${p}'`).join(", ")})`,
          );
        a.phase = v;
        break;
      }
      default:
        fail(`unrecognized arguments: ${arg}`);
    }
  }
  if (a.apply && !a.repo) fail("--apply needs --repo OWNER/NAME");
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const { tickets, epics } = parse();
  if (a.check) return check(tickets, epics);
  if (a.planTables) {
    planTables(tickets);
    return 0;
  }
  if (check(tickets, epics)) {
    print("fix the backlog before importing");
    return 1;
  }
  apply(tickets, epics, a.repo, a.phase, a.epics, !a.apply);
  return 0;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) process.exitCode = main();

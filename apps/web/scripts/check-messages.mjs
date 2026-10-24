#!/usr/bin/env node
/**
 * i18n gate (MD-022): every key in en.json exists in hi.json and vice versa, no value is empty, and
 * both languages use the same ICU arguments and rich-text tags. Exit 1 on any problem.
 *
 * The catalogue is messages/<locale>.json plus the P2 namespace files messages/<locale>/<ns>.json
 * (src/i18n/messages.ts). A namespace file holds the namespace body and is checked under the key
 * "<ns>." exactly as next-intl sees it after the merge in src/i18n/request.ts. Both locales must
 * have the same namespace files, and a namespace must not reuse a top-level key of <locale>.json.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LOCALES = ["en", "hi"];

function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

/** ICU argument names (`{name}`, `{name, number, inr}`) and tags (`<num>`), sorted. */
export function signature(message) {
  const args = new Set();
  for (const m of message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*(?:,[^{}]*)?\}/g)) args.add(m[1]);
  const tags = new Set();
  for (const m of message.matchAll(/<([A-Za-z][\w-]*)>/g)) tags.add(m[1]);
  return `args:${[...args].sort().join(",")}|tags:${[...tags].sort().join(",")}`;
}

/** Keys, placeholders and tags of one locale against the base locale. */
function compareLocale(base, baseMap, loc, other) {
  const problems = [];
  for (const [key, value] of baseMap) {
    if (!other.has(key)) problems.push(`${loc}: missing key ${key}`);
    else if (signature(value) !== signature(other.get(key) ?? "")) {
      problems.push(`${loc}: ${key} uses different placeholders or tags than ${base}`);
    }
  }
  for (const key of other.keys()) {
    if (!baseMap.has(key)) problems.push(`${loc}: extra key ${key} (not in ${base})`);
  }
  return problems;
}

export function compareCatalogues(catalogues) {
  const [base, ...rest] = LOCALES;
  const problems = rest.flatMap((loc) =>
    compareLocale(base, catalogues[base], loc, catalogues[loc]),
  );
  for (const loc of LOCALES) {
    for (const [key, value] of catalogues[loc]) {
      if (value.trim() === "") problems.push(`${loc}: empty value for ${key}`);
    }
  }
  return problems;
}

/** Namespace names found as messages/<locale>/*.json, sorted. */
export function namespaceFiles(messagesDir, locale) {
  const dir = join(messagesDir, locale);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length))
    .sort();
}

/** Namespace files present in one locale but not the other. */
function namespaceDrift(byLocale) {
  const problems = [];
  const [base, ...rest] = LOCALES;
  for (const loc of rest) {
    const missing = byLocale[base].filter((ns) => !byLocale[loc].includes(ns));
    const extra = byLocale[loc].filter((ns) => !byLocale[base].includes(ns));
    for (const ns of missing) problems.push(`${loc}: missing namespace file ${loc}/${ns}.json`);
    for (const ns of extra) problems.push(`${loc}: extra namespace file ${loc}/${ns}.json`);
  }
  return problems;
}

/** Problems with one namespace body before it is merged into the locale tree. */
function namespaceProblems(loc, ns, tree, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [`${loc}: ${loc}/${ns}.json must hold a JSON object`];
  }
  const problems = [];
  if (Object.hasOwn(tree, ns)) {
    problems.push(`${loc}: namespace ${ns} is already a top-level key of ${loc}.json`);
  }
  if (Object.hasOwn(body, ns)) {
    problems.push(`${loc}: ${loc}/${ns}.json wraps its body in "${ns}"; drop the wrapper key`);
  }
  return problems;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * Reads every locale's catalogue (base file + namespace files) as flat key maps, with the
 * structural problems found on the way (namespace drift between locales, collisions, wrappers).
 */
export function loadCatalogues(messagesDir = join(here, "..", "messages")) {
  const catalogues = {};
  const raw = {};
  const byLocale = Object.fromEntries(LOCALES.map((l) => [l, namespaceFiles(messagesDir, l)]));
  const problems = namespaceDrift(byLocale);
  for (const loc of LOCALES) {
    const tree = readJson(join(messagesDir, `${loc}.json`));
    for (const ns of byLocale[loc]) {
      const body = readJson(join(messagesDir, loc, `${ns}.json`));
      problems.push(...namespaceProblems(loc, ns, tree, body));
      if (body && typeof body === "object" && !Array.isArray(body)) tree[ns] = body;
    }
    raw[loc] = tree;
    catalogues[loc] = flatten(tree);
  }
  return { catalogues, raw, namespaces: byLocale[LOCALES[0]], problems };
}

function main() {
  const loaded = loadCatalogues();
  const { catalogues } = loaded;
  const problems = [...loaded.problems, ...compareCatalogues(catalogues)];
  if (problems.length > 0) {
    console.error(`i18n check failed (${problems.length}):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.warn(
    `i18n check passed: ${catalogues.en.size} keys in ${LOCALES.join(" + ")} (namespaces: ${loaded.namespaces.join(", ") || "none"}).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

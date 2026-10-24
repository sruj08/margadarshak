#!/usr/bin/env node
/**
 * Margdarshak token contrast check (WCAG 2.x relative luminance).
 *
 * Reads packages/ui/tokens.json (DTCG), resolves {aliases}, computes every pair in
 * $extensions["in.margdarshak"].contrastPairs and prints a Markdown table.
 * Exit code 1 if any pair not listed in expectedFailures is below its minimum, or
 * if an expected failure unexpectedly passes (so the audit list stays honest).
 *
 * Usage: node scripts/check_contrast.mjs [path/to/tokens.json] [--md]
 * (Node port of the former check_contrast.py; same output.)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const path = arg ? resolve(arg) : resolve(ROOT, "packages/ui/tokens.json");
// Python printed JSON floats with repr (3.0 stays "3.0"); keep whether a literal was a float.
const FLOAT_LITERALS = new WeakSet();
const tokens = JSON.parse(readFileSync(path, "utf8"), function (key, value, ctx) {
  if (key === "min" && typeof value === "number" && /[.eE]/.test(ctx?.source ?? ""))
    FLOAT_LITERALS.add(this);
  return value;
});
const pyNum = (holder, v) =>
  FLOAT_LITERALS.has(holder) && Number.isInteger(v) ? v.toFixed(1) : String(v);

function get(ref) {
  let node = tokens;
  for (const part of ref.replace(/^\{+|\}+$/g, "").split(".")) node = node[part];
  const val = node !== null && typeof node === "object" ? node.$value : node;
  return typeof val === "string" && val.startsWith("{") ? get(val) : val;
}

function lum(hex) {
  const h = hex.replace(/^#+/, "").slice(0, 6);
  const ch = (s) => {
    const c = Number.parseInt(s, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = ch(h.slice(0, 2));
  const g = ch(h.slice(2, 4));
  const b = ch(h.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [la, lb] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}

const ext = tokens.$extensions["in.margdarshak"];
const expected = new Set(ext.expectedFailures ?? []);
const bad = [];
const name = (ref) => ref.replace(/^\{+|\}+$/g, "").replace(/color\./g, "");
const lines = [
  "| ID | Theme | Foreground | Background | Ratio | Min | Result | Use |",
  "|---|---|---|---|---|---|---|---|",
];
for (const p of ext.contrastPairs) {
  const fg = get(p.fg);
  const bg = get(p.bg);
  const r = ratio(fg, bg);
  const ok = r >= p.min;
  let res;
  if (expected.has(p.id)) {
    res = ok ? "UNEXPECTED PASS" : "expected fail";
    if (ok) bad.push(p.id);
  } else {
    res = ok ? "pass" : "FAIL";
    if (!ok) bad.push(p.id);
  }
  lines.push(
    `| ${p.id} | ${p.theme} | \`${name(p.fg)}\` ${fg.toUpperCase()} | \`${name(p.bg)}\` ${bg.toUpperCase()} | **${r.toFixed(2)}** | ${pyNum(p, p.min)} | ${res} | ${p.use} |`,
  );
}
process.stdout.write(`${lines.join("\n")}\n`);
if (bad.length) {
  process.stderr.write(`\nContrast check failed for: ${bad.join(", ")}\n`);
  process.exit(1);
}

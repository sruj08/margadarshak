#!/usr/bin/env node
/**
 * Nazar field-study analysis (pre-registered; see HYPOTHESES.md).
 * Node port of the former nazar_stats.py: same exclusions, statistics and printed output.
 *
 * Usage: node nazar_stats.mjs sessions.csv [raters.csv]
 * sessions.csv columns: anon_id,ll_score(0-15),hpt_score(0-100),pre_mean(0-10),post_mean(0-10),
 *                       median_late_s,speed_kmh,total_s,max_taps_per_s,age_ok(1/0),retake_of(optional anon_id)
 * raters.csv columns:   clip_id,rater_a_onset_s,rater_b_onset_s
 *
 * Numerics follow CPython 3.12+ so the printed numbers match the Python version: statistics.fmean
 * uses an exactly rounded sum (math.fsum), built-in sum() uses Neumaier compensation, and
 * format(x, ".Nf") rounds half to even on the exact binary value.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** print() like Python: arguments joined by spaces, newline-terminated, to stdout. */
const print = (...args) => process.stdout.write(`${args.join(" ")}\n`);

// ---- CPython-compatible numerics -----------------------------------------------------------

/** math.fsum: Shewchuk's exactly rounded summation (CPython mathmodule.c). */
export function fsum(xs) {
  const partials = [];
  for (let x of xs) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  let n = partials.length;
  if (n === 0) return 0;
  let hi = partials[--n];
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n];
    hi = x + y;
    const yr = hi - x;
    lo = y - yr;
    if (lo) break;
  }
  if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
    const y = lo * 2;
    const x = hi + y;
    const yr = x - hi;
    if (y === yr) hi = x;
  }
  return hi;
}

/** Built-in sum() over floats (CPython >= 3.12: Neumaier compensated summation). */
export function pysum(xs) {
  let f = 0;
  let c = 0;
  for (const x of xs) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

export function fmean(xs) {
  if (xs.length === 0) throw new Error("StatisticsError: fmean requires at least one data point");
  return fsum(xs) / xs.length;
}

export function median(xs) {
  const d = [...xs].sort((a, b) => a - b);
  const n = d.length;
  if (n === 0) throw new Error("StatisticsError: no median for empty data");
  return n % 2 === 1 ? d[(n - 1) / 2] : (d[n / 2 - 1] + d[n / 2]) / 2;
}

/** erfc(x) to ~1e-15 absolute: Taylor series for |x| < 2.5, continued fraction beyond. */
export function erfc(x) {
  if (Number.isNaN(x)) return Number.NaN;
  if (x < 0) return 2 - erfc(-x);
  if (x < 2.5) {
    let term = x;
    let sum = x;
    for (let n = 1; n < 200; n++) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  if (x > 27) return 0;
  // erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + ...))))) (modified Lentz)
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let k = 1; k < 500; k++) {
    const a = k / 2;
    D = x + a * D;
    D = D === 0 ? tiny : D;
    C = x + a / C;
    C = C === 0 ? tiny : C;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

/** format(x, f"{'+' if plus else ''}.{digits}f") as CPython prints it. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mirrors CPython float formatting branch by branch
export function pyFixed(x, digits, plus = false) {
  if (Number.isNaN(x)) return plus ? "+nan" : "nan";
  if (!Number.isFinite(x)) return x > 0 ? (plus ? "+inf" : "inf") : "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let s = a.toFixed(digits);
  const exact = a.toFixed(100);
  const [ip, fp] = exact.split(".");
  if (/^50*$/.test(fp.slice(digits))) {
    // exact tie: round half to even (toFixed rounds ties up)
    const last = digits > 0 ? fp[digits - 1] : ip[ip.length - 1];
    if (Number(last) % 2 === 0) s = digits > 0 ? `${ip}.${fp.slice(0, digits)}` : ip;
  }
  return neg ? `-${s}` : plus ? `+${s}` : s;
}

/** float(str) as Python parses it (rejects empty and junk instead of yielding 0). */
export function pyFloat(v) {
  if (v === null || v === undefined)
    throw new TypeError("float() argument must be a string or a real number, not 'NoneType'");
  const s = String(v).trim().replace(/_/g, "");
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(s)) return Number.NaN;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s))
    throw new Error(`ValueError: could not convert string to float: '${v}'`);
  return Number(s);
}

// ---- csv.DictReader (excel dialect) --------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a small state machine mirroring csv.reader (excel dialect)
export function readCsvDicts(path) {
  const text = readFileSync(path, "utf8");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    if (fieldStarted || row.length > 0) endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      fieldStarted = true;
      endField();
      fieldStarted = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (fieldStarted || row.length > 0 || field !== "") endRow();
  const nonEmpty = rows.filter((r) => r.length > 0);
  const [header, ...data] = nonEmpty;
  if (!header) return [];
  return data.map((r) => {
    const o = {};
    header.forEach((h, i) => {
      o[h] = i < r.length ? r[i] : null;
    });
    return o;
  });
}

// ---- statistics (same formulas as the Python version) ---------------------------------------

export function wilson(k, n, z = 1.96) {
  if (n === 0) return [Number.NaN, Number.NaN];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

export function pearson(xs, ys) {
  const mx = fmean(xs);
  const my = fmean(ys);
  const n = Math.min(xs.length, ys.length);
  const sxy = pysum(Array.from({ length: n }, (_, i) => (xs[i] - mx) * (ys[i] - my)));
  const sxx = pysum(xs.map((x) => (x - mx) * (x - mx)));
  const syy = pysum(ys.map((y) => (y - my) * (y - my)));
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

export function fisherCi(r, n, z = 1.96) {
  if (n < 4 || Math.abs(r) >= 1) return [Number.NaN, Number.NaN];
  const f = Math.atanh(r);
  const se = 1 / Math.sqrt(n - 3);
  return [Math.tanh(f - z * se), Math.tanh(f + z * se)];
}

/** Signed-rank test, normal approximation, H1: median diff > 0. */
export function wilcoxonOneSided(diffs) {
  const d = diffs.filter((x) => x !== 0);
  const n = d.length;
  if (n < 6) return Number.NaN;
  const ranked = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => Math.abs(d[a]) - Math.abs(d[b]),
  );
  const ranks = new Array(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && Math.abs(d[ranked[j + 1]]) === Math.abs(d[ranked[i]])) j++;
    for (let k = i; k <= j; k++) ranks[ranked[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  const w = pysum(ranks.filter((_, k) => d[k] > 0));
  const mu = (n * (n + 1)) / 4;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  const zval = (w - mu) / sd;
  return 0.5 * erfc(zval / Math.sqrt(2));
}

function main(argv) {
  const rows = readCsvDicts(argv[0]);
  const keep = rows.filter(
    (r) =>
      r.age_ok === "1" &&
      pyFloat(r.total_s) >= 60 &&
      pyFloat(r.max_taps_per_s) <= 3 &&
      !r.retake_of,
  );
  const n = keep.length;
  print(`N after pre-registered exclusions: ${n} (of ${rows.length})`);
  if (n === 0) throw new Error("ZeroDivisionError: no sessions left after exclusions");
  const hpt = keep.map((r) => pyFloat(r.hpt_score));
  const ll = keep.map((r) => pyFloat(r.ll_score));
  const fail = hpt.filter((s) => s < 60).length;
  const [lo, hi] = wilson(fail, n);
  print(
    `H1  below 60/100: ${fail}/${n} = ${pyFixed((100 * fail) / n, 0)}%  (95% CI ${pyFixed(100 * lo, 0)}-${pyFixed(100 * hi, 0)}%)`,
  );
  const r = pearson(ll, hpt);
  const [clo, chi] = fisherCi(r, n);
  print(
    `H2  r(LL mock, Nazar) = ${pyFixed(r, 2)}  (95% CI ${pyFixed(clo, 2)} to ${pyFixed(chi, 2)})`,
  );
  const late = keep.map((x) => pyFloat(x.median_late_s));
  const spd = keep.map((x) => pyFloat(x.speed_kmh));
  const ml = median(late);
  const metres = (ml * median(spd)) / 3.6;
  print(
    `    median late = ${pyFixed(ml, 2)} s  (~${pyFixed(metres, 0)} m at ${pyFixed(median(spd), 0)} km/h)`,
  );
  const diffs = keep.map((x) => pyFloat(x.post_mean) - pyFloat(x.pre_mean));
  print(
    `H3  mean gain after feedback = ${pyFixed(fmean(diffs), 2, true)}/10 per clip, one-sided Wilcoxon p = ${pyFixed(wilcoxonOneSided(diffs), 4)}`,
  );
  const retakes = new Map();
  for (const x of rows) if (x.retake_of) retakes.set(x.retake_of, pyFloat(x.hpt_score));
  const pairs = keep
    .filter((x) => retakes.has(x.anon_id))
    .map((x) => [pyFloat(x.hpt_score), retakes.get(x.anon_id)]);
  if (pairs.length >= 8) {
    print(
      `    test-retest r = ${pyFixed(
        pearson(
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
        ),
        2,
      )} (n=${pairs.length})`,
    );
  }
  if (argv.length > 1) {
    const rr = readCsvDicts(argv[1]);
    const d = rr.map((x) => Math.abs(pyFloat(x.rater_a_onset_s) - pyFloat(x.rater_b_onset_s)));
    print(`H4  inter-rater median |d onset| = ${pyFixed(median(d), 2)} s over ${d.length} clips`);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  if (process.argv.length < 3) {
    console.error("usage: node nazar_stats.mjs sessions.csv [raters.csv]");
    process.exit(2);
  }
  main(process.argv.slice(2));
}

#!/usr/bin/env node
/**
 * First-load budget gate (MD-017, FRONTEND §14, F-51). Three checks on a production build:
 *
 *   per route   For every prerendered page, the brotli size of the HTML plus the JS, CSS and
 *               preloaded fonts it references: full mode <= 450 KB; Lite (/<locale>/lite...) < 300 KB.
 *   union       Every JS / CSS chunk that any prerendered page references (what some user downloads
 *               up front): a bloat ceiling over all routes. Lazily loaded chunks (games, the Phaser
 *               engine, debrief and replay screens) are not part of it: they download only when the
 *               user opens that screen, so they cannot slow a first load.
 *   lazy        Every chunk no page references up front, against the per-game budget of FRONTEND §14
 *               ("game chunk, engine excluded: <= 350 KB gzip"). The Phaser engine chunk is reported
 *               but not gated (§14: "measured at H0").
 *
 * Turbopack names chunks by content hash, so lazy chunks cannot be excluded by a size-limit glob;
 * that is why the union lives here rather than in the root size-limit config.
 *
 * Run after `next build` (honours NEXT_DIST_DIR):  node scripts/first-load.mjs [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const nextDir = join(here, "..", process.env.NEXT_DIST_DIR || ".next");
const pagesDir = join(nextDir, "server", "app");
const chunksDir = join(nextDir, "static", "chunks");
const KB = 1024;
const BUDGET = { full: 450 * KB, lite: 300 * KB };
/** Union ceilings, set from the measured P0–P2 build plus headroom (P2 verification doc §size). */
const UNION = { js: 700 * KB, css: 50 * KB };
const LAZY_CHUNK_GZIP = 350 * KB;

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) htmlFiles(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

const cache = new Map();
function assetSize(url) {
  if (cache.has(url)) return cache.get(url);
  const file = join(nextDir, url.replace(/^\/_next\//, ""));
  let size = 0;
  if (existsSync(file)) {
    const buf = readFileSync(file);
    size = url.endsWith(".woff2") ? buf.length : brotliCompressSync(buf).length;
  }
  cache.set(url, size);
  return size;
}

const union = new Set();
function measure(file) {
  const html = readFileSync(file, "utf8");
  const urls = new Set(
    [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css|woff2))"/g)].map(
      (m) => m[1],
    ),
  );
  let total = brotliCompressSync(Buffer.from(html)).length;
  for (const u of urls) {
    total += assetSize(u);
    union.add(u);
  }
  return total;
}

if (!existsSync(pagesDir)) {
  console.error("No build output. Run `pnpm --filter @margdarshak/web build` first.");
  process.exit(1);
}

const rows = htmlFiles(pagesDir)
  .map((f) => {
    const route = `/${relative(pagesDir, f)
      .split(sep)
      .join("/")
      .replace(/\.html$/, "")}`;
    const lite = /^\/(en|hi)\/lite(\/|$)/.test(route);
    const bytes = measure(f);
    const budget = lite ? BUDGET.lite : BUDGET.full;
    return {
      route,
      kb: Math.round((bytes / KB) * 10) / 10,
      budgetKb: budget / KB,
      ok: lite ? bytes < budget : bytes <= budget,
    };
  })
  .sort((a, b) => b.kb - a.kb);

const kb = (n) => Math.round((n / KB) * 10) / 10;
const unionJs = [...union].filter((u) => u.endsWith(".js")).reduce((s, u) => s + assetSize(u), 0);
const unionCss = [...union].filter((u) => u.endsWith(".css")).reduce((s, u) => s + assetSize(u), 0);

const lazy = (existsSync(chunksDir) ? readdirSync(chunksDir) : [])
  .filter((n) => n.endsWith(".js") && !union.has(`/_next/static/chunks/${n}`))
  .map((n) => {
    const buf = readFileSync(join(chunksDir, n));
    // Phaser's banner is minified to `"Phaser v"+version`, so match the prefix only.
    const engine = /Phaser v|window\.Phaser|"phaser"/.test(buf.toString("latin1"));
    return {
      chunk: n,
      gzipKb: kb(gzipSync(buf).length),
      brotliKb: kb(brotliCompressSync(buf).length),
      engine,
    };
  })
  .sort((a, b) => b.gzipKb - a.gzipKb);
const lazyOver = lazy.filter((c) => !c.engine && c.gzipKb * KB > LAZY_CHUNK_GZIP);

const summary = {
  union: {
    jsKb: kb(unionJs),
    jsLimitKb: UNION.js / KB,
    cssKb: kb(unionCss),
    cssLimitKb: UNION.css / KB,
  },
  lazy: {
    chunks: lazy.length,
    totalBrotliKb: kb(lazy.reduce((s, c) => s + c.brotliKb * KB, 0)),
    largestGzipKb: lazy.find((c) => !c.engine)?.gzipKb ?? 0,
    engineChunks: lazy.filter((c) => c.engine).map((c) => `${c.chunk} (${c.gzipKb} KB gzip)`),
    limitGzipKb: LAZY_CHUNK_GZIP / KB,
  },
};

if (process.argv.includes("--json")) console.warn(JSON.stringify({ rows, summary, lazy }, null, 2));
else {
  for (const r of rows)
    console.warn(
      `${r.ok ? "ok  " : "OVER"} ${r.route.padEnd(28)} ${String(r.kb).padStart(7)} KB / ${r.budgetKb} KB`,
    );
  console.warn(
    `union JS ${summary.union.jsKb} KB / ${summary.union.jsLimitKb} KB · union CSS ${summary.union.cssKb} KB / ${summary.union.cssLimitKb} KB`,
  );
  console.warn(
    `lazy chunks ${summary.lazy.chunks} (${summary.lazy.totalBrotliKb} KB brotli total) · largest game chunk ${summary.lazy.largestGzipKb} KB gzip / ${summary.lazy.limitGzipKb} KB` +
      (summary.lazy.engineChunks.length
        ? ` · engine (not gated): ${summary.lazy.engineChunks.join(", ")}`
        : ""),
  );
}

const problems = [];
const over = rows.filter((r) => !r.ok);
if (over.length) problems.push(`first-load budget exceeded on ${over.length} route(s)`);
if (unionJs > UNION.js)
  problems.push(`first-load union JS ${kb(unionJs)} KB > ${UNION.js / KB} KB`);
if (unionCss > UNION.css)
  problems.push(`first-load union CSS ${kb(unionCss)} KB > ${UNION.css / KB} KB`);
for (const c of lazyOver)
  problems.push(`lazy chunk ${c.chunk} ${c.gzipKb} KB gzip > ${LAZY_CHUNK_GZIP / KB} KB`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

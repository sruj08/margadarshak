// Facts formatting at render time (DEBRIEF_SPEC §5.2). Formatted values carry their own units, so
// templates and drafts never type "s", "m" or "km/h" after a placeholder. Western digits in both
// locales. Hinglish narration is Latin script, so inline facts use the English forms there.
import { roundTo } from "../sim/quantise.ts";
import { DebriefError, type FactLabels } from "./catalogue.ts";
import type { DebriefLocale, FactKind, TemplateLocale } from "./schema.ts";
import { PLACEHOLDER_RE } from "./spec.ts";

export interface FormatOptions {
  /** Throw a DebriefError instead of printing the safe fallback (tests, catalogue audits). */
  readonly strict?: boolean | undefined;
}

/** What a user sees when a label or a well-typed value is missing: never the raw snake_case. */
export const MISSING_VALUE: Readonly<Record<TemplateLocale, string>> = {
  en: "this item",
  hi: "यह स्थिति",
};

const UNITS = {
  en: { s: "s", m: "m", cm: "cm", kmh: "km/h", approx: "≈ ", perMin: "times a minute" },
  hi: { s: "सेकंड", m: "मीटर", cm: "सेमी", kmh: "किमी/घंटा", approx: "लगभग ", perMin: "बार प्रति मिनट" },
} as const;

const WORDS = {
  en: { once: "once", times: "times", yes: "yes", no: "no", and: " and " },
  hi: { once: "एक बार", times: "बार", yes: "हाँ", no: "नहीं", and: " और " },
} as const;

/** Inline facts: `hi` → Hindi forms; `en` and `hinglish` (Latin script) → English forms. */
export const factLocale = (locale: DebriefLocale): TemplateLocale =>
  locale === "hi" ? "hi" : "en";

/** Fixed decimals without locale grouping: `fixed(1.44, 1)` → "1.4". */
const fixed = (x: number, dp: number): string => roundTo(x, dp).toFixed(dp);
/** An integer, or one decimal when the value has a fractional part. */
const plain = (x: number): string => (Number.isInteger(roundTo(x, 1)) ? fixed(x, 0) : fixed(x, 1));

const ENUM_VALUE_RE = /^[A-Za-z0-9_]{1,32}$/;

function fail(
  opts: FormatOptions,
  code: "MISSING_LABEL" | "BAD_FACT",
  msg: string,
  l: TemplateLocale,
) {
  if (opts.strict === true) throw new DebriefError(code, msg);
  return MISSING_VALUE[l];
}

function label(
  key: string,
  value: string,
  labels: FactLabels,
  l: TemplateLocale,
  opts: FormatOptions,
): string {
  const text = labels.get(key)?.get(value)?.[l];
  if (text === undefined || text.length === 0) {
    return fail(opts, "MISSING_LABEL", `no ${l} label for ${key}=${value}`, l);
  }
  return text;
}

type NumericKind = Exclude<FactKind, "enum" | "enum_list" | "boolean">;

/** One formatter per numeric kind (§5.2). */
const NUMERIC: Readonly<Record<NumericKind, (x: number, l: TemplateLocale) => string>> = {
  seconds: (x, l) => `${fixed(x, 1)} ${UNITS[l].s}`,
  metres: (x, l) => `${UNITS[l].approx}${fixed(x, 0)} ${UNITS[l].m}`,
  centimetres: (x, l) => `${UNITS[l].approx}${fixed(x, 0)} ${UNITS[l].cm}`,
  kmh: (x, l) => `${fixed(x, 0)} ${UNITS[l].kmh}`,
  percent: (x) => `${fixed(x, 0)}%`,
  times: (x, l) => (roundTo(x, 0) === 1 ? WORDS[l].once : `${fixed(x, 0)} ${WORDS[l].times}`),
  rate_per_min: (x, l) => `${plain(x)} ${UNITS[l].perMin}`,
  ratio: (x) => fixed(x, 2),
  ordinal: (x) => fixed(x, 0),
  number: (x) => plain(x),
};

function formatEnum(
  key: string,
  value: string,
  list: boolean,
  labels: FactLabels,
  l: TemplateLocale,
  opts: FormatOptions,
): string {
  const parts = list ? value.split(/[,|]/).map((s) => s.trim()) : [value];
  if (parts.some((p) => !ENUM_VALUE_RE.test(p))) {
    return fail(opts, "BAD_FACT", `${key}: bad enum value`, l);
  }
  const names = parts.map((p) => label(key, p, labels, l, opts));
  const last = names.pop() as string;
  return names.length === 0 ? last : `${names.join(", ")}${WORDS[l].and}${last}`;
}

/**
 * Formats one fact value for display (§5.2):
 * seconds "1.4 s" / "1.4 सेकंड" · metres "≈ 16 m" / "लगभग 16 मीटर" · km/h "40 km/h" / "40 किमी/घंटा"
 * · percent "18%" · times "once" / "2 times", "एक बार" / "2 बार" · enums by i18n label.
 * `enum_list` values travel as one comma-separated string (facts are scalars, GAME_SDK §10).
 */
export function formatFact(
  key: string,
  value: string | number | boolean,
  kind: FactKind,
  locale: DebriefLocale,
  labels: FactLabels,
  opts: FormatOptions = {},
): string {
  const l = factLocale(locale);
  if (kind === "enum" || kind === "enum_list") {
    if (typeof value !== "string") return fail(opts, "BAD_FACT", `${key}: not a string`, l);
    return formatEnum(key, value, kind === "enum_list", labels, l, opts);
  }
  if (kind === "boolean") {
    if (typeof value !== "boolean") return fail(opts, "BAD_FACT", `${key}: not a boolean`, l);
    return value ? WORDS[l].yes : WORDS[l].no;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(opts, "BAD_FACT", `${key}: not a finite number`, l);
  }
  return NUMERIC[kind](value, l);
}

/** Fact keys of the placeholders in a text, in order of appearance. */
export function placeholderKeys(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] as string);
}

/** Facts plus their kinds, as the renderer needs them. */
export interface FactSource {
  readonly facts: Readonly<Record<string, string | number | boolean>>;
  readonly kinds: ReadonlyMap<string, FactKind>;
}

/**
 * Keeps only the sentences / clauses (split after . ; ! ? ।) whose placeholders all have a value,
 * so a template whose optional fact is absent still reads well (e.g. SD_COLLISION without stop_m).
 * Returns null when nothing with letters is left.
 */
export function dropMissingClauses(
  text: string,
  has: (key: string) => boolean,
  locale: TemplateLocale,
): string | null {
  const segments = text.match(/[^.;!?।]+[.;!?।]*\s*/gu) ?? [];
  const kept = segments.filter((s) => placeholderKeys(s).every(has));
  if (kept.length === segments.length) return text;
  let out = kept.join("").trim();
  if (out.length === 0 || !/\p{L}/u.test(out.replace(PLACEHOLDER_RE, ""))) return null;
  if (/[;,:]$/.test(out)) out = `${out.slice(0, -1)}${locale === "hi" ? "।" : "."}`;
  return out;
}

/** Replaces every {{fact:key}} with its formatted value. Unknown keys get the safe fallback. */
export function fillPlaceholders(
  text: string,
  source: FactSource,
  locale: DebriefLocale,
  labels: FactLabels,
  opts: FormatOptions = {},
): string {
  return text.replace(PLACEHOLDER_RE, (_m, key: string) => {
    const value = source.facts[key];
    const kind = source.kinds.get(key);
    if (value === undefined || kind === undefined) {
      return fail(opts, "BAD_FACT", `no value or kind for ${key}`, factLocale(locale));
    }
    return formatFact(key, value, kind, locale, labels, opts);
  });
}

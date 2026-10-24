// Loads validator-spec.json (the rule data shared with the Go validator), checks its shape and
// compiles its patterns once. Nothing in here is a rule: the rules are the JSON.
import { z } from "zod";
import raw from "./validator-spec.json" with { type: "json" };

const Pattern = z
  .object({ pattern: z.string().min(1), flags: z.enum(["", "i"]), why: z.string().min(1) })
  .strict();

const Rule = z
  .object({
    name: z.string().min(1),
    check: z.string().min(1),
    on_fail: z.enum(["reject", "always_applied"]),
    source: z.string().min(1),
    hint: z.string().min(1).optional(),
  })
  .loose();

const Field = z
  .object({
    paths: z.array(z.string()).min(1),
    max_chars: z.number().int().positive(),
    placeholder_scope: z.enum(["positives", "finding", "none"]),
  })
  .strict();

const Range = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

/** The shape of validator-spec.json. A malformed edit fails at import, in every test. */
export const ValidatorSpecFile = z
  .object({
    $comment: z.string(),
    spec: z.literal("margdarshak.debrief.validator"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.string(),
    regex: z.object({ dialect: z.string(), flags: z.string(), matching: z.string() }).strict(),
    placeholder: z
      .object({ pattern: z.string(), malformed_pattern: z.string(), note: z.string() })
      .strict(),
    fields: z.object({ how_you_did: Field, point_text: Field, drill_why: Field }).strict(),
    unknown_rule_id: z.literal("UNKNOWN"),
    retry: z.object({ line: z.string(), joiner: z.string(), source: z.string() }).strict(),
    pre_checks: z.object({ MODE: Rule, SCHEMA: Rule }).strict(),
    rules: z
      .object({
        V1: Rule.extend({ pattern: z.string() }),
        V2: Rule,
        V3: Rule,
        V4: Rule,
        V5: Rule.extend({
          banned: z
            .object({ en: z.array(Pattern), hi: z.array(Pattern), hinglish: z.array(Pattern) })
            .strict(),
        }),
        V6: Rule.extend({
          thresholds: z.record(
            z.enum(["en", "hi", "hinglish"]),
            z.object({ script: z.enum(["latin", "devanagari"]), min_share: z.number() }).strict(),
          ),
          scripts: z.object({ devanagari: z.array(Range), latin: z.array(Range) }).strict(),
          letter: z.string(),
        }),
        V7: Rule,
        V8: Rule.extend({ max_points: z.number().int().positive() }),
        V9: Rule.extend({ escape: z.array(z.tuple([z.string().length(1), z.string()])) }),
        V10: Rule.extend({ patterns: z.array(Pattern) }),
      })
      .strict(),
  })
  .strict();
export type ValidatorSpecFile = z.infer<typeof ValidatorSpecFile>;

/** The parsed validator-spec.json. */
export const VALIDATOR_SPEC: ValidatorSpecFile = ValidatorSpecFile.parse(raw);

const R = VALIDATOR_SPEC.rules;

/** `{{fact:key}}` (global: use with matchAll / replace only). */
export const PLACEHOLDER_RE = new RegExp(VALIDATOR_SPEC.placeholder.pattern, "g");
export const MALFORMED_PLACEHOLDER_RE = new RegExp(VALIDATOR_SPEC.placeholder.malformed_pattern);
export const DIGIT_RE = new RegExp(R.V1.pattern);

export interface CompiledPattern {
  readonly re: RegExp;
  readonly why: string;
}
const compile = (ps: readonly z.infer<typeof Pattern>[]): CompiledPattern[] =>
  ps.map((p) => ({ re: new RegExp(p.pattern, p.flags), why: p.why }));

/** V5: every list applies to every locale. */
export const TONE_PATTERNS: readonly CompiledPattern[] = compile([
  ...R.V5.banned.en,
  ...R.V5.banned.hi,
  ...R.V5.banned.hinglish,
]);
export const FEE_PATTERNS: readonly CompiledPattern[] = compile(R.V10.patterns);

export const stripPlaceholders = (text: string): string => text.replace(PLACEHOLDER_RE, "");

const inRanges = (cp: number, ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
const LETTER = /\p{L}/u;

/**
 * V6: the share of letters in the locale's script, placeholders removed. A text with no letters
 * returns 1 (nothing to judge).
 */
export function scriptShare(text: string, locale: "en" | "hi" | "hinglish"): number {
  const scripts = R.V6.scripts;
  const want = R.V6.thresholds[locale]?.script ?? "latin";
  let letters = 0;
  let inScript = 0;
  for (const ch of stripPlaceholders(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    const deva = inRanges(cp, scripts.devanagari);
    const latin = inRanges(cp, scripts.latin);
    const excluded = cp >= 0x0964 && cp <= 0x0970;
    if (excluded || !(deva || latin || LETTER.test(ch))) continue;
    letters++;
    if (want === "devanagari" ? deva : latin) inScript++;
  }
  return letters === 0 ? 1 : inScript / letters;
}

export const minScriptShare = (locale: "en" | "hi" | "hinglish"): number =>
  R.V6.thresholds[locale]?.min_share ?? 0.9;

/** V9: HTML-escape for text-node insertion, with the spec's map in its order. */
export function escapeHtml(text: string): string {
  let out = text;
  for (const [from, to] of R.V9.escape) out = out.split(from).join(to);
  return out;
}

/** Inverse of escapeHtml, for UI frameworks that escape text again (React text nodes). */
export function unescapeHtml(text: string): string {
  let out = text;
  for (const [from, to] of [...R.V9.escape].reverse()) out = out.split(to).join(from);
  return out;
}

/** Fills `{token}`s in a hint / line template from the spec. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z]+)\}/g, (m, k: string) => values[k] ?? m);
}

// Text rules for reviewed template strings, mirroring the DEBRIEF_SPEC §6.3 validator rules that
// apply to text (V1 digits, V3 placeholders, V5 tone, V6 language, V7 lengths, V10 fees).
// game-core/debrief/validator-spec.json is the shared spec for the AI path; this module applies
// the same rules to our templates at authoring time so the fallback card can never fail them.
import { PLACEHOLDER_RE } from "./schema/common.ts";

export type Locale = "en" | "hi";
export type TextViolation = { rule: "V1" | "V3" | "V5" | "V6" | "V7" | "V10"; detail: string };

/** DEBRIEF_SPEC §6.3 V7 limits. */
export const LIMITS = { how: 160, point: 140, drill_why: 120 } as const;

/** Placeholder keys used in a template, in order of appearance. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] as string);
}

export function stripPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_RE, "");
}

/**
 * V5 tone lint: rule 4 of the DebriefAgent instruction plus gore/death and shaming words.
 * English patterns are case-insensitive with word boundaries; Hindi patterns are literal.
 */
export const TONE_BANS_EN: readonly RegExp[] = [
  /\bcertified\b/i,
  /\bcertificate\b/i,
  /\bofficial(ly)?\b/i,
  /\bsafe driver\b/i,
  /\bsafe rider\b/i,
  /\bunsafe (driver|rider)\b/i,
  /\bdangerous (driver|rider)\b/i,
  /\byou (would|will|'d) (have )?crash(ed)?\b/i,
  /\byou would have died\b/i,
  /\blives? saved\b/i,
  /\bKerala'?s test\b/i,
  /\byour RTO'?s track\b/i,
  /\bguarantee(d)?\b/i,
  /\byou will pass\b/i,
  /\bdeath\b/i,
  /\bdied?\b/i,
  /\bdead\b/i,
  /\bkill(ed|s)?\b/i,
  /\bblood\b/i,
  /\bfatal\b/i,
  /\bgore\b/i,
  /\bstupid\b/i,
  /\bsilly\b/i,
  /\bcareless\b/i,
  /\blazy\b/i,
  /\bfailed\b/i,
  /\bbeta\b/i,
  /\bbachcha\b/i,
  /\bhurry\b/i,
];

export const TONE_BANS_HI: readonly string[] = [
  "प्रमाणित",
  "आधिकारिक", // copy-ok: tone-validator ban list (V5), not copy
  "सुरक्षित ड्राइवर",
  "सुरक्षित चालक",
  "असुरक्षित",
  "ख़तरनाक ड्राइवर", // copy-ok: tone-validator ban list (V5), not copy
  "खतरनाक ड्राइवर", // copy-ok: tone-validator ban list (V5), not copy
  "एक्सीडेंट हो जाता",
  "मौत",
  "मृत्यु",
  "मर जाते",
  "मर सकते",
  "खून",
  "ख़ून",
  "जान बचाई", // copy-ok: tone-validator ban list (V5), not copy
  "गारंटी",
  "बेवकूफ़",
  "बेवकूफ",
  "लापरवाह",
  "बेटा",
  "फ़ेल",
  "फेल",
  "पक्का पास",
];

/** V10: no rupee or fee mention in any debrief text (word-boundary aware so "feet" passes). */
export const FEE_BANS: readonly RegExp[] = [
  /₹/,
  /\brupees?\b/i,
  /रुपये|रुपए|रुपया/,
  /\bfees?\b/i,
  /शुल्क|फ़ीस|फीस/,
];

const DEVANAGARI = /[ऀ-ॿ]/u;
const LATIN = /[A-Za-z]/;
const LETTER = /\p{L}/u;

/** Share of letters in the script expected for the locale (V6), ignoring placeholders. */
export function scriptShare(text: string, locale: Locale): number {
  let letters = 0;
  let inScript = 0;
  for (const ch of stripPlaceholders(text)) {
    // Devanagari vowel signs are marks (\p{M}), count them as letters of the script.
    const isDeva = DEVANAGARI.test(ch);
    if (!isDeva && !LETTER.test(ch)) continue;
    letters++;
    if (locale === "hi" ? isDeva : LATIN.test(ch)) inScript++;
  }
  return letters === 0 ? 1 : inScript / letters;
}

export type TextCheckOptions = {
  locale: Locale;
  maxLength: number;
  /** Keys allowed in `{{fact:key}}`; an empty array means no placeholders allowed. */
  allowedKeys: readonly string[];
};

export function checkTemplateText(text: string, opts: TextCheckOptions): TextViolation[] {
  const out: TextViolation[] = [];
  const bare = stripPlaceholders(text);
  if (/[0-9०-९]/.test(bare)) out.push({ rule: "V1", detail: "digit outside a placeholder" });
  if (/\{\{|\}\}/.test(bare)) out.push({ rule: "V3", detail: "malformed placeholder" });
  for (const key of placeholders(text)) {
    if (!opts.allowedKeys.includes(key))
      out.push({ rule: "V3", detail: `unknown fact key ${key}` });
  }
  for (const re of TONE_BANS_EN) {
    const m = re.exec(bare);
    if (m) out.push({ rule: "V5", detail: `banned phrase "${m[0]}"` });
  }
  for (const w of TONE_BANS_HI) {
    if (bare.includes(w)) out.push({ rule: "V5", detail: `banned phrase "${w}"` });
  }
  const share = scriptShare(text, opts.locale);
  const min = opts.locale === "hi" ? 0.7 : 0.9;
  if (share < min) {
    out.push({ rule: "V6", detail: `${opts.locale} script share ${share.toFixed(2)} < ${min}` });
  }
  if ([...text].length > opts.maxLength) {
    out.push({ rule: "V7", detail: `length ${[...text].length} > ${opts.maxLength}` });
  }
  for (const re of FEE_BANS) {
    const m = re.exec(bare);
    if (m) out.push({ rule: "V10", detail: `fee/rupee mention "${m[0]}"` });
  }
  return out;
}

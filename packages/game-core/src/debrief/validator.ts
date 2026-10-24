// DebriefDraft validator (DEBRIEF_SPEC §6.3). Every check reads its data (patterns, limits,
// thresholds, hints) from validator-spec.json, which the Go validator shares. The same text checks
// also gate the reviewed templates before the template renderer fills them (§9).
import { placeholderKeys } from "./format.ts";
import {
  DebriefDraft,
  type DebriefDraft as DebriefDraftType,
  type DebriefLocale,
  type FactsPack,
  type ValidationResult,
  type ValidatorRuleId,
  type Violation,
} from "./schema.ts";
import {
  DIGIT_RE,
  FEE_PATTERNS,
  fillTemplate,
  MALFORMED_PLACEHOLDER_RE,
  minScriptShare,
  scriptShare,
  stripPlaceholders,
  TONE_PATTERNS,
  VALIDATOR_SPEC,
} from "./spec.ts";

const S = VALIDATOR_SPEC;
export const UNKNOWN_RULE_ID = S.unknown_rule_id;

/** The three kinds of text field (§6.3 V7, §7.1). */
export type TextField = keyof typeof S.fields;

function hintFor(rule: ValidatorRuleId, values: Readonly<Record<string, string>>): string {
  const t = rule === "MODE" || rule === "SCHEMA" ? S.pre_checks[rule].hint : S.rules[rule].hint;
  return fillTemplate(t ?? "", values);
}

function v(
  rule: ValidatorRuleId,
  path: string,
  message: string,
  values: Readonly<Record<string, string>> = {},
): Violation {
  return { rule, path, message: message.slice(0, 400), hint: hintFor(rule, values).slice(0, 400) };
}

const list = (keys: readonly string[]): string =>
  keys.length === 0 ? "none" : keys.map((k) => `{{fact:${k}}}`).join(", ");

export interface TextCheck {
  readonly field: TextField;
  /** JSON path for the violation, e.g. `where_you_lacked[0].text`. */
  readonly path: string;
  readonly locale: DebriefLocale;
  /** Keys `{{fact:k}}` may name. */
  readonly allowedKeys: readonly string[];
  /** Keys with numeric values, suggested in the V1 hint. Defaults to allowedKeys. */
  readonly numericKeys?: readonly string[] | undefined;
}

/** The per-field text rules: V1 digits, V3 placeholders, V5 tone, V6 script, V7 length, V10 fees. */
export function checkText(text: string, c: TextCheck): Violation[] {
  const out: Violation[] = [];
  const bare = stripPlaceholders(text);
  const numeric = c.numericKeys ?? c.allowedKeys;
  const digit = DIGIT_RE.exec(bare);
  if (digit) {
    out.push(
      v("V1", c.path, `digit "${digit[0]}" outside a placeholder`, {
        placeholders: numeric.length === 0 ? "words instead of numbers" : `one of ${list(numeric)}`,
      }),
    );
  }
  if (MALFORMED_PLACEHOLDER_RE.test(bare)) {
    out.push(v("V3", c.path, "malformed placeholder", { allowed: list(c.allowedKeys) }));
  }
  for (const key of placeholderKeys(text)) {
    if (!c.allowedKeys.includes(key)) {
      out.push(v("V3", c.path, `unknown fact key "${key}"`, { allowed: list(c.allowedKeys) }));
    }
  }
  for (const p of TONE_PATTERNS) {
    const m = p.re.exec(bare);
    if (m) out.push(v("V5", c.path, `banned phrase "${m[0]}" (${p.why})`, { match: m[0] }));
  }
  const share = scriptShare(text, c.locale);
  const min = minScriptShare(c.locale);
  if (share < min) {
    out.push(
      v("V6", c.path, `${c.locale} script share ${share.toFixed(2)} < ${min}`, {
        locale: c.locale,
      }),
    );
  }
  const max = S.fields[c.field].max_chars;
  const len = [...text].length;
  if (len > max) out.push(v("V7", c.path, `length ${len} > ${max}`, { max: String(max) }));
  for (const p of FEE_PATTERNS) {
    const m = p.re.exec(bare);
    if (m) out.push(v("V10", c.path, `fee/rupee mention "${m[0]}" (${p.why})`, { match: m[0] }));
  }
  return out;
}

const numericKeysOf = (facts: Readonly<Record<string, unknown>>): string[] =>
  Object.keys(facts)
    .filter((k) => typeof facts[k] === "number")
    .sort();

/**
 * Validates a model draft against its facts pack (§6.3 V1–V10; V9 is applied at render). Returns
 * every violation, so the retry prompt can list them all.
 */
export function validateDraft(draft: unknown, pack: FactsPack): ValidationResult {
  if (pack.debriefMode === "template_only") {
    return { verdict: "reject", violations: [v("MODE", "", `${pack.gameId} is template only`)] };
  }
  const parsed = DebriefDraft.safeParse(draft);
  if (!parsed.success) {
    return {
      verdict: "reject",
      violations: parsed.error.issues
        .slice(0, 12)
        .map((i) => v("SCHEMA", i.path.map(String).join("."), i.message)),
    };
  }
  const d: DebriefDraftType = parsed.data;
  const out: Violation[] = [];
  const findings = new Map(pack.findings.map((f) => [f.findingId, f]));
  const findingIds = pack.findings.map((f) => f.findingId);

  if (d.locale !== pack.locale) {
    out.push(
      v("V6", "locale", `draft locale ${d.locale} ≠ pack locale ${pack.locale}`, {
        locale: pack.locale,
      }),
    );
  }

  // how_you_did: placeholders from positives (§6.3 V3).
  const posFacts = Object.assign({}, ...pack.positives.map((p) => p.facts)) as Record<
    string,
    unknown
  >;
  out.push(
    ...checkText(d.how_you_did, {
      field: "how_you_did",
      path: "how_you_did",
      locale: pack.locale,
      allowedKeys: Object.keys(posFacts).sort(),
      numericKeys: numericKeysOf(posFacts),
    }),
  );

  const allowedRules = new Set([...pack.allowedRuleIds, UNKNOWN_RULE_ID]);
  const lists = [
    ["where_you_lacked", d.where_you_lacked],
    ["what_you_could_have_done", d.what_you_could_have_done],
  ] as const;
  for (const [name, points] of lists) {
    points.forEach((p, i) => {
      const at = `${name}[${i}]`;
      const f = findings.get(p.finding_id);
      if (f === undefined) {
        out.push(
          v("V2", `${at}.finding_id`, `unknown finding_id "${p.finding_id}"`, {
            allowed: findingIds.join(", ") || "no finding IDs (leave the list empty)",
          }),
        );
      }
      if (!allowedRules.has(p.rule_id)) {
        out.push(
          v("V2", `${at}.rule_id`, `rule_id "${p.rule_id}" is not allowed`, {
            allowed: [...allowedRules].join(", "),
          }),
        );
      }
      out.push(
        ...checkText(p.text, {
          field: "point_text",
          path: `${at}.text`,
          locale: pack.locale,
          allowedKeys: f === undefined ? [] : Object.keys(f.facts).sort(),
          numericKeys: f === undefined ? [] : numericKeysOf(f.facts),
        }),
      );
    });
  }

  const drills = pack.drillCandidates.map((c) => c.drillId);
  if (!drills.includes(d.next_drill.drill_id)) {
    out.push(
      v("V2", "next_drill.drill_id", `drill_id "${d.next_drill.drill_id}" is not a candidate`, {
        allowed: drills.join(", "),
      }),
    );
  }
  out.push(
    ...checkText(d.next_drill.why, {
      field: "drill_why",
      path: "next_drill.why",
      locale: pack.locale,
      allowedKeys: [],
    }),
  );

  const improved = d.improved_since_last;
  if (improved !== undefined && improved !== null && !pack.resolvedSinceLast.includes(improved)) {
    out.push(
      v("V2", "improved_since_last", `"${improved}" is not a resolved previous finding`, {
        allowed: pack.resolvedSinceLast.join(", ") || "null",
      }),
    );
  }

  // V4 coverage: the first lacked point is the top finding.
  const top = pack.findings[0];
  if (top !== undefined && d.where_you_lacked[0]?.finding_id !== top.findingId) {
    out.push(
      v("V4", "where_you_lacked[0].finding_id", `first point must be ${top.findingId}`, {
        expected: top.findingId,
      }),
    );
  }

  // V8 counts.
  const max = S.rules.V8.max_points;
  for (const [name, points] of lists) {
    if (points.length > max) {
      const detail = `keep at most ${max} points in ${name}`;
      out.push(v("V8", name, `${points.length} points > ${max}`, { detail }));
    }
    const seen = new Set<string>();
    points.forEach((p, i) => {
      if (seen.has(p.finding_id)) {
        out.push(
          v("V8", `${name}[${i}].finding_id`, `duplicate finding_id ${p.finding_id}`, {
            detail: "use each finding at most once per list",
          }),
        );
      }
      seen.add(p.finding_id);
    });
  }
  const lacked = new Set(d.where_you_lacked.map((p) => p.finding_id));
  d.what_you_could_have_done.forEach((p, i) => {
    if (!lacked.has(p.finding_id)) {
      out.push(
        v(
          "V8",
          `what_you_could_have_done[${i}].finding_id`,
          `${p.finding_id} is not in where_you_lacked`,
          {
            detail: "each 'could have done' point must refer to a finding in where_you_lacked",
          },
        ),
      );
    }
  });

  return { verdict: out.length === 0 ? "pass" : "reject", violations: out };
}

/**
 * The retry message (§6.3 flow): one line per violation, e.g.
 * "Your draft broke V1 at where_you_lacked[0].text: remove the digit, use one of {{fact:late_s}}, …".
 */
export function retryHint(violations: readonly Violation[]): string {
  const lines = violations.map((x) =>
    fillTemplate(S.retry.line, { rule: x.rule, path: x.path || "(draft)", hint: x.hint }),
  );
  return [...new Set(lines)].join(S.retry.joiner);
}

/** Unique rule IDs of a violation list, in V-order, for E-19 and the card (§8.5). */
export function violatedRules(violations: readonly Violation[]): ValidatorRuleId[] {
  const order: ValidatorRuleId[] = [
    "MODE",
    "SCHEMA",
    "V1",
    "V2",
    "V3",
    "V4",
    "V5",
    "V6",
    "V7",
    "V8",
    "V9",
    "V10",
  ];
  const set = new Set(violations.map((x) => x.rule));
  return order.filter((r) => set.has(r));
}

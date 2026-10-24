// Card renderers (DEBRIEF_SPEC §7.2, §9). renderTemplateCard builds "Auto notes" from the reviewed
// templates (always available, offline, the only path for Golden Hour); renderDraft turns a
// validated DebriefDraft into "Coach notes". Both fill {{fact:key}} with formatted values, attach
// rule chips only for verified rules, and HTML-escape every text (V9).
import {
  type CatalogueIndex,
  type DebriefCatalogue,
  DebriefError,
  type FactLabels,
  indexCatalogue,
  ruleText,
} from "./catalogue.ts";
import {
  dropMissingClauses,
  type FactSource,
  type FormatOptions,
  factLocale,
  fillPlaceholders,
} from "./format.ts";
import {
  type CardDrill,
  type CardPoint,
  type CardValidator,
  DebriefCard,
  type DebriefDraft,
  type DebriefLocale,
  type DrillCandidate,
  type FactKind,
  type FactsPack,
  type RuleChip,
  type TemplateLocale,
} from "./schema.ts";
import { escapeHtml } from "./spec.ts";
import {
  checkText,
  retryHint,
  type TextField,
  UNKNOWN_RULE_ID,
  validateDraft,
} from "./validator.ts";

/** Fixed card labels (§0.1, §8.4, §9). Hindi pending native review. */
export const CARD_LABELS: Readonly<
  Record<
    TemplateLocale,
    { footer: string; autoNotes: string; coachNotes: string; medicalDraft: string }
  >
> = {
  en: {
    footer: "Practice and familiarisation, not certification",
    autoNotes: "Auto notes",
    coachNotes: "Coach notes",
    medicalDraft: "Draft, not medical advice",
  },
  hi: {
    footer: "अभ्यास और परिचय के लिए, प्रमाणन नहीं",
    autoNotes: "स्वचालित नोट्स",
    coachNotes: "कोच नोट्स",
    medicalDraft: "मसौदा, चिकित्सा सलाह नहीं",
  },
};

/**
 * Last-resort lines when a template is missing, fails the text rules (non-strict mode) or loses
 * every clause to absent facts. They pass the text rules themselves (tested).
 */
export const FALLBACK_TEXT: Readonly<
  Record<TemplateLocale, { how: string; lacked: string; could: string; why: string }>
> = {
  en: {
    how: "Here is what this session showed, and one drill to try next.",
    lacked: "This came up in your session. The drill below works on it.",
    could: "Try the drill below, then watch for this next time.",
    why: "A short drill on the part of this session that needs work.",
  },
  hi: {
    how: "इस सेशन में क्या दिखा और आगे कौन-सा अभ्यास करें, यह नीचे है।",
    lacked: "यह आपके सेशन में दिखा। नीचे दिया अभ्यास इसी पर है।",
    could: "नीचे दिया अभ्यास करें, फिर अगली बार इस पर ध्यान दें।",
    why: "इस सेशन के उस हिस्से पर छोटा अभ्यास, जिस पर काम करना है।",
  },
};

export interface TemplateCardOptions {
  /** ISO-8601 timestamp for created_at (game-core never reads the clock). */
  readonly now: string;
  readonly sid: string;
  /** e.g. "game-core 0.1.0". */
  readonly generatorVersion: string;
  /** Set when the template replaces a rejected AI draft (§8.5); default pass / 0 attempts. */
  readonly validator?: CardValidator | undefined;
  /** Throw on a missing label, a missing template or a template that fails the text rules. */
  readonly strict?: boolean | undefined;
}

export interface DraftCardOptions {
  readonly now: string;
  readonly sid: string;
  readonly generatorVersion: string;
  /** The model ID that wrote the draft, e.g. "gemini-3.1-flash-lite". */
  readonly model: string;
  /** 1 or 2 (§6.3 flow: one retry). Default 1. */
  readonly attempts?: number | undefined;
  readonly strict?: boolean | undefined;
}

/** Hinglish templates fall back to `hi` (§7.1 locale note). */
export const templateLocale = (locale: DebriefLocale): TemplateLocale =>
  locale === "en" ? "en" : "hi";

function sourceOf(ix: CatalogueIndex, findingId: string, facts: FactSource["facts"]): FactSource {
  return { facts, kinds: ix.factKinds.get(findingId) ?? new Map<string, FactKind>() };
}

interface SlotContext {
  readonly field: TextField;
  readonly path: string;
  readonly locale: TemplateLocale;
  readonly labels: FactLabels;
  readonly opts: FormatOptions;
}

/**
 * One template slot: text rules on the raw template first (§9: templates can never fail the
 * validator), then drop the clauses whose facts are absent. Returns the unfilled text, or null to
 * use a fallback line.
 */
function selectTemplate(
  template: string | undefined,
  source: FactSource,
  c: SlotContext,
): string | null {
  if (template === undefined || template.length === 0) {
    if (c.opts.strict === true) throw new DebriefError("TEMPLATE_INVALID", `${c.path}: missing`);
    return null;
  }
  const issues = checkText(template, {
    field: c.field,
    path: c.path,
    locale: c.locale,
    allowedKeys: [...source.kinds.keys()],
  });
  if (issues.length > 0) {
    if (c.opts.strict === true) {
      const detail = issues.map((i) => `${i.rule} ${i.message}`).join("; ");
      throw new DebriefError("TEMPLATE_INVALID", `${c.path}: ${detail}`);
    }
    return null;
  }
  return dropMissingClauses(template, (k) => source.facts[k] !== undefined, c.locale);
}

function chip(ix: CatalogueIndex, ruleId: string, locale: TemplateLocale): RuleChip | null {
  const r = ix.rules.get(ruleId);
  if (r === undefined) return null;
  return {
    id: r.rule_id,
    text: escapeHtml(ruleText(r, locale)),
    source_title: escapeHtml(r.source_title),
    source_url: r.source_url,
    verified_on: r.verified_on,
  };
}

function cardDrill(ix: CatalogueIndex, c: DrillCandidate, why: string): CardDrill {
  const drill = ix.drills.get(c.drillId);
  if (drill === undefined) throw new DebriefError("UNKNOWN_DRILL", `${c.drillId} not in catalogue`);
  const deeplink =
    c.level === null
      ? drill.deeplink.replace("&level={level}", "")
      : drill.deeplink.replace("{level}", String(c.level));
  return { drillId: c.drillId, level: c.level, deeplink, why: escapeHtml(why) };
}

function notices(ix: CatalogueIndex, pack: FactsPack, locale: TemplateLocale): string[] {
  const medical = pack.findings.some((f) => ix.findings.get(f.findingId)?.medical_review_required);
  return medical ? [escapeHtml(CARD_LABELS[locale].medicalDraft)] : [];
}

/** The template card's texts before placeholders are filled (§9 assembly). */
interface TemplatePoint {
  readonly findingId: string;
  /** First verified rule of the finding (chips only for verified rules), else UNKNOWN. */
  readonly ruleId: string;
  readonly lacked: string;
  readonly could: string;
  readonly source: FactSource;
}

interface TemplateTexts {
  readonly locale: TemplateLocale;
  readonly how: { readonly text: string; readonly source: FactSource };
  readonly points: readonly TemplatePoint[];
  readonly drill: DrillCandidate;
  readonly why: string;
}

function templateTexts(
  pack: FactsPack,
  ix: CatalogueIndex,
  locale: DebriefLocale,
  opts: FormatOptions,
): TemplateTexts {
  const tl = templateLocale(locale);
  const game = ix.games.get(pack.gameId);
  if (game === undefined) throw new DebriefError("UNKNOWN_GAME", `${pack.gameId} not in catalogue`);
  const slot = (field: TextField, path: string): SlotContext => ({
    field,
    path,
    locale: tl,
    labels: ix.labels,
    opts,
  });
  const none = sourceOf(ix, "", {});

  // how_you_did: a positive's template when one renders, else the game's band line.
  let how: TemplateTexts["how"] | null = null;
  for (const p of pack.positives) {
    const source = sourceOf(ix, p.findingId, p.facts);
    const text = selectTemplate(
      ix.findings.get(p.findingId)?.templates.how?.[tl],
      source,
      slot("how_you_did", `debrief.${p.findingId}.how.${tl}`),
    );
    if (text !== null) {
      how = { text, source };
      break;
    }
  }
  const band = pack.score.band;
  how ??= {
    text:
      selectTemplate(
        game.how_templates[band][tl],
        none,
        slot("how_you_did", `debrief.${pack.gameId}.how.${band}.${tl}`),
      ) ?? FALLBACK_TEXT[tl].how,
    source: none,
  };

  const points = pack.findings.map((f): TemplatePoint => {
    const entry = ix.findings.get(f.findingId);
    const source = sourceOf(ix, f.findingId, f.facts);
    const text = (s: "lacked" | "could"): string =>
      selectTemplate(
        entry?.templates[s]?.[tl],
        source,
        slot("point_text", `debrief.${f.findingId}.${s}.${tl}`),
      ) ?? FALLBACK_TEXT[tl][s];
    return {
      findingId: f.findingId,
      ruleId: f.ruleIds.find((r) => ix.rules.get(r)?.verified === true) ?? UNKNOWN_RULE_ID,
      lacked: text("lacked"),
      could: text("could"),
      source,
    };
  });

  const drill = pack.drillCandidates[0] as DrillCandidate;
  const why =
    selectTemplate(
      ix.drills.get(drill.drillId)?.why[tl],
      none,
      slot("drill_why", `drill.${drill.drillId}.why.${tl}`),
    ) ?? FALLBACK_TEXT[tl].why;
  return { locale: tl, how, points, drill, why };
}

/**
 * The template debrief as a DebriefDraft (placeholders unfilled, `locale` = the template locale),
 * so it can go through validateDraft: "the template debrief passes the validator" (P2 DoD). A
 * verified rule the AI may not cite (not in allowedRuleIds) becomes UNKNOWN here.
 */
export function templateDraft(
  pack: FactsPack,
  catalogue: DebriefCatalogue,
  locale: DebriefLocale,
  opts: { readonly strict?: boolean | undefined } = {},
): DebriefDraft {
  const t = templateTexts(pack, indexCatalogue(catalogue), locale, { strict: opts.strict });
  const cite = (r: string): string => (pack.allowedRuleIds.includes(r) ? r : UNKNOWN_RULE_ID);
  const points = (s: "lacked" | "could") =>
    t.points.map((p) => ({ finding_id: p.findingId, rule_id: cite(p.ruleId), text: p[s] }));
  return {
    locale: t.locale,
    how_you_did: t.how.text,
    where_you_lacked: points("lacked"),
    what_you_could_have_done: points("could"),
    next_drill: { drill_id: t.drill.drillId, why: t.why },
    improved_since_last: pack.resolvedSinceLast[0] ?? null,
    unknown: pack.findings.length === 0,
  };
}

/**
 * The template card, "Auto notes" (§9 assembly): how_you_did from a positive's template or the
 * game's band line; top-3 findings in generator order with their lacked / could templates; rule
 * chips only for verified rules (else UNKNOWN, no chip); drill = drillCandidates[0]. Hinglish
 * renders the `hi` templates.
 */
export function renderTemplateCard(
  pack: FactsPack,
  catalogue: DebriefCatalogue,
  locale: DebriefLocale,
  opts: TemplateCardOptions,
): DebriefCard {
  const ix = indexCatalogue(catalogue);
  const fmt: FormatOptions = { strict: opts.strict };
  const t = templateTexts(pack, ix, locale, fmt);
  const tl = t.locale;
  const fill = (text: string, source: FactSource): string =>
    escapeHtml(fillPlaceholders(text, source, tl, ix.labels, fmt));
  const point = (p: TemplatePoint, s: "lacked" | "could"): CardPoint => ({
    findingId: p.findingId,
    ruleId: p.ruleId,
    text: fill(p[s], p.source),
    rule: p.ruleId === UNKNOWN_RULE_ID ? null : chip(ix, p.ruleId, tl),
  });

  return DebriefCard.parse({
    sid: opts.sid,
    gameId: pack.gameId,
    kind: "auto_notes",
    locale: tl,
    label: CARD_LABELS[tl].footer,
    notes_label: CARD_LABELS[tl].autoNotes,
    notices: notices(ix, pack, tl),
    how_you_did: fill(t.how.text, t.how.source),
    where_you_lacked: t.points.map((p) => point(p, "lacked")),
    what_you_could_have_done: t.points.map((p) => point(p, "could")),
    next_drill: cardDrill(ix, t.drill, t.why),
    improved_since_last: pack.resolvedSinceLast[0] ?? null,
    generator_version: opts.generatorVersion,
    model: null,
    validator: opts.validator ?? { verdict: "pass", attempts: 0, violations: [] },
    created_at: opts.now,
  });
}

/**
 * The coach card, "Coach notes": validates the draft (throws INVALID_DRAFT with the retry message
 * if it breaks any rule), fills {{fact:key}} with formatted values, attaches rule text + source
 * for the allowed rules it cites and HTML-escapes everything (V9).
 */
export function renderDraft(
  draft: DebriefDraft,
  pack: FactsPack,
  catalogue: DebriefCatalogue,
  locale: DebriefLocale,
  opts: DraftCardOptions,
): DebriefCard {
  const verdict = validateDraft(draft, pack);
  if (verdict.verdict !== "pass") {
    throw new DebriefError("INVALID_DRAFT", retryHint(verdict.violations));
  }
  const ix = indexCatalogue(catalogue);
  const fmt: FormatOptions = { strict: opts.strict };
  // Prose from the catalogue (rule chips, labels) follows the template locale; inline facts in
  // Hinglish (Latin script) use the English forms (format.ts factLocale).
  const tl = templateLocale(locale);
  const ui = factLocale(locale);
  const findings = new Map(pack.findings.map((f) => [f.findingId, f]));

  const posKinds = new Map<string, FactKind>();
  for (const p of pack.positives) {
    for (const [k, kind] of ix.factKinds.get(p.findingId) ?? []) posKinds.set(k, kind);
  }
  const posSource: FactSource = {
    facts: Object.assign({}, ...pack.positives.map((p) => p.facts)),
    kinds: posKinds,
  };

  const points = (list: DebriefDraft["where_you_lacked"]): CardPoint[] =>
    list.map((p) => {
      const f = findings.get(p.finding_id);
      const source = sourceOf(ix, p.finding_id, f?.facts ?? {});
      return {
        findingId: p.finding_id,
        ruleId: p.rule_id,
        text: escapeHtml(fillPlaceholders(p.text, source, locale, ix.labels, fmt)),
        rule: p.rule_id === UNKNOWN_RULE_ID ? null : chip(ix, p.rule_id, tl),
      };
    });

  const candidate = pack.drillCandidates.find((c) => c.drillId === draft.next_drill.drill_id);
  if (candidate === undefined) throw new DebriefError("INVALID_DRAFT", "drill not a candidate");

  return DebriefCard.parse({
    sid: opts.sid,
    gameId: pack.gameId,
    kind: "coach_notes",
    locale,
    label: CARD_LABELS[ui].footer,
    notes_label: CARD_LABELS[ui].coachNotes,
    notices: notices(ix, pack, ui),
    how_you_did: escapeHtml(fillPlaceholders(draft.how_you_did, posSource, locale, ix.labels, fmt)),
    where_you_lacked: points(draft.where_you_lacked),
    what_you_could_have_done: points(draft.what_you_could_have_done),
    next_drill: cardDrill(ix, candidate, draft.next_drill.why),
    improved_since_last: draft.improved_since_last ?? null,
    generator_version: opts.generatorVersion,
    model: opts.model,
    validator: { verdict: "pass", attempts: opts.attempts ?? 1, violations: [] },
    created_at: opts.now,
  });
}

interface AuditText {
  readonly text: string | undefined;
  readonly field: TextField;
  readonly path: string;
  readonly locale: TemplateLocale;
  readonly keys: readonly string[];
}

const LOCALES = ["en", "hi"] as const;

/** Every reviewed text the template card can show, with its rule context. */
function auditTexts(catalogue: DebriefCatalogue): AuditText[] {
  const findings = catalogue.findings.flatMap((f) => {
    const keys = f.facts.map((x) => x.key);
    const slots = f.polarity === "negative" ? (["lacked", "could"] as const) : (["how"] as const);
    return slots.flatMap((s) =>
      LOCALES.map((locale) => ({
        text: f.templates[s]?.[locale],
        field: s === "how" ? ("how_you_did" as const) : ("point_text" as const),
        path: `debrief.${f.finding_id}.${s}.${locale}`,
        locale,
        keys,
      })),
    );
  });
  const bands = catalogue.games.flatMap((g) =>
    (["strong", "medium", "weak"] as const).flatMap((band) =>
      LOCALES.map((locale) => ({
        text: g.how_templates[band][locale],
        field: "how_you_did" as const,
        path: `debrief.${g.game_id}.how.${band}.${locale}`,
        locale,
        keys: [],
      })),
    ),
  );
  const whys = catalogue.drills.flatMap((d) =>
    LOCALES.map((locale) => ({
      text: d.why[locale],
      field: "drill_why" as const,
      path: `drill.${d.drill_id}.why.${locale}`,
      locale,
      keys: [],
    })),
  );
  return [...findings, ...bands, ...whys];
}

/**
 * Catalogue audit for tests and content tooling: every finding has its en + hi templates and every
 * template, band line and drill reason passes the text rules; every enum fact has labels; every
 * game's default drill exists.
 */
export function auditCatalogue(catalogue: DebriefCatalogue): string[] {
  const ix = indexCatalogue(catalogue);
  const out: string[] = [];
  for (const t of auditTexts(catalogue)) {
    if (t.text === undefined || t.text.trim().length === 0) {
      out.push(`${t.path}: missing`);
      continue;
    }
    const c = { field: t.field, path: t.path, locale: t.locale, allowedKeys: t.keys };
    for (const i of checkText(t.text, c)) out.push(`${t.path}: ${i.rule} ${i.message}`);
  }
  for (const f of catalogue.findings) {
    for (const x of f.facts) {
      const enumLike = x.kind === "enum" || x.kind === "enum_list";
      if (enumLike && (ix.labels.get(x.key)?.size ?? 0) === 0) {
        out.push(`${f.finding_id}: no labels for enum fact ${x.key}`);
      }
    }
  }
  for (const g of catalogue.games) {
    if (!ix.drills.has(g.default_drill_id)) out.push(`${g.game_id}: unknown default drill`);
  }
  return out;
}

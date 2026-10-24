// Cross-file consistency checks over a parsed content pack. Each check returns a list of human-
// readable issues (empty = pass); tests assert each one separately and scripts/validate.ts runs
// them all. Schema-level checks live in the Zod schemas; these are the ones a schema can't see.
import { citableRuleIds } from "./allowlists.ts";
import type { Content } from "./model.ts";
import type { AllowlistsFile } from "./schema/allowlists.ts";
import { HAZARD_TYPES, type LocalizedText } from "./schema/common.ts";
import type { Finding } from "./schema/findings.ts";
import type { Item } from "./schema/questions.ts";
import type { Sign } from "./schema/signs.ts";
import { checkTemplateText, LIMITS } from "./text.ts";

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/** Devanagari block. */
const DEVA = /[ऀ-ॿ]/;

function dupes(label: string, ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) out.push(`duplicate ${label}: ${id}`);
    seen.add(id);
  }
  return out;
}

function index<T>(xs: readonly T[], key: (x: T) => string): Map<string, T> {
  return new Map(xs.map((x) => [key(x), x]));
}

export function allConcepts(c: Content) {
  return c.questionBanks.flatMap((b) => b.concepts);
}

export function allItems(c: Content) {
  return allConcepts(c).flatMap((k) => k.items.map((it) => ({ concept: k, item: it })));
}

/** Upper-cases the fact value and substitutes it into a drill pattern. */
export function expandDrillPattern(template: string, factKey: string, value: string): string {
  return template.replace(`{${factKey}}`, value.toUpperCase());
}

/**
 * Values a drill-pattern fact can take (hazard types come from NAZAR §3.3). Labelled values marked
 * `pattern_drill: false` have a fixed drill instead and are left out.
 */
export function factEnumValues(c: Content, factKey: string): string[] | undefined {
  if (factKey === "hazard_type") return c.hazardTypes.hazard_types.map((h) => h.hazard_type);
  return c.enums.enums
    .find((e) => e.fact_key === factKey)
    ?.values.filter((v) => v.pattern_drill !== false)
    .map((v) => v.value);
}

// ---------------------------------------------------------------------------------------------
// duplicate IDs
// ---------------------------------------------------------------------------------------------

export function checkDuplicateIds(c: Content): string[] {
  const concepts = allConcepts(c);
  const items = allItems(c);
  const objectives = c.modules.flatMap((m) => m.learning_objectives.map((o) => o.id));
  const lessons = c.modules.flatMap((m) => m.lessons.map((o) => o.id));
  const facts = c.modules.flatMap((m) => m.key_facts.map((o) => o.id));
  const myths = c.modules.flatMap((m) => m.misconceptions.map((o) => o.id));
  const out = [
    ...dupes(
      "rule_id",
      c.rules.rules.map((r) => r.rule_id),
    ),
    ...dupes(
      "finding_id",
      c.findings.findings.map((f) => f.finding_id),
    ),
    ...dupes(
      "drill_id",
      c.drills.drills.map((d) => d.drill_id),
    ),
    ...dupes(
      "skill_id",
      c.skills.skills.map((s) => s.skill_id),
    ),
    ...dupes(
      "game_id",
      c.games.games.map((g) => g.game_id),
    ),
    ...dupes(
      "game code",
      c.games.games.map((g) => g.code),
    ),
    ...dupes(
      "hazard_type",
      c.hazardTypes.hazard_types.map((h) => h.hazard_type),
    ),
    ...dupes(
      "sign_id",
      c.signs.signs.map((s) => s.sign_id),
    ),
    ...dupes(
      "illustration_id",
      c.illustrations.illustrations.map((s) => s.illustration_id),
    ),
    ...dupes(
      "module_id",
      c.modules.map((m) => m.module_id),
    ),
    ...dupes(
      "concept_id",
      concepts.map((k) => k.concept_id),
    ),
    ...dupes(
      "item_id",
      items.map((x) => x.item.item_id),
    ),
    ...dupes(
      "explanation_id",
      concepts.map((k) => k.explanation.explanation_id),
    ),
    ...dupes("objective id", objectives),
    ...dupes("lesson id", lessons),
    ...dupes("key fact id", facts),
    ...dupes("misconception id", myths),
    ...dupes(
      "enum fact_key",
      c.enums.enums.map((e) => e.fact_key),
    ),
    ...dupes(
      "question bank topic",
      c.questionBanks.map((b) => b.topic),
    ),
  ];
  for (const e of c.enums.enums)
    out.push(
      ...dupes(
        `${e.fact_key} value`,
        e.values.map((v) => v.value),
      ),
    );
  for (const f of c.findings.findings)
    out.push(
      ...dupes(
        `${f.finding_id} fact`,
        f.facts.map((x) => x.key),
      ),
    );
  // Two signs with the same name or alt text would make an option ambiguous.
  out.push(
    ...dupes(
      "sign name (en)",
      c.signs.signs.map((s) => s.name.en.toLowerCase()),
    ),
  );
  out.push(
    ...dupes(
      "sign name (hi)",
      c.signs.signs.map((s) => s.name.hi),
    ),
  );
  out.push(
    ...dupes(
      "sign alt (en)",
      c.signs.signs.map((s) => s.alt.en.toLowerCase()),
    ),
  );
  return out;
}

// ---------------------------------------------------------------------------------------------
// referential integrity
// ---------------------------------------------------------------------------------------------

type Need = (ok: boolean, msg: string) => void;

type Index = {
  rules: Set<string>;
  drills: Map<string, Content["drills"]["drills"][number]>;
  skills: Set<string>;
  games: Map<string, Content["games"]["games"][number]>;
  modules: Set<string>;
  signs: Map<string, Sign>;
  illustrations: Set<string>;
  concepts: Map<string, ReturnType<typeof allConcepts>[number]>;
};

function buildIndex(c: Content): Index {
  return {
    rules: new Set(c.rules.rules.map((r) => r.rule_id)),
    drills: index(c.drills.drills, (d) => d.drill_id),
    skills: new Set(c.skills.skills.map((s) => s.skill_id)),
    games: index(c.games.games, (g) => g.game_id),
    modules: new Set(c.modules.map((m) => m.module_id)),
    signs: index(c.signs.signs, (s) => s.sign_id),
    illustrations: new Set(c.illustrations.illustrations.map((i) => i.illustration_id)),
    concepts: index(allConcepts(c), (k) => k.concept_id),
  };
}

function refFindingDrills(c: Content, ix: Index, f: Finding, need: Need): void {
  for (const d of f.drill_ids) {
    const drill = ix.drills.get(d);
    need(!!drill, `${f.finding_id}: unknown drill ${d}`);
    if (drill) {
      need(drill.game_id === f.game_id, `${f.finding_id}: drill ${d} belongs to ${drill.game_id}`);
    }
  }
  if (f.drill_pattern) {
    const { template, fact_key } = f.drill_pattern;
    const values = factEnumValues(c, fact_key);
    need(!!values, `${f.finding_id}: no enum values for ${fact_key}`);
    for (const v of values ?? []) {
      const id = expandDrillPattern(template, fact_key, v);
      need(ix.drills.has(id), `${f.finding_id}: pattern expands to missing drill ${id}`);
    }
  }
  need(
    f.drill_ids.length > 0 || !!f.drill_pattern || f.polarity === "positive",
    `${f.finding_id}: a negative finding needs a drill`,
  );
}

function refFindings(c: Content, ix: Index, need: Need): void {
  const mapped = new Set(c.hazardTypes.hazard_types.flatMap((h) => h.rule_ids));
  for (const f of c.findings.findings) {
    const g = ix.games.get(f.game_id);
    need(!!g, `${f.finding_id}: unknown game ${f.game_id}`);
    if (g) {
      need(
        f.finding_id.startsWith(g.finding_prefix),
        `${f.finding_id}: prefix is not ${g.finding_prefix}`,
      );
      need(
        f.template_only === (g.debrief_mode === "template_only"),
        `${f.finding_id}: template_only must follow the game's debrief_mode`,
      );
    }
    if (f.skill.id) need(ix.skills.has(f.skill.id), `${f.finding_id}: unknown skill ${f.skill.id}`);
    for (const r of f.rule_ids) need(ix.rules.has(r), `${f.finding_id}: unknown rule ${r}`);
    if (f.rule_resolution === "per_hazard_type") {
      for (const r of f.rule_ids) {
        need(mapped.has(r), `${f.finding_id}: ${r} is not mapped to any hazard type`);
      }
    }
    refFindingDrills(c, ix, f, need);
  }
}

function refDrills(c: Content, ix: Index, need: Need): void {
  for (const d of c.drills.drills) {
    const g = ix.games.get(d.game_id);
    need(!!g, `${d.drill_id}: unknown game ${d.game_id}`);
    for (const s of d.skill_ids) need(ix.skills.has(s), `${d.drill_id}: unknown skill ${s}`);
    const expectedId = d.hazard_type
      ? `DR-NAZ-OCCL-${d.hazard_type.toUpperCase()}`
      : d.sign_family
        ? `DR-LL-SIGNS-${d.sign_family}`
        : d.topic
          ? `DR-LL-TOPIC-${d.topic}`
          : d.drill_id;
    need(d.drill_id === expectedId, `${d.drill_id}: hazard_type / sign_family / topic mismatch`);
    if (g) {
      need(
        d.template_only === (g.debrief_mode === "template_only"),
        `${d.drill_id}: template_only must follow the game's debrief_mode`,
      );
    }
  }
}

function refSkillsAndGames(c: Content, ix: Index, need: Need): void {
  for (const s of c.skills.skills) {
    need(ix.modules.has(s.module_id), `${s.skill_id}: no module file for ${s.module_id}`);
    for (const p of s.follows) need(ix.skills.has(p), `${s.skill_id}: follows unknown ${p}`);
    for (const p of s.requires) {
      need(ix.skills.has(p.skill_id), `${s.skill_id}: requires unknown ${p.skill_id}`);
    }
  }
  for (const g of c.games.games) {
    for (const m of g.module_ids) need(ix.modules.has(m), `${g.game_id}: unknown module ${m}`);
    for (const s of g.skill_ids) need(ix.skills.has(s), `${g.game_id}: unknown skill ${s}`);
    const d = ix.drills.get(g.default_drill_id);
    need(
      d?.game_id === g.game_id,
      `${g.game_id}: default drill ${g.default_drill_id} missing or of another game`,
    );
  }
  for (const r of c.rules.rules) {
    for (const m of r.module_ids) need(ix.modules.has(m), `${r.rule_id}: unknown module ${m}`);
  }
  for (const h of c.hazardTypes.hazard_types) {
    for (const m of h.module_ids) need(ix.modules.has(m), `${h.hazard_type}: unknown module ${m}`);
    if (h.skill_id)
      need(ix.skills.has(h.skill_id), `${h.hazard_type}: unknown skill ${h.skill_id}`);
    for (const r of h.rule_ids) need(ix.rules.has(r), `${h.hazard_type}: unknown rule ${r}`);
    need(
      ix.drills.has(h.occlusion_drill_id),
      `${h.hazard_type}: missing drill ${h.occlusion_drill_id}`,
    );
  }
}

function refModules(c: Content, ix: Index, need: Need): void {
  for (const m of c.modules) {
    const id = m.module_id;
    need(ix.skills.has(m.skill_id), `${id}: no skill node ${m.skill_id}`);
    for (const g of m.game_ids) {
      const game = ix.games.get(g);
      need(!!game, `${id}: unknown game ${g}`);
      if (game) need(game.module_ids.includes(id), `${id}: game ${g} does not list this module`);
    }
    for (const d of m.drill_ids) need(ix.drills.has(d), `${id}: unknown drill ${d}`);
    const ruleRefs = [
      ...m.rule_ids,
      ...m.key_facts.flatMap((k) => (k.rule_id ? [k.rule_id] : [])),
      ...m.misconceptions.flatMap((x) => (x.rule_id ? [x.rule_id] : [])),
    ];
    for (const r of ruleRefs) need(ix.rules.has(r), `${id}: unknown rule ${r}`);
    for (const k of [...m.concepts.authored, ...m.assessment.item_refs]) {
      need(ix.concepts.has(k), `${id}: unknown concept ${k}`);
    }
  }
}

function refConcepts(c: Content, ix: Index, need: Need): void {
  const asset = (a: string) => ix.signs.has(a) || ix.illustrations.has(a);
  for (const k of allConcepts(c)) {
    const m = c.modules.find((x) => x.module_id === k.topic);
    need(
      !!m?.concepts.authored.includes(k.concept_id),
      `${k.concept_id}: not listed in ${k.topic}.concepts.authored`,
    );
    for (const r of k.rule_ids) need(ix.rules.has(r), `${k.concept_id}: unknown rule ${r}`);
    if (k.sign_id) {
      const s = ix.signs.get(k.sign_id);
      need(!!s, `${k.concept_id}: unknown sign ${k.sign_id}`);
      if (s)
        need(
          s.family === k.sign_family,
          `${k.concept_id}: sign_family ${k.sign_family} != ${s.family}`,
        );
    }
    for (const it of k.items) {
      const assets = [
        ...it.stem_assets,
        ...it.options.flatMap((o) => (o.asset_id ? [o.asset_id] : [])),
      ];
      for (const a of assets) need(asset(a), `${it.item_id}: unknown asset ${a}`);
      for (const ref of Object.values(it.key.option_refs ?? {})) {
        need(ix.signs.has(ref), `${it.item_id}: unknown option ref ${ref}`);
      }
    }
  }
  for (const s of c.signs.signs) {
    if (!s.mirror_of) continue;
    const m = ix.signs.get(s.mirror_of);
    need(m?.mirror_of === s.sign_id, `${s.sign_id}: mirror_of must be symmetric`);
  }
}

export function checkReferences(c: Content): string[] {
  const out: string[] = [];
  const need: Need = (ok, msg) => {
    if (!ok) out.push(msg);
  };
  const ix = buildIndex(c);
  refFindings(c, ix, need);
  refDrills(c, ix, need);
  refSkillsAndGames(c, ix, need);
  refModules(c, ix, need);
  refConcepts(c, ix, need);
  return out;
}

// ---------------------------------------------------------------------------------------------
// rule-pack cross references (rulepacks/ is read-only for content)
// ---------------------------------------------------------------------------------------------

export type RulepackLookup = {
  /** rows by file (path relative to rulepacks/) */
  files: {
    [file: string]: {
      rules?: { id: string; [k: string]: unknown }[];
      classes?: { id: string; [k: string]: unknown }[];
    };
  };
};

function rowsOf(rp: RulepackLookup, file: string) {
  const f = rp.files[file];
  return [...(f?.rules ?? []), ...(f?.classes ?? [])];
}

function anyRow(rp: RulepackLookup, id: string) {
  for (const file of Object.keys(rp.files)) {
    const row = rowsOf(rp, file).find((r) => r.id === id);
    if (row) return row;
  }
  return undefined;
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function rulepackRowIssues(c: Content, rp: RulepackLookup): string[] {
  const out: string[] = [];
  const want = (owner: string, id: string | null | undefined) => {
    if (id && !id.startsWith("{STATE}-") && !anyRow(rp, id)) {
      out.push(`${owner}: rule-pack row ${id} not found in rulepacks/`);
    }
  };
  for (const f of c.findings.findings) {
    for (const ref of f.rulepack_refs) {
      want(f.finding_id, ref.fallback_row);
      want(f.finding_id, ref.row_pattern);
    }
  }
  for (const m of c.modules) {
    for (const id of m.rulepack_rows) want(m.module_id, id);
    for (const k of m.key_facts) want(k.id, k.rulepack_row);
  }
  return out;
}

function rulepackFactIssues(c: Content, rp: RulepackLookup): string[] {
  const out: string[] = [];
  for (const k of allConcepts(c)) {
    for (const fact of k.rulepack_facts) {
      const row = rowsOf(rp, fact.file).find((r) => r.id === fact.id);
      if (!row) {
        out.push(`${k.concept_id}: ${fact.file} has no row ${fact.id}`);
        continue;
      }
      const v = getPath(row, fact.path);
      if (v !== fact.expected) {
        out.push(
          `${k.concept_id}: ${fact.file} ${fact.id}.${fact.path} is ${JSON.stringify(v)}, item text says ${JSON.stringify(fact.expected)}`,
        );
      }
      if (row["verified"] !== true) {
        out.push(`${k.concept_id}: quotes ${fact.id}, which is verified=false in rulepacks/`);
      }
    }
  }
  return out;
}

/** Rule-pack rows named by findings and modules exist; values quoted by LL items match. */
export function checkRulepackRefs(c: Content, rp: RulepackLookup): string[] {
  return [...rulepackRowIssues(c, rp), ...rulepackFactIssues(c, rp)];
}

// ---------------------------------------------------------------------------------------------
// templates (DEBRIEF_SPEC §6.3 text rules + placeholders ⊆ facts)
// ---------------------------------------------------------------------------------------------

export function templateTexts(f: Finding) {
  const out: { slot: "lacked" | "could" | "how"; text: LocalizedText; max: number }[] = [];
  if (f.templates.lacked) out.push({ slot: "lacked", text: f.templates.lacked, max: LIMITS.point });
  if (f.templates.could) out.push({ slot: "could", text: f.templates.could, max: LIMITS.point });
  if (f.templates.how) out.push({ slot: "how", text: f.templates.how, max: LIMITS.how });
  return out;
}

function localizedIssues(
  label: string,
  text: LocalizedText,
  maxLength: number,
  allowedKeys: readonly string[],
): string[] {
  const out: string[] = [];
  for (const locale of ["en", "hi"] as const) {
    for (const v of checkTemplateText(text[locale], { locale, maxLength, allowedKeys })) {
      out.push(`${label}.${locale}: ${v.rule} ${v.detail}`);
    }
  }
  return out;
}

export function checkTemplates(c: Content): string[] {
  const out: string[] = [];
  for (const f of c.findings.findings) {
    const keys = f.facts.map((x) => x.key);
    for (const t of templateTexts(f)) {
      out.push(...localizedIssues(`debrief.${f.finding_id}.${t.slot}`, t.text, t.max, keys));
    }
  }
  for (const g of c.games.games) {
    for (const band of ["strong", "medium", "weak"] as const) {
      out.push(
        ...localizedIssues(
          `debrief.${g.game_id}.how.${band}`,
          g.how_templates[band],
          LIMITS.how,
          [],
        ),
      );
    }
  }
  for (const d of c.drills.drills) {
    out.push(...localizedIssues(`drill.${d.drill_id}.why`, d.why, LIMITS.drill_why, []));
  }
  return out;
}

/** Every finding renders in both locales (DEBRIEF_SPEC §9: templates complete before a game ships). */
export function checkFindingLocales(c: Content): string[] {
  const out: string[] = [];
  for (const f of c.findings.findings) {
    const texts = templateTexts(f);
    if (texts.length === 0) out.push(`${f.finding_id}: no templates`);
    for (const t of texts) {
      if (!t.text.en.trim()) out.push(`${f.finding_id}.${t.slot}: empty en`);
      if (!DEVA.test(t.text.hi)) out.push(`${f.finding_id}.${t.slot}: hi is not Devanagari`);
    }
    if (f.hi_review_status !== "pending_native_review" && f.hi_review_status !== "approved") {
      out.push(`${f.finding_id}: bad hi_review_status`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// question bank
// ---------------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function itemTextIssues(it: Item): string[] {
  const out: string[] = [];
  for (const locale of ["en", "hi"] as const) {
    out.push(
      ...dupes(
        `${it.item_id} option text (${locale})`,
        it.options.map((o) => norm(o.text[locale])),
      ),
    );
  }
  if (!DEVA.test(it.stem.hi)) out.push(`${it.item_id}: hi stem is not Devanagari`);
  for (const o of it.options) {
    if (!DEVA.test(o.text.hi) && !/^[A-Z0-9 ]+$/.test(o.text.hi)) {
      out.push(`${it.item_id}.${o.option_id}: hi option is not Devanagari`);
    }
  }
  return out;
}

export function checkVariants(c: Content): string[] {
  const out: string[] = [];
  for (const k of allConcepts(c)) {
    if (k.items.length < 3 || k.items.length > 6) {
      out.push(`${k.concept_id}: ${k.items.length} variants (need 3–6)`);
    }
    for (const locale of ["en", "hi"] as const) {
      out.push(
        ...dupes(
          `${k.concept_id} stem (${locale})`,
          k.items.map((it) => norm(it.stem[locale])),
        ),
      );
    }
    for (const it of k.items) out.push(...itemTextIssues(it));
    if (!DEVA.test(k.explanation.text.hi)) {
      out.push(`${k.concept_id}: hi explanation is not Devanagari`);
    }
  }
  return out;
}

/** Correct-option position balance per option count (a, b, c, d used about equally). */
export function positionCounts(c: Content): Map<number, Map<string, number>> {
  const byCount = new Map<number, Map<string, number>>();
  for (const { item } of allItems(c)) {
    const n = item.options.length;
    const m = byCount.get(n) ?? new Map<string, number>();
    m.set(item.key.correct_option_id, (m.get(item.key.correct_option_id) ?? 0) + 1);
    byCount.set(n, m);
  }
  return byCount;
}

export function checkPositionBalance(c: Content): string[] {
  const out: string[] = [];
  for (const [n, counts] of positionCounts(c)) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const ideal = total / n;
    const tol = Math.max(2, Math.ceil(ideal * 0.1));
    for (const id of ["a", "b", "c", "d"].slice(0, n)) {
      const got = counts.get(id) ?? 0;
      if (Math.abs(got - ideal) > tol) {
        out.push(
          `${n}-option items: correct = ${id} in ${got} of ${total} (ideal ${ideal.toFixed(1)} ± ${tol})`,
        );
      }
    }
  }
  // no single concept always puts the answer in the same place
  for (const k of allConcepts(c)) {
    const pos = new Set(k.items.map((it) => it.key.correct_option_id));
    if (k.items.length >= 3 && pos.size === 1)
      out.push(`${k.concept_id}: every variant has the answer at ${[...pos][0]}`);
  }
  return out;
}

/** Similarity of one distractor sign to the correct sign (GAME_DESIGN §11.8 L1–L5). */
export function signSimilarity(d: Sign, correct: Sign): 1 | 3 | 4 | 5 {
  if (d.family !== correct.family) return 1;
  if (d.shape !== correct.shape || d.colour_scheme !== correct.colour_scheme) return 3;
  if (d.symbol_class !== correct.symbol_class) return 4;
  return 5;
}

/**
 * Item level from its distractors: L1 all from other families · L2 mixed · L3 all same family,
 * some differ in shape/colour · L4 all same family and shape, different symbols · L5 as L4 with
 * at least one near-identical (mirror or same symbol class) distractor.
 */
export function levelFromSimilarities(sims: readonly number[]): 1 | 2 | 3 | 4 | 5 {
  const min = Math.min(...sims);
  const max = Math.max(...sims);
  if (max === 1) return 1;
  if (min === 1) return 2;
  if (min === 3) return 3;
  return max === 5 ? 5 : 4;
}

/** Sign per option for items whose options are signs (by asset or by key ref). */
function optionSigns(it: Item, signs: Map<string, Sign>): Map<string, Sign> | undefined {
  const m = new Map<string, Sign>();
  for (const o of it.options) {
    const id = it.form === "meaning_to_sign" ? o.asset_id : it.key.option_refs?.[o.option_id];
    const s = id ? signs.get(id) : undefined;
    if (!s) return undefined;
    m.set(o.option_id, s);
  }
  return m;
}

export function computedLevel(it: Item, signs: Map<string, Sign>): number | undefined {
  const bySign = optionSigns(it, signs);
  if (!bySign) return undefined;
  const correct = bySign.get(it.key.correct_option_id);
  if (!correct) return undefined;
  const sims = [...bySign.entries()]
    .filter(([id]) => id !== it.key.correct_option_id)
    .map(([, s]) => signSimilarity(s, correct));
  return levelFromSimilarities(sims);
}

export function checkSimilarity(c: Content): string[] {
  const out: string[] = [];
  const signs = index(c.signs.signs, (s) => s.sign_id);
  for (const { item } of allItems(c)) {
    const lvl = computedLevel(item, signs);
    if (item.similarity.basis === "computed") {
      if (lvl === undefined)
        out.push(`${item.item_id}: basis computed but options are not all signs`);
      else if (lvl !== item.similarity.level)
        out.push(`${item.item_id}: level ${item.similarity.level} but sign data gives ${lvl}`);
    } else if (lvl !== undefined) {
      out.push(`${item.item_id}: options are signs, so similarity basis must be computed`);
    }
  }
  return out;
}

type ConceptT = ReturnType<typeof allConcepts>[number];

function signToMeaningIssues(concept: ConceptT, item: Item, signs: Map<string, Sign>): string[] {
  const out: string[] = [];
  const refs = item.key.option_refs ?? {};
  for (const o of item.options) {
    const ref = refs[o.option_id];
    const s = ref ? signs.get(ref) : undefined;
    if (!s) out.push(`${item.item_id}.${o.option_id}: sign_to_meaning option needs a sign ref`);
    else if (o.text.en !== s.name.en || o.text.hi !== s.name.hi) {
      out.push(`${item.item_id}.${o.option_id}: text differs from ${s.sign_id} name`);
    }
  }
  if (refs[item.key.correct_option_id] !== concept.sign_id) {
    out.push(`${item.item_id}: correct option is not the concept's sign ${concept.sign_id}`);
  }
  if (item.stem_assets[0] !== concept.sign_id) {
    out.push(`${item.item_id}: stem must show ${concept.sign_id}`);
  }
  return out;
}

function meaningToSignIssues(concept: ConceptT, item: Item, signs: Map<string, Sign>): string[] {
  const out: string[] = [];
  for (const o of item.options) {
    const s = o.asset_id ? signs.get(o.asset_id) : undefined;
    if (s && (o.text.en !== s.alt.en || o.text.hi !== s.alt.hi)) {
      out.push(`${item.item_id}.${o.option_id}: option text must be the alt text of ${s.sign_id}`);
    }
  }
  const correct = item.options.find((o) => o.option_id === item.key.correct_option_id);
  if (correct?.asset_id !== concept.sign_id) {
    out.push(`${item.item_id}: correct option is not ${concept.sign_id}`);
  }
  if (concept.sign_id && item.stem_assets.includes(concept.sign_id)) {
    out.push(`${item.item_id}: stem shows the answer`);
  }
  return out;
}

/** Option texts agree with the sign catalogue; the answer is the concept's own sign. */
export function checkOptionConsistency(c: Content): string[] {
  const out: string[] = [];
  const signs = index(c.signs.signs, (s) => s.sign_id);
  for (const { concept, item } of allItems(c)) {
    if (item.form === "sign_to_meaning") out.push(...signToMeaningIssues(concept, item, signs));
    else if (item.form === "meaning_to_sign")
      out.push(...meaningToSignIssues(concept, item, signs));
    else if (item.key.option_refs)
      out.push(`${item.item_id}: option_refs only for sign_to_meaning`);
  }
  return out;
}

/** Topic balance so mocks (J&K 10 / 6, default 15 / 60%) can mix unseen variants per topic. */
export function checkBankSize(
  c: Content,
  min = { concepts: 60, items: 200, perTopicConcepts: 10, perTopicItems: 30 },
): string[] {
  const out: string[] = [];
  const concepts = allConcepts(c);
  const items = allItems(c);
  if (concepts.length < min.concepts) out.push(`${concepts.length} concepts (< ${min.concepts})`);
  if (items.length < min.items) out.push(`${items.length} items (< ${min.items})`);
  for (const b of c.questionBanks) {
    const n = b.concepts.length;
    const m = b.concepts.reduce((a, k) => a + k.items.length, 0);
    const mock = b.concepts.reduce(
      (a, k) => a + k.items.filter((it) => it.pool === "mock").length,
      0,
    );
    if (n < min.perTopicConcepts) out.push(`${b.topic}: ${n} concepts (< ${min.perTopicConcepts})`);
    if (m < min.perTopicItems) out.push(`${b.topic}: ${m} items (< ${min.perTopicItems})`);
    if (mock < min.perTopicConcepts)
      out.push(`${b.topic}: ${mock} mock items (< ${min.perTopicConcepts})`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// wording, fees, ai_citable, hazards, allowlists
// ---------------------------------------------------------------------------------------------

export type TextUnit = { path: string; text: string; userFacing: boolean };

/** Every string in the pack; `userFacing` = a localized value (…en / …hi / text_en / text_hi). */
export function collectStrings(value: unknown, path = "", out: TextUnit[] = []): TextUnit[] {
  if (typeof value === "string") {
    const last = path.split(".").pop() ?? "";
    out.push({
      path,
      text: value,
      userFacing: last === "en" || last === "hi" || last === "text_en" || last === "text_hi",
    });
  } else if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) collectStrings(v, `${path}[${i}]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectStrings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

export type WordingTerm = { id: string; pattern: string; lang: string };

const FEE_NUMBER_RULES: { id: string; re: RegExp }[] = [
  { id: "rupee-sign", re: /₹/ },
  { id: "rs-prefix", re: /\bRs\.?\s?[0-9०-९]/i },
  { id: "inr-prefix", re: /\bINR\b/ },
  { id: "rupees-word", re: /\brupees?\b|रुपये|रुपए|रुपया/i },
  {
    id: "fee-number",
    re: /\bfees?\b[^.]{0,30}[0-9०-९]|[0-9०-९][^.]{0,15}\bfees?\b|(फ़ीस|फीस|शुल्क)[^।.]{0,30}[0-9०-९]/i,
  },
];

/** D-19 wording bans (scripts/lint_wording.terms.json) and D-06 fee literals over the pack. */
export function checkWording(c: Content, terms: readonly WordingTerm[]): string[] {
  const out: string[] = [];
  const rules = terms.map((t) => ({
    id: t.id,
    re: new RegExp(t.pattern, t.lang === "en" ? "i" : ""),
  }));
  const units = collectStrings(c);
  for (const u of units) {
    for (const r of rules) {
      const m = r.re.exec(u.text);
      if (m) out.push(`${u.path}: [${r.id}] "${m[0]}"`);
    }
    for (const r of FEE_NUMBER_RULES) {
      if (r.id !== "rupee-sign" && !u.userFacing) continue;
      const m = r.re.exec(u.text);
      if (m) out.push(`${u.path}: [${r.id}] "${m[0]}"`);
    }
  }
  return out;
}

export function checkAiCitable(c: Content): string[] {
  return c.rules.rules
    .filter((r) => r.ai_citable !== (r.verified && r.kind !== "medical"))
    .map(
      (r) => `${r.rule_id}: ai_citable=${r.ai_citable} but verified=${r.verified}, kind=${r.kind}`,
    );
}

export function checkHazardDrills(c: Content): string[] {
  const out: string[] = [];
  const drills = index(c.drills.drills, (d) => d.drill_id);
  const typed = new Set(c.hazardTypes.hazard_types.map((h) => h.hazard_type));
  for (const t of HAZARD_TYPES) {
    if (!typed.has(t)) out.push(`hazard_types.json lacks ${t}`);
    const id = `DR-NAZ-OCCL-${t.toUpperCase()}`;
    const d = drills.get(id);
    if (!d) out.push(`missing occlusion drill ${id}`);
    else if (d.game_id !== "nazar" || d.hazard_type !== t)
      out.push(`${id}: must be a nazar drill for ${t}`);
  }
  return out;
}

export function checkAllowlists(c: Content, a: AllowlistsFile): string[] {
  const out: string[] = [];
  const findings = index(c.findings.findings, (f) => f.finding_id);
  const drills = index(c.drills.drills, (d) => d.drill_id);
  const rules = new Set(c.rules.rules.map((r) => r.rule_id));
  const citable = citableRuleIds(c);
  const signs = index(c.signs.signs, (s) => s.sign_id);
  const explanations = new Map(
    allConcepts(c).map((k) => [k.explanation.explanation_id, k.explanation]),
  );
  const sub = (label: string, ids: readonly string[], ok: (id: string) => boolean) => {
    for (const id of ids) if (!ok(id)) out.push(`${label}: ${id} not allowed`);
  };
  sub("debrief_agent.finding_ids", a.debrief_agent.finding_ids, (id) => {
    const f = findings.get(id);
    return !!f && !f.template_only;
  });
  sub("debrief_agent.rule_ids", a.debrief_agent.rule_ids, (id) => rules.has(id) && citable.has(id));
  sub(
    "debrief_agent.drill_ids",
    a.debrief_agent.drill_ids,
    (id) => !!drills.get(id) && !drills.get(id)?.template_only,
  );
  for (const [fid, keys] of Object.entries(a.debrief_agent.fact_keys)) {
    const f = findings.get(fid);
    sub(`debrief_agent.fact_keys.${fid}`, keys, (k) => !!f && f.facts.some((x) => x.key === k));
  }
  sub("tutor_agent.explanation_ids", a.tutor_agent.explanation_ids, (id) => {
    const e = explanations.get(id);
    return !!e && e.review_status === "approved" && e.hi_review_status === "approved";
  });
  sub("tutor_agent.rule_ids", a.tutor_agent.rule_ids, (id) => citable.has(id));
  sub("voice_guide_agent.get_rule_ids", a.voice_guide_agent.get_rule_ids, (id) => citable.has(id));
  sub("voice_guide_agent.open_drill_ids", a.voice_guide_agent.open_drill_ids, (id) =>
    drills.has(id),
  );
  sub("coach_agent.drill_ids", a.coach_agent.drill_ids, (id) => drills.has(id));
  sub("sign_snap.sign_ids", a.sign_snap.sign_ids, (id) => signs.has(id));
  return out;
}

/** All checks that need only the content pack. */
export function runContentChecks(c: Content): { [check: string]: string[] } {
  return {
    duplicateIds: checkDuplicateIds(c),
    references: checkReferences(c),
    templates: checkTemplates(c),
    findingLocales: checkFindingLocales(c),
    variants: checkVariants(c),
    positionBalance: checkPositionBalance(c),
    similarity: checkSimilarity(c),
    optionConsistency: checkOptionConsistency(c),
    bankSize: checkBankSize(c),
    aiCitable: checkAiCitable(c),
    hazardDrills: checkHazardDrills(c),
  };
}

// Per-agent ID allowlists generated from the catalogues (D-09, PROMPTS §2, AGENTS §1 rule 3).
// Deterministic: every list is sorted and de-duplicated, there are no timestamps, and the input
// hashes are over canonical JSON. The Go API reads the generated file; per-request enums handed
// to a model are always subsets of these lists.
import type { Content } from "./model.ts";
import type { AllowlistsFile } from "./schema/allowlists.ts";

/** JSON with object keys sorted recursively (stable across runs and platforms). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sortUnique = (xs: Iterable<string>): string[] =>
  [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** `ai_citable = verified && kind != "medical"` (DEBRIEF_SPEC §3), recomputed, not trusted. */
export function citableRuleIds(content: Content): Set<string> {
  return new Set(
    content.rules.rules.filter((r) => r.verified && r.kind !== "medical").map((r) => r.rule_id),
  );
}

/** Rule IDs linked to the LL syllabus (LL modules + LL concepts). */
function llRuleIds(content: Content): Set<string> {
  const ids = new Set<string>();
  for (const m of content.modules) {
    if (m.track !== "A_ll_syllabus") continue;
    for (const r of m.rule_ids) ids.add(r);
  }
  for (const b of content.questionBanks) {
    for (const c of b.concepts) {
      for (const r of c.rule_ids) ids.add(r);
    }
  }
  return ids;
}

/**
 * Builds the allowlists. `inputs` maps a catalogue name to the sha256 of its canonical JSON
 * (computed by the caller so this module stays free of node:crypto).
 */
export function buildAllowlists(content: Content, inputs: Record<string, string>): AllowlistsFile {
  const templateOnly = content.games.games
    .filter((g) => g.debrief_mode === "template_only")
    .map((g) => g.game_id);
  const aiGame = (gameId: string) => !templateOnly.includes(gameId as never);
  const citable = citableRuleIds(content);

  const aiFindings = content.findings.findings.filter((f) => aiGame(f.game_id) && !f.template_only);
  const factKeys: Record<string, string[]> = {};
  for (const f of [...aiFindings].sort((a, b) => (a.finding_id < b.finding_id ? -1 : 1))) {
    factKeys[f.finding_id] = sortUnique(f.facts.map((x) => x.key));
  }

  const available = content.drills.drills.filter((d) => d.availability === "phase_1_2");
  const approvedExplanations = content.questionBanks.flatMap((b) =>
    b.concepts
      .filter(
        (c) =>
          c.explanation.review_status === "approved" &&
          c.explanation.hi_review_status === "approved",
      )
      .map((c) => c.explanation.explanation_id),
  );
  const ll = llRuleIds(content);
  const sortedInputs: Record<string, string> = {};
  for (const k of Object.keys(inputs).sort()) sortedInputs[k] = inputs[k] as string;

  return {
    $schema: "../schema/allowlists.schema.json",
    file_kind: "allowlists",
    generator: "@margdarshak/content allowlists v1",
    licence: "CC-BY-4.0",
    inputs: sortedInputs,
    policy: {
      citable_rule: "verified && kind != 'medical'",
      explanations: "review_status == 'approved' && hi_review_status == 'approved'",
      drills_for_coach_and_voice: "availability == 'phase_1_2'",
      template_only_games_excluded_from_ai: sortUnique(
        templateOnly,
      ) as AllowlistsFile["policy"]["template_only_games_excluded_from_ai"],
    },
    debrief_agent: {
      finding_ids: sortUnique(aiFindings.map((f) => f.finding_id)),
      rule_ids: sortUnique(aiFindings.flatMap((f) => f.rule_ids).filter((r) => citable.has(r))),
      drill_ids: sortUnique(
        content.drills.drills
          .filter((d) => aiGame(d.game_id) && !d.template_only)
          .map((d) => d.drill_id),
      ),
      fact_keys: factKeys,
    },
    tutor_agent: {
      explanation_ids: sortUnique(approvedExplanations),
      rule_ids: sortUnique([...ll].filter((r) => citable.has(r))),
    },
    voice_guide_agent: {
      get_rule_ids: sortUnique([...citable]),
      open_drill_ids: sortUnique(available.map((d) => d.drill_id)),
    },
    coach_agent: {
      drill_ids: sortUnique(available.map((d) => d.drill_id)),
    },
    sign_snap: {
      sign_ids: sortUnique(
        content.signs.signs
          .filter(
            (s) =>
              s.family === "MANDATORY" || s.family === "CAUTIONARY" || s.family === "INFORMATORY",
          )
          .map((s) => s.sign_id),
      ),
    },
  };
}

/** Catalogue inputs hashed into `allowlists.inputs`. */
export function allowlistInputs(content: Content): Record<string, unknown> {
  return {
    "catalogue/drills.json": content.drills,
    "catalogue/findings.json": content.findings,
    "catalogue/games.json": content.games,
    "catalogue/rules.json": content.rules,
    "catalogue/signs.json": content.signs,
    curriculum: content.modules,
    questions: content.questionBanks,
  };
}

// The catalogue the debrief reads (DEBRIEF_SPEC §2–§4, §9), as structural types. game-core never
// imports @margdarshak/content: callers pass the catalogue in. The content JSON files satisfy these
// shapes field for field (extra fields are ignored); `debriefCatalogue()` is the thin adapter from
// the content package's file model (`{ findings: { findings }, rules: { rules }, … }`).
import type { FactKind, TemplateLocale } from "./schema.ts";

export interface LocalizedText {
  readonly en: string;
  readonly hi: string;
}

export interface CatalogueFact {
  readonly key: string;
  readonly kind: FactKind;
}

/** findings.json entry (content `Finding`). */
export interface CatalogueFinding {
  readonly finding_id: string;
  readonly game_id: string;
  readonly polarity: "negative" | "positive";
  readonly critical: boolean;
  readonly facts: readonly CatalogueFact[];
  readonly skill: { readonly id: string | null };
  readonly rule_ids: readonly string[];
  readonly drill_ids: readonly string[];
  readonly template_only: boolean;
  readonly templates: {
    readonly lacked?: LocalizedText | undefined;
    readonly could?: LocalizedText | undefined;
    readonly how?: LocalizedText | undefined;
  };
  readonly medical_review_required?: boolean | undefined;
}

/** rules.json entry (content `RuleEntry`, the spec's §3 entry shape). */
export interface CatalogueRule {
  readonly rule_id: string;
  readonly kind: string;
  readonly text_en: string;
  readonly text_hi: string;
  readonly source_title: string;
  readonly source_url: string | null;
  readonly verified_on: string | null;
  readonly verified: boolean;
  /** `verified && kind != "medical"`: the only rules the AI may cite. */
  readonly ai_citable: boolean;
}

export type CatalogueDrillLevels =
  | { readonly kind: "range"; readonly min: number; readonly max: number }
  | { readonly kind: "mock" }
  | { readonly kind: "none" };

/** drills.json entry (content `Drill`). */
export interface CatalogueDrill {
  readonly drill_id: string;
  readonly game_id: string;
  readonly levels: CatalogueDrillLevels;
  /** `margdarshak://play/<gameId>?drill=<id>` plus `&level={level}` for range drills. */
  readonly deeplink: string;
  readonly skill_ids: readonly string[];
  /** drill.<drillId>.why (≤ 120 chars, no digits). */
  readonly why: LocalizedText;
}

/** games.json entry (content `Game`). */
export interface CatalogueGame {
  readonly game_id: string;
  readonly debrief_mode: "ai_or_template" | "template_only";
  readonly default_drill_id: string;
  /** debrief.<gameId>.how.<band> (no placeholders). */
  readonly how_templates: {
    readonly strong: LocalizedText;
    readonly medium: LocalizedText;
    readonly weak: LocalizedText;
  };
}

/** enums.json entry: labels for one enum-valued fact key. */
export interface CatalogueEnum {
  readonly fact_key: string;
  readonly values: readonly { readonly value: string; readonly label: LocalizedText }[];
}

/** hazard_types.json entry: the label of a `hazard_type` value. */
export interface CatalogueHazardType {
  readonly hazard_type: string;
  readonly label: LocalizedText;
}

export interface DebriefCatalogue {
  readonly findings: readonly CatalogueFinding[];
  readonly rules: readonly CatalogueRule[];
  readonly drills: readonly CatalogueDrill[];
  readonly games: readonly CatalogueGame[];
  readonly enums: readonly CatalogueEnum[];
  readonly hazardTypes: readonly CatalogueHazardType[];
}

/** The content package's file model (`Content` in packages/content/src/model.ts), structurally. */
export interface ContentFiles {
  readonly findings: { readonly findings: readonly CatalogueFinding[] };
  readonly rules: { readonly rules: readonly CatalogueRule[] };
  readonly drills: { readonly drills: readonly CatalogueDrill[] };
  readonly games: { readonly games: readonly CatalogueGame[] };
  readonly enums: { readonly enums: readonly CatalogueEnum[] };
  readonly hazardTypes: { readonly hazard_types: readonly CatalogueHazardType[] };
}

/** Adapter: content file model (or the parsed catalogue JSON files) → DebriefCatalogue. */
export function debriefCatalogue(files: ContentFiles): DebriefCatalogue {
  return {
    findings: files.findings.findings,
    rules: files.rules.rules,
    drills: files.drills.drills,
    games: files.games.games,
    enums: files.enums.enums,
    hazardTypes: files.hazardTypes.hazard_types,
  };
}

/** labels[factKey][value] → localized label. `hazard_type` labels come from hazard_types.json. */
export type FactLabels = ReadonlyMap<string, ReadonlyMap<string, LocalizedText>>;

export function buildLabels(catalogue: DebriefCatalogue): FactLabels {
  const out = new Map<string, Map<string, LocalizedText>>();
  for (const e of catalogue.enums) {
    out.set(e.fact_key, new Map(e.values.map((v) => [v.value, v.label])));
  }
  out.set("hazard_type", new Map(catalogue.hazardTypes.map((h) => [h.hazard_type, h.label])));
  return out;
}

/** Lookup tables over one catalogue (built once per catalogue object). */
export interface CatalogueIndex {
  readonly findings: ReadonlyMap<string, CatalogueFinding>;
  readonly rules: ReadonlyMap<string, CatalogueRule>;
  readonly drills: ReadonlyMap<string, CatalogueDrill>;
  readonly games: ReadonlyMap<string, CatalogueGame>;
  /** factKinds[findingId][factKey] */
  readonly factKinds: ReadonlyMap<string, ReadonlyMap<string, FactKind>>;
  readonly labels: FactLabels;
}

const cache = new WeakMap<DebriefCatalogue, CatalogueIndex>();

export function indexCatalogue(catalogue: DebriefCatalogue): CatalogueIndex {
  const hit = cache.get(catalogue);
  if (hit !== undefined) return hit;
  const ix: CatalogueIndex = {
    findings: new Map(catalogue.findings.map((f) => [f.finding_id, f])),
    rules: new Map(catalogue.rules.map((r) => [r.rule_id, r])),
    drills: new Map(catalogue.drills.map((d) => [d.drill_id, d])),
    games: new Map(catalogue.games.map((g) => [g.game_id, g])),
    factKinds: new Map(
      catalogue.findings.map((f) => [f.finding_id, new Map(f.facts.map((x) => [x.key, x.kind]))]),
    ),
    labels: buildLabels(catalogue),
  };
  cache.set(catalogue, ix);
  return ix;
}

/** Rule text in a template locale. */
export const ruleText = (r: CatalogueRule, locale: TemplateLocale): string =>
  locale === "hi" ? r.text_hi : r.text_en;

export type DebriefErrorCode =
  | "UNKNOWN_GAME"
  | "UNKNOWN_DRILL"
  | "MISSING_LABEL"
  | "BAD_FACT"
  | "TEMPLATE_INVALID"
  | "INVALID_DRAFT";

/** A debrief that cannot be built: a catalogue gap, or (strict mode) a label or template problem. */
export class DebriefError extends Error {
  readonly code: DebriefErrorCode;
  constructor(code: DebriefErrorCode, message: string) {
    super(message);
    this.name = "DebriefError";
    this.code = code;
  }
}

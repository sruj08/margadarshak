// biome-ignore-all lint/performance/noBarrelFile: this file is the `./debrief` subpath entry point.
// Deterministic debrief layer (DEBRIEF_SPEC §5–§9): findings → facts pack, facts formatting, the
// shared DebriefDraft validator (validator-spec.json), the template card ("Auto notes") and the
// AI-draft card ("Coach notes"). Pure TS: runs on the device (instant offline card) and in Node.
export type {
  CatalogueDrill,
  CatalogueDrillLevels,
  CatalogueEnum,
  CatalogueFact,
  CatalogueFinding,
  CatalogueGame,
  CatalogueHazardType,
  CatalogueIndex,
  CatalogueRule,
  ContentFiles,
  DebriefCatalogue,
  DebriefErrorCode,
  FactLabels,
  LocalizedText,
} from "./catalogue.ts";
export {
  buildLabels,
  DebriefError,
  debriefCatalogue,
  indexCatalogue,
} from "./catalogue.ts";
export type { FactSource, FormatOptions } from "./format.ts";
export {
  dropMissingClauses,
  factLocale,
  fillPlaceholders,
  formatFact,
  MISSING_VALUE,
  placeholderKeys,
} from "./format.ts";
export type { DebriefHistory, GenerateOptions } from "./generate.ts";
export { generateFindings, POSITIVE_RULES, scoreBand, typedFacts } from "./generate.ts";
export type { DraftCardOptions, TemplateCardOptions } from "./render.ts";
export {
  auditCatalogue,
  CARD_LABELS,
  FALLBACK_TEXT,
  renderDraft,
  renderTemplateCard,
  templateDraft,
  templateLocale,
} from "./render.ts";
export type { ValidationResult } from "./schema.ts";
export {
  CardDrill,
  CardPoint,
  CardValidator,
  DebriefCard,
  DebriefDraft,
  DebriefLocale,
  DebriefMode,
  DraftDrill,
  DraftPoint,
  DrillCandidate,
  FactKind,
  FactsPack,
  PositiveFinding,
  RuleChip,
  ScoreBand,
  TemplateLocale,
  ValidatorRuleId,
  Violation,
} from "./schema.ts";
export {
  escapeHtml,
  PLACEHOLDER_RE,
  scriptShare,
  stripPlaceholders,
  unescapeHtml,
  VALIDATOR_SPEC,
  ValidatorSpecFile,
} from "./spec.ts";
export type { TextCheck, TextField } from "./validator.ts";
export {
  checkText,
  retryHint,
  UNKNOWN_RULE_ID,
  validateDraft,
  violatedRules,
} from "./validator.ts";

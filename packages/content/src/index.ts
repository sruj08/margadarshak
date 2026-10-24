// @margdarshak/content: schemas, typed parsing, validators, the LL bank split and the AI
// allowlist generator for content/ (CC-BY-4.0 data). Environment-free; disk loaders are in
// "@margdarshak/content/node".
// biome-ignore-all lint/performance/noBarrelFile: this is the package entry point.

export { allowlistInputs, buildAllowlists, canonicalJson, citableRuleIds } from "./allowlists.ts";
export { type LlAnswerKeyDoc, toLlAnswerKeys } from "./answer-keys.ts";
export {
  allConcepts,
  allItems,
  checkAiCitable,
  checkAllowlists,
  checkBankSize,
  checkDuplicateIds,
  checkFindingLocales,
  checkHazardDrills,
  checkOptionConsistency,
  checkPositionBalance,
  checkReferences,
  checkRulepackRefs,
  checkSimilarity,
  checkTemplates,
  checkVariants,
  checkWording,
  collectStrings,
  computedLevel,
  expandDrillPattern,
  factEnumValues,
  levelFromSimilarities,
  positionCounts,
  type RulepackLookup,
  runContentChecks,
  signSimilarity,
  type TextUnit,
  templateTexts,
  type WordingTerm,
} from "./checks.ts";
export {
  type Content,
  ContentError,
  MODULE_ORDER,
  parseContent,
  type RawContent,
} from "./model.ts";
export {
  checkSceneCoverage,
  checkSceneIds,
  checkScenePromptVersion,
  checkSceneText,
  nazarScenesJsonSchema,
  runNazarSceneChecks,
  SCENE_COVERAGE,
  SCENE_TEXT_BANS,
} from "./nazar.ts";
export { AllowlistsFile } from "./schema/allowlists.ts";
export {
  AssetId,
  ATTRIBUTION,
  CONCEPT_ID_RE,
  ConceptId,
  Confidence,
  DRILL_ID_RE,
  DrillId,
  FACT_KEY_RE,
  FactKey,
  FINDING_ID_RE,
  FindingId,
  GAME_IDS,
  GameId,
  Grade,
  HAZARD_TYPES,
  HazardType,
  HiReviewStatus,
  ITEM_ID_RE,
  ItemId,
  LICENCE,
  LL_TOPICS,
  LlTopic,
  LocalizedText,
  MODULE_ID_RE,
  ModuleId,
  PLACEHOLDER_RE,
  ReviewStatus,
  RULE_ID_RE,
  RuleId,
  RuleKind,
  SIGN_FAMILIES,
  SIGN_ID_RE,
  SignFamily,
  SignId,
  SKILL_ID_RE,
  SkillId,
  Source,
  VehicleScope,
} from "./schema/common.ts";
export { KeyFact, Module } from "./schema/curriculum.ts";
export { Drill, DrillsFile } from "./schema/drills.ts";
export { EnumsFile, FactEnum } from "./schema/enums.ts";
export { FactKind, Finding, FindingsFile } from "./schema/findings.ts";
export { Game, GamesFile } from "./schema/games.ts";
export { HazardTypeEntry, HazardTypesFile } from "./schema/hazards.ts";
export {
  NazarScene,
  NazarScenesFile,
  SCENE_HAZARDS,
  SCENE_ID_RE,
  SCENE_LIMITS,
  SCENE_SETTINGS,
  SceneSetting,
  SceneShot,
  SETTING_MAX_KMH,
  sceneNominalOnsetS,
} from "./schema/nazar-scenes.ts";
export { Concept, Item, ItemForm, OptionId, QuestionBankFile } from "./schema/questions.ts";
export { SCHEMAS, type SchemaEntry, toJsonSchema } from "./schema/registry.ts";
export { RuleEntry, RulesFile } from "./schema/rules.ts";
export { Illustration, IllustrationsFile, Sign, SignsFile } from "./schema/signs.ts";
export { Skill, SkillsFile } from "./schema/skills.ts";
export {
  type ClientBank,
  type ClientItem,
  type KeyEntry,
  type PracticeKey,
  type ServerKey,
  type SplitBank,
  splitQuestionBank,
} from "./split.ts";
export {
  checkTemplateText,
  LIMITS,
  type Locale,
  placeholders,
  scriptShare,
  type TextViolation,
} from "./text.ts";

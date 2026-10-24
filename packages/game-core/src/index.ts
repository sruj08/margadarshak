// biome-ignore-all lint/performance/noBarrelFile: the package root re-exports the most used names.
// Prefer the subpaths (`@margdarshak/game-core/scoring` …) so bundlers tree-shake per game.

export {
  DebriefCard,
  DebriefDraft,
  FactsPack,
  generateFindings,
  renderDraft,
  renderTemplateCard,
  validateDraft,
} from "./debrief/index.ts";
export type { ReplayErrorCode } from "./errors.ts";
export { ReplayError } from "./errors.ts";
export { compareResults, computeTrust, eligibility } from "./integrity/index.ts";
export { ratingFromEvidence } from "./learning/index.ts";
export {
  GameContent,
  GameEvent,
  GameId,
  GameManifest,
  ReplayPackage,
  SessionContext,
  SessionResult,
  toJsonSchemas,
} from "./schema/index.ts";
export { replay, replayAsync, SCORING_VERSIONS } from "./scoring/index.ts";
export { decodeReplay, encodeReplay, eventsDigest } from "./sdk/index.ts";

/** Package version (kept in step with package.json by a test). */
export const GAME_CORE_VERSION = "0.1.0";

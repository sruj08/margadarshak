// biome-ignore-all lint/performance/noBarrelFile: this file is the `./integrity` subpath entry point.
export type { IntegrityAnalysis, IntegrityHints, IntegrityOptions, VoidReason } from "./checks.ts";
export { INTEGRITY_CONFIG, itemSpans, rateImpossible, runIntegrityChecks } from "./checks.ts";
export type {
  ComparisonResult,
  EligibilityContext,
  EligibilityPurpose,
  EligibilityResult,
} from "./compare.ts";
export {
  compareResults,
  eligibility,
  PERCENTILE_BASELINE_MIN,
  REPLAY_TOLERANCE_PCT,
  withIntegrityFlags,
} from "./compare.ts";
export {
  computeTrust,
  FLAG_ORDER,
  mergeFlags,
  sortFlags,
  TRUST_FACTORS,
  TRUST_PRACTICE_ONLY_BELOW,
} from "./trust.ts";

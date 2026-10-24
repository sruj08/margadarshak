// Types of the rule-pack files (rulepacks/schema/rulepack.schema.json) and of
// the plan output. Mirrors services/api/internal/rules (Go, authoritative).

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface Source {
  title: string;
  url: string;
}

export interface Provenance {
  source: Source;
  grade: "OBS" | "P" | "P-state" | "S" | "MK" | "unknown";
  checkedOn: string;
  confidence: "high" | "medium" | "low";
  verified: boolean;
  approvers: string[];
  effectiveFrom?: string;
  effectiveTo?: string;
}

export type RuleKind =
  | "eligibility"
  | "blocker"
  | "warning"
  | "notice"
  | "route"
  | "document"
  | "param"
  | "planner"
  | "office";

export interface RuleRow extends Provenance {
  id: string;
  kind: RuleKind;
  overrides?: string;
  disabled?: boolean;
  appliesTo?: string[];
  condition: Json;
  output: { [k: string]: Json };
  textKey: string;
  fixKey?: string;
  text?: { en: string; hi?: string };
  refs?: string[];
}

export interface PackFile {
  $schema?: string;
  fileKind: "rulepack";
  packId: string;
  name?: string;
  version: string;
  extends?: string;
  effectiveFrom: string;
  status: string;
  partial: boolean;
  maker: string;
  checker?: string | null;
  approvedAt?: string | null;
  notes?: string;
  rules: RuleRow[];
}

export interface FeeItem extends Provenance {
  id: string;
  labelKey: string;
  noteKey?: string;
  amount: number;
  per: "class" | "application" | "attempt" | "class_attempt";
  stage: "LL" | "DL" | "RETEST";
  smartCard?: boolean;
  state?: string;
  overrides?: string;
  includedInTotal?: boolean;
}

export interface FeesFile {
  $schema?: string;
  fileKind: "fees";
  version: string;
  currency: "INR";
  unit: "paise";
  notes?: string;
  excludes?: string[];
  items: FeeItem[];
  retest: FeeItem[];
  stateItems: FeeItem[];
}

export interface Prerequisite {
  id: string;
  textKey: string;
  verified: boolean;
}

export interface ClassRow extends Provenance {
  id: string;
  code: string;
  sarathiCode: string;
  nameKey: string;
  name: { en: string; hi?: string };
  pictures: string[];
  minAge: number;
  maxCc?: number | null;
  guardianConsentUnder18: boolean;
  transport: boolean;
  form1a: "always" | "age40";
  contentDepth: "deep" | "thin" | "coming";
  prerequisites: Prerequisite[];
}

export interface ClassesFile {
  $schema?: string;
  fileKind: "classes";
  version: string;
  notes?: string;
  classes: ClassRow[];
}

/** The four source documents, as parsed JSON (e.g. imported JSON modules). */
export interface PackSources {
  base: PackFile;
  states: { [state: string]: PackFile };
  fees: FeesFile;
  classes: ClassesFile;
}

// ---------- plan input ----------

export interface PlanInput {
  as_of: string;
  state: string;
  dob: string;
  dob_precision?: "day" | "year" | null;
  vehicles?: string[] | null;
  classes?: string[] | null;
  aadhaar_address_matches_residence?: boolean | null;
  aadhaar_has_relation_line?: boolean | null;
  aadhaar_mobile_linked?: boolean | null;
  home_test_device?: boolean | null;
  disability?: string[] | null;
  foreign_licence?: boolean | null;
  nri?: boolean | null;
  moving_state?: boolean | null;
  holds_dl?: boolean | null;
  lmv_dl_held_since?: string | null;
  wants_idp?: boolean | null;
  has_test_vehicle?: boolean | null;
  ll_issued_on?: string | null;
}

// ---------- plan output (snake_case on the wire) ----------

export interface ProvOut {
  source_title: string;
  source_url: string;
  grade: string;
  checked_on: string;
  confidence: string;
  verified: boolean;
}

export interface PackRef {
  pack_id: string;
  version: string;
  base_version: string;
  fees_version: string;
  classes_version: string;
  partial: boolean;
  hash: string;
}

export interface AgeInfo {
  years_min: number;
  years_max: number;
  band: string;
  dob_precision: string;
}

export interface PrereqOut {
  id: string;
  text_key: string;
  verified: boolean;
}

export interface ClassResult {
  class_code: string;
  name_key: string;
  eligible: boolean;
  eligible_from: string | null;
  reason_key: string | null;
  content_depth: string;
  transport: boolean;
  verify_at_rto: boolean;
  requires: string[];
  flags: string[];
  alternatives: string[];
  prerequisites: PrereqOut[];
  rule_ids: string[];
  provenance: ProvOut;
}

export interface FeeLine {
  fee_id: string;
  label_key: string;
  per: string;
  class_code: string | null;
  quantity: number;
  unit_paise: number;
  amount_paise: number;
  stage: string;
  rule_id: string;
}

export interface StateFee {
  fee_id: string;
  label_key: string;
  amount_paise: number;
  included_in_total: boolean;
  provenance: ProvOut;
}

export interface RetestFee {
  fee_id: string;
  label_key: string;
  per: string;
  amount_paise: number;
}

export interface FeeQuote {
  classes: string[];
  lines: FeeLine[];
  ll_stage_paise: number;
  subtotal_govt_fee_paise: number;
  smart_card_paise: number;
  total_paise: number;
  state_items: StateFee[];
  retest: RetestFee[];
  excludes: string[];
  provenance: ProvOut;
}

export interface Bundle {
  bundle_no: number;
  classes: string[];
  ll_from: string;
  dl_test_unlock: string;
  ll_expires_on: string;
  earliest_licence: string;
  fees: FeeQuote;
  rule_ids: string[];
}

export interface Saving {
  classes_on_one_ll: number;
  applications_saved: number;
  wait_days_saved: number;
  fee_saving_paise: number;
  note_key: string;
  verified: boolean;
  confidence: string;
  rule_ids: string[];
}

export interface Path {
  path_id: string;
  recommended: boolean;
  ll_test_at_rto: boolean;
  max_rto_visits: number;
  rule_ids: string[];
}

export interface Step {
  n: number;
  key: string;
  at_rto: boolean;
  visit: number | null;
  done: boolean;
  due_on: string | null;
  rule_ids: string[];
}

export interface Dates {
  ll_issue: string;
  dl_test_unlock: string;
  ll_expires_on: string;
  earliest_licence: string;
}

export interface DocumentItem {
  doc_id: string;
  required: boolean;
  stage: string;
  rule_id: string;
  text_key: string;
  verified: boolean;
}

export interface Issue {
  rule_id: string;
  severity: string;
  text_key: string;
  fix_key: string | null;
  due_on: string | null;
  refs: string[];
  verify_at_rto: boolean;
  provenance: ProvOut;
}

export interface LLTest {
  online_available: boolean;
  where: string[];
  mode: string;
  known: boolean;
  questions: number;
  pass_correct: number;
  pass_pct: number;
  verified: boolean;
  confidence: string;
  rule_ids: string[];
}

export interface DLTest {
  known: boolean;
  automated: boolean | null;
  tracks: string[];
  verified: boolean;
  rule_id: string;
}

export interface HPT {
  status: string;
  effective_from: string | null;
  applies: boolean;
  rule_id: string;
}

export interface Office {
  office_id: string;
  name: string;
  district: string;
  tests: string[];
  track_type: string | null;
  verified: boolean;
  rule_id: string;
}

export interface Milestone {
  id: string;
  due_on: string;
  rule_id: string;
}

export interface Plan {
  rule_pack: PackRef;
  as_of: string;
  state: string;
  age: AgeInfo;
  family_mode_required: boolean;
  requested_classes: string[];
  classes: ClassResult[];
  bundles: Bundle[];
  saving: Saving | null;
  paths: Path[];
  recommended_path: string;
  steps: Step[];
  max_rto_visits: number;
  earliest_dates: Dates | null;
  fees: FeeQuote | null;
  documents: DocumentItem[];
  blockers: Issue[];
  warnings: Issue[];
  notices: Issue[];
  ll_test: LLTest;
  dl_test: DLTest;
  hpt: HPT;
  offices: Office[];
  milestones: Milestone[];
  trace: string[];
}

export interface InputErrorShape {
  code: string;
  field: string;
}

import {
  type ClassRow,
  type CompiledPack,
  compileAll,
  type FeeItem,
  type PackFile,
  type PackSources,
  type Plan,
  type PlanInput,
  plan,
  type RuleRow,
  todayIST,
} from "@margdarshak/rules";
import base from "@rulepacks/base/cmvr.json";
import classes from "@rulepacks/classes.json";
import fees from "@rulepacks/fees.json";
import AN from "@rulepacks/states/AN.json";
import AP from "@rulepacks/states/AP.json";
import AR from "@rulepacks/states/AR.json";
import AS from "@rulepacks/states/AS.json";
import BR from "@rulepacks/states/BR.json";
import CG from "@rulepacks/states/CG.json";
import CH from "@rulepacks/states/CH.json";
import DH from "@rulepacks/states/DH.json";
import DL from "@rulepacks/states/DL.json";
import GA from "@rulepacks/states/GA.json";
import GJ from "@rulepacks/states/GJ.json";
import HP from "@rulepacks/states/HP.json";
import HR from "@rulepacks/states/HR.json";
import JH from "@rulepacks/states/JH.json";
import JK from "@rulepacks/states/JK.json";
import KA from "@rulepacks/states/KA.json";
import KL from "@rulepacks/states/KL.json";
import LA from "@rulepacks/states/LA.json";
import LD from "@rulepacks/states/LD.json";
import MH from "@rulepacks/states/MH.json";
import ML from "@rulepacks/states/ML.json";
import MN from "@rulepacks/states/MN.json";
import MP from "@rulepacks/states/MP.json";
import MZ from "@rulepacks/states/MZ.json";
import NL from "@rulepacks/states/NL.json";
import OD from "@rulepacks/states/OD.json";
import PB from "@rulepacks/states/PB.json";
import PY from "@rulepacks/states/PY.json";
import RJ from "@rulepacks/states/RJ.json";
import SK from "@rulepacks/states/SK.json";
import TN from "@rulepacks/states/TN.json";
import TR from "@rulepacks/states/TR.json";
import TS from "@rulepacks/states/TS.json";
import UK from "@rulepacks/states/UK.json";
import UP from "@rulepacks/states/UP.json";
import WB from "@rulepacks/states/WB.json";

const STATE_FILES = {
  AN,
  AP,
  AR,
  AS,
  BR,
  CG,
  CH,
  DH,
  DL,
  GA,
  GJ,
  HP,
  HR,
  JH,
  JK,
  KA,
  KL,
  LA,
  LD,
  MH,
  ML,
  MN,
  MP,
  MZ,
  NL,
  OD,
  PB,
  PY,
  RJ,
  SK,
  TN,
  TR,
  TS,
  UK,
  UP,
  WB,
};

/**
 * The rule packs, bundled with the app so the plan card works offline (MD-108, F-51). The TS mirror
 * (`packages/rules`) is conformance-tested against the Go engine on tests/golden, so a plan computed
 * here is byte-identical to the server's for the same input and date.
 */
export const SOURCES: PackSources = {
  base: base as unknown as PackFile,
  states: STATE_FILES as unknown as Record<string, PackFile>,
  fees: fees as unknown as PackSources["fees"],
  classes: classes as unknown as PackSources["classes"],
};

let compiled: Map<string, CompiledPack> | null = null;

export function packs(): Map<string, CompiledPack> {
  compiled ??= compileAll(SOURCES);
  return compiled;
}

/** Evaluates a plan on this device with the TS mirror. Throws InputError on bad input. */
export function planOnDevice(input: PlanInput): Plan {
  return plan(packs(), input);
}

export { todayIST };

/** Every state and UT has a pack; J&K (the demo tenant) first, then alphabetical by name. */
export const STATE_CODES = [
  "JK",
  "AN",
  "AP",
  "AR",
  "AS",
  "BR",
  "CH",
  "CG",
  "DH",
  "DL",
  "GA",
  "GJ",
  "HR",
  "HP",
  "JH",
  "KA",
  "KL",
  "LA",
  "LD",
  "MP",
  "MH",
  "MN",
  "ML",
  "MZ",
  "NL",
  "OD",
  "PY",
  "PB",
  "RJ",
  "SK",
  "TN",
  "TS",
  "TR",
  "UP",
  "UK",
  "WB",
] as const;
export type StateCode = (typeof STATE_CODES)[number];
export const DEFAULT_STATE: StateCode = "JK";

export function isStateCode(v: unknown): v is StateCode {
  return typeof v === "string" && (STATE_CODES as readonly string[]).includes(v);
}

/** Whether the state's pack offers the LL test online at home (PRM-LL-TEST-MODE, base default). */
export function llTestAtHome(code: string): boolean {
  const own = SOURCES.states[code]?.rules.find((r) => r.overrides === "PRM-LL-TEST-MODE");
  const base = SOURCES.base.rules.find((r) => r.id === "PRM-LL-TEST-MODE");
  const v = (own ?? base)?.output["value"] as { onlineAvailable?: boolean } | undefined;
  return v?.onlineAvailable === true;
}

export function statePartial(code: StateCode): boolean {
  return SOURCES.states[code]?.partial ?? true;
}

/** Every vehicle class in classes.json, in pack order. */
export function allClasses(): ClassRow[] {
  return SOURCES.classes.classes;
}

export function classByCode(code: string): ClassRow | undefined {
  return SOURCES.classes.classes.find((c) => c.code === code);
}

const ruleIndex = new Map<string, RuleRow>();
function indexRules(): Map<string, RuleRow> {
  if (ruleIndex.size === 0) {
    for (const r of SOURCES.base.rules) ruleIndex.set(r.id, r);
    for (const st of Object.values(SOURCES.states))
      for (const r of st.rules) ruleIndex.set(r.id, r);
  }
  return ruleIndex;
}

/** The raw rule row (with provenance and English text) for a rule ID. */
export function ruleRow(id: string): RuleRow | undefined {
  return indexRules().get(id);
}

export function feeItem(id: string): FeeItem | undefined {
  const f = SOURCES.fees;
  return [...f.items, ...f.retest, ...f.stateItems].find((i) => i.id === id);
}

/** The latest "checked on" date across the packs a plan used (for "rules dated …"). */
export function rulesCheckedOn(state: string): string {
  let latest = "";
  const rows = [...SOURCES.base.rules, ...(SOURCES.states[state]?.rules ?? [])];
  for (const r of rows) if (r.checkedOn > latest) latest = r.checkedOn;
  return latest;
}

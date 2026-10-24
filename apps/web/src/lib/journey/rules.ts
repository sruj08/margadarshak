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
import DL from "@rulepacks/states/DL.json";
import JK from "@rulepacks/states/JK.json";
import KL from "@rulepacks/states/KL.json";
import MH from "@rulepacks/states/MH.json";
import PB from "@rulepacks/states/PB.json";
import TN from "@rulepacks/states/TN.json";

/**
 * The rule packs, bundled with the app so the plan card works offline (MD-108, F-51). The TS mirror
 * (`packages/rules`) is conformance-tested against the Go engine on tests/golden, so a plan computed
 * here is byte-identical to the server's for the same input and date.
 */
export const SOURCES: PackSources = {
  base: base as unknown as PackFile,
  states: {
    DL: DL as unknown as PackFile,
    JK: JK as unknown as PackFile,
    KL: KL as unknown as PackFile,
    MH: MH as unknown as PackFile,
    PB: PB as unknown as PackFile,
    TN: TN as unknown as PackFile,
  },
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

/** States with a rule pack, in display order (J&K is the demo tenant). */
export const STATE_CODES = ["JK", "DL", "KL", "PB", "MH", "TN"] as const;
export type StateCode = (typeof STATE_CODES)[number];
export const DEFAULT_STATE: StateCode = "JK";

export function isStateCode(v: unknown): v is StateCode {
  return typeof v === "string" && (STATE_CODES as readonly string[]).includes(v);
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

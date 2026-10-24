// @margdarshak/rules: TS mirror of the authoritative Go rules engine
// (services/api/internal/rules) for offline plan cards. Zero runtime deps.
//
//   import base from "../../rulepacks/base/cmvr.json" with { type: "json" };
//   const packs = compileAll({ base, states: { JK }, fees, classes });
//   const p = plan(packs, { as_of: todayIST(new Date()), state: "JK", dob: "2007-03-14", vehicles: ["bike_gear"] });

export { canonicalJSON, sha256Hex } from "./canon.ts";
export { addMonths, ageOn, birthdayAt, formatDate, parseDate, todayIST } from "./date.ts";
export { feeQuote, InputError, plan, planWith } from "./engine.ts";
export { ExprError, evaluate, parseExpr } from "./expr.ts";
export type { CompiledPack } from "./pack.ts";
export { compileAll, compilePack, PackError } from "./pack.ts";
export type * from "./types.ts";

// biome-ignore-all lint/complexity/useLiteralKeys: tsconfig.base sets noPropertyAccessFromIndexSignature, which requires bracket access on index signatures.
// Pack compilation: base + state overlay merged by rule ID (state wins), every
// expression parsed and statically checked, content hash computed.
// Mirrors services/api/internal/rules/pack.go. JSON Schema validation is done
// by the Go loader and CI; the mirror trusts the same files.

import { canonicalJSON, sha256Hex } from "./canon.ts";
import { type ExprNode, parseExpr, walk } from "./expr.ts";
import type {
  ClassesFile,
  ClassRow,
  FeesFile,
  Json,
  PackFile,
  PackSources,
  RuleRow,
} from "./types.ts";

export interface CompiledRule extends RuleRow {
  cond: ExprNode;
  outExprs: Map<string, ExprNode>;
}

export interface CompiledPack {
  packId: string;
  version: string;
  baseVersion: string;
  partial: boolean;
  hash: string;
  rules: CompiledRule[];
  params: Map<string, CompiledRule>;
  effective: Map<string, string>;
  fees: FeesFile;
  classes: ClassesFile;
  classByCode: Map<string, ClassRow>;
  classByPic: Map<string, ClassRow>;
  classOrder: Map<string, number>;
}

export class PackError extends Error {}

const REQUIRED_PARAMS = [
  "PRM-LL-TEST-MODE",
  "PRM-LL-FORMAT",
  "PRM-TUTORIAL-DAYS",
  "PRM-MIN-WAIT-DAYS",
  "PRM-LL-VALIDITY-MONTHS",
  "PRM-RETEST-GAP-DAYS",
  "PRM-FORM1A-AGE",
  "PRM-DL-TEST",
  "PRM-HPT",
];

function prepare(pf: PackFile): CompiledRule[] {
  return pf.rules.map((r) => {
    let cond: ExprNode;
    try {
      cond = parseExpr(r.condition, 1);
    } catch (e) {
      throw new PackError(`${pf.packId}/${r.id} condition: ${(e as Error).message}`);
    }
    const outExprs = new Map<string, ExprNode>();
    for (const k of ["eligibleFromAge", "dueOn"]) {
      if (k in r.output) outExprs.set(k, parseExpr(r.output[k] as Json, 1));
    }
    return { ...r, cond, outExprs };
  });
}

export function compilePack(src: PackSources, state: string): CompiledPack {
  const st = src.states[state];
  if (!st) throw new PackError(`unknown state ${state}`);
  if (st.extends !== `IN-base@${src.base.version}`)
    throw new PackError(`${state} extends ${st.extends}`);
  const baseRules = prepare(src.base);
  const stateRules = prepare(st);
  const merged: CompiledRule[] = [];
  const index = new Map<string, number>();
  for (const r of baseRules) {
    if (index.has(r.id)) throw new PackError(`IN-base: duplicate rule ${r.id}`);
    index.set(r.id, merged.length);
    merged.push(r);
  }
  const effective = new Map<string, string>();
  const seen = new Set<string>();
  for (const r of stateRules) {
    if (seen.has(r.id)) throw new PackError(`${state}: duplicate rule ${r.id}`);
    seen.add(r.id);
    let target = r.overrides ?? "";
    if (target === "" && index.has(r.id)) target = r.id;
    if (target !== "") {
      const pos = index.get(target);
      if (pos === undefined)
        throw new PackError(`${state}/${r.id} overrides unknown base rule ${target}`);
      if ((merged[pos] as CompiledRule).kind !== r.kind)
        throw new PackError(`${state}/${r.id} changes kind of ${target}`);
      merged[pos] = r;
      effective.set(target, r.id);
      continue;
    }
    index.set(r.id, merged.length);
    merged.push(r);
  }
  const rules = merged.filter((r) => r.disabled !== true);
  const params = new Map<string, CompiledRule>();
  for (const r of rules) if (r.kind === "param") params.set(r.id, r);
  for (const [base, eff] of effective) {
    const p = params.get(eff);
    if (p) params.set(base, p);
  }
  const classByCode = new Map<string, ClassRow>();
  const classByPic = new Map<string, ClassRow>();
  const classOrder = new Map<string, number>();
  src.classes.classes.forEach((c, i) => {
    classByCode.set(c.code, c);
    classOrder.set(c.code, i);
    for (const p of c.pictures) {
      if (classByPic.has(p)) throw new PackError(`classes: picture ${p} used twice`);
      classByPic.set(p, c);
    }
  });
  for (const id of REQUIRED_PARAMS)
    if (!params.has(id)) throw new PackError(`${state}: missing required param ${id}`);
  for (const r of rules) {
    const check = (n: ExprNode): void => {
      if (n.op === "param") {
        const p = params.get(n.paramId as string);
        if (!p) throw new PackError(`${state}: ${r.id} reads unknown param ${n.paramId}`);
        if (n.paramPath !== undefined) {
          const v = p.output["value"];
          if (v === null || typeof v !== "object" || Array.isArray(v) || !(n.paramPath in v)) {
            throw new PackError(
              `${state}: ${r.id} reads unknown path ${n.paramPath} of param ${n.paramId}`,
            );
          }
        }
      }
      if (n.fact?.startsWith("class.") && r.kind !== "eligibility")
        throw new PackError(`${state}: ${r.id} reads ${n.fact} outside an eligibility rule`);
    };
    walk(r.cond, check);
    for (const n of r.outExprs.values()) walk(n, check);
    for (const c of r.appliesTo ?? [])
      if (!classByCode.has(c))
        throw new PackError(`${state}: ${r.id} applies to unknown class ${c}`);
  }
  const hash = sha256Hex(
    canonicalJSON({ base: src.base, state: st, fees: src.fees, classes: src.classes }),
  );
  return {
    packId: state,
    version: st.version,
    baseVersion: st.extends,
    partial: st.partial,
    hash,
    rules,
    params,
    effective,
    fees: src.fees,
    classes: src.classes,
    classByCode,
    classByPic,
    classOrder,
  };
}

/** Compiles every state pack once (cache this; packs are immutable). */
export function compileAll(src: PackSources): Map<string, CompiledPack> {
  const out = new Map<string, CompiledPack>();
  for (const st of Object.keys(src.states).sort()) out.set(st, compilePack(src, st));
  return out;
}

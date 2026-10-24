// biome-ignore-all lint/complexity/useLiteralKeys: tsconfig.base sets noPropertyAccessFromIndexSignature, which requires bracket access on index signatures.
// Closed JSON expression language. Mirrors services/api/internal/rules/expr.go
// (same parse errors, same semantics; see the comment block there).

import { addMonths, ageOn, birthdayAt, formatDate, parseDate } from "./date.ts";
import type { Json } from "./types.ts";

export const MAX_EXPR_DEPTH = 8;

export const KNOWN_FACTS: ReadonlySet<string> = new Set([
  "asOf",
  "state",
  "dobPrecision",
  "dobLatest",
  "dobEarliest",
  "aadhaarAddressMatches",
  "aadhaarRelationLine",
  "aadhaarMobileLinked",
  "homeTestDevice",
  "disability",
  "hasDisability",
  "foreignLicence",
  "nri",
  "movingState",
  "holdsDl",
  "lmvDlHeldSince",
  "wantsIdp",
  "hasTestVehicle",
  "llIssuedOn",
  "requestedClasses",
  "anyTransport",
  "anyNonTransport",
  "anyForm1aAlways",
  "packPartial",
  "llDate",
  "dlTestUnlock",
  "llExpiresOn",
  "earliestLicence",
  "class.code",
  "class.minAge",
  "class.transport",
  "class.form1a",
]);

export interface ExprNode {
  op: string;
  lit?: Json;
  args: ExprNode[];
  fact?: string;
  paramId?: string;
  paramPath?: string;
  bound?: "min" | "max";
}

export type Value = Json;

export class ExprError extends Error {}

function isObj(v: Json): v is { [k: string]: Json } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function parseExpr(v: Json, depth: number): ExprNode {
  if (depth > MAX_EXPR_DEPTH) throw new ExprError(`expression deeper than ${MAX_EXPR_DEPTH}`);
  if (v === null || typeof v === "boolean" || typeof v === "string")
    return { op: "lit", lit: v, args: [] };
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new ExprError(`only integer numbers are allowed, got ${v}`);
    return { op: "lit", lit: v, args: [] };
  }
  if (Array.isArray(v)) return { op: "list", args: v.map((e) => parseExpr(e, depth + 1)) };
  const keys = Object.keys(v);
  if (keys.length !== 1)
    throw new ExprError(`operator object must have exactly one key, got ${keys.length}`);
  const op = keys[0] as string;
  return parseOp(op, v[op] as Json, depth);
}

function parseArgs(op: string, arg: Json, depth: number, min: number, max: number): ExprNode[] {
  if (!Array.isArray(arg)) throw new ExprError(`${op} expects an array`);
  if (arg.length < min || (max >= 0 && arg.length > max))
    throw new ExprError(`${op} expects ${min}..${max} arguments, got ${arg.length}`);
  return arg.map((e) => parseExpr(e, depth + 1));
}

function parseOp(op: string, arg: Json, depth: number): ExprNode {
  switch (op) {
    case "all":
    case "any":
      return { op, args: parseArgs(op, arg, depth, 1, -1) };
    case "not":
      return { op, args: [parseExpr(arg, depth + 1)] };
    case "eq":
    case "ne":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "in":
    case "has":
    case "daysBetween":
    case "addDays":
    case "addMonths":
      return { op, args: parseArgs(op, arg, depth, 2, 2) };
    case "between":
      return { op, args: parseArgs(op, arg, depth, 3, 3) };
    case "fact":
      if (typeof arg !== "string" || !KNOWN_FACTS.has(arg))
        throw new ExprError(`unknown fact ${String(arg)}`);
      return { op, args: [], fact: arg };
    case "param": {
      if (!isObj(arg)) throw new ExprError("param expects an object");
      const id = arg["id"];
      if (typeof id !== "string" || id === "") throw new ExprError("param needs an id");
      for (const k of Object.keys(arg))
        if (k !== "id" && k !== "path") throw new ExprError(`param: unknown key "${k}"`);
      const n: ExprNode = { op, args: [], paramId: id };
      if ("path" in arg) {
        const p = arg["path"];
        if (typeof p !== "string" || p === "") throw new ExprError("param path must be a string");
        n.paramPath = p;
      }
      return n;
    }
    case "ageOn":
    case "birthday": {
      if (!isObj(arg)) throw new ExprError(`${op} expects an object`);
      const key = op === "birthday" ? "age" : "on";
      if (Object.keys(arg).length !== 2) throw new ExprError(`${op} expects keys ${key} and bound`);
      const b = arg["bound"];
      if (b !== "min" && b !== "max") throw new ExprError(`${op} bound must be min or max`);
      if (!(key in arg)) throw new ExprError(`${op} needs ${key}`);
      return { op, args: [parseExpr(arg[key] as Json, depth + 1)], bound: b };
    }
    case "const":
      return { op: "lit", lit: arg, args: [] };
    default:
      throw new ExprError(`unknown operator "${op}"`);
  }
}

export function walk(n: ExprNode, f: (n: ExprNode) => void): void {
  f(n);
  for (const c of n.args) walk(c, f);
}

export interface ParamRow {
  id: string;
  output: { [k: string]: Json };
}

export interface EvalEnv {
  facts: Map<string, Value>;
  params: Map<string, ParamRow>;
  dobLatest: number;
  dobEarliest: number;
  used: Set<string>;
}

export const truthy = (v: Value | undefined): boolean => v === true;

function asDate(v: Value): number | null {
  return typeof v === "string" ? parseDate(v) : null;
}

function compare(a: Value, b: Value): number | null {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

export function deepEqual(a: Value, b: Value): boolean {
  if (a === null || typeof a !== "object") return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i] as Value));
  }
  if (b === null || typeof b !== "object" || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && deepEqual(a[k] as Value, b[k] as Value));
}

function contains(list: Value, x: Value): boolean {
  if (!Array.isArray(list)) return false;
  return list.some((e) => deepEqual(e, x));
}

export function evaluate(env: EvalEnv, n: ExprNode): Value {
  const a = (i: number): Value => evaluate(env, n.args[i] as ExprNode);
  switch (n.op) {
    case "lit":
      return n.lit === undefined ? null : n.lit;
    case "list":
      return n.args.map((c) => evaluate(env, c));
    case "all":
      for (const c of n.args) if (!truthy(evaluate(env, c))) return false;
      return true;
    case "any":
      for (const c of n.args) if (truthy(evaluate(env, c))) return true;
      return false;
    case "not":
      return !truthy(a(0));
    case "eq":
      return deepEqual(a(0), a(1));
    case "ne":
      return !deepEqual(a(0), a(1));
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const c = compare(a(0), a(1));
      if (c === null) return false;
      if (n.op === "lt") return c < 0;
      if (n.op === "lte") return c <= 0;
      if (n.op === "gt") return c > 0;
      return c >= 0;
    }
    case "between": {
      const x = a(0);
      const lo = compare(a(1), x);
      const hi = compare(x, a(2));
      return lo !== null && hi !== null && lo <= 0 && hi <= 0;
    }
    case "in":
      return contains(a(1), a(0));
    case "has":
      return contains(a(0), a(1));
    case "fact": {
      const v = env.facts.get(n.fact as string);
      return v === undefined ? null : v;
    }
    case "param": {
      const r = env.params.get(n.paramId as string);
      if (!r) return null;
      env.used.add(r.id);
      const v = r.output["value"];
      if (v === undefined) return null;
      if (n.paramPath === undefined) return v;
      if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
      const pv = v[n.paramPath];
      return pv === undefined ? null : pv;
    }
    case "ageOn": {
      const d = asDate(a(0));
      if (d === null) return null;
      return ageOn(n.bound === "max" ? env.dobEarliest : env.dobLatest, d);
    }
    case "birthday": {
      const age = a(0);
      if (typeof age !== "number") return null;
      return formatDate(birthdayAt(n.bound === "max" ? env.dobEarliest : env.dobLatest, age));
    }
    case "daysBetween": {
      const x = asDate(a(0));
      const y = asDate(a(1));
      if (x === null || y === null) return null;
      return y - x;
    }
    case "addDays":
    case "addMonths": {
      const d = asDate(a(0));
      const k = a(1);
      if (d === null || typeof k !== "number") return null;
      return formatDate(n.op === "addDays" ? d + k : addMonths(d, k));
    }
  }
  return null;
}

// biome-ignore-all lint/complexity/useLiteralKeys: tsconfig.base sets noPropertyAccessFromIndexSignature, which requires bracket access on index signatures.
// The plan algorithm (F-02 plan, F-03 smart class planner, F-04 blocker check).
// A line-by-line mirror of services/api/internal/rules/engine.go + fees.go:
// same order of evaluation, same sorting, same nulls. Deterministic and pure.

import {
  addMonths,
  ageOn,
  birthdayAt,
  civilFromDays,
  formatDate,
  fromYMD,
  parseDate,
  parseYear,
} from "./date.ts";
import { type EvalEnv, evaluate, truthy, type Value } from "./expr.ts";
import type { CompiledPack, CompiledRule } from "./pack.ts";
import type {
  Bundle,
  ClassResult,
  ClassRow,
  Dates,
  DLTest,
  DocumentItem,
  FeeItem,
  FeeLine,
  FeeQuote,
  HPT,
  InputErrorShape,
  Issue,
  Json,
  LLTest,
  Milestone,
  Office,
  Path,
  Plan,
  PlanInput,
  Provenance,
  ProvOut,
  Saving,
  Step,
} from "./types.ts";

export class InputError extends Error implements InputErrorShape {
  code: string;
  field: string;
  constructor(code: string, field: string) {
    super(`${code} (${field})`);
    this.code = code;
    this.field = field;
  }
}

const KNOWN_DISABILITIES = new Set(["deaf", "colour_vision", "low_vision", "locomotor", "other"]);

const prov = (p: Provenance): ProvOut => ({
  source_title: p.source.title,
  source_url: p.source.url,
  grade: p.grade,
  checked_on: p.checkedOn,
  confidence: p.confidence,
  verified: p.verified,
});

function appendUnique(list: string[], vals: string[]): string[] {
  for (const v of vals) if (!list.includes(v)) list.push(v);
  return list;
}

function stringList(v: Json | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is string => typeof e === "string");
}

function ageBand(y: number): string {
  if (y < 16) return "under_16";
  if (y < 18) return "16_17";
  if (y < 20) return "18_19";
  if (y < 40) return "20_39";
  return "40_plus";
}

const intOf = (v: Value | undefined): number => (typeof v === "number" ? v : 0);
const asMap = (v: Value | undefined): { [k: string]: Json } =>
  v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v) ? v : {};
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function active(r: CompiledRule, asOf: number): boolean {
  if (r.effectiveFrom) {
    const d = parseDate(r.effectiveFrom);
    if (d !== null && asOf < d) return false;
  }
  if (r.effectiveTo) {
    const d = parseDate(r.effectiveTo);
    if (d !== null && asOf > d) return false;
  }
  return true;
}

function eff(c: CompiledPack, id: string): string {
  return c.effective.get(id) ?? id;
}

function param(c: CompiledPack, env: EvalEnv, id: string): CompiledRule {
  const r = c.params.get(id) as CompiledRule;
  env.used.add(r.id);
  return r;
}

function effectiveFeeItems(c: CompiledPack): FeeItem[] {
  return c.fees.items.map((it) => {
    let chosen = it;
    for (const s of c.fees.stateItems)
      if (s.state === c.packId && s.overrides === it.id) chosen = s;
    return chosen;
  });
}

/** Fee quote for a class list (API-03). Integer paise from fees.json only. */
export function feeQuote(c: CompiledPack, classes: string[]): FeeQuote {
  const items = effectiveFeeItems(c);
  const q: FeeQuote = {
    classes: [...classes],
    lines: [],
    ll_stage_paise: 0,
    subtotal_govt_fee_paise: 0,
    smart_card_paise: 0,
    total_paise: 0,
    state_items: [],
    retest: [],
    excludes: [...(c.fees.excludes ?? [])],
    provenance: {
      source_title: "",
      source_url: "",
      grade: "",
      checked_on: "",
      confidence: "",
      verified: false,
    },
  };
  const addLine = (it: FeeItem, cls: string | null): void => {
    const line: FeeLine = {
      fee_id: it.id,
      label_key: it.labelKey,
      per: it.per,
      class_code: cls,
      quantity: 1,
      unit_paise: it.amount,
      amount_paise: it.amount,
      stage: it.stage,
      rule_id: it.id,
    };
    q.lines.push(line);
    q.total_paise += it.amount;
    if (it.stage === "LL") q.ll_stage_paise += it.amount;
    if (it.smartCard === true) q.smart_card_paise += it.amount;
  };
  for (const it of items) {
    if (it.per === "class") for (const cl of classes) addLine(it, cl);
    else addLine(it, null);
  }
  for (const s of c.fees.stateItems) {
    if (s.state !== c.packId || (s.overrides ?? "") !== "") continue;
    const included = s.includedInTotal === true;
    if (included) addLine(s, null);
    q.state_items.push({
      fee_id: s.id,
      label_key: s.labelKey,
      amount_paise: s.amount,
      included_in_total: included,
      provenance: prov(s),
    });
  }
  for (const r of c.fees.retest)
    q.retest.push({ fee_id: r.id, label_key: r.labelKey, per: r.per, amount_paise: r.amount });
  q.subtotal_govt_fee_paise = q.total_paise - q.smart_card_paise;
  if (items.length > 0) q.provenance = prov(items[0] as FeeItem);
  return q;
}

/** Plan for one input. Throws InputError on invalid input. */
export function plan(packs: Map<string, CompiledPack>, input: PlanInput): Plan {
  const c = packs.get(input.state);
  if (!c) throw new InputError("UNKNOWN_STATE", "state");
  return planWith(c, input);
}

export function planWith(c: CompiledPack, input: PlanInput): Plan {
  if (input.state !== c.packId) throw new InputError("UNKNOWN_STATE", "state");
  const asOf = parseDate(input.as_of ?? "");
  if (asOf === null) throw new InputError("INVALID_AS_OF", "as_of");
  const prec = input.dob_precision ?? "day";
  const precStr = (prec as string) === "" ? "day" : prec;
  if (precStr !== "day" && precStr !== "year")
    throw new InputError("INVALID_DOB_PRECISION", "dob_precision");
  const dobRaw = input.dob ?? "";
  let dobLatest: number;
  let dobEarliest: number;
  if (precStr === "day") {
    const d = parseDate(dobRaw);
    if (d === null) throw new InputError("INVALID_DOB", "dob");
    dobLatest = d;
    dobEarliest = d;
  } else {
    let y: number | null = null;
    if (dobRaw.length === 4) y = parseYear(dobRaw);
    else if (dobRaw.length === 10) {
      const d = parseDate(dobRaw);
      if (d !== null) y = civilFromDays(d)[0];
    }
    if (y === null) throw new InputError("INVALID_DOB", "dob");
    dobLatest = fromYMD(y, 12, 31);
    dobEarliest = fromYMD(y, 1, 1);
  }
  if (dobEarliest > asOf) throw new InputError("DOB_AFTER_AS_OF", "dob");
  const reqSet = new Set<string>();
  for (const v of input.vehicles ?? []) {
    const cr = c.classByPic.get(v);
    if (!cr) throw new InputError("UNKNOWN_VEHICLE", "vehicles");
    reqSet.add(cr.code);
  }
  for (const code of input.classes ?? []) {
    if (!c.classByCode.has(code)) throw new InputError("UNKNOWN_CLASS", "classes");
    reqSet.add(code);
  }
  if (reqSet.size === 0) throw new InputError("NO_CLASSES", "vehicles");
  const requested = [...reqSet].sort(
    (a, b) => (c.classOrder.get(a) as number) - (c.classOrder.get(b) as number),
  );

  let lmvSince: number | null = null;
  let llIssued: number | null = null;
  if (input.lmv_dl_held_since !== undefined && input.lmv_dl_held_since !== null) {
    const d = parseDate(input.lmv_dl_held_since);
    if (d === null || d > asOf) throw new InputError("INVALID_DATE", "lmv_dl_held_since");
    lmvSince = d;
  }
  if (input.ll_issued_on !== undefined && input.ll_issued_on !== null) {
    const d = parseDate(input.ll_issued_on);
    if (d === null || d > asOf) throw new InputError("INVALID_DATE", "ll_issued_on");
    llIssued = d;
  }
  const disSet = new Set<string>();
  for (const d of input.disability ?? []) {
    if (!KNOWN_DISABILITIES.has(d)) throw new InputError("UNKNOWN_DISABILITY", "disability");
    disSet.add(d);
  }
  const disability = [...disSet].sort(byStr);

  const trace = new Set<string>();
  let anyTransport = false;
  let anyNonTransport = false;
  let anyForm1a = false;
  for (const code of requested) {
    const cr = c.classByCode.get(code) as ClassRow;
    if (cr.transport) anyTransport = true;
    else anyNonTransport = true;
    if (cr.form1a === "always") anyForm1a = true;
    trace.add(cr.id);
  }
  const nb = (b: boolean | null | undefined): Value => (b === undefined || b === null ? null : b);
  const facts = new Map<string, Value>([
    ["asOf", formatDate(asOf)],
    ["state", c.packId],
    ["dobPrecision", precStr],
    ["dobLatest", formatDate(dobLatest)],
    ["dobEarliest", formatDate(dobEarliest)],
    ["aadhaarAddressMatches", nb(input.aadhaar_address_matches_residence)],
    ["aadhaarRelationLine", nb(input.aadhaar_has_relation_line)],
    ["aadhaarMobileLinked", nb(input.aadhaar_mobile_linked)],
    ["homeTestDevice", nb(input.home_test_device)],
    ["disability", [...disability]],
    ["hasDisability", disability.length > 0],
    ["foreignLicence", input.foreign_licence === true],
    ["nri", input.nri === true],
    ["movingState", input.moving_state === true],
    ["holdsDl", input.holds_dl === true],
    ["lmvDlHeldSince", lmvSince === null ? null : formatDate(lmvSince)],
    ["wantsIdp", input.wants_idp === true],
    ["hasTestVehicle", nb(input.has_test_vehicle)],
    ["llIssuedOn", llIssued === null ? null : formatDate(llIssued)],
    ["requestedClasses", [...requested]],
    ["anyTransport", anyTransport],
    ["anyNonTransport", anyNonTransport],
    ["anyForm1aAlways", anyForm1a],
    ["packPartial", c.partial],
    ["llDate", null],
    ["dlTestUnlock", null],
    ["llExpiresOn", null],
    ["earliestLicence", null],
    ["class.code", null],
    ["class.minAge", null],
    ["class.transport", null],
    ["class.form1a", null],
  ]);
  const env: EvalEnv = { facts, params: c.params, dobLatest, dobEarliest, used: new Set() };

  // 1. Eligibility per class.
  const classes: ClassResult[] = [];
  for (const code of requested) {
    const cr = c.classByCode.get(code) as ClassRow;
    facts.set("class.code", cr.code);
    facts.set("class.minAge", cr.minAge);
    facts.set("class.transport", cr.transport);
    facts.set("class.form1a", cr.form1a);
    const res: ClassResult = {
      class_code: cr.code,
      name_key: cr.nameKey,
      eligible: true,
      eligible_from: null,
      reason_key: null,
      content_depth: cr.contentDepth,
      transport: cr.transport,
      verify_at_rto: !cr.verified,
      requires: [],
      flags: [],
      alternatives: [],
      prerequisites: [],
      rule_ids: [cr.id],
      provenance: prov(cr),
    };
    for (const p of cr.prerequisites) {
      res.prerequisites.push({ id: p.id, text_key: p.textKey, verified: p.verified });
      if (!p.verified) res.verify_at_rto = true;
    }
    let from: number | null = null;
    let permanent = false;
    for (const r of c.rules) {
      if (r.kind !== "eligibility" || !active(r, asOf)) continue;
      if (r.appliesTo && r.appliesTo.length > 0 && !r.appliesTo.includes(code)) continue;
      if (!truthy(evaluate(env, r.cond))) continue;
      res.rule_ids.push(r.id);
      trace.add(r.id);
      const out = r.output;
      if (truthy(out["deny"])) {
        res.eligible = false;
        const rk = out["reasonKey"];
        if (typeof rk === "string" && res.reason_key === null) res.reason_key = rk;
        const n = r.outExprs.get("eligibleFromAge");
        const age = n ? evaluate(env, n) : null;
        if (typeof age === "number") {
          const d = birthdayAt(dobLatest, age);
          if (from === null || d > from) from = d;
        } else {
          permanent = true;
        }
      }
      appendUnique(res.requires, stringList(out["requires"]));
      appendUnique(res.flags, stringList(out["flags"]));
      appendUnique(res.alternatives, stringList(out["alternatives"]));
      if (truthy(out["verifyAtRto"])) res.verify_at_rto = true;
    }
    if (!res.eligible && !permanent && from !== null) res.eligible_from = formatDate(from);
    classes.push(res);
  }
  for (const k of ["class.code", "class.minAge", "class.transport", "class.form1a"])
    facts.set(k, null);

  // 2. Smart class planner.
  const llBase = llIssued ?? asOf;
  const waitRule = param(c, env, "PRM-MIN-WAIT-DAYS");
  const valRule = param(c, env, "PRM-LL-VALIDITY-MONTHS");
  const minWait = intOf(waitRule.output["value"]);
  const validity = intOf(valRule.output["value"]);
  const groups = new Map<string, string[]>();
  classes.forEach((cl, i) => {
    let key: string;
    if (cl.eligible) key = formatDate(llBase);
    else if (cl.eligible_from !== null) key = cl.eligible_from;
    else return;
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as string[]).push(requested[i] as string);
  });
  const keys = [...groups.keys()].sort(byStr);
  const bundles: Bundle[] = keys.map((k, i) => {
    const from = parseDate(k) as number;
    const unlock = formatDate(from + minWait);
    const cls = groups.get(k) as string[];
    const b: Bundle = {
      bundle_no: i + 1,
      classes: cls,
      ll_from: k,
      dl_test_unlock: unlock,
      ll_expires_on: formatDate(addMonths(from, validity)),
      earliest_licence: unlock,
      fees: feeQuote(c, cls),
      rule_ids: [],
    };
    if (cls.length > 1) b.rule_ids.push("PLN-ONE-LL-MANY-CLASSES");
    if (i > 0) b.rule_ids.push("PLN-SPLIT-BY-AGE");
    for (const id of b.rule_ids) trace.add(id);
    for (const ln of b.fees.lines) trace.add(ln.rule_id);
    for (const s of b.fees.state_items) trace.add(s.fee_id);
    return b;
  });
  const primary: Bundle | null = bundles.length > 0 ? (bundles[0] as Bundle) : null;
  if (primary) {
    facts.set("llDate", primary.ll_from);
    facts.set("dlTestUnlock", primary.dl_test_unlock);
    facts.set("llExpiresOn", primary.ll_expires_on);
    facts.set("earliestLicence", primary.earliest_licence);
  }

  // 3. Routes, documents, issues, offices.
  let forcedRTO = false;
  let recommendNA = false;
  let familyMode = false;
  const routeIDs: string[] = [];
  const documents: DocumentItem[] = [];
  const docSeen = new Set<string>();
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  const notices: Issue[] = [];
  const offices: Office[] = [];
  const issueDue = new Map<string, string>();
  for (const r of c.rules) {
    if (!["route", "document", "blocker", "warning", "notice", "office"].includes(r.kind)) continue;
    if (!active(r, asOf) || !truthy(evaluate(env, r.cond))) continue;
    trace.add(r.id);
    const out = r.output;
    if (r.kind === "route") {
      if (truthy(out["llTestAtRto"])) forcedRTO = true;
      routeIDs.push(r.id);
    } else if (r.kind === "document") {
      const id = typeof out["docId"] === "string" ? out["docId"] : "";
      if (docSeen.has(id)) continue;
      docSeen.add(id);
      documents.push({
        doc_id: id,
        required: truthy(out["required"]),
        stage: typeof out["stage"] === "string" ? out["stage"] : "",
        rule_id: r.id,
        text_key: r.textKey,
        verified: r.verified,
      });
    } else if (r.kind === "office") {
      const tt = out["trackType"];
      offices.push({
        office_id: typeof out["officeId"] === "string" ? out["officeId"] : "",
        name: typeof out["name"] === "string" ? out["name"] : "",
        district: typeof out["district"] === "string" ? out["district"] : "",
        tests: stringList(out["tests"]),
        track_type: typeof tt === "string" ? tt : null,
        verified: r.verified,
        rule_id: r.id,
      });
    } else {
      const is: Issue = {
        rule_id: r.id,
        severity: r.kind,
        text_key: r.textKey,
        fix_key: r.fixKey ? r.fixKey : null,
        due_on: null,
        refs: [...(r.refs ?? [])],
        verify_at_rto: !r.verified || r.confidence === "low",
        provenance: prov(r),
      };
      const n = r.outExprs.get("dueOn");
      if (n) {
        const d = evaluate(env, n);
        if (typeof d === "string") {
          is.due_on = d;
          issueDue.set(r.id, d);
        }
      }
      if (out["recommendPath"] === "non_aadhaar") recommendNA = true;
      if (truthy(out["familyMode"])) familyMode = true;
      if (r.kind === "blocker") blockers.push(is);
      else if (r.kind === "warning") warnings.push(is);
      else notices.push(is);
    }
  }

  // 4. Paths and RTO visits.
  const llDone = llIssued !== null;
  const visits = (atRTO: boolean): number => (atRTO && !llDone ? 2 : 1);
  trace.add("PLN-NON-AADHAAR-AT-RTO");
  const paths: Path[] = [
    {
      path_id: "aadhaar_contactless",
      recommended: !recommendNA,
      ll_test_at_rto: forcedRTO,
      max_rto_visits: visits(forcedRTO),
      rule_ids: [...routeIDs],
    },
    {
      path_id: "non_aadhaar",
      recommended: recommendNA,
      ll_test_at_rto: true,
      max_rto_visits: visits(true),
      rule_ids: ["PLN-NON-AADHAAR-AT-RTO", ...routeIDs],
    },
  ];
  const rec = (recommendNA ? paths[1] : paths[0]) as Path;
  const llAtRTO = rec.ll_test_at_rto;

  // 5. LL / DL test formats and HPT.
  const tmRule = param(c, env, "PRM-LL-TEST-MODE");
  const fmtRule = param(c, env, "PRM-LL-FORMAT");
  const tm = asMap(tmRule.output["value"]);
  const fm = asMap(fmtRule.output["value"]);
  const llTest: LLTest = {
    online_available: truthy(tm["onlineAvailable"]),
    where: stringList(tm["where"]),
    mode: llAtRTO ? "rto" : "online",
    known: truthy(fm["known"]),
    questions: intOf(fm["questions"]),
    pass_correct: intOf(fm["passCorrect"]),
    pass_pct: intOf(fm["passPct"]),
    verified: fmtRule.verified,
    confidence: fmtRule.confidence,
    rule_ids: [tmRule.id, fmtRule.id],
  };
  const dlRule = param(c, env, "PRM-DL-TEST");
  const dv = asMap(dlRule.output["value"]);
  const dlTest: DLTest = {
    known: truthy(dv["known"]),
    automated: typeof dv["automated"] === "boolean" ? dv["automated"] : null,
    tracks: stringList(dv["tracks"]),
    verified: dlRule.verified,
    rule_id: dlRule.id,
  };
  const hptRule = param(c, env, "PRM-HPT");
  const hv = asMap(hptRule.output["value"]);
  const hpt: HPT = {
    status: typeof hv["status"] === "string" ? hv["status"] : "",
    effective_from: typeof hv["effectiveFrom"] === "string" ? hv["effectiveFrom"] : null,
    applies: false,
    rule_id: hptRule.id,
  };
  if (
    primary &&
    hpt.effective_from !== null &&
    (hpt.status === "announced" || hpt.status === "in_force") &&
    primary.dl_test_unlock >= hpt.effective_from
  ) {
    hpt.applies = true;
  }

  // 6. Steps for the recommended path of the primary bundle.
  const steps: Step[] = [];
  let maxVisits = rec.max_rto_visits;
  let milestones: Milestone[] = [];
  let dates: Dates | null = null;
  let fees: FeeQuote | null = null;
  if (primary) {
    let visit = 0;
    const add = (
      key: string,
      atRTO: boolean,
      vis: number | null,
      done: boolean,
      due: string | null,
      ids: string[],
    ): void => {
      const uniq = appendUnique([], ids);
      for (const id of uniq) trace.add(id);
      steps.push({
        n: steps.length + 1,
        key,
        at_rto: atRTO,
        visit: vis,
        done,
        due_on: due,
        rule_ids: uniq,
      });
    };
    const tutRule = param(c, env, "PRM-TUTORIAL-DAYS");
    add("ll.apply", false, null, llDone, null, [
      tmRule.id,
      "FEE-LL-ISSUE",
      "FEE-LL-TEST",
      "FEE-DL-TEST",
    ]);
    add("ll.tutorial", false, null, llDone, null, [tutRule.id]);
    let llVisit: number | null = null;
    if (llAtRTO && !llDone) {
      visit++;
      llVisit = visit;
    }
    add(
      llAtRTO ? "ll.test.at_rto" : "ll.test.online",
      llAtRTO,
      llVisit,
      llDone,
      llDone ? null : primary.ll_from,
      [tmRule.id, fmtRule.id, ...rec.rule_ids],
    );
    add("practice", false, null, false, primary.dl_test_unlock, [waitRule.id]);
    add("dl.book", false, null, false, primary.dl_test_unlock, [waitRule.id, valRule.id]);
    visit++;
    const dlVisit = visit;
    if (hpt.applies) add("dl.hpt", true, dlVisit, false, primary.dl_test_unlock, [hptRule.id]);
    add("dl.test", true, dlVisit, false, primary.dl_test_unlock, [dlRule.id]);
    add("dl.issue", false, null, false, primary.earliest_licence, [
      "FEE-DL-ISSUE",
      "FEE-SMART-CARD",
    ]);
    maxVisits = visit;
    milestones = [
      { id: "LL_DAY_30_UNLOCK", due_on: primary.dl_test_unlock, rule_id: waitRule.id },
      { id: "LL_EXPIRY", due_on: primary.ll_expires_on, rule_id: valRule.id },
    ];
    const t40 = eff(c, "WRN-TURNING-40");
    const d40 = issueDue.get(t40);
    if (d40 !== undefined) milestones.push({ id: "FORM_1A_AT_40", due_on: d40, rule_id: t40 });
    dates = {
      ll_issue: primary.ll_from,
      dl_test_unlock: primary.dl_test_unlock,
      ll_expires_on: primary.ll_expires_on,
      earliest_licence: primary.earliest_licence,
    };
    fees = primary.fees;
  }
  milestones.sort((a, b) =>
    a.due_on !== b.due_on ? byStr(a.due_on, b.due_on) : byStr(a.id, b.id),
  );

  // 7. Saving.
  let saving: Saving | null = null;
  if (primary && primary.classes.length > 1) {
    const n = primary.classes.length;
    let perApp = 0;
    for (const it of effectiveFeeItems(c)) if (it.per === "application") perApp += it.amount;
    const srId = eff(c, "PLN-SAVING-IF-SEQUENTIAL");
    const sr = c.rules.find((r) => r.id === srId) as CompiledRule;
    saving = {
      classes_on_one_ll: n,
      applications_saved: n - 1,
      wait_days_saved: minWait * (n - 1),
      fee_saving_paise: perApp * (n - 1),
      note_key: "plan.bundle.saves_if_sequential",
      verified: sr.verified,
      confidence: sr.confidence,
      rule_ids: ["PLN-ONE-LL-MANY-CLASSES", "PLN-SAVING-IF-SEQUENTIAL"],
    };
    trace.add("PLN-SAVING-IF-SEQUENTIAL");
  }

  for (const id of [tmRule.id, fmtRule.id, dlRule.id, hptRule.id]) trace.add(id);
  for (const id of env.used) trace.add(id);

  const ageMin = ageOn(dobLatest, asOf);
  const ageMax = ageOn(dobEarliest, asOf);
  return {
    rule_pack: {
      pack_id: c.packId,
      version: c.version,
      base_version: c.baseVersion,
      fees_version: c.fees.version,
      classes_version: c.classes.version,
      partial: c.partial,
      hash: c.hash,
    },
    as_of: formatDate(asOf),
    state: c.packId,
    age: { years_min: ageMin, years_max: ageMax, band: ageBand(ageMin), dob_precision: precStr },
    family_mode_required: ageMin < 18 || familyMode,
    requested_classes: requested,
    classes,
    bundles,
    saving,
    paths,
    recommended_path: rec.path_id,
    steps,
    max_rto_visits: maxVisits,
    earliest_dates: dates,
    fees,
    documents,
    blockers,
    warnings,
    notices,
    ll_test: llTest,
    dl_test: dlTest,
    hpt,
    offices,
    milestones,
    trace: [...trace].sort(byStr),
  };
}

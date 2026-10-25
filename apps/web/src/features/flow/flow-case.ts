"use client";

import type { Plan } from "@margdarshak/rules";
import { useCallback, useState } from "react";
import { cacheCase } from "@/lib/case/case-store";
import { type CaseSession, useCaseSession } from "@/lib/case/use-case-session";
import { demoSkipDays, getCase, postEvent } from "@/lib/journey/api";
import type { CaseEventCreate } from "@/lib/journey/api-types";
import { addDays, istToday } from "@/lib/journey/dates";
import { feeItem, packs, ruleRow } from "@/lib/journey/rules";

/**
 * Shared plumbing for the LL-to-DL flow screens: the case session plus one `act` that records a
 * journey event (Go API when live, the device API otherwise) and refreshes the cached case, so the
 * stage-aware home and the tracker move with every step.
 */

export type FlowEvent = CaseEventCreate["type"];

export function useFlow(): CaseSession & {
  busy: boolean;
  error: string | null;
  act: (type: FlowEvent, payload?: CaseEventCreate["payload"], on?: string) => Promise<boolean>;
  skip: (days: number) => Promise<boolean>;
} {
  const s = useCaseSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caseId = s.active?.caseId;

  const act = useCallback(
    async (type: FlowEvent, payload?: CaseEventCreate["payload"], on?: string) => {
      if (!caseId) return false;
      setBusy(true);
      setError(null);
      try {
        await postEvent(caseId, {
          type,
          occurred_on: on ?? istToday(),
          ...(payload ? { payload } : {}),
        });
        const fresh = await getCase(caseId);
        cacheCase(fresh.data);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [caseId],
  );

  const skip = useCallback(
    async (days: number) => {
      if (!caseId) return false;
      const c = await demoSkipDays(caseId, days).catch(() => null);
      if (c) cacheCase(c);
      return c !== null;
    },
    [caseId],
  );

  return { ...s, busy, error, act, skip };
}

/** A numeric rule-pack parameter (e.g. PRM-RETEST-GAP-DAYS), with the state's override if any. */
export function paramNumber(plan: Plan | null, id: string, fallback: number): number {
  const st = plan?.state;
  const pack = st ? packs().get(st) : undefined;
  const row = pack?.rules.find((r) => r.id === id || r.overrides === id) ?? ruleRow(id);
  const v = row?.output["value"];
  return typeof v === "number" ? v : fallback;
}

export type PayFor = "ll" | "dl" | "retest" | "llretest";

export interface PayLine {
  id: string;
  labelKey: string;
  qty: number;
  amount: number;
}

/** What the gateway charges, from fees.json in paise (no literal anywhere in the UI). */
export function payLines(plan: Plan | null, kind: PayFor): PayLine[] {
  const fees = plan?.fees;
  if (!fees) return [];
  if (kind === "llretest") {
    const it = feeItem("FEE-LL-RETEST");
    return it ? [{ id: it.id, labelKey: it.labelKey, qty: 1, amount: it.amount }] : [];
  }
  if (kind === "retest") {
    const it = feeItem("FEE-DL-RETEST");
    const n = Math.max(1, plan.classes.filter((c) => c.eligible).length);
    return it ? [{ id: it.id, labelKey: it.labelKey, qty: n, amount: it.amount * n }] : [];
  }
  const stage = kind === "ll" ? "LL" : "DL";
  const rows = new Map<string, PayLine>();
  for (const l of fees.lines) {
    if (l.stage !== stage) continue;
    const r = rows.get(l.fee_id);
    if (r) {
      r.qty += l.quantity;
      r.amount += l.amount_paise;
    } else
      rows.set(l.fee_id, {
        id: l.fee_id,
        labelKey: l.label_key,
        qty: l.quantity,
        amount: l.amount_paise,
      });
  }
  return [...rows.values()];
}

/** Synthetic, deterministic references for the simulated flow (never real-looking Aadhaar data). */
export function refFor(seed: string, len: number): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  while (out.length < len) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    out += String(h % 10);
  }
  return out;
}

/** "JK01 20260004471"-style licence number: state, office, year, serial (synthetic). */
export function licenceNumber(state: string, seed: string, year: string): string {
  return `${state}01 ${year}${refFor(seed, 7)}`;
}

export interface TestOffice {
  id: string;
  name: string;
  district: string;
  track: string | null;
  sample: boolean;
}

/** Driving-test offices: the state pack's offices, else a clearly-labelled sample pair. */
export function officesFor(plan: Plan | null, stateName: string): TestOffice[] {
  const real = (plan?.offices ?? [])
    .filter((o) => o.tests.length === 0 || o.tests.includes("dl_test"))
    .map((o) => ({
      id: o.office_id,
      name: o.name,
      district: o.district,
      track: o.track_type,
      sample: false,
    }));
  if (real.length > 0) return real;
  return [
    { id: "RTO-HQ", name: `RTO · ${stateName}`, district: stateName, track: null, sample: true },
    { id: "ARTO-1", name: `ARTO · ${stateName}`, district: stateName, track: null, sample: true },
  ];
}

/** Working-day slots from `from` for `days` days (Sundays closed), as ISO dates. */
export function slotDates(from: string, days: number, until?: string | null): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < days && i < days * 2; i++) {
    const d = addDays(from, i);
    if (until && d > until) break;
    if (new Date(`${d}T06:30:00Z`).getUTCDay() !== 0) out.push(d);
  }
  return out;
}

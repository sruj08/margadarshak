"use client";

import type { Plan } from "@margdarshak/rules";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCase } from "@/lib/journey/api";
import type { Case } from "@/lib/journey/api-types";
import { toEnginePath } from "@/lib/journey/api-types";
import { istToday, serverToday } from "@/lib/journey/dates";
import type { Answers, FormContext } from "@/lib/journey/form-engine";
import { bandOf, type PlanAnswers, toEngineInput } from "@/lib/journey/plan-model";
import { packs, planOnDevice } from "@/lib/journey/rules";
import { KEYS, readJson, subscribe, writeJson } from "@/lib/journey/storage";
import {
  type ActiveCase,
  cacheCase,
  getCaseFacts,
  setCaseFacts,
  useActiveCase,
  useCachedCase,
} from "./case-store";
import { loadDraft, type SaveStatus, saveAnswers } from "./draft";
import { readVault, type VaultRecord, writeVault } from "./vault";

/**
 * Everything an application screen needs, offline-first: the active case (cached Case from the
 * API), the plan facts behind it, the draft answers (IndexedDB, newer than the server copy), the
 * on-device vault, the plan re-evaluated with the application answers (so blockers like EC-03 show
 * up before hand-off), and the form context for the question engine.
 */

const DOCS = "md.case.docs.v1";
export type DocState = { photo?: "done"; signature?: "done" | "paper" };

export function readDocs(caseId: string): DocState {
  return readJson<Record<string, DocState>>(DOCS, {})[caseId] ?? {};
}

export function writeDocs(caseId: string, d: DocState): void {
  const all = readJson<Record<string, DocState>>(DOCS, {});
  writeJson(DOCS, { ...all, [caseId]: { ...(all[caseId] ?? {}), ...d } });
}

function triFrom(v: unknown): boolean | null {
  return v === "yes" ? true : v === "no" ? false : null;
}

/** Plan facts updated with what the application has learnt (relation line, mobile, address). */
export function factsWithAnswers(facts: PlanAnswers, a: Answers): PlanAnswers {
  const address = a["aadhaar_address_match"];
  return {
    ...facts,
    aadhaar: address === "yes" || address === "no" || address === "none" ? address : facts.aadhaar,
    relationLine:
      a["aadhaar_relation_line"] !== undefined
        ? triFrom(a["aadhaar_relation_line"])
        : (facts.relationLine ?? null),
    mobileLinked:
      a["mobile_linked"] !== undefined ? triFrom(a["mobile_linked"]) : (facts.mobileLinked ?? null),
  };
}

export interface CaseSession {
  ready: boolean;
  active: ActiveCase | null;
  caseData: Case | null;
  facts: PlanAnswers | null;
  answers: Answers;
  vault: VaultRecord;
  plan: Plan | null;
  ctx: FormContext;
  docs: DocState;
  savedAt: string | null;
  saveStatus: SaveStatus | null;
  stale: boolean;
  save: (patch: Answers) => Promise<SaveStatus>;
  saveVault: (values: VaultRecord) => Promise<void>;
  updateFacts: (f: PlanAnswers) => void;
  refresh: () => Promise<void>;
}

export function useDocs(caseId: string | undefined): DocState {
  const [d, setD] = useState<DocState>({});
  useEffect(() => {
    if (!caseId) return;
    setD(readDocs(caseId));
    return subscribe(DOCS, () => setD(readDocs(caseId)));
  }, [caseId]);
  return d;
}

export function useCaseSession(): CaseSession {
  const active = useActiveCase();
  const caseId = active?.caseId;
  const cached = useCachedCase(caseId);
  const [draft, setDraft] = useState<Answers | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultRecord>({});
  const [facts, setFacts] = useState<PlanAnswers | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [stale, setStale] = useState(false);
  const docs = useDocs(caseId);

  const refresh = useCallback(async () => {
    if (!caseId) return;
    try {
      const res = await getCase(caseId);
      cacheCase(res.data);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [caseId]);

  useEffect(() => {
    if (!caseId) {
      setLoaded(true);
      return;
    }
    let live = true;
    setFacts(getCaseFacts(caseId));
    void Promise.all([loadDraft(caseId), readVault(caseId)]).then(([d, v]) => {
      if (!live) return;
      setDraft(d?.answers ?? null);
      setSavedAt(d?.savedAt ?? null);
      setVault(v);
      setLoaded(true);
    });
    void refresh();
    return () => {
      live = false;
    };
  }, [caseId, refresh]);

  const answers: Answers = useMemo(
    () => ({ ...((cached?.answers as Answers | undefined) ?? {}), ...(draft ?? {}) }),
    [cached, draft],
  );

  const plan = useMemo(() => {
    if (!facts) return null;
    try {
      return planOnDevice(
        toEngineInput(factsWithAnswers(facts, answers), serverToday() || istToday()),
      );
    } catch {
      return null;
    }
  }, [facts, answers]);

  const ctx: FormContext = useMemo(() => {
    const path =
      answers["aadhaar_address_match"] === "none" || answers["aadhaar_address_match"] === "no"
        ? "non_aadhaar"
        : plan
          ? (plan.recommended_path as "aadhaar_contactless" | "non_aadhaar")
          : cached?.path
            ? toEnginePath(cached.path)
            : "aadhaar_contactless";
    const band = facts ? bandOf(facts.age, istToday()) : null;
    const minor = band === "16_17" || band === "under_16";
    const form1aNeeded =
      band === "40_plus" || (plan?.classes.some((c) => c.requires.includes("FORM_1A")) ?? false);
    const officeRows = plan
      ? (packs().get(plan.state)?.rules ?? []).filter((r) => r.kind === "office")
      : [];
    const offices = officeRows
      .map((r) => ({
        id: String(r.output["officeId"] ?? r.id),
        name: String(r.output["name"] ?? r.id),
      }))
      .filter((o) => !/csc/i.test(o.id));
    const nonAadhaar = path === "non_aadhaar";
    const documentsDone = nonAadhaar
      ? docs.photo === "done" && docs.signature !== undefined
      : docs.signature !== undefined;
    return { path, minor, form1aNeeded, offices, documentsDone };
  }, [answers, cached, plan, facts, docs]);

  const save = useCallback(
    async (patch: Answers) => {
      if (!caseId) return "local" as SaveStatus;
      setDraft((d) => {
        const next = { ...(d ?? {}), ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      });
      const status = await saveAnswers(caseId, patch);
      setSavedAt(new Date().toISOString());
      setSaveStatus(status);
      return status;
    },
    [caseId],
  );

  const saveVault = useCallback(
    async (values: VaultRecord) => {
      if (!caseId) return;
      await writeVault(caseId, values);
      setVault((v) => ({ ...v, ...values }));
    },
    [caseId],
  );

  const updateFacts = useCallback(
    (f: PlanAnswers) => {
      if (!caseId) return;
      setCaseFacts(caseId, f);
      setFacts(f);
    },
    [caseId],
  );

  return {
    ready: loaded,
    active,
    caseData: cached,
    facts,
    answers,
    vault,
    plan,
    ctx,
    docs,
    savedAt,
    saveStatus,
    stale,
    save,
    saveVault,
    updateFacts,
    refresh,
  };
}

/** Persona chip text for the demo tenant (SCR-061). */
export function readPersona(): string | null {
  return readJson<string | null>(KEYS.persona, null);
}

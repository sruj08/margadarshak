"use client";

import { ApiError, getCase, isOffline, patchCase } from "@/lib/journey/api";
import type { Answers } from "@/lib/journey/form-engine";
import { idbEntries, idbGet, idbSet } from "@/lib/journey/idb";
import { cacheCase, getCachedCase } from "./case-store";

/**
 * Autosave and resume (MD-110 / MD-109 client side, EC-11). Every answer is written to the
 * IndexedDB draft first (nothing is lost if the tab dies or Sarathi or our server is down), then
 * PATCHed to API-12 with the case version (If-Match). If that fails the draft stays "pending" and
 * is replayed when the phone is back online. A version conflict (another device saved first)
 * re-reads the case, re-applies this answer once and reports "conflict" so the page can say so.
 */

export interface Draft {
  answers: Answers;
  savedAt: string;
  pending: boolean;
}

export type SaveStatus = "saved" | "local" | "conflict";

export async function loadDraft(caseId: string): Promise<Draft | null> {
  return (await idbGet<Draft>("drafts", caseId)) ?? null;
}

async function pushToServer(caseId: string, patch: Answers): Promise<SaveStatus> {
  const version = getCachedCase(caseId)?.version;
  try {
    const res = await patchCase(caseId, { answers: patch }, version);
    cacheCase(res.data);
    return res.source === "server" ? "saved" : "local";
  } catch (e) {
    if (e instanceof ApiError && e.status === 412) {
      const fresh = await getCase(caseId);
      cacheCase(fresh.data);
      const res = await patchCase(caseId, { answers: patch }, fresh.data.version);
      cacheCase(res.data);
      return "conflict";
    }
    if (isOffline(e)) return "local";
    throw e;
  }
}

/** Saves answers (merged into the draft). Never throws for network problems. */
export async function saveAnswers(caseId: string, patch: Answers): Promise<SaveStatus> {
  const prev = await loadDraft(caseId);
  const answers: Answers = { ...(prev?.answers ?? {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete answers[k];
  const draft: Draft = { answers, savedAt: new Date().toISOString(), pending: true };
  await idbSet("drafts", caseId, draft);
  let status: SaveStatus = "local";
  try {
    const wire: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) wire[k] = v === undefined ? null : v;
    status = await pushToServer(caseId, wire as Answers);
  } catch {
    status = "local";
  }
  if (status !== "local") await idbSet("drafts", caseId, { ...draft, pending: false });
  return status;
}

/** Replays pending drafts (call on load and on the `online` event). Returns how many synced. */
export async function flushPending(): Promise<number> {
  let n = 0;
  for (const [caseId, d] of await idbEntries<Draft>("drafts")) {
    if (!d.pending) continue;
    try {
      const status = await pushToServer(caseId, d.answers);
      if (status !== "local") {
        await idbSet("drafts", caseId, { ...d, pending: false });
        n++;
      }
    } catch {
      // keep it pending
    }
  }
  return n;
}

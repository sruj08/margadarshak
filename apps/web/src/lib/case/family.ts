"use client";

import { createCase, deleteCase } from "@/lib/journey/api";
import type { VehicleClassCode } from "@/lib/journey/api-types";
import { idbDel, idbSet } from "@/lib/journey/idb";
import { getPlan } from "@/lib/journey/plan-store";
import {
  type ActiveCase,
  cacheCase,
  getCachedCase,
  getCaseFacts,
  setCaseFacts,
} from "./case-store";
import { loadDraft } from "./draft";
import { readDocs, writeDocs } from "./use-case-session";
import { clearVault, readVault, writeVault } from "./vault";

/**
 * Family mode on the server (F-17, D-13 revised). The application starts before we know who it is
 * for, so the first case is the account holder's own. Once the signed-in parent has added the
 * family member and recorded the parental consent, the application moves to a case opened for that
 * member (API-10 with `family_member_id`): the answers, plan facts, on-device vault and document
 * checks move with it, and the stand-in case is deleted (API-17), so the account never keeps a
 * second case for the same application. Returns the new active case, or null when the server
 * could not open it (the device keeps family mode locally and says so).
 */
export async function openMemberCase(
  old: ActiveCase,
  memberId: string,
  memberLabel: string | null,
): Promise<ActiveCase | null> {
  const cached = getCachedCase(old.caseId);
  const facts = getCaseFacts(old.caseId);
  const draft = await loadDraft(old.caseId);
  const plan = getPlan(old.planId);
  const classes = (cached?.classes?.map((c) => c.class_code) ??
    plan?.plan.bundles[0]?.classes ??
    []) as VehicleClassCode[];
  if (classes.length === 0) return null;
  const answers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft?.answers ?? cached?.answers ?? {}))
    if (v !== undefined) answers[k] = v;
  const res = await createCase({
    ...(plan?.serverPlanId ? { plan_id: plan.serverPlanId } : {}),
    state: cached?.tenant ?? (plan?.plan.state as "JK") ?? "JK",
    classes,
    ...(cached?.path ? { path: cached.path } : {}),
    ...(cached?.facts ? { facts: cached.facts } : {}),
    for_family_member: true,
    family_member_id: memberId,
    answers,
  });
  if (res.source !== "server") return null;
  const id = res.data.case_id;
  cacheCase(res.data);
  if (facts) setCaseFacts(id, facts);
  if (draft) await idbSet("drafts", id, { ...draft, pending: false });
  const vault = await readVault(old.caseId);
  if (Object.keys(vault).length > 0) await writeVault(id, vault);
  writeDocs(id, readDocs(old.caseId));
  await deleteCase(old.caseId).catch(() => null);
  await idbDel("drafts", old.caseId);
  await clearVault(old.caseId);
  return { ...old, caseId: id, memberId, memberLabel, minor: true, local: false };
}

"use client";

import type { Issue } from "@margdarshak/rules";
import { useEffect, useState } from "react";
import { API_MODE, serverBlockers } from "@/lib/journey/api";
import { serverIssues } from "@/lib/journey/blockers";
import type { CaseSession } from "./use-case-session";

export type IssuesSource = "server" | "device";

export interface CaseIssues {
  issues: Issue[];
  /** "server": API-13 evaluated the stored case; "device": the same rules ran on this phone. */
  source: IssuesSource;
  /** API-13 says some facts are not answered yet ("we can't tell yet", MD-106). */
  cantTellYet: boolean;
}

/** Blockers and warnings the person should sort out before Sarathi, from the case plan (device). */
export function deviceIssues(s: CaseSession): Issue[] {
  return s.plan ? [...s.plan.blockers, ...s.plan.warnings] : [];
}

/**
 * The case's open issues: from the server (API-13) when the case lives on the server, re-read
 * after every autosave; otherwise (mock mode, a case kept on this phone, offline) the blockers the
 * same rules engine computed on this phone. The source is always shown with the list.
 */
export function useCaseIssues(s: CaseSession): CaseIssues {
  const caseId = s.active && !s.active.local && API_MODE === "real" ? s.active.caseId : null;
  const version = s.caseData?.version ?? 0;
  const [server, setServer] = useState<{
    caseId: string;
    issues: Issue[];
    cantTellYet: boolean;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read after each save (savedAt, version)
  useEffect(() => {
    if (!caseId) return;
    let live = true;
    void serverBlockers(caseId).then((res) => {
      if (!live) return;
      setServer(
        res
          ? { caseId, issues: serverIssues(res), cantTellYet: res.status === "cant_tell_yet" }
          : null,
      );
    });
    return () => {
      live = false;
    };
  }, [caseId, s.savedAt, version]);

  if (caseId && server && server.caseId === caseId) {
    return { issues: server.issues, source: "server", cantTellYet: server.cantTellYet };
  }
  return { issues: deviceIssues(s), source: "device", cantTellYet: false };
}

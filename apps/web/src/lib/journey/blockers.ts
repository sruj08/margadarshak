import type { Issue } from "@margdarshak/rules";
import type { ServerBlocker, ServerBlockers } from "./api";

/**
 * API-13 rows (Blocker schema) as the engine's Issue, so one IssueCard renders both the server's
 * blockers and the ones the same rules engine computed on this phone. The wire severity
 * block / warn / info maps back to blocker / warning / notice; the text key and fix key are the
 * rule-pack keys either way.
 */
const SEVERITY: Record<ServerBlocker["severity"], Issue["severity"]> = {
  block: "blocker",
  warn: "warning",
  info: "notice",
};

export function fromServerBlocker(b: ServerBlocker): Issue {
  const p = b.provenance;
  return {
    rule_id: b.rule_id,
    severity: SEVERITY[b.severity] ?? "notice",
    text_key: b.title_key,
    fix_key: b.fix_key ?? null,
    due_on: b.due_on ?? null,
    refs: b.refs ?? [],
    verify_at_rto: b.verify_at_rto ?? false,
    provenance: {
      source_title: p?.source_title ?? "",
      source_url: p?.source_url ?? "",
      grade: "",
      checked_on: p?.verified_on ?? "",
      confidence: p?.confidence ?? b.confidence,
      verified: p?.verified ?? !b.verify_at_rto,
    },
  };
}

/** The rows the person should sort out before Sarathi (blockers and warnings; notices apart). */
export function serverIssues(res: ServerBlockers): Issue[] {
  return res.blockers.filter((b) => b.severity !== "info").map(fromServerBlocker);
}

/**
 * Journey-test logging (MD-140, F-57, FIELD_STUDY §3.6). One trial = one participant on one
 * system (the lab replica or Margdarshak). Logged automatically: start/end, screens visited,
 * back-navigations, validation errors, selections, typed vs auto-filled fields. No personal data:
 * participants use printed synthetic role cards and a pseudonymous code (P-001).
 * Export: JSON and `journey_sessions.csv` with the exact FIELD_STUDY §3.6 columns; observer-only
 * columns stay empty for the paper sheet.
 */

import { KEYS, newId, readJson, writeJson } from "./storage";

export type TrialSystem = "sarathi_lab" | "margdarshak";

export interface TrialEvent {
  /** ms since the trial started */
  t: number;
  type: "screen" | "back" | "error" | "select" | "typed" | "note";
  id: string;
  value?: string;
}

export interface Trial {
  trial_id: string;
  pid: string;
  cell: string;
  order: 1 | 2;
  system: TrialSystem;
  case: "X" | "Y";
  start_ts: string;
  end_ts: string | null;
  completed: boolean;
  class_correct: boolean | null;
  blockers_found: number | null;
  events: TrialEvent[];
}

const ACTIVE = "md.lab.active.v1";

export function allTrials(): Trial[] {
  return readJson<Trial[]>(KEYS.labLog, []);
}

function saveTrials(list: Trial[]): void {
  writeJson(KEYS.labLog, list);
}

export function activeTrialId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE);
  } catch {
    return null;
  }
}

export function startTrial(meta: Pick<Trial, "pid" | "cell" | "order" | "system" | "case">): Trial {
  const trial: Trial = {
    trial_id: newId("trl"),
    ...meta,
    start_ts: new Date().toISOString(),
    end_ts: null,
    completed: false,
    class_correct: null,
    blockers_found: null,
    events: [],
  };
  saveTrials([...allTrials(), trial]);
  try {
    sessionStorage.setItem(ACTIVE, trial.trial_id);
  } catch {
    // sessionStorage disabled: the trial is still saved, just not auto-continued
  }
  return trial;
}

export function logEvent(
  type: TrialEvent["type"],
  id: string,
  value?: string,
  trialId?: string,
): void {
  const tid = trialId ?? activeTrialId();
  if (!tid) return;
  const list = allTrials();
  const tr = list.find((x) => x.trial_id === tid);
  if (!tr || tr.end_ts) return;
  tr.events.push({
    t: Date.now() - Date.parse(tr.start_ts),
    type,
    id,
    ...(value !== undefined ? { value } : {}),
  });
  saveTrials(list);
}

/** Margdarshak screens call this; it is a no-op unless a lab trial is running in this tab. */
export function recordScreen(id: string): void {
  if (typeof window === "undefined") return;
  const tid = activeTrialId();
  if (!tid) return;
  const tr = allTrials().find((x) => x.trial_id === tid);
  if (tr?.system !== "margdarshak") return;
  logEvent("screen", id);
}

export function endTrial(
  trialId: string,
  result: { completed: boolean; class_correct?: boolean | null; blockers_found?: number | null },
): Trial | null {
  const list = allTrials();
  const tr = list.find((x) => x.trial_id === trialId);
  if (!tr) return null;
  tr.end_ts = new Date().toISOString();
  tr.completed = result.completed;
  tr.class_correct = result.class_correct ?? null;
  tr.blockers_found = result.blockers_found ?? null;
  saveTrials(list);
  try {
    if (sessionStorage.getItem(ACTIVE) === trialId) sessionStorage.removeItem(ACTIVE);
  } catch {
    // ignore
  }
  return tr;
}

export function clearTrials(): void {
  saveTrials([]);
}

/** FIELD_STUDY §3.6 column order, exactly. */
export const CSV_COLUMNS = [
  "pid",
  "cell",
  "order",
  "system",
  "case",
  "t0_real_site_s",
  "t0_wrong_clicks",
  "start_ts",
  "end_ts",
  "time_s",
  "completed",
  "class_correct",
  "path_correct",
  "blockers_found",
  "blockers_planted",
  "full_success",
  "errors_validation",
  "backtracks",
  "screens_visited",
  "help_requests",
  "sus_1",
  "sus_2",
  "sus_3",
  "sus_4",
  "sus_5",
  "sus_6",
  "sus_7",
  "sus_8",
  "sus_9",
  "sus_10",
  "sus_score",
  "date_q_correct",
  "extra_doc_q_correct",
  "pre_agent_yn",
  "pre_agent_max_inr",
  "post_agent_yn",
  "post_agent_max_inr",
  "preferred",
  "quote_text",
  "audio_consent",
  "observer",
  "notes",
] as const;

export function trialSummary(tr: Trial) {
  const screens = tr.events.filter((e) => e.type === "screen");
  const time_s =
    tr.end_ts !== null
      ? Math.round((Date.parse(tr.end_ts) - Date.parse(tr.start_ts)) / 100) / 10
      : null;
  return {
    time_s,
    screens_visited: new Set(screens.map((e) => e.id)).size,
    screen_views: screens.length,
    backtracks: tr.events.filter((e) => e.type === "back").length,
    errors_validation: tr.events.filter((e) => e.type === "error").length,
    selections: tr.events.filter((e) => e.type === "select").length,
    typed_fields: tr.events.filter((e) => e.type === "typed").length,
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(trials: Trial[]): string {
  const rows = trials.map((tr) => {
    const s = trialSummary(tr);
    const row: Record<string, unknown> = {
      pid: tr.pid,
      cell: tr.cell,
      order: tr.order,
      system: tr.system,
      case: tr.case,
      start_ts: tr.start_ts,
      end_ts: tr.end_ts,
      time_s: s.time_s,
      completed: tr.completed,
      class_correct: tr.class_correct,
      blockers_found: tr.blockers_found,
      blockers_planted: 2,
      errors_validation: s.errors_validation,
      backtracks: s.backtracks,
      screens_visited: s.screens_visited,
    };
    return CSV_COLUMNS.map((c) => csvCell(row[c])).join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

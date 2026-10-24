import type { Source } from "./api";
import type { StudyEnrolment } from "./types";

/**
 * Where the participant is in the scripted flow, kept in sessionStorage for this visit so a reload
 * or a quit from a game resumes the same step. Written only after the consent was accepted (a
 * decline or an under-18 answer never reaches here), and holds no personal data: the pseudonymous
 * code, the form, session IDs and the LL quiz score.
 */

export const STEPS = [
  "consent",
  "bands",
  "enrolled",
  "ll",
  "test",
  "feedback",
  "fresh",
  "score",
  "nearmiss",
  "done",
] as const;
export type FlowStep = (typeof STEPS)[number] | "declined" | "under18";

export interface FlowState {
  v: 1;
  step: FlowStep;
  participant?: StudyEnrolment;
  source?: Source;
  consentId?: string | null;
  sids: { ll?: string; test?: string; fresh?: string };
  ll?: { raw: number; max: number } | null;
  startedAt?: number;
}

const KEY = "md.study.flow.v1";

export const initialFlow = (): FlowState => ({ v: 1, step: "consent", sids: {} });

export function loadFlow(): FlowState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as FlowState;
    return s.v === 1 && typeof s.step === "string" ? s : null;
  } catch {
    return null;
  }
}

export function saveFlow(s: FlowState): void {
  if (s.step === "consent" || s.step === "declined" || s.step === "under18") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked: the flow still works until the page is reloaded
  }
}

export function clearFlow(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** 1-based position for "Step n of N" (consent … near-miss; done is past the end). */
export function stepNumber(step: FlowStep): number {
  const i = (STEPS as readonly string[]).indexOf(step);
  return i < 0 ? 1 : i + 1;
}
export const STEP_TOTAL = STEPS.length - 1;

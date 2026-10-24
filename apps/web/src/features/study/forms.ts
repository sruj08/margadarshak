import { FORMS, type StudyForm } from "./types";

/**
 * Counterbalancing (FIELD_STUDY §4.2, DEC-017): forms rotate A → B → C in order of arrival, the
 * same rule as the Go `study.FormFor`. Form A: test B1+B2, fresh B3 · B: test B2+B3, fresh B1 ·
 * C: test B1+B3, fresh B2. `seq` is the 1-based arrival number.
 */
export function formFor(seq: number): StudyForm {
  const i = (((Math.trunc(seq) - 1) % 3) + 3) % 3;
  return FORMS[i] as StudyForm;
}

/** Pseudonymous participant code `P-NNN` (`^P-\d{3,4}$`). */
export function participantCode(seq: number): string {
  return `P-${String(Math.max(1, Math.trunc(seq))).padStart(3, "0")}`;
}

/** Which blocks are test and which is fresh for a form. */
export function formBlocks(form: StudyForm): { test: [string, string]; fresh: string } {
  switch (form) {
    case "A":
      return { test: ["B1", "B2"], fresh: "B3" };
    case "B":
      return { test: ["B2", "B3"], fresh: "B1" };
    default:
      return { test: ["B1", "B3"], fresh: "B2" };
  }
}

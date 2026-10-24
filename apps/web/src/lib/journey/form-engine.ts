/**
 * One-question-per-screen form engine (MD-110, F-05, SCR-030/031).
 *
 * The LL application is a GOV.UK-style task list. Each task is a short run of question pages; a
 * question is shown only when it applies to this case (path, age, family mode), and answers the
 * plan already gave us are carried, never asked again (date of birth is asked once, in the plan).
 * Pure functions only: the page components render whatever this module decides.
 *
 * Answer keys avoid the server's prohibited names (no `name*`, `relation*`, `address*`, `otp`,
 * `aadhaar_number`): personal values go to the on-device vault instead (`vault: true`).
 */

export type TaskId = "about" | "licence" | "route" | "health" | "documents" | "check";
export const TASKS: readonly TaskId[] = [
  "about",
  "licence",
  "route",
  "health",
  "documents",
  "check",
];

export type AnswerValue = string | boolean | null;
export type Answers = Record<string, AnswerValue | undefined>;

export type Path = "aadhaar_contactless" | "non_aadhaar";

export interface FormContext {
  path: Path;
  /** The applicant is 16-17 (or under 16): family mode with parental consent. */
  minor: boolean;
  /** 40 or over, or a transport class: Form 1A is needed. */
  form1aNeeded: boolean;
  /** Offices from the rule pack for the "which office" question (non-Aadhaar path). */
  offices: readonly { id: string; name: string }[];
  /** Photo/signature status from the documents task (on device). */
  documentsDone: boolean;
}

export type QuestionKind = "radio" | "text" | "consent" | "acknowledge";

export interface Question {
  id: string;
  task: TaskId;
  kind: QuestionKind;
  /** Option IDs for radio questions (labels come from messages: apply.q.<id>.o.<option>). */
  options?: readonly string[];
  /** Text fields for `text` questions (each a separate input). */
  fields?: readonly { id: string; inputMode?: "text" | "numeric"; autoComplete?: string }[];
  /** Personal values: stored in the on-device vault, never sent to the server. */
  vault?: boolean;
  /** Shown in the walk-through; false = reachable only from "Check your answers". */
  inFlow?: boolean;
  /** Applies to this case? */
  when?: (a: Answers, c: FormContext) => boolean;
  /** Answer carried from the plan or start screen (not a decision screen). */
  carried?: boolean;
}

const isFamily = (a: Answers) => a["for_whom"] === "family";

export const QUESTIONS: readonly Question[] = [
  // 1 About you
  { id: "for_whom", task: "about", kind: "radio", options: ["self", "family"] },
  {
    id: "member_kind",
    task: "about",
    kind: "radio",
    options: ["child", "parent", "spouse", "sibling", "other"],
    when: (a) => isFamily(a),
  },
  {
    id: "parental_consent",
    task: "about",
    kind: "consent",
    when: (a, c) => c.minor && (isFamily(a) || a["for_whom"] === "self"),
  },
  {
    id: "category",
    task: "about",
    kind: "radio",
    options: [
      "general",
      "divyang",
      "ex_servicemen",
      "foreigner",
      "oci",
      "repatriate",
      "refugee",
      "diplomat",
    ],
  },
  { id: "born_in_india", task: "about", kind: "radio", options: ["yes", "no"], inFlow: false },
  // 2 Your licence
  { id: "classes", task: "licence", kind: "radio", carried: true, inFlow: false },
  { id: "licence_held", task: "licence", kind: "radio", options: ["none", "ll", "dl"] },
  {
    id: "office",
    task: "licence",
    kind: "radio",
    when: (_a, c) => c.path === "non_aadhaar" && c.offices.length > 0,
  },
  // 3 Your address route
  {
    id: "aadhaar_address_match",
    task: "route",
    kind: "radio",
    options: ["yes", "no", "none"],
    carried: true,
    inFlow: false,
  },
  {
    id: "mobile_linked",
    task: "route",
    kind: "radio",
    options: ["yes", "no", "not_sure"],
    when: (a) => a["aadhaar_address_match"] !== "none",
  },
  {
    id: "aadhaar_relation_line",
    task: "route",
    kind: "radio",
    options: ["yes", "no", "not_sure"],
    when: (a) => a["aadhaar_address_match"] !== "none",
  },
  {
    id: "personal",
    task: "route",
    kind: "text",
    vault: true,
    fields: [
      { id: "full_name", autoComplete: "name" },
      { id: "relative_name", autoComplete: "off" },
      { id: "home", autoComplete: "street-address" },
    ],
    when: (_a, c) => c.path === "non_aadhaar",
  },
  // 4 Health declaration
  { id: "form1", task: "health", kind: "acknowledge" },
  {
    id: "form1a",
    task: "health",
    kind: "radio",
    options: ["have", "not_yet"],
    when: (_a, c) => c.form1aNeeded,
  },
];

export function question(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

export function applies(q: Question, a: Answers, c: FormContext): boolean {
  return q.when ? q.when(a, c) : true;
}

/** The question pages a person walks through, in order (carried and change-only ones left out). */
export function flow(a: Answers, c: FormContext): Question[] {
  return QUESTIONS.filter((q) => q.inFlow !== false && !q.carried && applies(q, a, c));
}

export function taskFlow(task: TaskId, a: Answers, c: FormContext): Question[] {
  return flow(a, c).filter((q) => q.task === task);
}

export function isAnswered(q: Question, a: Answers, vault: Record<string, string> = {}): boolean {
  if (q.kind === "text") {
    return (q.fields ?? []).every((f) => (vault[f.id] ?? "").trim().length > 0);
  }
  const v = a[q.id];
  if (q.kind === "consent" || q.kind === "acknowledge") return v === true;
  return typeof v === "string" && v.length > 0;
}

/** Next page after `id`: the next question in the same task, or null (back to the task list). */
export function nextInTask(id: string, a: Answers, c: FormContext): string | null {
  const q = question(id);
  if (!q) return null;
  const list = taskFlow(q.task, a, c);
  const i = list.findIndex((x) => x.id === id);
  return list[i + 1]?.id ?? null;
}

export function prevInTask(id: string, a: Answers, c: FormContext): string | null {
  const q = question(id);
  if (!q) return null;
  const list = taskFlow(q.task, a, c);
  const i = list.findIndex((x) => x.id === id);
  return i > 0 ? (list[i - 1]?.id ?? null) : null;
}

/** "Question 2 of 4" within the task. */
export function positionInTask(id: string, a: Answers, c: FormContext): { i: number; n: number } {
  const q = question(id);
  if (!q) return { i: 0, n: 0 };
  const list = taskFlow(q.task, a, c);
  return { i: Math.max(1, list.findIndex((x) => x.id === id) + 1), n: list.length };
}

export type TaskStatus = "done" | "in_progress" | "not_started" | "locked";

export function taskStatus(
  task: TaskId,
  a: Answers,
  c: FormContext,
  vault: Record<string, string> = {},
): TaskStatus {
  if (task === "documents") return c.documentsDone ? "done" : "not_started";
  if (task === "check") {
    const others = TASKS.filter((t) => t !== "check");
    const allDone = others.every((t) => taskStatus(t, a, c, vault) === "done");
    if (!allDone) return "locked";
    return a["check_confirmed"] === true ? "done" : "not_started";
  }
  const list = taskFlow(task, a, c);
  const answered = list.filter((q) => isAnswered(q, a, vault)).length;
  if (list.length === 0 || answered === list.length) return "done";
  return answered === 0 ? "not_started" : "in_progress";
}

/** The first page still to answer in a task (or the task's first page). */
export function firstOpen(
  task: TaskId,
  a: Answers,
  c: FormContext,
  vault: Record<string, string> = {},
): string | null {
  const list = taskFlow(task, a, c);
  return (list.find((q) => !isAnswered(q, a, vault)) ?? list[0])?.id ?? null;
}

/** The next task to do (the task list's single primary action). */
export function nextTask(
  a: Answers,
  c: FormContext,
  vault: Record<string, string> = {},
): TaskId | null {
  for (const t of TASKS) {
    const s = taskStatus(t, a, c, vault);
    if (s === "not_started" || s === "in_progress") return t;
  }
  return null;
}

export function doneCount(a: Answers, c: FormContext, vault: Record<string, string> = {}): number {
  return TASKS.filter((t) => taskStatus(t, a, c, vault) === "done").length;
}

/** Decision screens a person sees before "Check your answers" (journey-test metric, ~16 -> ~6). */
export function decisionScreens(a: Answers, c: FormContext): number {
  return flow(a, c).length;
}

/** Fields typed vs auto-filled (MD-110 evidence slide). */
export function fieldCounts(a: Answers, c: FormContext): { typed: number; carried: number } {
  const typed = flow(a, c)
    .filter((q) => q.kind === "text")
    .reduce((n, q) => n + (q.fields?.length ?? 0), 0);
  const carried = QUESTIONS.filter((q) => q.carried && applies(q, a, c)).length + 1; // + date of birth
  return { typed, carried };
}

export type FieldError = "choose_one" | "agree_required" | "fill_all" | "no_identity_numbers";

/** Validates a page. `hasIdentityNumber` lets the caller plug in the PII detector (EC-20). */
export function validate(
  q: Question,
  value: AnswerValue | undefined,
  textValues: Record<string, string> = {},
  hasIdentityNumber: (s: string) => boolean = () => false,
): FieldError | null {
  if (q.kind === "radio") return typeof value === "string" && value ? null : "choose_one";
  if (q.kind === "consent" || q.kind === "acknowledge")
    return value === true ? null : "agree_required";
  const fields = q.fields ?? [];
  if (fields.some((f) => !(textValues[f.id] ?? "").trim())) return "fill_all";
  if (fields.some((f) => hasIdentityNumber(textValues[f.id] ?? ""))) return "no_identity_numbers";
  return null;
}

/** Applying an answer can make later answers irrelevant; drop them so nothing stale is shown. */
export function applyAnswer(a: Answers, id: string, value: AnswerValue, c: FormContext): Answers {
  const next: Answers = { ...a, [id]: value };
  for (const q of QUESTIONS) {
    if (q.carried || q.inFlow === false) continue;
    if (!applies(q, next, c) && next[q.id] !== undefined) delete next[q.id];
  }
  // Any change after confirming means the person must confirm again on Check your answers.
  if (id !== "check_confirmed") delete next["check_confirmed"];
  return next;
}

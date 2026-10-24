import type { Issue } from "@margdarshak/rules";
import type { PlanAnswers } from "./plan-model";

/**
 * "I've fixed this" (MD-107): issues tied to a plan answer re-run the plan with the new answer, so
 * the issue disappears only when the rules agree. Issues with no input behind them can be marked
 * as sorted; that mark is keyed to the current answers, so it comes back if the answers change.
 */

export type FixKind =
  | { kind: "answer"; patch: Partial<PlanAnswers>; labelKey: string }
  | { kind: "dob"; labelKey: string }
  | { kind: "dismiss"; labelKey: string };

const BY_RULE: Record<string, FixKind> = {
  "BLK-ADDRESS-MISMATCH": { kind: "answer", patch: { aadhaar: "yes" }, labelKey: "fixedAddress" },
  "JK-B02": { kind: "answer", patch: { aadhaar: "yes" }, labelKey: "fixedAddress" },
  "BLK-RELATION-LINE-BLANK": {
    kind: "answer",
    patch: { relationLine: true },
    labelKey: "fixedRelation",
  },
  "JK-B03": { kind: "answer", patch: { relationLine: true }, labelKey: "fixedRelation" },
  "WRN-MOBILE-NOT-LINKED": {
    kind: "answer",
    patch: { mobileLinked: true },
    labelKey: "fixedMobile",
  },
  "JK-B05": { kind: "answer", patch: { mobileLinked: true }, labelKey: "fixedMobile" },
  "WRN-HOME-TEST-DEVICE": {
    kind: "answer",
    patch: { homeTestDevice: true },
    labelKey: "fixedDevice",
  },
  "JK-B06": { kind: "answer", patch: { homeTestDevice: true }, labelKey: "fixedDevice" },
  "WRN-TEST-VEHICLE": { kind: "answer", patch: { hasTestVehicle: true }, labelKey: "fixedVehicle" },
  "JK-B09": { kind: "answer", patch: { hasTestVehicle: true }, labelKey: "fixedVehicle" },
  "BLK-DOB-YEAR-ONLY": { kind: "dob", labelKey: "fixedDob" },
  "JK-B10": { kind: "dob", labelKey: "fixedDob" },
  "BLK-FORM1A-AGE40": { kind: "dismiss", labelKey: "fixedForm1a" },
  "JK-B04": { kind: "dismiss", labelKey: "fixedForm1a" },
  "WRN-TURNING-40": { kind: "dismiss", labelKey: "fixedForm1a" },
};

/** Age limits cannot be "fixed"; everything else without an input can be marked sorted. */
const NOT_FIXABLE = new Set([
  "BLK-UNDER-16",
  "BLK-TRANSPORT-UNDER-20",
  "WRN-U18-MC50-ONLY",
  "BLK-LL-EXPIRED",
]);

export function fixFor(issue: Issue): FixKind | null {
  if (NOT_FIXABLE.has(issue.rule_id)) return null;
  if (BY_RULE[issue.rule_id]) return BY_RULE[issue.rule_id] as FixKind;
  if (issue.severity === "notice") return null;
  return { kind: "dismiss", labelKey: "fixedGeneric" };
}

/** Hash of the answers a dismissal depends on (a change brings the issue back). */
export function answersHash(a: PlanAnswers): string {
  return JSON.stringify([
    a.age,
    [...a.vehicles].sort(),
    a.state,
    a.aadhaar,
    a.relationLine ?? null,
  ]);
}

export function isDismissed(
  dismissed: Record<string, string> | undefined,
  ruleId: string,
  a: PlanAnswers,
): boolean {
  return dismissed?.[ruleId] === answersHash(a);
}

/** Blockers that stop the application itself (the CTA becomes the fix, never "continue anyway"). */
export function stopsApplication(issues: Issue[], allClassesIneligible: boolean): boolean {
  return allClassesIneligible || issues.some((i) => i.rule_id === "BLK-UNDER-16");
}

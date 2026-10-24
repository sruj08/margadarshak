import type { LlFormat } from "@/features/learn/api-types";
import { planOnDevice, ruleRow, STATE_CODES, todayIST } from "@/lib/journey/rules";

/**
 * The LL test format per state, from the rule packs through the TS rules mirror
 * (`@margdarshak/rules`, conformance-tested against the Go engine) — the same `plan.ll_test` the plan
 * card shows today, plus the format row's provenance (source, checked date, confidence) and its timer.
 * Shaped as API-05 `LlFormat`, so the screens read one type whether the server or the mirror answered.
 * Server-only: pages pass the small result to the client, which keeps the simulator working offline.
 *
 * Unknown format → the rule pack's documented default (15 questions, 9 to pass) with `known: false`;
 * the simulator shows it as a practice format, never as the state's. EC-10: a state whose LL test is
 * only at the RTO has `online_test_available: false` (Kerala).
 */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function llFormatFor(state: string, asOf = todayIST(new Date())): LlFormat {
  const plan = planOnDevice({ as_of: asOf, state, dob: "1995-06-15", vehicles: ["bike_gear"] });
  const ll = plan.ll_test;
  const formatId = ll.rule_ids[1] ?? "PRM-LL-FORMAT";
  const row = ruleRow(formatId);
  const value = (row?.output["value"] ?? {}) as Record<string, unknown>;
  const where = ll.where.filter(
    (w): w is "home_online" | "csc" | "rto" => w === "home_online" || w === "csc" || w === "rto",
  );
  return {
    state,
    rule_id: formatId,
    known: ll.known,
    questions: ll.questions || null,
    pass_correct: ll.pass_correct || null,
    pass_pct: ll.pass_pct || null,
    per_question_timer_s: num(value["timerSeconds"]),
    total_timer_s: num(value["totalTimerSeconds"]),
    online_test_available: ll.online_available,
    where,
    languages: ["en", "hi"],
    provenance: {
      source_title: row?.source.title ?? "",
      source_url: row?.source.url ?? null,
      verified_on: row?.checkedOn ?? null,
      confidence: row?.confidence ?? null,
      verified: ll.verified,
    },
  };
}

export function allLlFormats(): Record<string, LlFormat> {
  const out: Record<string, LlFormat> = {};
  for (const s of STATE_CODES) out[s] = llFormatFor(s);
  return out;
}

export { STATE_CODES };

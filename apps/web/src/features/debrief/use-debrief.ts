"use client";

import { CARD_LABELS, type DebriefCard } from "@margdarshak/game-core/debrief";
import { useEffect, useState } from "react";
import { getServerDebrief } from "@/features/games/api";
import type { DebriefWire } from "@/features/games/api-types";

export type DebriefSource = "template" | "coach";

/** A coach card from API-36, shown only when the server validator passed (DEBRIEF_SPEC §6.3). */
export function coachCard(wire: DebriefWire, template: DebriefCard): DebriefCard | null {
  if (wire.source !== "ai" || wire.status !== "ai_ready" || !wire.validator.passed) return null;
  const locale = template.locale === "en" ? "en" : "hi";
  // The server lists only verified, AI-citable rules (DEBRIEF_SPEC §3); anything else gets no chip.
  const cited = new Map(
    (wire.rules ?? []).filter((r) => r.rule_id).map((r) => [r.rule_id as string, r]),
  );
  const point = (p: DebriefWire["where_you_lacked"][number]) => {
    const r = cited.get(p.rule_id);
    return {
      findingId: p.finding_id,
      ruleId: p.rule_id,
      text: p.text,
      rule: r
        ? {
            id: p.rule_id,
            text: r.text ?? "",
            source_title: r.source_url ?? p.rule_id,
            source_url: r.source_url ?? null,
            verified_on: r.verified_on ?? null,
          }
        : (template.where_you_lacked.find((x) => x.ruleId === p.rule_id)?.rule ?? null),
    };
  };
  return {
    ...template,
    kind: "coach_notes",
    notes_label: CARD_LABELS[locale].coachNotes,
    how_you_did: wire.how_you_did,
    where_you_lacked: wire.where_you_lacked.map(point),
    what_you_could_have_done: wire.what_you_could_have_done.map(point),
    next_drill: {
      ...template.next_drill,
      drillId:
        wire.next_drill.drill_id && /^DR-/.test(wire.next_drill.drill_id)
          ? wire.next_drill.drill_id
          : template.next_drill.drillId,
      why: wire.next_drill.why ?? template.next_drill.why,
    },
    improved_since_last: template.improved_since_last,
  };
}

/**
 * Template first (FRONTEND §8.4): the template card ("Auto notes") is on screen at once. API-36 is
 * asked once; a validated coach card ("Coach notes") replaces it in place. No consent, 404, 202,
 * offline, mock mode or a failed validation all keep the template, with no error shown (EC-29).
 */
export function useDebrief(
  sid: string,
  template: DebriefCard | null,
  enabled: boolean,
): { card: DebriefCard | null; source: DebriefSource } {
  const [coach, setCoach] = useState<DebriefCard | null>(null);
  useEffect(() => {
    if (!enabled || !template) return;
    let alive = true;
    void getServerDebrief(sid).then((r) => {
      if (!alive || r.kind !== "card") return;
      setCoach(coachCard(r.data, template));
    });
    return () => {
      alive = false;
    };
  }, [sid, template, enabled]);
  if (coach) return { card: coach, source: "coach" };
  return { card: template, source: "template" };
}

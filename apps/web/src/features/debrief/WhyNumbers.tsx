"use client";

import type { Finding } from "@margdarshak/game-core/schema";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { sendAIFeedback } from "@/features/ai/api";

const UNIT: Record<string, string> = {
  late_s: "s",
  last_look_s: "s",
  gap_s: "s",
  metres: "m",
  dist_m: "m",
  sight_m: "m",
  predicted_m: "m",
  true_m: "m",
  speed_kmh: "km/h",
  chosen_kmh: "km/h",
  max_safe_kmh: "km/h",
  share_pct: "%",
  brake_heat_pct: "%",
  score_pct: "%",
};

/**
 * "Why these numbers?" (MD-309, DEBRIEF_SPEC §5): the measured facts behind the card, as the
 * scoring code produced them, and the one formula a learner can check by hand. Numbers come from
 * the findings only; the coach never adds any.
 */
export function WhyNumbers({ findings }: { findings: readonly Finding[] }) {
  const t = useTranslations("games");
  const rows = findings.flatMap((f) =>
    Object.entries(f.facts)
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => ({
        id: `${f.findingId}.${k}`,
        finding: f.findingId,
        key: k,
        value: v as number,
      })),
  );
  const hasMetres = findings.some(
    (f) => "late_s" in f.facts && "speed_kmh" in f.facts && "metres" in f.facts,
  );
  return (
    <details className="mg-debrief__why" data-testid="debrief-why">
      <summary className="md-link">{t("debrief.why")}</summary>
      <p className="mg-note">{t("debrief.whyLine")}</p>
      {rows.length === 0 ? (
        <p>{t("debrief.whyNone")}</p>
      ) : (
        <dl className="mg-debrief__facts">
          {rows.map((r) => (
            <div key={r.id}>
              <dt>
                <code>{r.finding}</code> · {r.key.replaceAll("_", " ")}
              </dt>
              <dd data-fact={r.key}>
                {r.value}
                {UNIT[r.key] ? ` ${UNIT[r.key]}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {hasMetres ? <p className="mg-note">{t("debrief.whyMetres")}</p> : null}
    </details>
  );
}

/** Thumbs up/down on a coach card (MD-327 feedback; no free text, nothing personal). */
export function CoachFeedback({ sid }: { sid: string }) {
  const t = useTranslations("games");
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <p className="mg-note" role="status">
        {t("debrief.thanks")}
      </p>
    );
  const send = (helpful: boolean) => {
    setSent(true);
    void sendAIFeedback("debrief", sid, helpful);
  };
  return (
    <p className="mg-debrief__feedback">
      <span>{t("debrief.helpful")}</span>{" "}
      <button
        type="button"
        className="md-link"
        onClick={() => send(true)}
        data-testid="debrief-helpful-yes"
      >
        {t("debrief.helpfulYes")}
      </button>{" "}
      <button
        type="button"
        className="md-link"
        onClick={() => send(false)}
        data-testid="debrief-helpful-no"
      >
        {t("debrief.helpfulNo")}
      </button>
    </p>
  );
}

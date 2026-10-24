"use client";

import { useTranslations } from "next-intl";
import { getSessionRecord } from "@/features/games/results-store";
import type { SessionOutcome } from "@/features/games/types";
import { keralaFormat } from "./format";
import { anyAiScene } from "./origin";

/** Clip marks at or above this pass the clip (GAME_DESIGN §2.7 item pass). */
const CLIP_PASS_MARKS = 6;

/**
 * Nazar lines in the results reveal (UI_SPEC_LEARN_GAMES §4.5, §5.1 mock summary). Every number is
 * code-built from the analysed clips: "You spotted 7 of 9 hazards. 2 were late." For a mock: the
 * pass mark as reported, the calibration chip, and whether the session counts toward the Nazar
 * Score (server-decided; a device session never does). When the clips were AI-generated scenes (each
 * item's `origin`), a line says the result describes those scenes only (ADR-0013 validity limit).
 */
export function NazarResultsExtra({ outcome }: { outcome: SessionOutcome }) {
  const t = useTranslations("nazar");
  const analysis = outcome.checked?.nazar?.analysis ?? [];
  const hazards = analysis.flatMap((c) => c.hazards);
  const spotted = hazards.filter((h) => h.credit > 0).length;
  const late = hazards.filter((h) => (h.late_s ?? 0) > 0).length;
  const mock = outcome.mode === "mock" || outcome.mode === "pair";
  const fmt = keralaFormat();
  const rec = getSessionRecord(outcome.sid);
  let expected: number | null = null;
  if (mock) {
    for (const e of rec?.events ?? []) {
      if (e.type === "confidence" && "predictedPassClips" in e.p) {
        expected = e.p.predictedPassClips;
        break;
      }
    }
  }
  const actual = analysis.filter((c) => c.hazards.length > 0 && c.marks >= CLIP_PASS_MARKS).length;
  return (
    <div className="mg-reveal__extra" data-testid="nazar-results">
      <p className="mg-reveal__skill">{mock ? t("results.skill") : t("results.skillPractice")}</p>
      {hazards.length > 0 ? (
        <p data-testid="nazar-spotted">
          {t("results.spotted", { h: spotted, n: hazards.length, late })}
        </p>
      ) : null}
      {mock ? <p>{t("results.passMark", { pass: fmt.passMark })}</p> : null}
      {mock && expected !== null && analysis.length > 0 ? (
        <p className="mg-chip">{t("results.calib", { expected, actual })}</p>
      ) : null}
      {mock ? (
        <p className="mg-note" data-testid="nazar-counts">
          {outcome.checked?.nazar?.score_eligible ? t("results.counts") : t("results.notCounts")}
        </p>
      ) : null}
      {rec && anyAiScene(rec.items, rec.media) ? (
        <p className="mg-note" data-testid="nazar-ai-results">
          {t("results.aiScenes")}
        </p>
      ) : null}
      <p className="mg-note">{t("notTest")}</p>
    </div>
  );
}

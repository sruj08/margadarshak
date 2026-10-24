"use client";

import { calibrationBins, istWeek, sureAndWrong } from "@margdarshak/gamification";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ratedAnswers } from "@/features/learn/learning";
import { type LogEntry, reviewStore } from "@/features/learn/offline/review-store";
import { LoadingState, OfflineBanner } from "@/features/learn/ui/states";
import { Link } from "@/i18n/navigation";

/**
 * Calibration view (UI_SPEC_LEARN_GAMES §2.6, GAMIFICATION_ENGINE §6). Private to the learner: when
 * you said 50 / 75 / 100 %, how often you were right, over the last 40 rated answers on this phone.
 * The bars are decorative; the table holds the numbers. The Calibrated badge's criterion is shown
 * before it is earned (DP-07).
 */
export function CalibrationView() {
  const t = useTranslations("learnHub.cal");
  const format = useFormatter();
  const [log, setLog] = useState<LogEntry[] | null>(null);

  useEffect(() => {
    void reviewStore()
      .log()
      .then(setLog)
      .catch(() => setLog([]));
  }, []);

  if (!log) return <LoadingState rows={3} />;
  const answers = ratedAnswers(log);
  const bins = calibrationBins(answers);
  const n = bins.reduce((s, b) => s + b.n, 0);
  const week = istWeek(Date.now()).key;
  const thisWeek = log.filter((e) => istWeek(e.reviewedAt).key === week && e.mode !== "mock");
  const k = sureAndWrong(
    thisWeek.map((e) => ({
      correct: e.correct,
      ...(e.confidence ? { confidence: e.confidence } : {}),
    })),
  );

  return (
    <div className="md-stack" data-screen="LRN-006">
      <OfflineBanner />
      {n === 0 ? (
        <p className="md-h3">{t("empty")}</p>
      ) : (
        <table className="ml-table">
          <caption className="md-sr-only">{t("title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("said")}</th>
              <th scope="col">{t("right")}</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b) => (
              <tr key={b.stated}>
                <th scope="row">{t(`bin${b.stated}`)}</th>
                <td>
                  <div className="ml-row">
                    <span className="ml-bar" style={{ width: 96 }} aria-hidden="true">
                      <span style={{ width: `${Math.round((b.accuracy ?? 0) * 100)}%` }} />
                    </span>
                    <span className="ml-num">
                      {b.accuracy === null
                        ? t("none")
                        : format.number(b.accuracy, { style: "percent", maximumFractionDigits: 0 })}
                    </span>
                    {b.accuracy !== null && b.accuracy + 0.1 < b.p ? (
                      <span className="ml-chip ml-chip--warn">▲ {t("overSure")}</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>{t("window", { n })}</p>
      <p>{t("sureWrong", { k })}</p>
      <p className="ml-small">{t("badge")}</p>
      <Link
        href="/learn/review"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {t("cta")}
      </Link>
    </div>
  );
}

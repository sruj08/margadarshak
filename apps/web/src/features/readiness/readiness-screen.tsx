"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getReadiness, type ReadinessView } from "@/features/learn/api";
import type { LlTopicId } from "@/features/learn/content/bank-types";
import { llMocks } from "@/features/learn/mock-api";
import { learnerProfile } from "@/features/learn/profile";
import {
  DeviceNote,
  ErrorState,
  FamilyChip,
  LoadingState,
  OfflineBanner,
} from "@/features/learn/ui/states";
import { Link } from "@/i18n/navigation";
import { getActiveCase, getCachedCase } from "@/lib/case/case-store";
import { BookAnyway } from "./book-anyway";
import { ReadinessDial } from "./readiness-dial";
import { dialLabel, readinessEquation, weakestTopics } from "./readiness-line";

/**
 * Test Readiness (F-21, UI_SPEC_LEARN_GAMES §2.7). Shows the server's number with its arithmetic
 * ("78 = knowledge 84 − calibration 6", built only from API-33 fields), the per-topic mastery, and
 * what would lift it. "Book anyway" is always visible: the 85 gate is a suggestion, not a lock. When
 * the server can't be reached the same screen shows this phone's estimate and says so.
 */

const NODATA_ANSWERS = 20;

export function ReadinessScreen({
  conceptCounts,
  rtoStates,
}: {
  conceptCounts: Record<LlTopicId, number>;
  rtoStates: string[];
}) {
  const t = useTranslations("learnHub.ready");
  const tt = useTranslations("learnHub.topics");
  const format = useFormatter();
  const [view, setView] = useState<ReadinessView | null>(null);
  const [error, setError] = useState(false);
  const [minor, setMinor] = useState(false);
  const [state, setState] = useState("JK");

  const load = useCallback(async () => {
    setError(false);
    try {
      const profile = learnerProfile();
      setMinor(profile.kind === "family_minor");
      const c = getActiveCase();
      const tenant = c ? getCachedCase(c.caseId)?.tenant : undefined;
      if (typeof tenant === "string") setState(tenant);
      setView(await getReadiness(Date.now(), conceptCounts, profile));
    } catch {
      setError(true);
    }
  }, [conceptCounts]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!view) return <LoadingState rows={4} label={t("title")} />;

  const r = view.readiness;
  const nodata =
    view.answered !== null
      ? view.answered < NODATA_ANSWERS
      : r.knowledge === 0 && r.topics.every((x) => x.mastery === 0);
  const eq = readinessEquation(r, (p) => t("eq", p));
  const weak = weakestTopics(r);
  const mocks = llMocks().slice(-2);
  const atRto = rtoStates.includes(state);

  return (
    <div
      className="md-stack"
      data-screen="LRN-007"
      data-testid="readiness-screen"
      data-source={view.source}
    >
      <OfflineBanner />
      {minor ? <FamilyChip holder={null} /> : null}
      <ReadinessDial
        score={r.score}
        gate={r.gate.threshold}
        muted={nodata}
        label={dialLabel(r, (p) => t("dialLabel", p))}
      />
      {nodata ? (
        <p className="md-h3" data-testid="readiness-nodata">
          {t("nodata", { n: NODATA_ANSWERS })}
        </p>
      ) : null}
      <p className="ml-eq" data-testid="readiness-eq">
        {eq}
      </p>
      {view.source === "device" ? <DeviceNote kind="estimate" /> : null}

      <details className="ml-card">
        <summary className="md-link">{t("how")}</summary>
        <p>{t("howKnowledge", { k: r.knowledge })}</p>
        <p>{t("howCal", { c: r.calibration_penalty })}</p>
        <p className="ml-small">{t("weights")}</p>
        <ul className="ml-list">
          <li>
            {r.score >= r.gate.threshold ? "✓" : "○"} {t("gateScore", { g: r.gate.threshold })}
          </li>
          <li>
            {r.topics.every((x) => x.mastery >= 0.7) ? "✓" : "○"} {t("gateTopics")}
          </li>
          <li>
            {r.gate.met ? "✓" : "○"} {t("gateMocks")}
          </li>
        </ul>
      </details>

      <table className="ml-table">
        <caption className="md-sr-only">{t("topicsCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("topic")}</th>
            <th scope="col">{t("mastery")}</th>
          </tr>
        </thead>
        <tbody>
          {r.topics.map((x) => (
            <tr key={x.topic_id}>
              <th scope="row">{tt(x.topic_id as LlTopicId)}</th>
              <td>
                <div className="ml-row">
                  <span className="ml-bar" style={{ width: 96 }} aria-hidden="true">
                    <span style={{ width: `${Math.round(x.mastery * 100)}%` }} />
                  </span>
                  <span className="ml-num">
                    {format.number(x.mastery, {
                      maximumFractionDigits: 2,
                      minimumFractionDigits: 2,
                    })}
                  </span>
                  {x.mastery < 0.7 ? (
                    <span className="ml-chip ml-chip--warn">▲ {t("needsWork")}</span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {mocks.length > 0 ? (
        <p>{t("lastMocks", { list: mocks.map((m) => `${m.correct}/${m.total}`).join(" · ") })}</p>
      ) : null}

      <div className="ml-actions">
        {!r.gate.met ? (
          <Link
            href={weak[0] ? `/learn/review?topic=${weak[0]}` : "/learn/review"}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          >
            {nodata ? t("ctaStart") : t("ctaPractise", { n: weak.length })}
          </Link>
        ) : null}
        <BookAnyway
          score={r.score}
          gateMet={r.gate.met}
          threshold={r.gate.threshold}
          atRto={atRto}
        />
        <Link href="/learn/readiness/calibration" className="md-link">
          {t("calibrationLink")}
        </Link>
      </div>
    </div>
  );
}

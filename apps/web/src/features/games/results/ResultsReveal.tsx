"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useGameA11y } from "../host/a11y-context";
import { NotCountedNote } from "../integrity/NotCountedNote";
import type { SessionOutcome } from "../types";

/** The score to show: the server's once checked, else the device's provisional preview. */
export function shownScore(o: SessionOutcome): { raw: number; max: number; pct: number } | null {
  const c = o.checked;
  if (!c) return null;
  const pct = c.server_checked ? (c.server_score_pct ?? c.score.pct) : c.score.pct;
  return { raw: c.score.raw, max: c.score.max, pct };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Results reveal (UI_SPEC_LEARN_GAMES §4.5): the score counts up (≤ 1.2 s, tap to skip, no count-up
 * with reduced motion), then the skill and the verdict. The server score wins (D-11): a device or
 * verifier-down result says "provisional"; when the check lands later the number moves to the
 * server value with "Score updated after check". Never "FAILED", never a fail sound, no speed praise.
 */
export function ResultsReveal({
  outcome,
  debriefHref,
  exitHref,
  onAgain,
  Extra,
}: {
  outcome: SessionOutcome;
  debriefHref: string | null;
  exitHref: string;
  onAgain: () => void;
  Extra?: ComponentType<{ outcome: SessionOutcome }>;
}) {
  const t = useTranslations("games");
  const { reducedMotion } = useGameA11y();
  const score = shownScore(outcome);
  const target = score?.raw ?? 0;
  const [shown, setShown] = useState(reducedMotion ? target : 0);
  const [updated, setUpdated] = useState(false);
  const firstStatus = useRef(outcome.status);
  const firstRaw = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    if (reducedMotion || target === 0) {
      setShown(target);
      return;
    }
    const from = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 700);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round((from + (target - from) * eased) * 10) / 10);
      if (k < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, reducedMotion]);

  useEffect(() => {
    if (
      outcome.status === "verified" &&
      firstStatus.current !== "verified" &&
      target !== firstRaw.current
    )
      setUpdated(true);
  }, [outcome.status, target]);

  const c = outcome.checked;
  const passed = c?.score.passed ?? null;
  const statusLine =
    outcome.status === "verified"
      ? t("reveal.checked")
      : outcome.status === "queued"
        ? t("reveal.queued")
        : t("reveal.provisional");

  return (
    <section className="mg-reveal" aria-labelledby="reveal-score" data-testid="results-reveal">
      <button
        type="button"
        className="mg-reveal__score"
        onClick={() => setShown(target)}
        data-testid="reveal-score"
        data-status={outcome.status}
      >
        {score ? (
          <>
            <span id="reveal-score" className="mg-reveal__num">
              {fmt(shown)}
            </span>
            <span className="mg-reveal__max">{t("reveal.of", { max: fmt(score.max) })}</span>
          </>
        ) : (
          <span id="reveal-score" className="mg-reveal__none">
            {t("reveal.noScore")}
          </span>
        )}
      </button>
      <p className={`mg-chip mg-chip--${outcome.status}`} data-testid="reveal-status">
        {statusLine}
      </p>
      {updated ? <p className="mg-chip mg-chip--verified">{t("reveal.updated")}</p> : null}
      {passed !== null ? (
        <p className="mg-reveal__verdict">{passed ? t("reveal.passed") : t("reveal.notyet")}</p>
      ) : null}
      {Extra ? <Extra outcome={outcome} /> : null}
      <NotCountedNote trust={c?.server_checked ? c.integrity.trust : null} />
      <p className="md-sr-only" role="status">
        {score ? t("reveal.srScore", { score: fmt(target), max: fmt(score.max) }) : ""}
        {statusLine}
      </p>
      {typeof c?.xp_awarded === "number" && c.xp_awarded > 0 ? (
        <p className="mg-reveal__xp">{t("reveal.xp", { xp: c.xp_awarded })}</p>
      ) : null}
      <div className="mg-reveal__actions">
        {debriefHref && c ? (
          <Link
            href={debriefHref}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="reveal-debrief"
          >
            {t("reveal.debrief")}
          </Link>
        ) : null}
        <button
          type="button"
          className={buttonClassName({ variant: "secondary", fullWidth: true })}
          onClick={onAgain}
        >
          {t("reveal.again")}
        </button>
        <Link href={exitHref} className={buttonClassName({ variant: "ghost", fullWidth: true })}>
          {t("reveal.done")}
        </Link>
      </div>
      <p className="mg-label">{t("label")}</p>
    </section>
  );
}

"use client";

import "./coach.css";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { type AiFailure, aiFailure, type CoachTurn, coachTurn } from "./api";
import { canSpeak, speak, stopSpeaking } from "./speech";

/** One answered question (ll: `<question>:<variant>`) or one hazard (nazar: its hazard type). */
export interface SummaryRow {
  ref: string;
  correct: boolean;
  /** Topic or hazard name in the UI language, for the code-built lines. */
  label: string;
}

export interface SummaryLink {
  href: string;
  label: string;
}

/**
 * End-of-session summary (API-79 `summary`). The counts and the "all right in / mistakes in" lines
 * are built here from the session's own results and always show; the AI coach adds spoken
 * strengths, mistakes and next steps when it can (labelled), and the next-step links are code's.
 */
export function CoachSummary({
  game,
  sessionKey,
  rows,
  links,
}: {
  game: "ll" | "nazar";
  sessionKey: string;
  rows: SummaryRow[];
  links: SummaryLink[];
}) {
  const t = useTranslations("ai.summary");
  const tc = useTranslations("ai.coachTurn");
  const lang = useLocale() === "hi" ? "hi" : "en";
  const [ai, setAi] = useState<CoachTurn | "loading" | AiFailure>("loading");
  const [speaking, setSpeaking] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // biome-ignore lint/correctness/useExhaustiveDependencies: one summary per session
  useEffect(() => {
    let alive = true;
    const results = rowsRef.current.slice(0, 60).map(({ ref, correct }) => ({ ref, correct }));
    if (results.length === 0) {
      setAi("busy");
      return;
    }
    setAi("loading");
    void coachTurn({ kind: "summary", game, results }).then((r) => {
      if (!alive) return;
      setAi(r.ok ? r.data : aiFailure(r));
    });
    return () => {
      alive = false;
      stopSpeaking();
    };
  }, [sessionKey, game]);

  if (rows.length === 0) return null;
  const right = rows.filter((r) => r.correct).length;
  const byLabel = new Map<string, { right: number; wrong: number }>();
  for (const r of rows) {
    const b = byLabel.get(r.label) ?? { right: 0, wrong: 0 };
    if (r.correct) b.right++;
    else b.wrong++;
    byLabel.set(r.label, b);
  }
  const strong = [...byLabel].filter(([, b]) => b.wrong === 0).map(([l]) => l);
  const weak = [...byLabel].filter(([, b]) => b.wrong > 0).map(([l]) => l);
  const coach = typeof ai === "object" ? ai : null;
  const failure = typeof ai === "string" && ai !== "loading" ? ai : null;

  const list = (title: string, items: string[] | undefined) =>
    items && items.length > 0 ? (
      <div className="md-coach__stack">
        <h3 className="md-coach__strong">{title}</h3>
        <ul className="md-coach__list" lang={lang}>
          {items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <section
      className="md-coach"
      data-state={coach ? "ai" : "fallback"}
      data-testid="coach-summary"
      aria-labelledby={`summary-${sessionKey}`}
    >
      <div className="md-coach__row">
        <h2 id={`summary-${sessionKey}`} className="md-coach__strong">
          {t("title")}
        </h2>
        <span className="md-coach__chip">{coach ? t("ai") : t("auto")}</span>
        {coach && canSpeak() ? (
          <button
            type="button"
            className="md-coach__btn"
            onClick={() => {
              if (speaking) {
                stopSpeaking();
                setSpeaking(false);
                return;
              }
              setSpeaking(true);
              speak(coach.say, lang, () => setSpeaking(false));
            }}
          >
            {speaking ? tc("stop") : tc("listen")}
          </button>
        ) : null}
      </div>
      <p className="md-coach__strong" data-testid="coach-summary-score">
        {t("score", { right, total: rows.length })}
      </p>
      {strong.length > 0 ? <p>{t("allRight", { list: strong.join(", ") })}</p> : null}
      {weak.length > 0 ? <p>{t("toWork", { list: weak.join(", ") })}</p> : null}
      {weak.length === 0 && strong.length === 0 ? <p>{t("keepGoing")}</p> : null}

      {ai === "loading" ? (
        <p role="status" className="md-coach__small md-coach__pulse">
          {t("loading")}
        </p>
      ) : coach ? (
        <>
          <p lang={lang} data-testid="coach-summary-say">
            {coach.say}
          </p>
          {list(t("strengths"), coach.strengths)}
          {list(t("mistakes"), coach.mistakes)}
          {list(t("next"), coach.next_steps)}
        </>
      ) : failure ? (
        <p className="md-coach__small">
          {t(`status.${failure}`)}{" "}
          {failure === "signin" ? (
            <Link href="/signin" className="md-coach__btn">
              {tc("signin")}
            </Link>
          ) : failure === "consent" ? (
            <Link href="/privacy" className="md-coach__btn">
              {tc("turnOn")}
            </Link>
          ) : null}
        </p>
      ) : null}
      {links.length > 0 ? (
        <div className="md-coach__row">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="md-coach__btn">
              {l.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

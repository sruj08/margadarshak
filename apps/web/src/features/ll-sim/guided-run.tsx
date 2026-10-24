"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { LlFormat } from "@/features/learn/api-types";
import { LEARN_KEYS, writeKv } from "@/features/learn/offline/kv";
import { Link } from "@/i18n/navigation";
import { examSize } from "./exam-items";

/**
 * Guided first run (UI_SPEC_LEARN_GAMES §3.2): the exam screen with one coach mark at a time — the
 * timer, picking and changing an answer, Next vs Submit, a time-out, the result screen, and the
 * at-home device check, described in text only (no camera, no face match: that happens on Sarathi,
 * D-07). Each tip is a labelled dialog that takes focus, with "Skip tour" always visible.
 */
const TIPS = ["timer", "pick", "next", "timeout", "result", "device"] as const;

export function GuidedRun({ format }: { format: LlFormat }) {
  const t = useTranslations("llSim.guided");
  const te = useTranslations("llSim.exam");
  const [tip, setTip] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const { questions } = examSize(format);
  const name = TIPS[tip] ?? "timer";
  const last = tip === TIPS.length - 1;

  // Each new tip takes focus (the dialog is re-labelled; the ref itself never changes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every tip change
  useEffect(() => {
    card.current?.focus();
  }, [tip]);

  const done = () => writeKv(LEARN_KEYS.guided, true);
  const ring = (k: (typeof TIPS)[number]) =>
    name === k
      ? { outline: "3px solid var(--md-focus)", outlineOffset: 4, borderRadius: 8 }
      : undefined;

  return (
    <div className="md-stack" data-testid="ll-guided">
      <div
        role="dialog"
        aria-labelledby="tip-title"
        aria-describedby="tip-body"
        tabIndex={-1}
        ref={card}
        className="ml-coach"
      >
        <p className="ml-small">{t("count", { i: tip + 1, n: TIPS.length })}</p>
        <h2 id="tip-title" className="md-h3">
          {t(`tips.${name}.title`)}
        </h2>
        <p id="tip-body">{t(`tips.${name}.body`)}</p>
        <div className="ml-row">
          {last ? (
            <Link
              href={`/learn/practise/ll-sim/exam?mode=mock&state=${format.state}`}
              className={buttonClassName({ variant: "primary", size: "lg" })}
              onClick={done}
            >
              {t("finish")}
            </Link>
          ) : (
            <button
              type="button"
              className={buttonClassName({ variant: "primary", size: "lg" })}
              onClick={() => setTip(tip + 1)}
            >
              {t("next")}
            </button>
          )}
          <Link
            href={`/learn/practise/ll-sim?state=${format.state}`}
            className="md-link"
            onClick={done}
          >
            {t("skip")}
          </Link>
        </div>
      </div>

      <div className="ml-card" aria-hidden="true" style={{ opacity: 0.6 }}>
        <div className="ml-exambar">
          <span style={ring("result")}>{te("q", { i: 1, n: questions })}</span>
          <span style={ring("timer")}>{t("timerSample")}</span>
        </div>
        <p className="md-h3">{t("sampleStem")}</p>
        <div className="ml-q" style={ring("pick")}>
          <span className="ml-opt">A. {t("sampleA")}</span>
          <span className="ml-opt">B. {t("sampleB")}</span>
        </div>
        <span
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          style={ring("next") ?? ring("timeout")}
        >
          {te("next")}
        </span>
      </div>
    </div>
  );
}

/** Picks the state's format from `?state=` on the client, so the page stays static. */
export function GuidedRoute({ formats }: { formats: Record<string, LlFormat> }) {
  const state = useSearchParams().get("state") ?? "JK";
  const f = formats[state] ?? formats["JK"];
  return f ? <GuidedRun format={f} /> : null;
}

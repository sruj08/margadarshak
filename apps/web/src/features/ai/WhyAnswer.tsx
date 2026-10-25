"use client";

import "./coach.css";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { type AiFailure, aiFailure, explainAnswer, type TutorExplanation } from "./api";
import { canSpeak, speak, stopSpeaking } from "./speech";

/**
 * "Why?" under a wrong answer (API-41): the tutor's one-line note linking the learner's choice to
 * the right answer when AI help is on, and the reviewed explanation when the screen doesn't show
 * it already (`localText` is the practice key's explanation this phone has, already on screen).
 */
export function WhyAnswer({
  itemId,
  chosenOptionId,
  localText,
}: {
  itemId: string;
  chosenOptionId: string;
  localText: string | null;
}) {
  const t = useTranslations("ai.why");
  const tc = useTranslations("ai.coachTurn");
  const lang = useLocale() === "hi" ? "hi" : "en";
  const [state, setState] = useState<"idle" | "loading" | TutorExplanation | { failed: AiFailure }>(
    "idle",
  );

  const ask = () => {
    setState("loading");
    void explainAnswer(itemId, chosenOptionId).then((r) =>
      setState(r.ok ? r.data : { failed: aiFailure(r) }),
    );
  };

  if (state === "idle")
    return (
      <button type="button" className="md-coach__btn" onClick={ask} data-testid="why-button">
        {t("button")}
      </button>
    );
  if (state === "loading")
    return (
      <p role="status" className="md-coach__small md-coach__pulse">
        {t("loading")}
      </p>
    );

  if ("failed" in state)
    return (
      <div className="md-coach" data-state="fallback" data-testid="why-answer">
        {localText ? null : <p>{t("none")}</p>}
        <p className="md-coach__small">
          {tc(`status.${state.failed}`)}{" "}
          {state.failed === "signin" ? (
            <Link href="/signin" className="md-coach__btn">
              {tc("signin")}
            </Link>
          ) : null}
        </p>
      </div>
    );

  const unknown = state.explanation_id === "UNKNOWN";
  const spoken = [state.glue_text, unknown ? localText : state.reviewed_text]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className="md-coach"
      data-state={state.glue_text ? "ai" : "fallback"}
      data-testid="why-answer"
    >
      {state.glue_text ? (
        <>
          <p className="md-coach__chip">{t("note")}</p>
          <p lang={lang}>{state.glue_text}</p>
        </>
      ) : null}
      {localText ? null : <p lang={lang}>{state.reviewed_text}</p>}
      {state.glue_text ? null : (
        <p className="md-coach__small">
          {tc("status.consent")}{" "}
          <Link href="/privacy" className="md-coach__btn">
            {tc("turnOn")}
          </Link>
        </p>
      )}
      {state.calibration_note && state.calibration_note !== "none" ? (
        <p className="md-coach__small">{t(`calib.${state.calibration_note}`)}</p>
      ) : null}
      {spoken && canSpeak() ? (
        <button
          type="button"
          className="md-coach__btn"
          onClick={() => {
            stopSpeaking();
            speak(spoken, lang);
          }}
        >
          {tc("listen")}
        </button>
      ) : null}
    </div>
  );
}

"use client";

import type { ConfidenceLevel } from "@margdarshak/gamification";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Ride } from "@/components/fx/ride";
import type { BankItem, PracticeKeyEntry } from "../content/bank-types";
import { SignVisual } from "../ui/sign-visual";
import { shuffledOptions } from "../variants";

/**
 * QuestionCard with the confidence rating (UI_SPEC_LEARN_GAMES §2.5, GAME_DESIGN §11.3). In practice
 * mode the learner picks an answer AND says how sure they are (50 / 75 / 100 %) before "Check" is
 * enabled; only then is the feedback shown, so the confidence can never be adjusted after seeing the
 * answer. Feedback is never red: a wrong answer uses the caution tone with a ▲ glyph and words.
 * Keyboard: 1–4 choose an option, Q / W / E choose 50 / 75 / 100, Enter checks.
 */

export interface AnswerEvent {
  optionId: string;
  confidence: ConfidenceLevel;
  latencyMs: number;
  correct: boolean;
}

export interface QuestionCardProps {
  item: BankItem;
  seed: string;
  /** The practice key entry; feedback needs it. */
  answerKey: PracticeKeyEntry | null;
  onAnswered: (a: AnswerEvent) => void;
  onContinue: () => void;
  topicLabel?: string;
  continueLabel?: string;
  now?: () => number;
}

const CONF: readonly ConfidenceLevel[] = ["50", "75", "100"];

export function QuestionCard({
  item,
  seed,
  answerKey,
  onAnswered,
  onContinue,
  topicLabel,
  continueLabel,
  now = () => performance.now(),
}: QuestionCardProps) {
  const t = useTranslations("learnHub.q");
  const id = useId();
  const options = useMemo(() => shuffledOptions(item, seed), [item, seed]);
  const [choice, setChoice] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceLevel | null>(null);
  const [result, setResult] = useState<AnswerEvent | null>(null);
  const shownAt = useRef(now());
  const continueRef = useRef<HTMLButtonElement>(null);

  // A new question resets the card (the parent keys by item too; this keeps timing honest).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the item changes
  useEffect(() => {
    setChoice(null);
    setConfidence(null);
    setResult(null);
    shownAt.current = now();
  }, [item.id]);

  const ready = choice !== null && confidence !== null && result === null;

  const check = () => {
    if (!ready || choice === null || confidence === null) return;
    const ev: AnswerEvent = {
      optionId: choice,
      confidence,
      latencyMs: Math.max(0, Math.round(now() - shownAt.current)),
      correct: answerKey !== null && answerKey.correct === choice,
    };
    setResult(ev);
    onAnswered(ev);
  };

  useEffect(() => {
    if (result) continueRef.current?.focus();
  }, [result]);

  const onKey = (e: React.KeyboardEvent) => {
    if (result) return;
    const k = e.key.toLowerCase();
    const n = Number.parseInt(k, 10);
    if (n >= 1 && n <= options.length) {
      setChoice(options[n - 1]?.id ?? null);
      e.preventDefault();
    } else if (k === "q" || k === "w" || k === "e") {
      setConfidence(CONF[k === "q" ? 0 : k === "w" ? 1 : 2] ?? null);
      e.preventDefault();
    } else if (k === "enter" && ready) {
      check();
      e.preventDefault();
    }
  };

  const chosen = options.find((o) => o.id === result?.optionId);
  const right = options.find((o) => o.id === answerKey?.correct);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts for the radio groups inside
    <div className="ml-q" onKeyDown={onKey} data-testid="question-card" data-item={item.id}>
      {topicLabel ? <p className="ml-chip">{topicLabel}</p> : null}
      {item.visuals.map((v) => (
        <SignVisual key={v.id} visual={v} />
      ))}
      <fieldset disabled={result !== null}>
        <legend id={`${id}-q`} className="md-h3">
          {item.stem}
        </legend>
        {options.map((o, i) => (
          <label
            key={o.id}
            className="ml-opt"
            data-correct={result && o.id === answerKey?.correct ? "true" : undefined}
          >
            <input
              type="radio"
              name={`${id}-opt`}
              value={o.id}
              checked={choice === o.id}
              onChange={() => setChoice(o.id)}
            />
            <span>
              <span className="md-sr-only">{i + 1}. </span>
              {o.text}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={result !== null}>
        <legend className="md-h3">{t("sure")}</legend>
        <div className="ml-conf">
          {CONF.map((c) => (
            <label key={c} className="ml-opt">
              <input
                type="radio"
                name={`${id}-conf`}
                value={c}
                checked={confidence === c}
                onChange={() => setConfidence(c)}
              />
              <span>{t(`conf${c}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {result === null ? (
        <button
          type="button"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          disabled={!ready}
          aria-disabled={!ready}
          onClick={check}
        >
          {t("check")}
        </button>
      ) : (
        <>
          <div
            className="ml-feedback"
            data-tone={result.correct ? "ok" : "warn"}
            role="status"
            data-testid="feedback"
          >
            <Ride
              key={`${item.id}-${result.optionId}`}
              ok={result.correct}
              vehicle={
                [...item.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 2 === 0 ? "bike" : "car"
              }
            />
            <p className="md-h3">{result.correct ? `✓ ${t("right")}` : `▲ ${t("notQuite")}`}</p>
            {!result.correct && chosen ? <p>{t("youChose", { a: chosen.text })}</p> : null}
            {!result.correct && right ? (
              <p>
                <strong>{t("answer", { a: right.text })}</strong>
              </p>
            ) : null}
            {answerKey?.explanation ? <p>{answerKey.explanation}</p> : null}
            {!result.correct && result.confidence === "100" ? <p>{t("overconf")}</p> : null}
            {result.correct && result.confidence === "50" ? <p>{t("underconf")}</p> : null}
          </div>
          <button
            ref={continueRef}
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={onContinue}
          >
            {continueLabel ?? t("continue")}
          </button>
        </>
      )}
    </div>
  );
}

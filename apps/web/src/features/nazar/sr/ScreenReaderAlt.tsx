"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { OfflineNote } from "@/features/games/states";
import { Link } from "@/i18n/navigation";
import { hazardLabel } from "../hazard-labels";
import data from "./placeholder-frames.json";

interface Frame {
  hazard: boolean;
  en: string;
  hi: string;
}
interface Question {
  id: string;
  hazard_type: string;
  scene: { en: string; hi: string };
  frames: Frame[];
}

const QUESTIONS = data.questions as Question[];
const LETTERS = ["A", "B", "C", "D"];

/**
 * Screen-reader alternative (EC-18, D-21, NAZAR §12): still frames with descriptions and "Which of
 * these is developing into a hazard?". Labelled honestly as a different exercise from the timed
 * clips; it never blocks anything, it is untimed and it never counts toward a Nazar Score. Until
 * clips carry their authored `sr_alt_url`, the descriptions are placeholder text (said on screen).
 */
export function ScreenReaderAlt() {
  const t = useTranslations("nazar");
  const locale = useLocale();
  const lang = locale === "hi" ? "hi" : "en";
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [right, setRight] = useState(0);
  const id = useId();
  const done = index >= QUESTIONS.length;
  const q = QUESTIONS[index];

  return (
    <div className="md-page mg-page" data-screen="NAZ-SR" data-testid="nazar-sr">
      <OfflineNote>{t("sr.offline")}</OfflineNote>
      <h1 className="md-h1">{t("sr.title")}</h1>
      <p className="mg-callout" data-testid="sr-label">
        {t("sr.label")}
      </p>
      <p className="mg-note mg-note--ink" data-testid="sr-ai-line">
        {t("sr.aiLine")}
      </p>
      <p className="mg-note mg-note--ink">{t("sr.placeholder")}</p>
      {done || !q ? (
        <section aria-live="polite" data-testid="sr-done">
          <h2 className="md-h2">{t("sr.doneTitle")}</h2>
          <p>{t("sr.doneLine", { right, total: QUESTIONS.length })}</p>
          <Link
            href="/learn/practise/nazar"
            className={buttonClassName({ variant: "primary", size: "lg" })}
          >
            {t("sr.back")}
          </Link>
        </section>
      ) : (
        <section aria-labelledby={`${id}-q`}>
          <p className="mg-note mg-note--ink">
            {t("sr.progress", { n: index + 1, total: QUESTIONS.length })}
          </p>
          <p>{q.scene[lang]}</p>
          <fieldset className="mg-fieldset">
            <legend id={`${id}-q`} className="md-h3">
              {t("sr.question")}
            </legend>
            {q.frames.map((f, i) => (
              <label key={LETTERS[i]} className="mg-choice">
                <input
                  type="radio"
                  name={`${id}-${q.id}`}
                  checked={picked === i}
                  disabled={checked}
                  onChange={() => setPicked(i)}
                  data-testid={`sr-frame-${i}`}
                />
                <span>
                  <span className="mg-choice__label">
                    {t("sr.frame", { letter: LETTERS[i] ?? "" })}
                  </span>
                  <span className="mg-choice__line">{f[lang]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div aria-live="polite" data-testid="sr-feedback">
            {checked && picked !== null ? (
              <p className="mg-callout">
                {q.frames[picked]?.hazard
                  ? t("sr.right", { hazard: hazardLabel(q.hazard_type, locale) })
                  : t("sr.wrong", {
                      letter: LETTERS[q.frames.findIndex((f) => f.hazard)] ?? "",
                      hazard: hazardLabel(q.hazard_type, locale),
                    })}
              </p>
            ) : null}
          </div>
          {checked ? (
            <Button
              variant="primary"
              size="lg"
              onPress={() => {
                setIndex((n) => n + 1);
                setPicked(null);
                setChecked(false);
              }}
              data-testid="sr-next"
            >
              {t("sr.next")}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              isDisabled={picked === null}
              onPress={() => {
                setChecked(true);
                if (picked !== null && q.frames[picked]?.hazard) setRight((r) => r + 1);
              }}
              data-testid="sr-check"
            >
              {t("sr.check")}
            </Button>
          )}
        </section>
      )}
      <p className="mg-label mg-label--ink">{t("notTest")}</p>
    </div>
  );
}

"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { QuestionCoach } from "@/features/ai/QuestionCoach";
import { SD_UI } from "../config";
import { m1, type Round1, stopBreakdown, TEACHING } from "../physics";
import { Stepper, useNum } from "./Stepper";
import { Strip, stripMax } from "./Strip";
import type { RoundProps } from "./types";

/**
 * Round 1, predict then reveal (GAME_DESIGN §3.3-1, UI_SPEC_LEARN_GAMES §5.2): place a marker where
 * you think you'd stop, lock it (`estimate {speedKmh, surface, predictedM}`), then see thinking +
 * braking distance from game-core's `totalStoppingDistance` with both numbers in text.
 */
export function PredictReveal(p: RoundProps<Round1>) {
  const t = useTranslations("sims.sd");
  const num = useNum();
  const [guess, setGuess] = useState<number>(SD_UI.guess.start);
  const [locked, setLocked] = useState(false);
  const { speedKmh, surface } = p.spec;
  const real = stopBreakdown(speedKmh, surface);
  const guessMax = speedKmh > SD_UI.guessLongAboveKmh ? 2 * SD_UI.guess.max : SD_UI.guess.max;
  const maxM = locked ? stripMax(Math.max(real.totalM, guess), guessMax) : guessMax;
  const surfaceWord = surface === "wet" ? t("wet") : t("dry");

  const lock = () => {
    p.emit("estimate", { speedKmh, surface, predictedM: guess });
    setLocked(true);
  };

  return (
    <section className="sd-round" aria-labelledby={`sd-r1-${p.item}`} data-testid="sd-predict">
      <p className="sd-round__kicker">{p.heading}</p>
      <h2 id={`sd-r1-${p.item}`} className="sd-round__title">
        {t("q.where")}
      </h2>
      <p className="sd-round__at" data-testid="sd-at">
        {t("at", { kmh: speedKmh, surface: surfaceWord })}
      </p>
      <Strip
        maxM={maxM}
        surface={surface}
        guessM={guess}
        reactionM={locked ? real.reactionM : null}
        brakingM={locked ? real.brakingM : null}
        bikeM={locked ? real.totalM : 0}
        personM={locked ? real.totalM + SD_UI.tickM : null}
        animate={locked && !p.reducedMotion}
        labels={{
          title: t("strip.title", { kmh: speedKmh, surface: surfaceWord }),
          wet: t("wet"),
          you: t("strip.you"),
          metres: (m) => t("strip.metres", { m }),
        }}
      />
      {p.mode === "learn" ? (
        <p className="sd-round__hint">{t("hint", { rt: num(TEACHING.reactionS) })}</p>
      ) : null}
      {!locked ? (
        <div className="sd-controls">
          <Stepper
            label={t("guessLabel")}
            value={guess}
            min={SD_UI.guess.min}
            max={guessMax}
            steps={[SD_UI.guess.small, SD_UI.guess.big]}
            sliderStep={SD_UI.guess.small}
            unit={(v) => t("metres", { m: num(v) })}
            less={(s) => t("less", { m: s })}
            more={(s) => t("more", { m: s })}
            onChange={setGuess}
            testId="sd-guess"
          />
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={lock}
            data-testid="sd-lock"
          >
            {t("lock")}
          </button>
        </div>
      ) : (
        <div className="sd-reveal" data-testid="sd-reveal">
          <p className="sd-line sd-line--think" data-testid="sd-think">
            {t("think", { m: num(m1(real.reactionM)) })}
          </p>
          <p className="sd-line sd-line--brake" data-testid="sd-brake">
            {t("braking", { m: num(m1(real.brakingM)) })}
          </p>
          <p className="sd-line sd-line--total" data-testid="sd-total" aria-live="polite">
            {t("result1", { g: num(guess), t: num(m1(real.totalM)) })}
          </p>
          <p className="sd-note">
            {t("teaching", {
              rt: num(TEACHING.reactionS),
              mu: num(surface === "wet" ? TEACHING.muWet : TEACHING.muDry),
            })}
          </p>
          {p.mode !== "mock" ? (
            <QuestionCoach
              subject={{
                game: "sim",
                key: `sd1:${p.seed}:${p.item}`,
                sim: {
                  kind: "sd_predict",
                  surface,
                  outcome:
                    guess < real.totalM * 0.85
                      ? "under"
                      : guess > real.totalM * 1.15
                        ? "over"
                        : "close",
                },
              }}
              fallbackText={null}
            />
          ) : null}
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={p.onNext}
            data-testid="sd-next"
          >
            {t("next")}
          </button>
        </div>
      )}
    </section>
  );
}

"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { QuestionCoach } from "@/features/ai/QuestionCoach";
import { SD_UI } from "../config";
import { type Round3, sightDistanceM, sightOutcome, stopBreakdown } from "../physics";
import { Stepper, useNum } from "./Stepper";
import { Strip, stripMax } from "./Strip";
import type { RoundProps } from "./types";

/**
 * Round 3, speed for sight (GAME_DESIGN §3.3-3): a bend with X m of clear road (seeded by
 * game-core `sdSightM`); pick the highest speed you could still stop from and record
 * `speed_choice {chosenKmh, context: "sight"}`. The scorer takes 20% of the item per 5 km/h over the
 * highest safe option and nothing for being under it: a slower choice never costs a point and a
 * faster one is never praised. The reveal states the most you could stop from, never "go faster".
 */
export function SpeedForSight(p: RoundProps<Round3>) {
  const t = useTranslations("sims.sd");
  const num = useNum();
  const [kmh, setKmh] = useState<number>(SD_UI.sightSpeed.start);
  const [done, setDone] = useState(false);
  const surface = p.spec.surface;
  const sightM = sightDistanceM(p.seed, p.item, p.spec);
  const o = sightOutcome(kmh, sightM, surface);
  const real = stopBreakdown(kmh, surface);
  const surfaceWord = surface === "wet" ? t("wet") : t("dry");
  const maxM = stripMax(Math.max(sightM, done ? real.totalM : 0), 0);

  const choose = () => {
    p.emit("speed_choice", { chosenKmh: kmh, context: "sight" });
    setDone(true);
  };

  return (
    <section className="sd-round" aria-labelledby={`sd-r3-${p.item}`} data-testid="sd-sight">
      <p className="sd-round__kicker">{p.heading}</p>
      <h2 id={`sd-r3-${p.item}`} className="sd-round__title" data-testid="sd-choose">
        {t("choose", { x: sightM })}
      </h2>
      <p className="sd-round__at">{t("bend", { surface: surfaceWord })}</p>
      <Strip
        maxM={maxM}
        surface={surface}
        wallM={sightM}
        reactionM={done ? real.reactionM : null}
        brakingM={done ? real.brakingM : null}
        bikeM={done ? Math.min(real.totalM, maxM) : 0}
        animate={done && !p.reducedMotion}
        labels={{
          title: t("strip.sight", { x: sightM, surface: surfaceWord }),
          wet: t("wet"),
          you: t("strip.you"),
          metres: (m) => t("strip.metres", { m }),
        }}
      />
      {!done ? (
        <div className="sd-controls">
          <Stepper
            label={t("speedLabel")}
            value={kmh}
            min={SD_UI.sightSpeed.min}
            max={SD_UI.sightSpeed.max}
            steps={[SD_UI.sightSpeed.step]}
            sliderStep={SD_UI.sightSpeed.step}
            unit={(v) => t("kmh", { kmh: v })}
            less={(s) => t("slower", { kmh: s })}
            more={(s) => t("faster", { kmh: s })}
            onChange={setKmh}
            testId="sd-sight-speed"
          />
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={choose}
            data-testid="sd-ride"
          >
            {t("ride")}
          </button>
        </div>
      ) : (
        <div className="sd-reveal" data-testid="sd-sight-reveal" data-over={o.overKmh > 0}>
          <p className="sd-line">{t("needAt", { kmh, m: num(o.stopM), x: sightM })}</p>
          <p className="sd-line sd-line--total">
            {o.overKmh > 0 ? t("tooFast") : t("withinSight")}
          </p>
          <p className="sd-line" data-testid="sd-max-safe">
            {t("maxSafe", { x: sightM, kmh: o.maxSafeKmh })}
          </p>
          <p className="sd-note">{t("speedNote")}</p>
          {p.mode !== "mock" ? (
            <QuestionCoach
              subject={{
                game: "sim",
                key: `sd3:${p.seed}:${p.item}`,
                sim: {
                  kind: "sd_sight",
                  surface,
                  outcome: o.overKmh > 0 ? "overran" : "within_sight",
                },
              }}
              fallbackText={t("speedNote")}
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

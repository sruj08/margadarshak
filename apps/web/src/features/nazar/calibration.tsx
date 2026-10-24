"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Pre-mock calibration (UI_SPEC_LEARN_GAMES §5.1, 08 §4.5): "How many of the 10 clips do you think
 * you'll pass?" on a 0–N stepper. Recorded as a `confidence { predictedPassClips }` event and
 * compared after the mock (NAZ_OVERCONFIDENT). No default nudging: it starts in the middle.
 */
export function Calibration({ clips, onDone }: { clips: number; onDone: (n: number) => void }) {
  const t = useTranslations("nazar");
  const [n, setN] = useState(Math.round(clips / 2));
  return (
    <div className="mg-panel" data-testid="calibration">
      <p id="calib-q" className="mg-overlay__title">
        {t("calib.q", { n: clips })}
      </p>
      <fieldset className="mg-stepper" aria-labelledby="calib-q">
        <button
          type="button"
          className="mg-stepper__btn"
          aria-label={t("calib.less")}
          onClick={() => setN((v) => Math.max(0, v - 1))}
          disabled={n <= 0}
        >
          <Minus aria-hidden="true" size={22} />
        </button>
        <output className="mg-stepper__value" aria-live="polite" data-testid="calib-value">
          {n}
        </output>
        <button
          type="button"
          className="mg-stepper__btn"
          aria-label={t("calib.more")}
          onClick={() => setN((v) => Math.min(clips, v + 1))}
          disabled={n >= clips}
        >
          <Plus aria-hidden="true" size={22} />
        </button>
      </fieldset>
      <Button variant="primary" size="lg" onPress={() => onDone(n)} data-testid="calib-go">
        {t("calib.go")}
      </Button>
    </div>
  );
}

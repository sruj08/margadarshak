"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";
import type { PartA } from "./geometry";
import { type Placement, usePlacement } from "./placement";
import { SpotButtons } from "./tap-only/SpotButtons";

/**
 * One Part A item: the prompt, the picture (canvas or SVG, from `picture`), the numbered spots and
 * "Place here", then the feedback with the zones shown and "Next position". Emits one
 * `place {zoneProbe}` per prompt, as `scoreBlindSpot` pairs the k-th place with the k-th probe.
 */
export function PartARound(p: {
  spec: PartA;
  seed: number;
  item: number;
  learn: boolean;
  place: (probe: { x: number; y: number }) => void;
  onDone: () => void;
  picture: (pl: Placement) => ReactNode;
  dragHint?: boolean;
}) {
  const t = useTranslations("sims.bs");
  const name = useId();
  const pl = usePlacement({
    spec: p.spec,
    seed: p.seed,
    item: p.item,
    place: p.place,
    onDone: p.onDone,
  });
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (pl.result) feedback.current?.focus();
  }, [pl.result]);
  return (
    <section
      className="bs-round"
      aria-labelledby={`${name}-q`}
      data-testid="bs-part-a"
      data-probe={pl.k}
    >
      <p className="sd-round__kicker">{t("partA", { k: pl.k + 1, n: pl.total })}</p>
      <h2 id={`${name}-q`} className="sd-round__title" data-testid="bs-prompt">
        {t(`prompt.${pl.prompt}`)}
      </h2>
      {p.learn ? <p className="sd-round__hint">{t("rule")}</p> : null}
      <div className="bs-picture">{p.picture(pl)}</div>
      {pl.result === null ? (
        <div className="sd-controls">
          <p className="sd-note">{t("q")}</p>
          <SpotButtons
            spots={pl.spots}
            selected={pl.selected?.n ?? null}
            disabled={false}
            onPick={pl.select}
            name={name}
          />
          {p.dragHint ? <p className="sd-note">{t("dragHint")}</p> : null}
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            disabled={!pl.canCommit}
            onClick={pl.commit}
            data-testid="bs-place"
          >
            {t("place")}
          </button>
        </div>
      ) : (
        <div className="sd-reveal" data-testid="bs-feedback" data-correct={pl.result.correct}>
          <p ref={feedback} tabIndex={-1} className="sd-line sd-line--total" role="status">
            {pl.result.correct ? t("cansee") : t("cantsee")}
          </p>
          <p className="sd-note">{t("rule")}</p>
          <p className="sd-note">{t("zonesNote")}</p>
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={pl.next}
            data-testid="bs-next"
          >
            {pl.k + 1 < pl.total ? t("nextPos") : t("next")}
          </button>
        </div>
      )}
    </section>
  );
}

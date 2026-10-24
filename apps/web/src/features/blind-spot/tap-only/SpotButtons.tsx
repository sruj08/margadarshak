"use client";

import { useTranslations } from "next-intl";
import type { Spot } from "../geometry";

/**
 * Part A tap-only control (GAME_DESIGN §4.5, UI_SPEC_LEARN_GAMES §5.3): the eight numbered spots as
 * a radio group, each named by where it is around the vehicle. No drag needed.
 */
export function SpotButtons(p: {
  spots: readonly Spot[];
  selected: number | null;
  disabled: boolean;
  onPick(s: Spot): void;
  name: string;
}) {
  const t = useTranslations("sims.bs");
  return (
    <fieldset className="bs-spots" disabled={p.disabled} data-testid="bs-spots">
      <legend className="md-sr-only">{t("spotsLegend")}</legend>
      {p.spots.map((s) => (
        <label key={s.n} className={`bs-spot${p.selected === s.n ? " bs-spot--on" : ""}`}>
          <input
            type="radio"
            name={p.name}
            value={s.n}
            checked={p.selected === s.n}
            onChange={() => p.onPick(s)}
            className="md-sr-only"
            data-testid={`bs-spot-${s.n}`}
          />
          <span aria-hidden="true" className="bs-spot__n">
            {s.n}
          </span>
          <span className="md-sr-only">{t(`spot.${s.key}`, { n: s.n })}</span>
        </label>
      ))}
    </fieldset>
  );
}

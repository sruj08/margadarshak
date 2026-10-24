"use client";

import { Pause } from "lucide-react";
import { useTranslations } from "next-intl";
import type { HudState } from "../types";

/**
 * HUD top bar (UI_SPEC_LEARN_GAMES §4.2): 48 px on --road at 88%, item counter, skill tag and a
 * 48 × 48 Pause (top-left in the left-handed layout). No score and no countdown during play.
 */
export function GameHud({
  hud,
  onPause,
  leftHanded,
  paused,
}: {
  hud: HudState;
  onPause: () => void;
  leftHanded: boolean;
  paused: boolean;
}) {
  const t = useTranslations("games");
  const pause = (
    <button
      type="button"
      className="mg-hud__btn"
      onClick={onPause}
      aria-label={t("hud.pause")}
      aria-disabled={paused}
      data-testid="hud-pause"
    >
      <Pause aria-hidden="true" size={22} strokeWidth={2} />
    </button>
  );
  return (
    <div className={`mg-hud${leftHanded ? " mg-hud--left" : ""}`} data-testid="game-hud">
      {leftHanded ? pause : null}
      {hud.counter ? (
        <span className="mg-hud__counter">
          <span aria-hidden="true">
            {hud.counter.current}/{hud.counter.total}
          </span>
          <span className="md-sr-only">
            {t("hud.counter", { current: hud.counter.current, total: hud.counter.total })}
          </span>
        </span>
      ) : null}
      {hud.tag ? <span className="mg-hud__tag">{hud.tag}</span> : <span />}
      {leftHanded ? null : pause}
    </div>
  );
}

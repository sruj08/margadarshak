"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { LanePos } from "../ride";

export interface LaneButtonsProps {
  pos: LanePos;
  holding: boolean;
  disabled: boolean;
  onMove(dir: -1 | 1): void;
  onCentre(): void;
  onMirror(): void;
  onHold(): void;
  leftHanded?: boolean;
}

/**
 * Part B tap-only control (GAME_DESIGN §4.5, UI_SPEC_LEARN_GAMES §5.3): Move left / Centre / Move
 * right (3 × 56 px), Mirror check and Hold back, all in the bottom of the screen; keyboard ← ↓ → M H.
 * No drag, hold or tilt. "Move left" from the left of your lane goes into the gap on the truck's
 * left, which is the position the critical fault is about.
 */
export function LaneButtons(p: LaneButtonsProps) {
  const t = useTranslations("sims.bs.ride");
  const { disabled, onMove, onCentre, onMirror, onHold } = p;
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const act =
        key === "arrowleft"
          ? () => onMove(-1)
          : key === "arrowright"
            ? () => onMove(1)
            : key === "arrowdown"
              ? onCentre
              : key === "m"
                ? onMirror
                : key === "h"
                  ? onHold
                  : null;
      if (!act) return;
      e.preventDefault();
      act();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, onMove, onCentre, onMirror, onHold]);

  return (
    <div className={`bs-lanes${p.leftHanded ? " bs-lanes--left" : ""}`} data-testid="bs-lanes">
      <p className="bs-lanes__pos" aria-live="polite" data-testid="bs-pos">
        {t("legend")}: {t(`pos.${p.pos}`)}
      </p>
      <div className="bs-lanes__row">
        <button
          type="button"
          className="bs-btn"
          disabled={disabled}
          onClick={() => onMove(-1)}
          data-testid="bs-move-left"
        >
          <span aria-hidden="true">◀ </span>
          {t("moveLeft")}
        </button>
        <button
          type="button"
          className="bs-btn"
          disabled={disabled}
          onClick={onCentre}
          data-testid="bs-centre"
        >
          {t("centre")}
        </button>
        <button
          type="button"
          className="bs-btn"
          disabled={disabled}
          onClick={() => onMove(1)}
          data-testid="bs-move-right"
        >
          {t("moveRight")}
          <span aria-hidden="true"> ▶</span>
        </button>
      </div>
      <div className="bs-lanes__row">
        <button
          type="button"
          className="bs-btn"
          disabled={disabled}
          onClick={onMirror}
          data-testid="bs-mirror"
        >
          {t("mirror")}
        </button>
        <button
          type="button"
          className={`bs-btn${p.holding ? " bs-btn--on" : ""}`}
          aria-pressed={p.holding}
          disabled={disabled}
          onClick={onHold}
          data-testid="bs-hold"
        >
          {p.holding ? t("holding") : t("hold")}
        </button>
      </div>
    </div>
  );
}

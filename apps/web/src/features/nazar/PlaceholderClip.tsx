"use client";

import { useTranslations } from "next-intl";

/**
 * Stand-in for a clip while no clip media is published (mock mode). A deterministic road whose
 * centre dashes move with media time, the same for every clip: it shows nothing about where a
 * hazard is, so a mock never leaks a window. Always labelled as a placeholder.
 */
export function PlaceholderClip({ mt, reducedMotion }: { mt: number; reducedMotion: boolean }) {
  const t = useTranslations("nazar");
  // Dashes scroll 40 px per second of media time (static with reduced motion).
  const offset = reducedMotion ? 0 : (mt / 25) % 40;
  return (
    <div className="mg-clip mg-clip--placeholder" data-testid="placeholder-clip">
      <svg viewBox="0 0 360 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="360" height="240" fill="#1f2127" />
        <rect y="0" width="360" height="96" fill="#2f3440" />
        <polygon points="150,96 210,96 360,240 0,240" fill="#3a3d45" />
        <line
          x1="180"
          y1="96"
          x2="180"
          y2="240"
          stroke="#e8e6df"
          strokeWidth="4"
          strokeDasharray="14 26"
          strokeDashoffset={-offset}
        />
      </svg>
      <span className="mg-clip__label">{t("play.placeholder")}</span>
    </div>
  );
}

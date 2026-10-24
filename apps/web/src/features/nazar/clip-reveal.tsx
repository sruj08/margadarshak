"use client";

import { bandFor, patternVoids } from "@margdarshak/game-core/scoring";
import { Button } from "@margdarshak/ui/components/button";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { HazardWindowWire } from "@/features/games/api-types";
import { hazardLabel } from "./hazard-labels";
import { ReplayScrubber } from "./replay/ReplayScrubber";
import { WindowBand } from "./replay/WindowBand";

export interface HazardFeedback {
  hazardId: string;
  hazardType: HazardWindowWire["hazard_type"];
  band: 1 | 2 | 3 | 4 | 5 | null;
  points: number;
  early: boolean;
}

export interface ClipFeedback {
  pattern: boolean;
  hazards: HazardFeedback[];
  falseAlarms: number;
}

/**
 * Per-clip feedback from the reveal windows and this clip's taps, with game-core's own band and
 * pattern functions (the same numbers the scorer uses; the server replay still decides the score).
 */
export function clipFeedback(
  windows: readonly HazardWindowWire[],
  taps: readonly number[],
): ClipFeedback {
  const sorted = [...taps].sort((a, b) => a - b);
  const pattern = patternVoids(sorted, sorted.length, windows.length);
  const order = [...windows].sort(
    (x, y) => x.a_ms - y.a_ms || (x.hazard_id < y.hazard_id ? -1 : 1),
  );
  const credited = new Map<string, number>();
  for (const tau of sorted) {
    const h = order.find((w) => !credited.has(w.hazard_id) && w.a_ms <= tau && tau <= w.b_ms);
    if (h) credited.set(h.hazard_id, tau);
  }
  const hazards = windows.map((w) => {
    const tau = pattern ? undefined : credited.get(w.hazard_id);
    const band = tau === undefined ? null : bandFor(tau, w.a_ms, w.b_ms);
    return {
      hazardId: w.hazard_id,
      hazardType: w.hazard_type,
      band,
      points: band === null ? 0 : 6 - band,
      early: sorted.some((x) => x >= w.a_ms - 1000 && x < w.a_ms),
    };
  });
  const near = (x: number) => windows.some((w) => x >= w.a_ms - 1000 && x <= w.b_ms);
  return { pattern, hazards, falseAlarms: pattern ? 0 : sorted.filter((x) => !near(x)).length };
}

/**
 * Practice/learn per-clip reveal (UI_SPEC_LEARN_GAMES §5.1, GAME_DESIGN §2.3): the 5-band strip
 * per hazard with the learner's ring, the points (labelled with points, not just "early/late"),
 * a template teaching note, and an immediate replay of the clip timeline with the hatched window
 * band and the tap flags.
 */
export function ClipReveal({
  windows,
  taps,
  durationMs,
  voided,
  locale,
  isLast,
  reducedMotion,
  onNext,
}: {
  windows: readonly HazardWindowWire[];
  taps: readonly number[];
  durationMs: number;
  voided: "hidden" | "stalled" | null;
  locale: string;
  isLast: boolean;
  reducedMotion: boolean;
  onNext: () => void;
}) {
  const t = useTranslations("nazar");
  const [replaying, setReplaying] = useState(false);
  const fb = clipFeedback(windows, taps);
  return (
    <div className="mg-panel mg-panel--wide" data-testid="clip-reveal">
      {voided ? (
        <p className="mg-overlay__title">
          {voided === "stalled" ? t("play.stalled") : t("reveal.voided")}
        </p>
      ) : fb.pattern ? (
        <p className="mg-overlay__title" data-testid="reveal-pattern">
          {t("reveal.pattern")}
        </p>
      ) : null}
      {fb.hazards.map((h) => (
        <div key={h.hazardId} className="mg-hazard">
          <p className="mg-hazard__points">{t("reveal.points", { p: voided ? 0 : h.points })}</p>
          <ol className="mg-strip" aria-label={t("reveal.stripLabel")}>
            {[1, 2, 3, 4, 5].map((b) => (
              <li key={b} className="mg-strip__cell">
                <span>{6 - b}</span>
                {h.band === b && !voided ? (
                  <span className="mg-strip__ring" aria-hidden="true" />
                ) : null}
              </li>
            ))}
          </ol>
          <p>{h.band !== null && !voided ? t("reveal.band", { b: h.band }) : t("reveal.missed")}</p>
          {h.early && h.band === null && !voided ? (
            <p className="mg-note">{t("reveal.early")}</p>
          ) : null}
          <p className="mg-note">
            {t("reveal.teach", { hazard: hazardLabel(h.hazardType, locale) })}
          </p>
        </div>
      ))}
      {windows.length === 0 ? <p>{t("reveal.quiet")}</p> : null}
      {!voided && !fb.pattern ? (
        <p className="mg-note">{t("reveal.falseAlarms", { n: fb.falseAlarms })}</p>
      ) : null}
      {replaying ? (
        <ReplayScrubber
          durationMs={durationMs}
          windows={windows.map((w) => ({ hazardId: w.hazard_id, aMs: w.a_ms, bMs: w.b_ms }))}
          taps={taps}
          reducedMotion={reducedMotion}
          autoPlayFromMs={0}
        />
      ) : (
        <WindowBand
          durationMs={durationMs}
          windows={windows.map((w) => ({ hazardId: w.hazard_id, aMs: w.a_ms, bMs: w.b_ms }))}
          taps={taps}
        />
      )}
      <div className="mg-sheet-actions">
        <Button variant="primary" size="lg" onPress={onNext} data-testid="reveal-next">
          {isLast ? t("play.finish") : t("play.nextClip")}
        </Button>
        {!replaying ? (
          <Button variant="ghost" onPress={() => setReplaying(true)} data-testid="reveal-watch">
            {t("play.watchAgain")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

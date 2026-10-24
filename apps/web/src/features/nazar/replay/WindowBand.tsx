"use client";

import { useTranslations } from "next-intl";

export interface BandWindow {
  hazardId: string;
  aMs: number;
  bMs: number;
}

const pct = (ms: number, dur: number) => `${Math.max(0, Math.min(100, (ms / dur) * 100))}%`;
const sec = (ms: number) => (ms / 1000).toFixed(1);

/**
 * The clip timeline with the scoring window (UI_SPEC_LEARN_GAMES §1.1 game colour rule): the
 * window is a sky-blue band with vertical stripes, split into its five bands and labelled
 * "Window"; each tap is an amber ring labelled "You". Shape, pattern and word carry the meaning,
 * never colour alone. A text equivalent lists the times for screen readers.
 */
export function WindowBand({
  durationMs,
  windows,
  taps,
  playheadMs,
}: {
  durationMs: number;
  windows: readonly BandWindow[];
  taps: readonly number[];
  playheadMs?: number | null;
}) {
  const t = useTranslations("games");
  const dur = Math.max(1, durationMs);
  return (
    <figure className="mg-band" data-testid="window-band">
      <div className="mg-band__track" aria-hidden="true">
        {windows.map((w) => (
          <span
            key={w.hazardId}
            className="mg-band__window"
            style={{ left: pct(w.aMs, dur), width: pct(w.bMs - w.aMs, dur) }}
          >
            {[1, 2, 3, 4].map((k) => (
              <span key={k} className="mg-band__div" style={{ left: `${k * 20}%` }} />
            ))}
          </span>
        ))}
        {taps.map((mt, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: taps never reorder
            key={i}
            className="mg-band__tap"
            style={{ left: pct(mt, dur) }}
          />
        ))}
        {playheadMs != null ? (
          <span className="mg-band__head" style={{ left: pct(playheadMs, dur) }} />
        ) : null}
      </div>
      <figcaption className="mg-band__legend">
        <span className="mg-band__key mg-band__key--window">{t("replay.window")}</span>
        <span className="mg-band__key mg-band__key--tap">{t("replay.you")}</span>
      </figcaption>
      <p className="md-sr-only">
        {windows.map((w) => t("replay.srWindow", { a: sec(w.aMs), b: sec(w.bMs) })).join(" ")}{" "}
        {taps.length === 0
          ? t("replay.missed")
          : t("replay.srTaps", { taps: taps.map((m) => sec(m)).join(", ") })}
      </p>
    </figure>
  );
}

"use client";

import { Button } from "@margdarshak/ui/components/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiSceneChip } from "../AiSceneChip";
import type { ClipOrigin } from "../origin";
import { PlaceholderClip } from "../PlaceholderClip";
import { type BandWindow, WindowBand } from "./WindowBand";

const FRAME_MS = 1000 / 30;

/**
 * Replay of one clip (UI_SPEC_LEARN_GAMES §6.3): the clip (real video, or the labelled
 * placeholder), the timeline with the hatched window and the learner's taps, "Play from 2 s
 * before" (onset − 2 s to onset + 2 s) and frame-by-frame steps (buttons and the , and . keys).
 * Nothing here is recorded: a replay is never scored. A real clip carries the "AI-generated scene"
 * chip (ADR-0013) unless `origin` says it was filmed; the placeholder keeps its own label.
 */
export function ReplayScrubber({
  durationMs,
  windows,
  taps,
  reducedMotion,
  onsetMs,
  assetUrl,
  autoPlayFromMs,
  origin,
}: {
  durationMs: number;
  windows: readonly BandWindow[];
  taps: readonly number[];
  reducedMotion: boolean;
  onsetMs?: number;
  /** A real clip URL (blob or media host); absent = placeholder. */
  assetUrl?: string;
  autoPlayFromMs?: number;
  /** clip.json `origin` from the API; only an AI-generated scene carries the AI label. */
  origin?: ClipOrigin;
}) {
  const t = useTranslations("games");
  const [head, setHead] = useState<number>(onsetMs ?? 0);
  const [stopAt, setStopAt] = useState<number | null>(null);
  const raf = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    videoRef.current?.pause();
    setStopAt(null);
  }, []);

  const play = useCallback((from: number, to: number) => {
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    setHead(from);
    setStopAt(to);
    const v = videoRef.current;
    if (v) {
      v.currentTime = from / 1000;
      void v.play().catch(() => {});
    }
    const tick = (now: number) => {
      const ms = v ? v.currentTime * 1000 : from + (now - start);
      if (ms >= to) {
        setHead(to);
        v?.pause();
        setStopAt(null);
        return;
      }
      setHead(ms);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (autoPlayFromMs !== undefined) play(autoPlayFromMs, durationMs);
    return () => cancelAnimationFrame(raf.current);
  }, [autoPlayFromMs, durationMs, play]);

  const step = (dir: -1 | 1) => {
    stop();
    setHead((h) => {
      const next = Math.max(0, Math.min(durationMs, h + dir * FRAME_MS));
      if (videoRef.current) videoRef.current.currentTime = next / 1000;
      return next;
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ",") step(-1);
    if (e.key === ".") step(1);
  };

  const onset = onsetMs ?? windows[0]?.aMs ?? 0;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: , and . step frames inside the replay region
    <div className="mg-replay" onKeyDown={onKey} data-testid="replay-scrubber">
      {assetUrl && origin === "ai_generated" ? (
        <div>
          <AiSceneChip />
        </div>
      ) : null}
      {assetUrl ? (
        <video
          ref={videoRef}
          className="mg-clip"
          src={assetUrl}
          muted
          playsInline
          preload="auto"
          aria-label={t("replay.videoLabel")}
        />
      ) : (
        <PlaceholderClip mt={head} reducedMotion={reducedMotion} />
      )}
      <WindowBand durationMs={durationMs} windows={windows} taps={taps} playheadMs={head} />
      <div className="mg-replay__controls">
        <Button
          variant="secondary"
          onPress={() => play(Math.max(0, onset - 2000), Math.min(durationMs, onset + 2000))}
          data-testid="replay-play"
        >
          {stopAt !== null ? t("replay.playing") : t("replay.play")}
        </Button>
        <fieldset className="mg-replay__frames" aria-label={t("replay.frame")}>
          <button
            type="button"
            className="mg-hud__btn mg-hud__btn--ink"
            onClick={() => step(-1)}
            aria-label={t("replay.prev")}
          >
            <ChevronLeft aria-hidden="true" size={22} />
          </button>
          <button
            type="button"
            className="mg-hud__btn mg-hud__btn--ink"
            onClick={() => step(1)}
            aria-label={t("replay.nextFrame")}
          >
            <ChevronRight aria-hidden="true" size={22} />
          </button>
        </fieldset>
      </div>
    </div>
  );
}

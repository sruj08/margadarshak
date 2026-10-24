"use client";

import { Button } from "@margdarshak/ui/components/button";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { clockTime, FPS, framesTotal, frameToMs } from "./rules";

export interface ScrubBand {
  key: string;
  aMs: number;
  bMs: number;
  label: string;
  tone?: "a" | "b" | "final" | "ai";
}

export interface FrameScrubberProps {
  durationMs: number;
  /** Signed URL of the blurred rendition; absent (or `placeholder`) draws the labelled placeholder. */
  mediaUrl?: string | undefined;
  placeholder: boolean;
  frame: number;
  onFrame: (frame: number) => void;
  /** Every frame put on screen, as an inclusive range (the blur audit counts these as checked). */
  onShown?: (from: number, to: number) => void;
  speeds?: readonly number[];
  defaultSpeed?: number;
  bands?: readonly ScrubBand[];
  /** Fraction 0–1 per frame bucket, drawn under the track (blur audit coverage). */
  coverage?: readonly number[];
}

/**
 * Frame-accurate scrubber for the curator screens (UI_SPEC_LEARN_GAMES §12.2–§12.3): the clip (a
 * real `<video>` of the blurred rendition, or a clearly labelled placeholder in mock mode), a
 * timeline with hatched bands, buttons for ±1 / ±10 frames, play at a chosen speed, and the keys
 * `,` `.` (one frame) and Space (play / pause). Time is media time at 30 fps.
 */
export function FrameScrubber({
  durationMs,
  mediaUrl,
  placeholder,
  frame,
  onFrame,
  onShown,
  speeds = [0.25, 0.5, 1, 4],
  defaultSpeed = 1,
  bands = [],
  coverage,
}: FrameScrubberProps) {
  const t = useTranslations("curator");
  const id = useId();
  const total = framesTotal(durationMs);
  const last = total - 1;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(defaultSpeed);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const raf = useRef(0);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const shownRef = useRef(onShown);
  shownRef.current = onShown;
  const useVideo = !placeholder && !!mediaUrl;

  const go = useCallback(
    (f: number) => {
      const next = Math.max(0, Math.min(last, Math.round(f)));
      onFrame(next);
      shownRef.current?.(next, next);
    },
    [last, onFrame],
  );

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const startFrame = frameRef.current >= last ? 0 : frameRef.current;
    const t0 = performance.now();
    let prev = startFrame;
    const v = videoRef.current;
    if (useVideo && v) {
      v.playbackRate = speed;
      v.currentTime = startFrame / FPS;
      void v.play().catch(() => {});
    }
    setPlaying(true);
    onFrame(startFrame);
    shownRef.current?.(startFrame, startFrame);
    const tick = (now: number) => {
      const f =
        useVideo && v
          ? Math.floor(v.currentTime * FPS)
          : startFrame + Math.floor(((now - t0) / 1000) * FPS * speed);
      const clamped = Math.min(last, f);
      if (clamped > prev) {
        shownRef.current?.(prev + 1, clamped);
        prev = clamped;
        onFrame(clamped);
      }
      if (clamped >= last) {
        stop();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [last, onFrame, speed, stop, useVideo]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Paused: keep the video on the chosen frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!useVideo || !v || playing) return;
    const target = frame / FPS;
    if (Math.abs(v.currentTime - target) > 0.5 / FPS) v.currentTime = target;
  }, [frame, playing, useVideo]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === ",") {
      e.preventDefault();
      stop();
      go(frameRef.current - 1);
    } else if (e.key === ".") {
      e.preventDefault();
      stop();
      go(frameRef.current + 1);
    } else if (e.key === " ") {
      e.preventDefault();
      if (playing) stop();
      else play();
    }
  };

  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / durationMs) * 100))}%`;
  const ms = frameToMs(frame);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys are a shortcut; every action has a button
    <div className="cu-scrub" onKeyDown={onKey} data-testid="frame-scrubber">
      <div className="cu-scrub__media">
        {useVideo ? (
          <video
            ref={videoRef}
            className="cu-scrub__video"
            src={mediaUrl}
            muted
            playsInline
            preload="auto"
            aria-label={t("scrubber.label")}
          />
        ) : (
          <PlaceholderFrame frame={frame} total={total} label={t("scrubber.placeholder")} />
        )}
      </div>
      <p className="cu-scrub__time" aria-live="off" data-testid="scrub-time">
        {t("scrubber.time", {
          time: clockTime(ms),
          total: clockTime(durationMs),
          frame: frame + 1,
          frames: total,
        })}
      </p>
      <div className="cu-track" aria-hidden="true">
        {coverage ? (
          <div className="cu-track__coverage">
            {coverage.map((c, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed buckets of the timeline
                key={i}
                style={{ opacity: c > 0 ? 0.25 + 0.75 * c : 0 }}
              />
            ))}
          </div>
        ) : null}
        {bands.map((b) => (
          <span
            key={b.key}
            className={`cu-band cu-band--${b.tone ?? "a"}`}
            style={{ left: pct(b.aMs), width: pct(Math.max(0, b.bMs - b.aMs)) }}
            title={b.label}
          />
        ))}
        <span className="cu-track__head" style={{ left: pct(ms) }} />
      </div>
      {bands.length > 0 ? (
        <ul className="cu-bandlist">
          {bands.map((b) => (
            <li key={b.key}>
              <span className={`cu-swatch cu-band--${b.tone ?? "a"}`} aria-hidden="true" />
              {b.label}: {clockTime(b.aMs)} – {clockTime(b.bMs)}
            </li>
          ))}
        </ul>
      ) : null}
      <label className="cu-field" htmlFor={`${id}-frame`}>
        <span className="md-sr-only">{t("scrubber.frame")}</span>
        <input
          id={`${id}-frame`}
          className="cu-range"
          type="range"
          min={0}
          max={last}
          step={1}
          value={frame}
          aria-valuetext={clockTime(ms)}
          onChange={(e) => {
            stop();
            go(Number(e.currentTarget.value));
          }}
          data-testid="scrub-range"
        />
      </label>
      <div className="cu-scrub__controls">
        <Button
          variant="ghost"
          isIconOnly
          aria-label={t("scrubber.back10")}
          onPress={() => {
            stop();
            go(frame - 10);
          }}
        >
          <ChevronsLeft aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          isIconOnly
          aria-label={t("scrubber.back1")}
          onPress={() => {
            stop();
            go(frame - 1);
          }}
          data-testid="scrub-back1"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          isIconOnly
          aria-label={playing ? t("scrubber.pause") : t("scrubber.play")}
          onPress={() => (playing ? stop() : play())}
          data-testid="scrub-play"
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          isIconOnly
          aria-label={t("scrubber.fwd1")}
          onPress={() => {
            stop();
            go(frame + 1);
          }}
          data-testid="scrub-fwd1"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          isIconOnly
          aria-label={t("scrubber.fwd10")}
          onPress={() => {
            stop();
            go(frame + 10);
          }}
        >
          <ChevronsRight aria-hidden="true" />
        </Button>
        <label className="cu-speed" htmlFor={`${id}-speed`}>
          <span>{t("scrubber.speed")}</span>
          <select
            id={`${id}-speed`}
            className="cu-select cu-select--sm"
            value={speed}
            onChange={(e) => {
              stop();
              setSpeed(Number(e.currentTarget.value));
            }}
            data-testid="scrub-speed"
          >
            {speeds.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="cu-hint">{t("scrubber.keys")}</p>
    </div>
  );
}

/**
 * Mock-mode stand-in for the blurred rendition: a synthetic road scene that changes every frame,
 * always labelled as a placeholder, so the scrubber and the audit can be exercised without media.
 */
function PlaceholderFrame({
  frame,
  total,
  label,
}: {
  frame: number;
  total: number;
  label: string;
}) {
  const p = total > 1 ? frame / (total - 1) : 0;
  const dash = (frame * 6) % 40;
  return (
    <div className="cu-ph" data-testid="placeholder-media">
      <svg viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill="#1d2430" />
        <polygon points="110,70 210,70 320,180 0,180" fill="#3a4250" />
        <line
          x1="160"
          y1="70"
          x2="160"
          y2="180"
          stroke="#e8e2c8"
          strokeWidth="3"
          strokeDasharray="12 28"
          strokeDashoffset={-dash}
        />
        <rect
          x={40 + p * 220}
          y={96 - p * 10}
          width={34 + p * 10}
          height={20 + p * 6}
          rx="4"
          fill="#8a96a8"
        />
        <text
          x="160"
          y="40"
          textAnchor="middle"
          fill="#ffffff"
          fontSize="18"
          fontFamily="monospace"
        >
          {String(frame + 1).padStart(4, "0")} / {total}
        </text>
      </svg>
      <span className="cu-ph__label">{label}</span>
    </div>
  );
}

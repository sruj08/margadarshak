"use client";

import type { HazardType, NazarClip } from "@margdarshak/game-core/schema";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebGameModule, WebGameProps } from "@/features/games/types";
import { AiSceneChip } from "./AiSceneChip";
import { Calibration } from "./calibration";
import { ClipReveal } from "./clip-reveal";
import { hazardLabel } from "./hazard-labels";
import { predictionOptions } from "./hazards";
import { type FreezePoint, freezePoints, PredictionPanel } from "./learn-mode";
import { type ClipMedia, placeholderMedia, supportsRvfc, videoMedia } from "./media";
import { type ClipOrigin, clipOrigin } from "./origin";
import { PlaceholderClip } from "./PlaceholderClip";
import { preloadAll, waitPlayable } from "./preload";
import type { ScenePlan } from "./scene3d/choreo";
import { plansForSession } from "./scene3d/resolve";
import { prewarmRich, RICH } from "./scene3d/rich/rich";
import { Scene3D, sceneAvailable } from "./scene3d/Scene3D";
import { isTapKey, type Ring, tapPoint } from "./taps";

type Phase =
  | { k: "idle" }
  | { k: "calibrate" }
  | { k: "between"; i: number }
  | { k: "clip"; i: number }
  | { k: "predict"; i: number; fp: FreezePoint; options: HazardType[]; mt: number }
  | { k: "reveal"; i: number; taps: number[]; voided: "hidden" | "stalled" | null }
  | { k: "done" };

/**
 * The Nazar player (G1, GAME_DESIGN §2, NAZAR §1–§2, EC-18).
 *
 *  - init: every clip is fetched in full before Start (no scoring while buffering);
 *  - mock (Kerala's announced format): the pre-mock calibration, then the clips with no feedback
 *    between them (results only at the end);
 *  - practice: after each clip, the reveal with the 5-band strip and an immediate replay of the
 *    timeline with the hatched window and tap flags;
 *  - learn: the clip freezes 0.5 s before each onset (from the practice `reveal` windows) for
 *    "what happens next?" (a `prediction` event), then "Tap where";
 *  - taps anywhere, Space or any key; an amber ring marks each tap (no ripple with reduced motion).
 */
export function NazarPlayer(props: WebGameProps) {
  const { ctx, session, recorder, a11y, paused } = props;
  const t = useTranslations("nazar");
  const locale = useLocale();
  const n = session.items.length;
  const mode = ctx.mode;
  const kerala = mode === "mock" || mode === "pair";
  const showReveal = mode === "practice" || mode === "learn";

  const [phase, setPhaseState] = useState<Phase>({ k: "idle" });
  const [mt, setMt] = useState(0);
  const [rings, setRings] = useState<Ring[]>([]);
  const [voidNote, setVoidNote] = useState<"hidden" | "stalled" | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);

  const phaseRef = useRef<Phase>(phase);
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const mediaRef = useRef<ClipMedia | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const blobsRef = useRef<Blob[]>([]);
  const urlsRef = useRef<string[]>([]);
  const tapsRef = useRef<number[]>([]);
  const freezeRef = useRef<{ points: FreezePoint[]; next: number }>({ points: [], next: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ringId = useRef(0);
  // Simulated 3D scenes (NAZAR §17): one plan per clip, drawn from media time in mtRef.
  const plansRef = useRef<ScenePlan[] | null>(null);
  const mtRef = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;

  const deviceClips: readonly NazarClip[] =
    session.deviceContent?.gameId === "nazar" ? session.deviceContent.clips : [];
  const durationOf = useCallback(
    (i: number): number => {
      const c = deviceClips[i];
      const plan = plansRef.current?.[i];
      if (plan) return plan.durationMs;
      if (c) return c.durationMs;
      const v = videoRef.current;
      if (v && Number.isFinite(v.duration)) return Math.round(v.duration * 1000);
      const hz = session.items[i]?.reveal?.hazards ?? [];
      return Math.max(10_000, ...hz.map((h) => h.b_ms + 2000));
    },
    [deviceClips, session.items],
  );
  const refOf = useCallback(
    (i: number) => ctx.items[i]?.ref ?? session.items[i]?.item_ref ?? "",
    [ctx.items, session.items],
  );

  const stopMedia = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    mediaRef.current?.pause();
  }, []);

  const goNext = useCallback(
    (i: number) => {
      if (i + 1 < n) setPhase({ k: "between", i: i + 1 });
      else {
        setPhase({ k: "done" });
        propsRef.current.onEnd("completed");
      }
    },
    [n, setPhase],
  );

  const endClip = useCallback(
    (i: number, reason: "done" | "voided", why: "hidden" | "stalled" | null = null) => {
      const media = mediaRef.current;
      const at = reason === "done" ? durationOf(i) : (media?.clock.currentMs() ?? 0);
      stopMedia();
      recorder.emit("item_end", { ref: refOf(i), reason }, { item: i, mt: at });
      propsRef.current.setCurrentItem(null, false);
      mediaRef.current = null;
      if (showReveal) {
        setPhase({ k: "reveal", i, taps: [...tapsRef.current], voided: why });
      } else {
        setVoidNote(why);
        goNext(i);
      }
    },
    [durationOf, goNext, recorder, setPhase, showReveal, stopMedia, refOf],
  );

  const freeze = useCallback(
    (i: number, fp: FreezePoint) => {
      const media = mediaRef.current;
      if (!media) return;
      media.pause();
      const at = media.clock.currentMs();
      // The stop for the question is a system pause, so the clock-drift check subtracts it.
      recorder.emit("pause", { cause: "system" }, { item: i });
      setPhase({
        k: "predict",
        i,
        fp,
        mt: at,
        options: predictionOptions(ctx.seed, i, fp.k, fp.hazardType),
      });
    },
    [ctx.seed, recorder, setPhase],
  );

  const onFrame = useCallback(
    (i: number, ms: number) => {
      mtRef.current = ms;
      // The 3D scene reads mtRef itself; re-rendering the whole player every frame is for the timeline only.
      if (!plansRef.current) setMt(ms);
      const p = phaseRef.current;
      if (p.k !== "clip" || p.i !== i) return;
      const f = freezeRef.current;
      const fp = f.points[f.next];
      if (fp && ms >= fp.freezeMs) {
        freeze(i, fp);
        return;
      }
      if (ms >= durationOf(i)) endClip(i, "done");
    },
    [durationOf, endClip, freeze],
  );

  const startClip = useCallback(
    async (i: number) => {
      setVoidNote(null);
      tapsRef.current = [];
      setRings([]);
      mtRef.current = 0;
      setMt(0);
      freezeRef.current = {
        points: mode === "learn" ? freezePoints(session.items[i]?.reveal) : [],
        next: 0,
      };
      let media: ClipMedia;
      if (session.media === "video") {
        const url = urlsRef.current[i] ?? null;
        setClipUrl(url);
        await new Promise((r) => requestAnimationFrame(r));
        const v = videoRef.current;
        if (!v) return;
        await waitPlayable(v);
        media = videoMedia(v, Math.round(v.duration * 1000));
      } else {
        media = placeholderMedia(durationOf(i));
      }
      mediaRef.current = media;
      setPhase({ k: "clip", i });
      recorder.emit("item_start", { ref: refOf(i) }, { item: i, mt: 0 });
      propsRef.current.setCurrentItem(i, true);
      const first = session.items[i]?.reveal?.hazards[0];
      propsRef.current.setHud({
        counter: { current: i + 1, total: n },
        tag: mode === "learn" && first ? hazardLabel(first.hazard_type, locale) : null,
      });
      media.play();
      unsubRef.current = media.clock.onFrame((ms) => onFrame(i, ms));
    },
    [durationOf, locale, mode, n, onFrame, recorder, session.items, session.media, setPhase, refOf],
  );

  // The module is created once per mounted player; it reads live state through refs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one module per mounted player
  const module = useMemo<WebGameModule>(
    () => ({
      timingMode: session.media === "video" && supportsRvfc() ? "rvfc" : "fallback",
      async init() {
        const list = session.items.map((it) => ({
          url: it.asset_url ?? "",
          ...(it.bytes ? { bytes: it.bytes } : {}),
          ...(it.sha256 && session.media === "video" ? { sha256: it.sha256 } : {}),
        }));
        if (list.some((c) => c.url === "")) throw new Error("clip without media");
        blobsRef.current = await preloadAll(list, {
          onProgress: (p) => propsRef.current.reportProgress({ ...p, unit: "bytes" }),
        });
        if (session.media === "placeholder" && sceneAvailable())
          plansRef.current = await plansForSession(session.items, deviceClips);
        for (const plan of plansRef.current ?? []) {
          const theme = RICH[plan.row.id];
          if (theme) prewarmRich(theme);
        }
        if (session.media === "video")
          urlsRef.current = blobsRef.current.map((b) => URL.createObjectURL(b));
      },
      start() {
        setPhase(kerala ? { k: "calibrate" } : { k: "between", i: 0 });
      },
      pause() {
        mediaRef.current?.pause();
      },
      resume() {
        const p = phaseRef.current;
        if (p.k === "clip") mediaRef.current?.play();
        // The host's resume closed the question's system pause: open it again until answered.
        if (p.k === "predict") recorder.emit("pause", { cause: "system" }, { item: p.i });
      },
      onItemVoided() {
        const p = phaseRef.current;
        if (p.k === "clip" || p.k === "predict") endClip(p.i, "voided", "hidden");
      },
      end() {
        const p = phaseRef.current;
        if (p.k === "clip" || p.k === "predict") {
          stopMedia();
          recorder.emit("item_end", { ref: refOf(p.i), reason: "voided" }, { item: p.i });
        }
      },
      getPreview: () => null,
      destroy() {
        stopMedia();
        for (const u of urlsRef.current) URL.revokeObjectURL(u);
        urlsRef.current = [];
      },
    }),
    [],
  );

  useEffect(() => props.register(module), [module, props.register]);

  const tap = useCallback(
    (x: number, y: number) => {
      const p = phaseRef.current;
      const media = mediaRef.current;
      if (p.k !== "clip" || !media || propsRef.current.paused) return;
      const at = media.clock.currentMs();
      const e = recorder.emit("tap", { x, y }, { item: p.i, mt: at });
      if (e) tapsRef.current.push(at);
      const id = ++ringId.current;
      setRings((r) => [...r.slice(-5), { id, x, y }]);
      window.setTimeout(() => setRings((r) => r.filter((z) => z.id !== id)), 600);
    },
    [recorder],
  );

  // Space or any key = a tap while a clip runs (switch access, desktop judges).
  useEffect(() => {
    if (phase.k !== "clip") return;
    const onKey = (e: KeyboardEvent) => {
      if (!isTapKey(e)) return;
      e.preventDefault();
      tap(0.5, 0.5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.k, tap]);

  // Video stalls after the whole-file preload are rare; if one happens the clip is voided.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || session.media !== "video") return;
    const onStall = () => {
      const p = phaseRef.current;
      if (p.k === "clip") endClip(p.i, "voided", "stalled");
    };
    v.addEventListener("waiting", onStall);
    v.addEventListener("stalled", onStall);
    return () => {
      v.removeEventListener("waiting", onStall);
      v.removeEventListener("stalled", onStall);
    };
  }, [endClip, session.media]);

  const p = phase;
  const clipVisible = p.k === "clip" || p.k === "predict";
  const hint = hintKey(p, freezeRef.current.next > 0, kerala);
  const hintText = hint ? t(hint) : null;
  // ADR-0013: every AI-generated clip is labelled on screen (null for the placeholder timeline).
  const originOf = (i: number): ClipOrigin | null => clipOrigin(session.items[i], session.media);
  return (
    <div className="mg-nazar" data-testid="nazar-player" data-phase={p.k}>
      {session.media === "video" ? (
        <video
          ref={videoRef}
          className="mg-clip"
          src={clipUrl ?? undefined}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          controls={false}
          hidden={!clipVisible}
        />
      ) : null}
      {clipVisible ? (
        <TapSurface
          media={session.media}
          mt={mt}
          origin={originOf(p.i)}
          reducedMotion={a11y.reducedMotion}
          plan={sceneFailed ? null : (plansRef.current?.[p.i] ?? null)}
          mtRef={mtRef}
          onSceneFail={() => setSceneFailed(true)}
          rings={rings}
          hint={hintText}
          label={t("play.zoneLabel")}
          onTap={tap}
        />
      ) : null}
      {paused && clipVisible ? <div className="mg-dim" aria-hidden="true" /> : null}

      {p.k === "calibrate" ? (
        <div className="mg-overlay">
          <Calibration
            clips={n}
            onDone={(v) => {
              recorder.emit("confidence", { predictedPassClips: v });
              setPhase({ k: "between", i: 0 });
            }}
          />
        </div>
      ) : null}

      {p.k === "between" ? (
        <BetweenCard
          index={p.i}
          total={n}
          kerala={kerala}
          origin={originOf(p.i)}
          voidNote={voidNote}
          onStart={() => void startClip(p.i)}
        />
      ) : null}

      {p.k === "predict" ? (
        <div className="mg-overlay mg-overlay--top">
          <PredictionPanel
            key={`${p.i}:${p.fp.k}`}
            options={p.options}
            truth={p.fp.hazardType}
            locale={locale}
            onAnswer={(choice) => recorder.emit("prediction", { choice }, { item: p.i, mt: p.mt })}
            onContinue={() => {
              recorder.emit("resume", { cause: "system" }, { item: p.i });
              freezeRef.current.next += 1;
              setPhase({ k: "clip", i: p.i });
              mediaRef.current?.play();
            }}
          />
        </div>
      ) : null}

      {p.k === "reveal" ? (
        <div className="mg-overlay mg-overlay--scroll">
          <ClipReveal
            windows={session.items[p.i]?.reveal?.hazards ?? []}
            taps={p.taps}
            durationMs={durationOf(p.i)}
            voided={p.voided}
            coachKey={`${ctx.sid}:${p.i}`}
            locale={locale}
            isLast={p.i + 1 >= n}
            reducedMotion={a11y.reducedMotion}
            onNext={() => goNext(p.i)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The clip area: the placeholder (or the video behind it), the tap rings, one hint line, and a
 * transparent full-size button on top whose name is the instruction and whose content is empty. */
function TapSurface({
  media,
  mt,
  origin,
  reducedMotion,
  plan,
  mtRef,
  onSceneFail,
  rings,
  hint,
  label,
  onTap,
}: {
  media: "video" | "placeholder";
  mt: number;
  origin: ClipOrigin | null;
  reducedMotion: boolean;
  plan: ScenePlan | null;
  mtRef: MutableRefObject<number>;
  onSceneFail: () => void;
  rings: readonly Ring[];
  hint: string | null;
  label: string;
  onTap: (x: number, y: number) => void;
}) {
  return (
    <div className={`mg-tapwrap${media === "video" ? " mg-tapwrap--over" : ""}`}>
      {media === "placeholder" && plan ? (
        <Scene3D plan={plan} mtRef={mtRef} reducedMotion={reducedMotion} onFail={onSceneFail} />
      ) : media === "placeholder" ? (
        <PlaceholderClip mt={mt} reducedMotion={reducedMotion} />
      ) : null}
      {origin === "ai_generated" ? <AiSceneChip variant="overlay" /> : null}
      {rings.map((r) => (
        <span
          key={r.id}
          className={`mg-ring${reducedMotion ? "" : " mg-ring--ripple"}`}
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
          aria-hidden="true"
        />
      ))}
      {hint ? <span className="mg-status">{hint}</span> : null}
      <button
        type="button"
        className="mg-tapzone"
        aria-label={label}
        data-testid="tap-zone"
        onPointerDown={(e) => {
          const pt = tapPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          onTap(pt.x, pt.y);
        }}
      />
    </div>
  );
}

/** Between clips: "Clip n of N", a voided-clip note, and Start (no feedback in a mock). */
function BetweenCard({
  index,
  total,
  kerala,
  origin,
  voidNote,
  onStart,
}: {
  index: number;
  total: number;
  kerala: boolean;
  origin: ClipOrigin | null;
  voidNote: "hidden" | "stalled" | null;
  onStart: () => void;
}) {
  const t = useTranslations("nazar");
  return (
    <div className="mg-overlay" data-testid="clip-between">
      <p className="mg-overlay__title">{t("play.clipOf", { n: index + 1, total })}</p>
      {origin === "ai_generated" ? <AiSceneChip /> : null}
      {voidNote ? (
        <p className="mg-note">{voidNote === "stalled" ? t("play.stalled") : t("reveal.voided")}</p>
      ) : null}
      {index === 0 ? <p>{t("play.tapHint")}</p> : null}
      {kerala ? <p className="mg-note">{t("play.mockNoFeedback")}</p> : null}
      <Button variant="primary" size="lg" onPress={onStart} data-testid="clip-start">
        {t("play.startClip")}
      </Button>
    </div>
  );
}

/** The one hint line under a running clip: "Tap where" after a learn freeze, else the first-clip
 * hint outside a mock. */
function hintKey(p: Phase, froze: boolean, kerala: boolean) {
  if (p.k !== "clip") return null;
  if (froze) return "learn.whereHint" as const;
  return p.i === 0 && !kerala ? ("play.tapHint" as const) : null;
}

"use client";

import type { GameEvent, GameId, GameMode, SessionContext } from "@margdarshak/game-core/schema";
import {
  createEventRecorder,
  type EventRecorder,
  SessionLifecycle,
} from "@margdarshak/game-core/sdk";
import {
  createQueueSink,
  endQueuedSession,
  type QueueSink,
  queueSession,
} from "@margdarshak/game-core/sdk/browser";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { GameApiError, type PublicDocResolver, setGamesApiLocale, startGameSession } from "../api";
import type { GameSessionCreate } from "../api-types";
import { GameHud } from "../hud/GameHud";
import { PauseSheet } from "../hud/PauseSheet";
import { loadWebGame, UnknownGameError } from "../registry";
import { ResultsReveal } from "../results/ResultsReveal";
import {
  getSessionRecord,
  type SessionRecord,
  saveSessionRecord,
  subscribeSessionRecords,
} from "../results-store";
import type {
  DeviceItems,
  GameA11y,
  HostSession,
  HudState,
  SessionOutcome,
  StudyForm,
  WebGame,
  WebGameLoader,
  WebGameModule,
} from "../types";
import { a11yModes, currentA11y, GameA11yProvider, useGameA11y } from "./a11y-context";
import { deviceClass } from "./game-host";
import { useOnline } from "./online";
import { queueStore, syncPending } from "./queue";
import { bindHostVisibility } from "./visibility";

export interface GameStageProps {
  gameId: GameId;
  mode: GameMode;
  /** A drill from a debrief's next step (narrows item selection). */
  drillId?: string;
  difficulty?: number | null;
  /** Field-study phase (FIELD_STUDY §4.3). */
  study?: {
    participantCode: string;
    phase: "ll_mock" | "test" | "fresh";
    /** The participant's form; device sessions deal its blocks (default: from the code, A/B/C by arrival). */
    form?: StudyForm;
  };
  /** Family mode: play as this family member (the parent's consent is checked by the server). */
  familyMemberId?: string;
  /** Overrides the registry (a game can ship its loader with its page). */
  load?: WebGameLoader;
  /** Device sessions for games whose items are not game-core fixtures (e.g. the LL bank). */
  deviceItems?: DeviceItems;
  /**
   * Client-safe documents for server items (the API sends none), e.g. the LL bank's question for a
   * `q:` ref the server dealt from the mock pool.
   */
  publicDoc?: PublicDocResolver;
  /** State code for device sessions (rule-pack rows such as LLT-<state>); default KL for Nazar, else JK. */
  tenant?: string;
  /** Where Quit and Done go (locale-less path, e.g. "/learn/practise/nazar"). */
  exitHref: string;
  /** The debrief route for a session (default: /learn/practise/sessions/{sid}/debrief). */
  debriefHref?: (outcome: SessionOutcome) => string | null;
  /** Called once the run is saved and submitted (or queued). */
  onComplete?: (outcome: SessionOutcome) => void;
}

/**
 * The game host (MD-205, FRONTEND §10.1, GAME_SDK §4). For one `gameId` + `mode` it:
 *  1. starts a session through API-34 (device session with fixture items when the API is not
 *     there: `seedOrigin: client_offline`, provisional);
 *  2. creates the event recorder over the IndexedDB queue (Idempotency-Key = sid on sync);
 *  3. lazy-loads the game module from the registry (no game code in any first load), mounts its
 *     component, awaits `init` (full preload, with a progress ring) and offers Start;
 *  4. binds visibility (pause is mandatory; a hidden timed item is voided);
 *  5. on end writes `session_end`, saves the run on this phone and submits API-35 with the replay
 *     package; offline it stays queued and syncs when the phone is back online;
 *  6. shows the results with the server score (or "provisional" when unverified).
 */
export function GameStage(props: GameStageProps) {
  const [run, setRun] = useState(0);
  return (
    <GameA11yProvider>
      <Stage key={run} {...props} onPlayAgain={() => setRun((n) => n + 1)} />
    </GameA11yProvider>
  );
}

type Phase =
  | { kind: "starting" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "playing" }
  | { kind: "submitting" }
  | { kind: "results"; outcome: SessionOutcome }
  | { kind: "error"; error: "no_unseen" | "consent" | "unknown_game" | "failed" };

interface Live {
  ctx: SessionContext;
  session: HostSession;
  lifecycle: SessionLifecycle;
  recorder: EventRecorder;
  sink: QueueSink;
  game: WebGame;
}

function outcomeOf(rec: SessionRecord): SessionOutcome {
  return {
    sid: rec.sid,
    gameId: rec.gameId,
    mode: rec.mode,
    checked: rec.checked,
    status: rec.status,
  };
}

const defaultDebrief = (o: SessionOutcome) => `/learn/practise/sessions/${o.sid}/debrief`;

/** API-34 body from the stage props and the device's accessibility options. */
function createBody(p: GameStageProps, locale: "en" | "hi", a: GameA11y): GameSessionCreate {
  return {
    mode: p.mode,
    locale,
    a11y_modes: a11yModes(a),
    text_scale: a.largeText ? 1.25 : 1,
    haptics: false,
    device_class: deviceClass(),
    ...(p.difficulty !== undefined ? { difficulty: p.difficulty } : {}),
    ...(p.drillId ? { drill_id: p.drillId } : {}),
    ...(p.familyMemberId ? { family_member_id: p.familyMemberId } : {}),
    ...(p.study
      ? { study: { participant_code: p.study.participantCode, phase: p.study.phase } }
      : {}),
  };
}

/** A failed start as a screen state; never an accusation, always a way back. */
function startError(e: unknown): Phase {
  if (e instanceof UnknownGameError) return { kind: "error", error: "unknown_game" };
  if (e instanceof GameApiError && e.code === "NO_UNSEEN_CLIPS")
    return { kind: "error", error: "no_unseen" };
  if (e instanceof GameApiError && e.status === 403) return { kind: "error", error: "consent" };
  console.warn("game start failed", e);
  return { kind: "error", error: "failed" };
}

/** Session, recorder over the IndexedDB queue (queued at once) and the loaded game. */
async function openLive(p: GameStageProps, locale: "en" | "hi"): Promise<Live> {
  const [started, mod] = await Promise.all([
    startGameSession(p.gameId, createBody(p, locale, currentA11y()), {
      ...(p.deviceItems ? { deviceItems: p.deviceItems } : {}),
      ...(p.publicDoc ? { publicDoc: p.publicDoc } : {}),
      ...(p.tenant ? { tenant: p.tenant } : {}),
      ...(p.study?.form ? { studyForm: p.study.form } : {}),
    }),
    loadWebGame(p.gameId, p.load),
  ]);
  const ctx = started.start.ctx;
  const store = queueStore();
  const sink = createQueueSink(store);
  const recorder = createEventRecorder(ctx, sink, {
    now: () => performance.now(),
    maxEvents: mod.default.replayManifest.budgets.maxEvents,
  });
  await queueSession(store, ctx, Date.now());
  return {
    ctx,
    session: {
      start: started.start,
      source: started.source,
      items: started.start.items,
      media: started.media,
      deviceContent: started.deviceContent,
    },
    lifecycle: new SessionLifecycle(),
    recorder,
    sink,
    game: mod.default,
  };
}

/** Ends the run: the module's end, `session_end`, the queue drained and marked ended. */
async function closeRun(
  l: Live,
  m: WebGameModule | null,
  reason: "completed" | "timeout" | "abandoned",
): Promise<GameEvent[]> {
  try {
    if (reason !== "abandoned") m?.end(reason);
  } catch (e) {
    console.warn("game end failed", e);
  }
  if (!l.recorder.stats().capped) l.recorder.emit("session_end", { reason });
  l.recorder.flush();
  await l.sink.drain();
  if (l.lifecycle.can({ type: "end", reason: "completed" }))
    l.lifecycle.send({ type: "end", reason: reason === "abandoned" ? "quit" : reason });
  const store = queueStore();
  await endQueuedSession(store, l.ctx.sid);
  const events = await store.events(l.ctx.sid);
  m?.destroy();
  return events;
}

/** The run as saved on this phone, before it is submitted. */
function recordOf(l: Live, events: GameEvent[], device: DeviceItems | undefined): SessionRecord {
  return {
    v: 1,
    sid: l.ctx.sid,
    gameId: l.ctx.gameId,
    mode: l.ctx.mode,
    source: l.session.source,
    media: l.session.media,
    ctx: l.ctx,
    manifest: {
      ...l.game.replayManifest,
      version: l.session.start.manifest_version,
      scoringVersion: l.session.start.scoring_version,
    },
    items: l.session.items,
    events,
    deviceContent: l.session.deviceContent,
    ...(device ? { deviceDocs: { docs: device.docs, formats: device.formats ?? {} } } : {}),
    checked: null,
    status: "queued",
    savedAt: Date.now(),
  };
}

/** Submits the queue and reads the run back (verified, provisional, or still queued). */
async function submitRun(l: Live): Promise<SessionOutcome> {
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  if (l.lifecycle.can({ type: "submit", online: isOnline }))
    l.lifecycle.send({ type: "submit", online: isOnline });
  try {
    await syncPending();
  } catch (e) {
    console.warn("sync failed", e);
  }
  const rec = getSessionRecord(l.ctx.sid);
  const outcome: SessionOutcome = rec
    ? outcomeOf(rec)
    : { sid: l.ctx.sid, gameId: l.ctx.gameId, mode: l.ctx.mode, checked: null, status: "queued" };
  if (l.lifecycle.state === "Submitting")
    l.lifecycle.send(
      outcome.status === "queued" ? { type: "network_error" } : { type: "verified" },
    );
  return outcome;
}

function Stage(props: GameStageProps & { onPlayAgain: () => void }) {
  const t = useTranslations("games");
  const locale = useLocale() === "hi" ? "hi" : "en";
  const router = useRouter();
  const a11y = useGameA11y();
  const online = useOnline();
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [live, setLive] = useState<Live | null>(null);
  const [paused, setPaused] = useState(false);
  const [pauseNote, setPauseNote] = useState<"user" | "hidden" | "voided">("user");
  const [hud, setHud] = useState<HudState>({});
  const [progress, setProgress] = useState<{ loaded: number; total: number; unit: string } | null>(
    null,
  );
  const moduleRef = useRef<WebGameModule | null>(null);
  const itemRef = useRef<{ item: number | null; timed: boolean }>({ item: null, timed: false });
  const unbindRef = useRef<(() => void) | null>(null);
  const pauseCause = useRef<"user" | "hidden">("user");
  const started = useRef(false);
  const initFor = useRef<WebGameModule | null>(null);
  const finished = useRef(false);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;
  const finishRef = useRef<(reason: "completed" | "timeout" | "abandoned") => Promise<void>>(
    async () => {},
  );

  // 1-3: session, recorder, module.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a stage starts exactly one session
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setGamesApiLocale(locale);
    openLive(props, locale)
      .then((l) => {
        setLive(l);
        setPhase({ kind: "loading" });
      })
      .catch((e: unknown) => setPhase(startError(e)));
  }, []);

  const begin = useCallback(() => {
    const l = liveRef.current;
    const m = moduleRef.current;
    if (!l || !m || l.lifecycle.state !== "Ready") return;
    l.recorder.emit("session_start", {
      deviceClass: l.ctx.deviceClass,
      timingMode: m.timingMode,
      a11yModes: a11yModes(currentA11y()),
      orientation:
        typeof window !== "undefined" && window.innerWidth > window.innerHeight
          ? "landscape"
          : "portrait",
      mode: l.ctx.mode,
    });
    l.lifecycle.send({ type: "start" });
    unbindRef.current = bindHostVisibility({
      lifecycle: l.lifecycle,
      recorder: l.recorder,
      pauseGame: () => m.pause(),
      currentItem: () => itemRef.current.item,
      itemIsTimed: () => itemRef.current.timed,
      afterChange: (hidden) => {
        const state = l.lifecycle.state;
        if (hidden && (state === "Paused" || state === "ItemVoided")) {
          pauseCause.current = "hidden";
          setPauseNote(state === "ItemVoided" ? "voided" : "hidden");
          setPaused(true);
        }
        if (!hidden && state === "Ended" && l.lifecycle.endReason === "abandoned") {
          void finishRef.current("abandoned");
        }
      },
    });
    m.start();
    setPhase({ kind: "playing" });
  }, []);

  const register = useCallback(
    (m: WebGameModule) => {
      const again = initFor.current === m;
      moduleRef.current = m;
      const l = liveRef.current;
      if (!l || again) return () => {};
      initFor.current = m;
      void (async () => {
        try {
          await m.init(l.ctx, l.recorder);
          if (l.lifecycle.state !== "Loading") return;
          l.lifecycle.send({ type: "assets_verified" });
          setPhase({ kind: "ready" });
          if (l.game.hostStart === false) begin();
        } catch (e) {
          console.warn("game init failed", e);
          if (l.lifecycle.can({ type: "asset_failed" })) l.lifecycle.send({ type: "asset_failed" });
          setPhase({ kind: "error", error: "failed" });
        }
      })();
      return () => {
        if (moduleRef.current === m) moduleRef.current = null;
      };
    },
    [begin],
  );

  const pause = useCallback(() => {
    const l = liveRef.current;
    const m = moduleRef.current;
    if (!l || !m || l.lifecycle.state !== "Running") return;
    const item = itemRef.current.item;
    l.recorder.emit("pause", { cause: "user" }, item === null ? {} : { item });
    l.lifecycle.send({ type: "pause", cause: "user" });
    pauseCause.current = "user";
    m.pause();
    setPauseNote("user");
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    const l = liveRef.current;
    const m = moduleRef.current;
    if (!l || !m) return;
    const state = l.lifecycle.state;
    if (state !== "Paused" && state !== "ItemVoided") return;
    if (state === "ItemVoided") m.onItemVoided?.();
    const item = itemRef.current.item;
    l.recorder.emit("resume", { cause: pauseCause.current }, item === null ? {} : { item });
    l.lifecycle.send({ type: "resume" });
    m.resume();
    setPaused(false);
  }, []);

  /** 5: end → session_end → save on this phone → submit (or queue). */
  const finish = useCallback(
    async (reason: "completed" | "timeout" | "abandoned") => {
      const l = liveRef.current;
      if (!l || finished.current) return;
      finished.current = true;
      unbindRef.current?.();
      setPaused(false);
      const events = await closeRun(l, moduleRef.current, reason);
      setPhase({ kind: "submitting" });
      saveSessionRecord(recordOf(l, events, props.deviceItems));
      const outcome = await submitRun(l);
      setPhase({ kind: "results", outcome });
      props.onComplete?.(outcome);
    },
    [props.onComplete, props.deviceItems],
  );
  finishRef.current = finish;

  const quit = useCallback(async () => {
    const l = liveRef.current;
    if (!l || finished.current) return;
    finished.current = true;
    unbindRef.current?.();
    try {
      moduleRef.current?.end("quit");
      moduleRef.current?.destroy();
    } catch (e) {
      console.warn("game quit failed", e);
    }
    l.recorder.emit("session_end", { reason: "quit" });
    l.recorder.flush();
    await l.sink.drain();
    // "This run won't be scored": the run never leaves the phone.
    await queueStore().removeSession(l.ctx.sid);
    router.push(props.exitHref);
  }, [props.exitHref, router]);

  // A queued run updates in place when the phone comes back online.
  useEffect(() => {
    if (phase.kind !== "results") return;
    const sid = phase.outcome.sid;
    return subscribeSessionRecords(() => {
      const rec = getSessionRecord(sid);
      if (rec) setPhase({ kind: "results", outcome: outcomeOf(rec) });
    });
  }, [phase]);

  useEffect(() => {
    if (online && phase.kind === "results" && phase.outcome.status === "queued") void syncPending();
  }, [online, phase]);

  // Keyboard: P / Escape pause (Space and other keys belong to the game).
  useEffect(() => {
    if (phase.kind !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "p" || e.key === "P" || e.key === "Escape") && !paused) {
        e.preventDefault();
        pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.kind, paused, pause]);

  // Unmount (route change): stop the module; an unfinished run stays open in the queue.
  useEffect(
    () => () => {
      unbindRef.current?.();
      if (!finished.current) moduleRef.current?.destroy();
    },
    [],
  );

  const onEnd = useCallback((reason: "completed" | "timeout") => void finish(reason), [finish]);
  const setCurrentItem = useCallback((item: number | null, timed: boolean) => {
    itemRef.current = { item, timed };
  }, []);

  if (phase.kind === "error") return <StageError error={phase.error} exitHref={props.exitHref} />;

  if (phase.kind === "results") {
    const href = (props.debriefHref ?? defaultDebrief)(phase.outcome);
    return (
      <div className="mg-stage mg-stage--results" data-testid="game-stage" data-phase="results">
        <ResultsReveal
          outcome={phase.outcome}
          debriefHref={href}
          exitHref={props.exitHref}
          onAgain={props.onPlayAgain}
          {...(live?.game.ResultsExtra ? { Extra: live.game.ResultsExtra } : {})}
        />
      </div>
    );
  }

  const Game = live?.game.Component;
  const showGame = live && Game && phase.kind !== "starting" && phase.kind !== "submitting";
  return (
    <div className="mg-stage" data-testid="game-stage" data-phase={phase.kind}>
      {phase.kind === "playing" ? (
        <GameHud hud={hud} onPause={pause} leftHanded={a11y.leftHanded} paused={paused} />
      ) : null}
      <div className="mg-stage__body">
        {showGame ? (
          <Game
            ctx={live.ctx}
            session={live.session}
            recorder={live.recorder}
            lifecycle={live.lifecycle}
            a11y={a11y}
            paused={paused}
            register={register}
            reportProgress={setProgress}
            setCurrentItem={setCurrentItem}
            setHud={setHud}
            onEnd={onEnd}
          />
        ) : null}
        {phase.kind === "starting" || phase.kind === "submitting" ? (
          <div className="mg-overlay" role="status" aria-live="polite">
            <span className="mg-spinner" aria-hidden="true" />
            <p>{phase.kind === "starting" ? t("stage.starting") : t("stage.submitting")}</p>
          </div>
        ) : null}
        {phase.kind === "loading" ? (
          <LoadingOverlay progress={progress} device={live?.session.source === "device"} />
        ) : null}
        {phase.kind === "ready" ? (
          <div className="mg-overlay" data-testid="stage-ready">
            <p className="mg-overlay__title">{t("stage.ready")}</p>
            {live?.session.source === "device" ? (
              <p className="mg-note">{t("stage.device")}</p>
            ) : null}
            <Button variant="primary" size="lg" onPress={begin} data-testid="stage-start">
              {t("stage.start")}
            </Button>
            <p className="mg-label">{t("label")}</p>
          </div>
        ) : null}
      </div>
      <PauseSheet isOpen={paused} note={pauseNote} onResume={resume} onQuit={() => void quit()} />
    </div>
  );
}

function LoadingOverlay({
  progress,
  device,
}: {
  progress: { loaded: number; total: number; unit: string } | null;
  device: boolean;
}) {
  const t = useTranslations("games");
  const mb = (b: number) => (Math.round((b / (1024 * 1024)) * 10) / 10).toString();
  const pct =
    progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
  const label = !progress
    ? t("stage.loadingGame")
    : progress.unit === "bytes"
      ? t("stage.loading", { x: mb(progress.loaded), y: mb(progress.total) })
      : t("stage.loadingItems", { x: progress.loaded, y: progress.total });
  return (
    <div className="mg-overlay" data-testid="stage-loading">
      <div
        className="mg-progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="mg-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <p aria-live="polite">{label}</p>
      <p className="mg-note">{t("stage.preloadNote")}</p>
      {device ? <p className="mg-note">{t("stage.device")}</p> : null}
    </div>
  );
}

function StageError({
  error,
  exitHref,
}: {
  error: "no_unseen" | "consent" | "unknown_game" | "failed";
  exitHref: string;
}) {
  const t = useTranslations("games");
  const router = useRouter();
  const line = {
    no_unseen: t("stage.noUnseen"),
    consent: t("stage.consent"),
    unknown_game: t("stage.unknownGame"),
    failed: t("stage.failed"),
  }[error];
  return (
    <div className="mg-stage" data-testid="game-stage" data-phase="error">
      <div className="mg-overlay" role="alert">
        <p className="mg-overlay__title">{line}</p>
        {error === "failed" ? (
          <Button variant="primary" size="lg" onPress={() => window.location.reload()}>
            {t("states.retry")}
          </Button>
        ) : null}
        <Button variant="secondary" onPress={() => router.push(exitHref)}>
          {t("stage.back")}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { createFixedStepLoop, type FixedStepLoop } from "@margdarshak/game-core/sim";
import { useEffect, useRef, useState } from "react";
import { watchContextLoss } from "./context-loss";
import { loadPhaser, type PhaserModule } from "./load";

/**
 * The game's logic, stepped at a fixed 60 Hz by game-core's accumulator whatever the frame rate
 * (FRONTEND §10.2, GAME_SDK §6.2): at 30 fps each frame runs two steps, so the score and the
 * server replay never depend on the phone. Phaser only draws what `step` produced.
 */
export interface FixedStepDriver {
  step(stepMs: number): void;
}

export interface PhaserMountProps {
  /** Builds the scene list from the loaded engine. Called once per canvas (a context loss rebuilds). */
  scenes: (P: PhaserModule) => Phaser.Types.Scenes.SceneType[];
  /** Logical size; the canvas is scaled to fit its box (FIT, centred). */
  width: number;
  height: number;
  driver?: FixedStepDriver;
  /** Host pause (user or hidden page): the loop sleeps and no logic step runs. */
  paused: boolean;
  reducedMotion: boolean;
  /** Canvas description for assistive tech (the DOM controls are the accessible path). */
  label: string;
  /** "Graphics were reset" overlay copy and its button. */
  lostLine: string;
  continueLabel: string;
  loadingLabel: string;
  /** Called once a canvas is up (again after a context-loss rebuild). */
  onReady?: (game: Phaser.Game, P: PhaserModule) => void;
  onError?: (e: unknown) => void;
  /** Fired when the GPU context goes away / when the learner taps to continue. */
  onContextLost?: () => void;
  onContinue?: () => void;
  testId?: string;
}

/**
 * Mounts a Phaser 4 game inside React (FRONTEND §10.2). Phaser is imported inside the effect, so it
 * is a lazy chunk requested only when a canvas game opens; the game is destroyed on unmount
 * (StrictMode double-mount safe). React never polls the canvas: scenes read the game's controller
 * through closures and the controller is stepped here, on Phaser's STEP event, through the
 * fixed-step loop. Pause sleeps the loop; reduced motion is handed to scenes in the registry.
 */
export function PhaserMount(props: PhaserMountProps) {
  const box = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const loopRef = useRef<FixedStepLoop>(createFixedStepLoop({ hz: 60, maxStepsPerAdvance: 15 }));
  const latest = useRef(props);
  latest.current = props;
  const [generation, setGeneration] = useState(0);
  const [lost, setLost] = useState(false);
  const [booting, setBooting] = useState(true);
  const lostRef = useRef(false);

  // One canvas per generation; a context loss bumps the generation after the learner's tap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: size and scenes are fixed per mount
  useEffect(() => {
    let cancelled = false;
    let unwatch: (() => void) | null = null;
    setBooting(true);
    void (async () => {
      try {
        const P = await loadPhaser();
        const parent = box.current;
        if (cancelled || !parent) return;
        const p = latest.current;
        const game = new P.Game({
          type: P.AUTO,
          parent,
          width: p.width,
          height: p.height,
          backgroundColor: "#2A2C33",
          banner: false,
          disableContextMenu: true,
          audio: { noAudio: true },
          input: { keyboard: false, gamepad: false },
          scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH },
          render: { antialias: true, powerPreference: "low-power" },
          fps: { target: 60, forceSetTimeOut: false },
          scene: p.scenes(P),
          callbacks: {
            preBoot: (g: Phaser.Game) => {
              g.registry.set("reducedMotion", p.reducedMotion);
            },
          },
        });
        gameRef.current = game;
        loopRef.current.reset();
        game.events.on(P.Core.Events.STEP, (_time: number, delta: number) => {
          const cur = latest.current;
          if (cur.paused || lostRef.current || !cur.driver) return;
          const { steps } = loopRef.current.advance(Math.max(0, Math.min(delta, 250)));
          for (let i = 0; i < steps; i++) cur.driver.step(loopRef.current.stepMs);
        });
        game.events.once(P.Core.Events.READY, () => {
          if (cancelled) return;
          setBooting(false);
          if (game.canvas) {
            unwatch = watchContextLoss(game.canvas, {
              onLost: () => {
                lostRef.current = true;
                setLost(true);
                latest.current.onContextLost?.();
              },
            });
          }
          if (latest.current.paused) game.pause();
          latest.current.onReady?.(game, P);
        });
      } catch (e) {
        if (!cancelled) latest.current.onError?.(e);
      }
    })();
    return () => {
      cancelled = true;
      unwatch?.();
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [generation]);

  // Host pause: the loop sleeps (no rendering, no steps); resume restarts the accumulator so a
  // long pause never turns into a burst of catch-up steps.
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    if (props.paused) g.pause();
    else {
      loopRef.current.reset();
      g.resume();
    }
  }, [props.paused]);

  useEffect(() => {
    gameRef.current?.registry.set("reducedMotion", props.reducedMotion);
  }, [props.reducedMotion]);

  const resume = () => {
    lostRef.current = false;
    setLost(false);
    loopRef.current.reset();
    setGeneration((n) => n + 1);
    latest.current.onContinue?.();
  };

  return (
    <div className="ph-mount" data-testid={props.testId ?? "phaser-mount"}>
      <div ref={box} className="ph-mount__canvas" role="img" aria-label={props.label} />
      {booting && !lost ? (
        <div className="ph-mount__overlay" role="status">
          <span className="mg-spinner" aria-hidden="true" />
          <p>{props.loadingLabel}</p>
        </div>
      ) : null}
      {lost ? (
        <div className="ph-mount__overlay" role="alert" data-testid="phaser-context-lost">
          <p>{props.lostLine}</p>
          <button type="button" className="ph-btn ph-btn--primary" onClick={resume}>
            {props.continueLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

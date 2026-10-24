"use client";

import type { EventRecorder } from "@margdarshak/game-core/sdk";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhaserModule } from "@/features/phaser/load";
import { PhaserMount } from "@/features/phaser/PhaserMount";
import type { PartB } from "./geometry";
import { type LanePos, Ride, type RideSnapshot } from "./ride";
import { createPartBScene, PART_B_SIZE } from "./scenes/PartB";
import { LaneButtons } from "./tap-only/LaneButtons";

/** How long the mirror inset stays up (ms) [D]. */
const MIRROR_MS = 1000;

/**
 * Part B on the canvas (UI_SPEC_LEARN_GAMES §5.3). A ready card first (the ride clock starts at
 * `item_start`, when the learner taps Start), then the Phaser scene over the ride controller, the
 * tap-only lane buttons, a 1 s mirror inset announced as text ("Driver visible: no"), a status line
 * for anything that would otherwise be visual only, and the critical-fault freeze (no contact
 * shown, haptic only, no alarm sound).
 */
export function PhaserPartB(p: {
  spec: PartB;
  item: number;
  recorder: EventRecorder;
  paused: boolean;
  reducedMotion: boolean;
  leftHanded: boolean;
  begin: () => void;
  onDone: () => void;
  onCanvasError: () => void;
}) {
  const t = useTranslations("sims");
  const [phase, setPhase] = useState<"ready" | "ride" | "over">("ready");
  const [pos, setPos] = useState<LanePos>("centre");
  const [holding, setHolding] = useState(false);
  const [mirror, setMirror] = useState<{ present: boolean; visible: boolean } | null>(null);
  const [status, setStatus] = useState("");
  const [snap, setSnap] = useState<RideSnapshot | null>(null);
  const ride = useRef<Ride | null>(null);
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef({ zone: false, ind: false, present: true });
  const scenes = useRef<((P: PhaserModule) => Phaser.Types.Scenes.SceneType[]) | null>(null);

  if (ride.current === null) {
    ride.current = new Ride({
      spec: p.spec,
      item: p.item,
      recorder: p.recorder,
      now: () => performance.now(),
    });
  }
  const r = ride.current;
  if (scenes.current === null) {
    const bridge = {
      spec: p.spec,
      snapshot: () => r.snapshot(),
      leftWord: t("bs.ride.left"),
      youWord: t("bs.ride.you"),
    };
    scenes.current = (P) => [createPartBScene(P, bridge)];
  }

  const driver = useRef({
    step: (ms: number) => {
      r.step(ms);
    },
  });

  // Throttled UI: the status line and the end of the ride (React never runs per frame).
  useEffect(() => {
    if (phase !== "ride") return;
    const h = setInterval(() => {
      const s = r.snapshot();
      const prev = seen.current;
      const inZone = s.zone !== null;
      if (s.critical || s.finished) {
        setSnap(s);
        setStatus(s.critical ? t("bs.ride.crit") : t("bs.ride.done"));
        if (s.critical) navigator.vibrate?.([8, 40, 8]);
        setPhase("over");
        return;
      }
      if (s.truck.indicating && !prev.ind) setStatus(t("bs.ride.indicating"));
      else if (!s.truck.present && prev.present) setStatus(t("bs.ride.gone"));
      else if (inZone !== prev.zone) setStatus(inZone ? t("bs.ride.inZone") : t("bs.ride.clear"));
      seen.current = { zone: inZone, ind: s.truck.indicating, present: s.truck.present };
    }, 100);
    return () => clearInterval(h);
  }, [phase, r, t]);

  useEffect(
    () => () => {
      if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
    },
    [],
  );

  const go = () => {
    p.begin();
    r.start();
    setPhase("ride");
  };
  const running = phase === "ride" && !p.paused;
  const onMove = useCallback((dir: -1 | 1) => setPos(r.move(dir)), [r]);
  const onCentre = useCallback(() => {
    r.setPos("centre");
    setPos("centre");
  }, [r]);
  const onHold = useCallback(() => {
    setHolding((h) => {
      r.setMode(h ? "cruise" : "hold");
      return !h;
    });
  }, [r]);
  const onMirror = useCallback(() => {
    const m = r.mirror();
    setMirror(m);
    if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
    mirrorTimer.current = setTimeout(() => setMirror(null), MIRROR_MS);
  }, [r]);

  if (phase === "ready") {
    return (
      <section className="bs-round" data-testid="bs-ride-ready">
        <p className="sd-round__kicker">{t("bs.partB")}</p>
        <p className="sd-round__title">{t("bs.ride.ready")}</p>
        <p className="sd-note">{t("bs.rule")}</p>
        <div className="sd-controls">
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={go}
            data-testid="bs-ride-go"
          >
            {t("bs.ride.go")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bs-round bs-round--ride" data-testid="bs-ride" data-phase={phase}>
      <p className="sd-round__kicker">{t("bs.partB")}</p>
      <div className="bs-picture bs-picture--ride">
        <PhaserMount
          scenes={scenes.current}
          width={PART_B_SIZE.width}
          height={PART_B_SIZE.height}
          driver={driver.current}
          paused={!running}
          reducedMotion={p.reducedMotion}
          label={t("bs.canvas.partB")}
          lostLine={t("canvas.lost")}
          continueLabel={t("canvas.continue")}
          loadingLabel={t("canvas.loading")}
          onError={p.onCanvasError}
          testId="bs-canvas-b"
        />
        {mirror ? (
          <div
            className="bs-mirror"
            role="status"
            data-testid="bs-mirror-view"
            data-visible={mirror.visible}
          >
            <span aria-hidden="true" className="bs-mirror__icon">
              {mirror.visible ? "◉" : "⊘"}
            </span>
            {!mirror.present
              ? t("bs.ride.mirrorNone")
              : mirror.visible
                ? t("bs.ride.mirrorYes")
                : t("bs.ride.mirrorNo")}
          </div>
        ) : null}
        {phase === "over" && snap?.critical ? (
          <div className="bs-freeze" role="alert" data-testid="bs-critical">
            <p>{t("bs.ride.crit")}</p>
          </div>
        ) : null}
      </div>
      <p className="sd-status" role="status" aria-live="polite" data-testid="bs-status">
        {status}
      </p>
      {phase === "ride" ? (
        <LaneButtons
          pos={pos}
          holding={holding}
          disabled={!running}
          onMove={onMove}
          onCentre={onCentre}
          onMirror={onMirror}
          onHold={onHold}
          leftHanded={p.leftHanded}
        />
      ) : (
        <div className="sd-controls">
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={p.onDone}
            data-testid="bs-next"
          >
            {t("bs.next")}
          </button>
        </div>
      )}
    </section>
  );
}

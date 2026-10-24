"use client";

import { randInt, subStream } from "@margdarshak/game-core/sim";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { SD_UI } from "../config";
import {
  childDistanceM,
  isAnticipatory,
  type Round2,
  reachMs,
  type StreetOutcome,
  streetOutcome,
  TEACHING,
} from "../physics";
import { useNum } from "./Stepper";
import { Strip, stripMax } from "./Strip";
import type { RoundProps } from "./types";

type Phase =
  | { k: "choose" }
  | { k: "ride" }
  | { k: "child" }
  | { k: "early" }
  | {
      k: "outcome";
      rtMs: number | null;
      o: StreetOutcome;
      why: "brake" | "late" | "early" | "typical";
    };

/** Clamp a measured reaction into the event bounds (integer ms, ≤ 10 s). */
const rtBound = (ms: number): number => Math.max(0, Math.min(10_000, Math.round(ms)));

/**
 * Round 2, choose a speed then react (GAME_DESIGN §3.3-2, §3.10; UI_SPEC_LEARN_GAMES §5.2).
 *
 * Events, exactly as `scoreStoppingDistance` replays them:
 *  - `speed_choice {chosenKmh, context: "street"}` when the learner rides off;
 *  - `brake {rtMs}` per press. A press before the child steps out is recorded as `rtMs: 0`, and a
 *    press under 100 ms after it as its real time: both are anticipatory, so the scorer never
 *    treats them as a stop, bumps the attempt (a new seeded child distance) and flags
 *    INT_RT_ANTICIPATORY. After `SD_UI.maxRedeals` re-deals the next early press ends the round
 *    with no valid brake, which the scorer counts as reaching the child at full speed. An early
 *    press is never rewarded.
 *  - no press before the bike reaches the child: no valid brake, same outcome.
 * The reaction time is reported, never scored: anticipation is rewarded through the speed choice.
 * "No timed tap" uses the teaching reaction time (1.5 s, slower than most real reactions, so it is
 * never an advantage) and says so.
 */
export function BrakeReflex(p: RoundProps<Round2>) {
  const t = useTranslations("sims.sd");
  const num = useNum();
  const [phase, setPhaseState] = useState<Phase>({ k: "choose" });
  const [kmh, setKmh] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const phaseRef = useRef<Phase>(phase);
  const setPhase = useCallback((ph: Phase) => {
    phaseRef.current = ph;
    setPhaseState(ph);
  }, []);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stimulusAt = useRef(0);
  const restarts = useRef(0);
  const interrupted = useRef(false);
  const attemptRef = useRef(0);
  const brakeBtn = useRef<HTMLButtonElement>(null);
  const surface = p.spec.surface;
  const childM = childDistanceM(p.seed, p.item, attempt, p.spec);
  const maxM = stripMax(p.spec.childDistanceM.max, 0);

  const clear = useCallback(() => {
    for (const h of timers.current) clearTimeout(h);
    timers.current = [];
  }, []);
  useEffect(() => clear, [clear]);

  const resolve = useCallback(
    (rtMs: number | null, why: "brake" | "late" | "early" | "typical", chosen: number) => {
      clear();
      const d = childDistanceM(p.seed, p.item, attemptRef.current, p.spec);
      setPhase({ k: "outcome", rtMs, o: streetOutcome(chosen, rtMs, d, surface), why });
    },
    [clear, p.seed, p.item, p.spec, surface, setPhase],
  );

  const ride = useCallback(
    (chosen: number) => {
      clear();
      setPhase({ k: "ride" });
      const rng = subStream(
        p.seed,
        `sd:ui:stepout:${p.item}:${attemptRef.current}:${restarts.current}`,
      );
      const wait = randInt(rng, SD_UI.stepOutMs.min, SD_UI.stepOutMs.max);
      timers.current.push(
        setTimeout(() => {
          stimulusAt.current = performance.now();
          setPhase({ k: "child" });
          const d = childDistanceM(p.seed, p.item, attemptRef.current, p.spec);
          timers.current.push(setTimeout(() => resolve(null, "late", chosen), reachMs(chosen, d)));
        }, wait),
      );
      brakeBtn.current?.focus();
    },
    [clear, p.seed, p.item, p.spec, resolve, setPhase],
  );

  const early = useCallback(
    (rtMs: number, chosen: number) => {
      clear();
      p.emit("brake", { rtMs: rtBound(rtMs) });
      const next = attemptRef.current + 1;
      attemptRef.current = next;
      setAttempt(next);
      if (next > SD_UI.maxRedeals) resolve(null, "early", chosen);
      else setPhase({ k: "early" });
    },
    [clear, p, resolve, setPhase],
  );

  const brake = useCallback(() => {
    const ph = phaseRef.current;
    if (kmh === null) return;
    if (ph.k === "ride") {
      early(0, kmh);
      return;
    }
    if (ph.k !== "child") return;
    const rt = rtBound(performance.now() - stimulusAt.current);
    if (isAnticipatory(rt)) {
      early(rt, kmh);
      return;
    }
    p.emit("brake", { rtMs: rt });
    resolve(rt, "brake", kmh);
  }, [kmh, early, p, resolve]);

  const go = (chosen: number) => {
    p.emit("speed_choice", { chosenKmh: chosen, context: "street" });
    ride(chosen);
  };

  const typical = () => {
    if (kmh === null) return;
    if (phaseRef.current.k === "choose")
      p.emit("speed_choice", { chosenKmh: kmh, context: "street" });
    const rt = TEACHING.reactionS * 1000;
    p.emit("brake", { rtMs: rt });
    resolve(rt, "typical", kmh);
  };

  // Space / Enter brake (UI_SPEC §5.2); a focused button handles its own key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "BUTTON" || tag === "INPUT") return;
      const k = phaseRef.current.k;
      if (k === "ride" || k === "child") {
        e.preventDefault();
        brake();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [brake]);

  // A pause while riding restarts the ride with the same child (the attempt does not change).
  useEffect(() => {
    const k = phaseRef.current.k;
    if (p.paused && (k === "ride" || k === "child")) {
      clear();
      interrupted.current = true;
    } else if (!p.paused && interrupted.current && kmh !== null) {
      interrupted.current = false;
      restarts.current += 1;
      ride(kmh);
    }
  }, [p.paused, clear, kmh, ride]);

  const surfaceWord = surface === "wet" ? t("wet") : t("dry");
  const out = phase.k === "outcome" ? phase : null;
  const showChild = phase.k === "child" || out !== null;
  const bikeAt = out ? (out.o.collision ? Math.max(0, childM - 1) : (out.o.stopM ?? 0)) : 0;
  const brakingM =
    out && out.o.stopM !== null && out.o.reactionM !== null ? out.o.stopM - out.o.reactionM : null;
  const labels = {
    title: t("strip.street", { surface: surfaceWord }),
    wet: t("wet"),
    you: t("strip.you"),
    metres: (m: number) => t("strip.metres", { m }),
  };

  return (
    <section className="sd-round" aria-labelledby={`sd-r2-${p.item}`} data-testid="sd-reflex">
      <p className="sd-round__kicker">{p.heading}</p>
      <h2 id={`sd-r2-${p.item}`} className="sd-round__title">
        {phase.k === "choose" ? t("q.street") : t("q.react")}
      </h2>
      <p className="sd-round__at">{t("street", { surface: surfaceWord })}</p>
      <Strip
        maxM={maxM}
        surface={surface}
        parked
        moving={(phase.k === "ride" || phase.k === "child") && !p.reducedMotion}
        personM={showChild ? childM : null}
        reactionM={out?.o.reactionM ?? null}
        brakingM={brakingM}
        bikeM={bikeAt}
        labels={labels}
      />
      {phase.k === "choose" ? (
        <div className="sd-controls">
          <fieldset className="sd-options" data-testid="sd-speeds">
            <legend className="sd-stepper__label">{t("speedLabel")}</legend>
            {p.spec.speedOptionsKmh.map((s) => (
              <button
                key={s}
                type="button"
                className={`sd-option${kmh === s ? " sd-option--on" : ""}`}
                aria-pressed={kmh === s}
                onClick={() => setKmh(s)}
                data-testid={`sd-speed-${s}`}
              >
                {t("kmh", { kmh: s })}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            disabled={kmh === null}
            onClick={() => kmh !== null && go(kmh)}
            data-testid="sd-ride"
          >
            {t("ride")}
          </button>
          <button
            type="button"
            className={`${buttonClassName({ variant: "ghost", fullWidth: true })}${p.screenReaderAlt ? " sd-alt--on" : ""}`}
            disabled={kmh === null}
            onClick={typical}
            data-testid="sd-typical"
          >
            {t("typical", { s: num(TEACHING.reactionS) })}
          </button>
        </div>
      ) : null}
      {phase.k === "ride" || phase.k === "child" ? (
        <div className="sd-controls">
          <p className="sd-status" role="status" data-testid="sd-status">
            {phase.k === "child" ? t("childOut") : t("riding", { kmh: kmh ?? 0 })}
          </p>
          <button
            ref={brakeBtn}
            type="button"
            className="sd-brake"
            onPointerDown={(e) => {
              e.preventDefault();
              brake();
            }}
            onClick={(e) => {
              // Keyboard activation (Enter/Space on the focused button); pointers fire on down.
              if (e.detail === 0) brake();
            }}
            data-testid="sd-brake"
          >
            {t("btnBrake")}
          </button>
        </div>
      ) : null}
      {phase.k === "early" ? (
        <div className="sd-controls" data-testid="sd-early">
          <p className="sd-status" role="alert">
            {t("early")}
          </p>
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={() => kmh !== null && ride(kmh)}
            data-testid="sd-retry"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}
      {out ? (
        <div className="sd-reveal" data-testid="sd-outcome" data-collision={out.o.collision}>
          {out.why === "early" ? <p className="sd-line">{t("tooEarly")}</p> : null}
          {out.why === "late" ? <p className="sd-line">{t("noBrake")}</p> : null}
          {out.why === "typical" ? (
            <p className="sd-line">{t("usedTypical", { s: num(TEACHING.reactionS) })}</p>
          ) : null}
          {out.why === "brake" && out.rtMs !== null ? (
            <p className="sd-line" data-testid="sd-rt">
              {t("rt", { s: num(Math.round(out.rtMs / 10) / 100) })}
            </p>
          ) : null}
          {out.o.stopM !== null ? (
            <p className="sd-line">{t("stopAt", { m: num(out.o.stopM), child: childM })}</p>
          ) : null}
          {out.o.collision ? (
            <>
              <p className="sd-line sd-line--total" data-testid="sd-moving">
                {t("moving", { kmh: num(out.o.impactKmh) })}
              </p>
              {out.o.band ? <p className="sd-note">{t(`who.${out.o.band}`)}</p> : null}
            </>
          ) : (
            <p className="sd-line sd-line--total" data-testid="sd-stopped">
              {t("stopped", { m: num(Math.max(0, childM - (out.o.stopM ?? 0))) })}
            </p>
          )}
          <p className="sd-note">{t("speedNote")}</p>
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={p.onNext}
            data-testid="sd-next"
          >
            {t("next")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import type { EventRecorder } from "@margdarshak/game-core/sdk";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";
import type { PartB } from "../geometry";
import { useFixedLoop } from "../loop";
import { Ride, type RideSnapshot } from "../ride";
import { FOLLOW, LANE, type PlanStep, planSteps, type RidePlan, TURN } from "./plan";
import { RideDiagram } from "./RideDiagram";

type Q = "follow" | "lane" | "turn";

/**
 * Part B in the decision version (GAME_DESIGN §1.3, §4.9; UI_SPEC_LEARN_GAMES §5.3): three picture
 * choices with no time pressure (where you ride, mirror before moving, what you do when the truck
 * indicates left), then the ride plays out with those choices on the same controller as the canvas
 * game, narrated in a live region. The item starts when the ride starts (the scorer places the
 * scripted truck from `item_start`); the choices are recorded as `decision {node, choice}`.
 */
export function DecisionPartB(p: {
  spec: PartB;
  item: number;
  recorder: EventRecorder;
  paused: boolean;
  begin: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("sims.bs");
  const name = useId();
  const [plan, setPlan] = useState<Partial<RidePlan>>({});
  const [phase, setPhase] = useState<"plan" | "ride" | "over">("plan");
  const [snap, setSnap] = useState<RideSnapshot | null>(null);
  const [said, setSaid] = useState("");
  const ride = useRef<Ride | null>(null);
  const steps = useRef<PlanStep[]>([]);
  const lastSay = useRef<{ zone: boolean; ind: boolean; present: boolean }>({
    zone: false,
    ind: false,
    present: true,
  });
  const lastUi = useRef(0);
  const complete = plan.follow !== undefined && plan.lane !== undefined && plan.turn !== undefined;

  const start = () => {
    if (!complete) return;
    const full = plan as RidePlan;
    p.begin();
    const r = new Ride({
      spec: p.spec,
      item: p.item,
      recorder: p.recorder,
      now: () => performance.now(),
    });
    p.recorder.emit("decision", { node: "follow", choice: full.follow }, { item: p.item });
    p.recorder.emit("decision", { node: "lane_change", choice: full.lane }, { item: p.item });
    p.recorder.emit("decision", { node: "left_turn", choice: full.turn }, { item: p.item });
    steps.current = planSteps(p.spec, full);
    r.start();
    ride.current = r;
    setSnap(r.snapshot());
    setSaid(t("plan.watching"));
    setPhase("ride");
  };

  const step = useCallback((stepMs: number) => {
    const r = ride.current;
    if (!r) return;
    const tNow = r.snapshot().simMs;
    while (
      steps.current.length > 0 &&
      (steps.current[0]?.atMs ?? Number.POSITIVE_INFINITY) <= tNow
    ) {
      steps.current.shift()?.run(r);
    }
    r.step(stepMs);
  }, []);

  const tick = useCallback(() => {
    const r = ride.current;
    if (!r) return;
    const now = performance.now();
    const s = r.snapshot();
    if (s.critical || s.finished) {
      setSnap(s);
      setSaid(s.critical ? t("ride.crit") : t("ride.done"));
      setPhase("over");
      return;
    }
    if (now - lastUi.current < 100) return;
    lastUi.current = now;
    setSnap(s);
    const prev = lastSay.current;
    const inZone = s.zone !== null;
    if (s.truck.indicating && !prev.ind) setSaid(t("ride.indicating"));
    else if (!s.truck.present && prev.present) setSaid(t("ride.gone"));
    else if (inZone !== prev.zone) setSaid(inZone ? t("ride.inZone") : t("ride.clear"));
    lastSay.current = { zone: inZone, ind: s.truck.indicating, present: s.truck.present };
  }, [t]);

  useFixedLoop(phase === "ride" && !p.paused, step, tick);

  if (phase === "plan") {
    const group = (q: Q, options: readonly string[]) => (
      <fieldset className="bs-choices" data-testid={`bs-plan-${q}`}>
        <legend className="sd-round__title">{t(`plan.${q}.q`)}</legend>
        {options.map((o) => (
          <label key={o} className={`bs-choice${plan[q] === o ? " bs-choice--on" : ""}`}>
            <input
              type="radio"
              name={`${name}-${q}`}
              value={o}
              checked={plan[q] === o}
              onChange={() => setPlan((pl) => ({ ...pl, [q]: o }))}
              data-testid={`bs-plan-${q}-${o}`}
            />
            <ChoicePicture q={q} choice={o} />
            <span>{t(`plan.${q}.${o}` as "plan.follow.back")}</span>
          </label>
        ))}
      </fieldset>
    );
    return (
      <section className="bs-round" data-testid="bs-decision-b">
        <p className="sd-round__kicker">{t("partB")}</p>
        <h2 className="sd-round__title">{t("plan.title")}</h2>
        {group("follow", FOLLOW)}
        {group("lane", LANE)}
        {group("turn", TURN)}
        <button
          type="button"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          disabled={!complete}
          onClick={start}
          data-testid="bs-plan-start"
        >
          {t("plan.start")}
        </button>
      </section>
    );
  }

  return (
    <section className="bs-round" data-testid="bs-decision-ride" data-phase={phase}>
      <p className="sd-round__kicker">{t("partB")}</p>
      {snap ? (
        <RideDiagram
          spec={p.spec}
          snap={snap}
          title={t("canvas.partB")}
          zoneLabel={t("zoneLabel")}
          leftWord={t("ride.left")}
          youWord={t("ride.you")}
        />
      ) : null}
      <p className="sd-status" role="status" aria-live="polite" data-testid="bs-narration">
        {said}
      </p>
      {phase === "over" ? (
        <div
          className="sd-reveal"
          data-testid="bs-ride-over"
          data-critical={snap?.critical ?? false}
        >
          {snap?.critical ? <p className="sd-line sd-line--total">{t("ride.crit")}</p> : null}
          <p className="sd-note">{t("rule")}</p>
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={p.onDone}
            data-testid="bs-next"
          >
            {t("next")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** A small top-down sketch for each choice (picture choice; the words carry the meaning too). */
function ChoicePicture({ q, choice }: { q: Q; choice: string }) {
  const rider =
    q === "follow"
      ? choice === "back"
        ? { x: 34, y: 44 }
        : choice === "beside"
          ? { x: 27, y: 20 }
          : { x: 6, y: 22 }
      : q === "turn"
        ? choice === "hold"
          ? { x: 16, y: 46 }
          : choice === "pass_left"
            ? { x: 6, y: 10 }
            : { x: 34, y: 10 }
        : { x: 30, y: 40 };
  return (
    <svg viewBox="0 0 48 52" className="bs-choice__pic" aria-hidden="true">
      <rect width="48" height="52" fill="#2A2C33" />
      <rect x="23.5" y="0" width="1" height="52" fill="#c9ccd3" opacity="0.6" />
      <rect x="10" y="6" width="10" height="26" fill="#c9ccd3" />
      {q === "turn" ? <path d="M8 4 l-4 3 l4 3z" fill="#F0E442" /> : null}
      {q === "lane" ? (
        choice === "mirror" ? (
          <g stroke="#fff" fill="none" strokeWidth="1.5">
            <rect x="26" y="8" width="12" height="8" rx="2" />
            <path d="M32 26 h8 m-3 -3 l3 3 l-3 3" />
          </g>
        ) : (
          <path d="M28 26 h10 m-3 -3 l3 3 l-3 3" stroke="#fff" fill="none" strokeWidth="1.5" />
        )
      ) : null}
      <rect
        x={rider.x - 2}
        y={rider.y - 4}
        width="4"
        height="8"
        rx="1"
        fill="#56B4E9"
        stroke="#fff"
        strokeWidth="0.6"
      />
    </svg>
  );
}

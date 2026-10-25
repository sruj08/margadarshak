"use client";

import "./fx.css";
import {
  m,
  useMotionValueEvent,
  useReducedMotionConfig,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  GEOMETRY,
  type Segment,
  useDrive,
  useRig,
  Vehicle as VehicleArt,
  type VehicleKind,
} from "./vehicles";

export type Vehicle = "car" | "bike";

/** Critically damped (Apple "response" ≈ 0.45 s): no overshoot on a progress indicator. */
const PROGRESS_SPRING = { stiffness: 195, damping: 28, mass: 1 };
/** Rendered size of the progress car: 36 px wide for the 64-unit drawing. */
const MINI_SCALE = 36 / 64;
const MINI_WHEELS = GEOMETRY.car.wheels;

/**
 * A road under the question counter. The fill and the car share one spring, so the car always sits
 * on the end of the fill, and its wheels turn by the distance it rolls.
 */
export function RoadProgress({ value, max }: { value: number; max: number }) {
  const reduce = useReducedMotionConfig() ?? false;
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const track = useRef<HTMLDivElement>(null);
  const wheels = useRef<Array<SVGGElement | null>>([]);
  const progress = useSpring(pct, PROGRESS_SPRING);
  const scaleX = useTransform(progress, (v) => v / 100);
  const x = useTransform(progress, (v) => `${v}%`);

  useEffect(() => {
    if (reduce) progress.jump(pct);
    else progress.set(pct);
  }, [pct, reduce, progress]);

  useMotionValueEvent(progress, "change", (v) => {
    const width = track.current?.clientWidth ?? 0;
    const rolled = ((v / 100) * width) / MINI_SCALE;
    const deg = ((rolled / GEOMETRY.car.radius) * 180) / Math.PI;
    MINI_WHEELS.forEach(([cx, cy], n) => {
      wheels.current[n]?.setAttribute("transform", `rotate(${deg.toFixed(1)} ${cx} ${cy})`);
    });
  });

  return (
    <div className="fx-roadprog" ref={track} aria-hidden="true">
      <m.div className="fx-roadprog__fill" style={{ scaleX }} />
      <m.div className="fx-roadprog__run" style={{ x }}>
        <svg
          className="fx-roadprog__car"
          viewBox="0 -1 64 34"
          overflow="visible"
          aria-hidden="true"
        >
          <MiniCar wheels={wheels} />
        </svg>
      </m.div>
    </div>
  );
}

function MiniCar({ wheels }: { wheels: React.RefObject<Array<SVGGElement | null>> }) {
  return (
    <>
      <path
        d="M3.5 24.5L3 19.5Q3 15.6 6.6 14.6L13.5 12.6L20.5 5.6Q22.4 3.8 25.4 3.6L38.8 3.4Q42 3.4 44.2 5.6L50.2 11.4L58.6 13.2Q62.6 14.2 62.8 18.4L62.8 22.6Q62.8 24.5 60.8 24.5L56.6 24.5A7.6 7.6 0 0 0 41.4 24.5L23.6 24.5A7.6 7.6 0 0 0 8.4 24.5Z"
        fill="var(--fx-paint)"
      />
      <path
        d="M15.8 12.3L21.9 6.5Q23.3 5.2 25.5 5.1L38.5 5Q41 5 42.6 6.6L47.8 11.8Z"
        fill="#dbe8fb"
      />
      <rect x="31" y="4.8" width="1.9" height="7.4" fill="var(--fx-paint)" />
      <path d="M58.6 14.8Q61.8 15.3 62.4 17.6L59.2 17.3Z" fill="#fff4c7" />
      {MINI_WHEELS.map(([cx, cy], n) => (
        <g
          key={cx}
          ref={(el) => {
            wheels.current[n] = el;
          }}
        >
          <circle cx={cx} cy={cy} r={6.2} fill="#14161b" />
          <circle cx={cx} cy={cy} r={3} fill="#c4ccd8" />
          <rect x={cx - 0.7} y={cy - 4.4} width={1.4} height={8.8} rx={0.7} fill="#5b6472" />
        </g>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------------------------------------- */

/** Scene units: 320 x 72. Road from y = 40; tyres touch y = 62; the lane marking runs in front. */
const SCENE_W = 320;
const SCENE_H = 72;
const GROUND = 62;
const CONE_X = 238;
/** Gap the driver leaves before the cone, in scene units. */
const STOP_GAP = 14;
const ENTRY_X = -72;
const PARKED_X = 150;

function plan(ok: boolean, kind: VehicleKind): Segment[] {
  if (ok)
    return [
      { kind: "cruise", to: 28 },
      { kind: "accel", a: 260, to: SCENE_W + 24 },
    ];
  const stopAt = CONE_X - STOP_GAP - GEOMETRY[kind].nose;
  return [
    { kind: "cruise", to: 34 },
    { kind: "stop", at: stopAt },
  ];
}

/**
 * Answer feedback ride. A correct answer pulls away past a green signal and leaves the frame; a wrong
 * one brakes and stops short of the cone, then the hazard lights blink. Decorative (aria-hidden):
 * the words in the feedback carry the meaning.
 */
export function Ride({ ok, vehicle = "car" }: { ok: boolean; vehicle?: Vehicle }) {
  const reduce = useReducedMotionConfig() ?? false;
  const kind: VehicleKind = vehicle === "bike" ? "scooter" : "car";
  const rig = useRig();
  const [stopped, setStopped] = useState(false);
  // Reduced motion shows the outcome as a still: parked at the green signal, or stopped at the cone.
  const still = reduce && ok;
  const x0 = still ? PARKED_X : ENTRY_X;
  const segments = still ? [] : plan(ok, kind);
  useDrive({
    rig,
    kind,
    x0,
    v0: ok ? 150 : 215,
    segments,
    planKey: `${ok}-${kind}`,
    reduce,
    onSettle: () => setStopped(true),
  });

  return (
    <svg
      className="fx-ride"
      viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
      aria-hidden="true"
      data-tone={ok ? "ok" : "warn"}
      data-stopped={stopped ? "true" : "false"}
    >
      <rect className="fx-scene__verge" y="34" width={SCENE_W} height="6" />
      <rect className="fx-scene__road" y="40" width={SCENE_W} height={SCENE_H - 40} />
      <rect className="fx-scene__kerb" y="40" width={SCENE_W} height="1.5" />
      <line className="fx-scene__lane" x1="0" y1="67.5" x2={SCENE_W} y2="67.5" />
      {ok ? <Signal x={262} /> : <Cone x={CONE_X} ground={GROUND} />}
      <VehicleArt kind={kind} rig={rig} groundY={GROUND} x0={x0} />
    </svg>
  );
}

function Signal({ x }: { x: number }) {
  return (
    <g className="fx-signal" transform={`translate(${x} 0)`}>
      <rect x="-1.5" y="18" width="3" height="23" rx="1" fill="#5b6472" />
      <rect x="-6" y="3" width="12" height="19" rx="3.5" fill="#262a32" />
      <circle cx="0" cy="8.5" r="2.6" fill="#4a2a2a" />
      <circle className="fx-signal__go" cx="0" cy="16.5" r="2.8" />
    </g>
  );
}

function Cone({ x, ground }: { x: number; ground: number }) {
  return (
    <g transform={`translate(${x} ${ground - 24})`}>
      <ellipse cx="9" cy="24" rx="12" ry="1.8" fill="#000" fillOpacity="0.22" />
      <path d="M6.6 0.8Q9 -0.6 11.4 0.8L17 21H1Z" fill="#f97316" />
      <path d="M4.6 9H13.4L14.6 13.4H3.4Z" fill="#fff" />
      <path d="M8 0.6L6.2 21H1L6.6 0.8Z" fill="#000" fillOpacity="0.08" />
      <rect x="-2" y="20.6" width="22" height="3.4" rx="1.2" fill="#c2410c" />
    </g>
  );
}

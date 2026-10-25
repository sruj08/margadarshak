"use client";

import { type RefObject, useEffect, useId, useRef } from "react";

/*
 * Shared 2D vehicles and the drive model behind every road moment (answer ride, progress road, toll).
 *
 * The camera is still and the vehicle moves. Motion is integrated per frame from accelerations, so
 * speed changes are continuous; wheels roll exactly the distance travelled (angle = x / r), and the
 * body pitches on a damped spring driven by acceleration: it squats when pulling away, dives when
 * braking and rocks back once stopped.
 */

export type VehicleKind = "car" | "scooter";

interface Geometry {
  wheels: ReadonlyArray<readonly [number, number]>;
  radius: number;
  /** Ground line in the vehicle's own units (bottom of the tyres). */
  ground: number;
  /** Front-most point, so scenes can stop the nose a set gap before an obstacle. */
  nose: number;
  /** Suspension pivot for body pitch (low centre of mass, between the axles). */
  pivot: readonly [number, number];
}

export const GEOMETRY: Record<VehicleKind, Geometry> = {
  car: {
    wheels: [
      [16, 25],
      [49, 25],
    ],
    radius: 6.2,
    ground: 31.2,
    nose: 62.8,
    pivot: [32, 22],
  },
  scooter: {
    wheels: [
      [13, 26.5],
      [51, 26.5],
    ],
    radius: 5.2,
    ground: 31.7,
    nose: 57,
    pivot: [30, 22],
  },
};

export interface VehicleRig {
  root: RefObject<SVGGElement | null>;
  body: RefObject<SVGGElement | null>;
  wheels: RefObject<Array<SVGGElement | null>>;
}

export function useRig(): VehicleRig {
  return { root: useRef(null), body: useRef(null), wheels: useRef([]) };
}

function Wheel({
  cx,
  cy,
  r,
  rim,
  setRef,
}: {
  cx: number;
  cy: number;
  r: number;
  rim: string;
  setRef: (el: SVGGElement | null) => void;
}) {
  const spokes = [0, 72, 144, 216, 288].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return `M${cx} ${cy}L${(cx + Math.cos(a) * r * 0.6).toFixed(2)} ${(cy + Math.sin(a) * r * 0.6).toFixed(2)}`;
  });
  return (
    <g ref={setRef}>
      <circle cx={cx} cy={cy} r={r} fill="#14161b" />
      <circle cx={cx} cy={cy} r={r * 0.9} fill="none" stroke="#2c3038" strokeWidth={r * 0.1} />
      <circle cx={cx} cy={cy} r={r * 0.64} fill={`url(#${rim})`} />
      <path d={spokes.join("")} stroke="#5b6472" strokeWidth={r * 0.17} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={r * 0.2} fill="#3f4652" />
    </g>
  );
}

function Shadow({ id, cx, cy, rx }: { id: string; cx: number; cy: number; rx: number }) {
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor="#000" stopOpacity="0.34" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx={rx} ry={2.2} fill={`url(#${id})`} />
    </>
  );
}

function CarArt({ rig, uid }: { rig: VehicleRig; uid: string }) {
  const g = GEOMETRY.car;
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-paint`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--fx-paint-hi)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--fx-paint)" }} />
          <stop offset="1" style={{ stopColor: "var(--fx-paint-lo)" }} />
        </linearGradient>
        <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#eef5ff" />
          <stop offset="1" stopColor="#8fb0dc" />
        </linearGradient>
        <radialGradient id={`${uid}-rim`} cx="0.4" cy="0.35">
          <stop offset="0" stopColor="#f3f5f8" />
          <stop offset="1" stopColor="#9aa4b3" />
        </radialGradient>
      </defs>
      <Shadow id={`${uid}-shadow`} cx={32.5} cy={g.ground} rx={31} />
      <g ref={rig.body}>
        <path
          d="M3.5 24.5L3 19.5Q3 15.6 6.6 14.6L13.5 12.6L20.5 5.6Q22.4 3.8 25.4 3.6L38.8 3.4Q42 3.4 44.2 5.6L50.2 11.4L58.6 13.2Q62.6 14.2 62.8 18.4L62.8 22.6Q62.8 24.5 60.8 24.5L56.6 24.5A7.6 7.6 0 0 0 41.4 24.5L23.6 24.5A7.6 7.6 0 0 0 8.4 24.5Z"
          fill={`url(#${uid}-paint)`}
        />
        <path
          d="M15.8 12.3L21.9 6.5Q23.3 5.2 25.5 5.1L38.5 5Q41 5 42.6 6.6L47.8 11.8Z"
          fill={`url(#${uid}-glass)`}
        />
        <rect x="31" y="4.8" width="1.9" height="7.4" fill="var(--fx-paint)" />
        <path
          d="M7 15.2Q30 13.4 58.6 14.2"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.38"
          strokeWidth="0.8"
        />
        <path d="M32 13v10.4" stroke="#000" strokeOpacity="0.16" strokeWidth="0.6" />
        <rect x="26.6" y="15.6" width="3.2" height="0.9" rx="0.45" fill="#000" fillOpacity="0.28" />
        <rect x="35.2" y="15.6" width="3.2" height="0.9" rx="0.45" fill="#000" fillOpacity="0.28" />
        <path d="M58.6 14.8Q61.8 15.3 62.4 17.6L59.2 17.3Z" fill="#fff4c7" />
        <rect x="3.2" y="16" width="2.2" height="3.4" rx="0.8" fill="#e5484d" />
        <rect x="3.4" y="22.4" width="4.6" height="2.1" rx="0.9" fill="#000" fillOpacity="0.28" />
        <rect x="57.6" y="22.4" width="5.2" height="2.1" rx="0.9" fill="#000" fillOpacity="0.28" />
        <circle className="fx-hazard" cx="61.4" cy="19.8" r="1.4" />
        <circle className="fx-hazard" cx="4.3" cy="20.6" r="1.4" />
      </g>
      {g.wheels.map(([cx, cy], n) => (
        <Wheel
          key={cx}
          cx={cx}
          cy={cy}
          r={g.radius}
          rim={`${uid}-rim`}
          setRef={(el) => {
            rig.wheels.current[n] = el;
          }}
        />
      ))}
    </>
  );
}

function ScooterArt({ rig, uid }: { rig: VehicleRig; uid: string }) {
  const g = GEOMETRY.scooter;
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-paint`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--fx-paint-hi)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--fx-paint)" }} />
          <stop offset="1" style={{ stopColor: "var(--fx-paint-lo)" }} />
        </linearGradient>
        <radialGradient id={`${uid}-rim`} cx="0.4" cy="0.35">
          <stop offset="0" stopColor="#f3f5f8" />
          <stop offset="1" stopColor="#9aa4b3" />
        </radialGradient>
        <linearGradient id={`${uid}-helmet`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <Shadow id={`${uid}-shadow`} cx={32} cy={g.ground} rx={28} />
      <g ref={rig.body}>
        <path d="M47.6 10L51 26.5" stroke="#4b5563" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="M4.4 22.8Q4 15.4 12 14.2L26.4 14Q31.2 14 31.6 19L31.8 22.8L19.8 22.8A6.8 6.8 0 0 0 6.2 22.8Z"
          fill={`url(#${uid}-paint)`}
        />
        <rect x="30" y="21.2" width="13" height="2.6" rx="1.2" fill="#2b2f38" />
        <path
          d="M41 23.4L44.6 9.6Q45.4 7.6 47.6 8.4L49.2 9.2L46.4 23.4Z"
          fill={`url(#${uid}-paint)`}
        />
        <path
          d="M45 24.8A6.4 6.4 0 0 1 57 22.6"
          fill="none"
          stroke="var(--fx-paint)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="4.2" y="16.4" width="1.8" height="2.6" rx="0.7" fill="#e5484d" />
        <circle cx="48.4" cy="10.2" r="1.3" fill="#fff4c7" />
        <path d="M12.4 14.2Q13 11.6 16 11.4L28 11.4Q30.6 11.6 30.4 14Z" fill="#1f2937" />
        <path
          d="M23.6 11.2L35.6 12.6L38.4 21"
          fill="none"
          stroke="#1e293b"
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M18.8 11.8L22.6 2.6Q23.5 0.8 25.6 1.3L28.8 2.1Q30.7 2.8 30 4.8L26.6 12.2Z"
          fill="#334155"
        />
        <path
          d="M27.4 4.4Q37 7.6 45.6 7.4"
          fill="none"
          stroke="#334155"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path d="M44.6 7.6L50 6.6" stroke="#111827" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="27.2" cy="-2.4" r="4.6" fill={`url(#${uid}-helmet)`} />
        <path d="M28.4 -3.8Q32.2 -3.6 31.8 -0.4L28.6 -0.7Z" fill="#0f172a" />
        <circle className="fx-hazard" cx="49.6" cy="12.6" r="1.3" />
        <circle className="fx-hazard" cx="4.6" cy="20.6" r="1.3" />
      </g>
      {g.wheels.map(([cx, cy], n) => (
        <Wheel
          key={cx}
          cx={cx}
          cy={cy}
          r={g.radius}
          rim={`${uid}-rim`}
          setRef={(el) => {
            rig.wheels.current[n] = el;
          }}
        />
      ))}
    </>
  );
}

/** A vehicle standing on `groundY` in scene units; the drive model moves it along x. */
export function Vehicle({
  kind,
  rig,
  groundY,
  x0 = 0,
}: {
  kind: VehicleKind;
  rig: VehicleRig;
  groundY: number;
  x0?: number;
}) {
  const uid = useId().replace(/:/g, "");
  return (
    <g transform={`translate(0 ${groundY - GEOMETRY[kind].ground})`}>
      <g ref={rig.root} transform={`translate(${x0} 0)`}>
        {kind === "car" ? <CarArt rig={rig} uid={uid} /> : <ScooterArt rig={rig} uid={uid} />}
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export type Segment =
  /** Hold the current speed until the vehicle reaches x. */
  | { kind: "cruise"; to: number }
  /** Constant acceleration (units/s²) until the vehicle reaches x. */
  | { kind: "accel"; a: number; to: number }
  /** Uniform braking that comes to rest exactly at x. */
  | { kind: "stop"; at: number }
  /** Stand still for a while. */
  | { kind: "wait"; ms: number };

interface DriveState {
  x: number;
  v: number;
  a: number;
  pitch: number;
  pitchV: number;
  seg: number;
  segT: number;
  brake: number | null;
}

const STEP = 1 / 240;
/** Degrees of pitch per unit/s² of acceleration, and the limit (a light hatchback on soft springs). */
const PITCH_GAIN = 0.011;
const PITCH_MAX = 2.4;
/** Suspension: ~2 Hz natural frequency, under-damped so it settles with one soft rock. */
const OMEGA = 2 * Math.PI * 2;
const ZETA = 0.38;

function advance(s: DriveState, segs: readonly Segment[], h: number): void {
  const seg = segs[s.seg];
  let a = 0;
  if (seg?.kind === "accel") a = seg.a;
  else if (seg?.kind === "stop") {
    s.brake ??= -(s.v * s.v) / (2 * Math.max(0.001, seg.at - s.x));
    a = s.brake;
  }
  s.a = a;
  if (seg?.kind === "wait") s.v = 0;
  s.v += a * h;
  s.x += s.v * h;
  s.segT += h;
  if (seg) {
    const doneSeg =
      (seg.kind === "cruise" && s.x >= seg.to) ||
      (seg.kind === "accel" && s.x >= seg.to) ||
      (seg.kind === "stop" && s.v <= 0) ||
      (seg.kind === "wait" && s.segT * 1000 >= seg.ms);
    if (doneSeg) {
      if (seg.kind === "stop") {
        s.v = 0;
        s.x = seg.at;
      }
      s.seg += 1;
      s.segT = 0;
      s.brake = null;
    }
  }
  const target = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, -PITCH_GAIN * s.a));
  s.pitchV += (OMEGA * OMEGA * (target - s.pitch) - 2 * ZETA * OMEGA * s.pitchV) * h;
  s.pitch += s.pitchV * h;
}

function render(s: DriveState, rig: VehicleRig, kind: VehicleKind) {
  const g = GEOMETRY[kind];
  rig.root.current?.setAttribute("transform", `translate(${s.x.toFixed(2)} 0)`);
  rig.body.current?.setAttribute(
    "transform",
    `rotate(${s.pitch.toFixed(3)} ${g.pivot[0]} ${g.pivot[1]})`,
  );
  const deg = ((s.x / g.radius) * 180) / Math.PI;
  g.wheels.forEach(([cx, cy], n) => {
    rig.wheels.current[n]?.setAttribute("transform", `rotate(${deg.toFixed(2)} ${cx} ${cy})`);
  });
}

/**
 * Drives a rig through `segments` from (x0, v0). When `planKey` changes the new segments continue
 * from the live position and speed, so a plan can be redirected mid-motion without a jump. Under
 * reduced motion the vehicle is placed at the end state at once. `onSettle` fires when the plan is
 * finished and the body has come to rest.
 */
export function useDrive({
  rig,
  kind,
  x0,
  v0,
  segments,
  planKey,
  reduce,
  onSettle,
}: {
  rig: VehicleRig;
  kind: VehicleKind;
  x0: number;
  v0: number;
  segments: readonly Segment[];
  planKey: string;
  reduce: boolean;
  onSettle?: () => void;
}) {
  const state = useRef<DriveState | null>(null);
  const plan = useRef(segments);
  plan.current = segments;
  const settle = useRef(onSettle);
  settle.current = onSettle;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new plan is signalled by planKey alone.
  useEffect(() => {
    const segs = plan.current;
    const s: DriveState = state.current ?? {
      x: x0,
      v: v0,
      a: 0,
      pitch: 0,
      pitchV: 0,
      seg: 0,
      segT: 0,
      brake: null,
    };
    s.seg = 0;
    s.segT = 0;
    s.brake = null;
    state.current = s;

    if (reduce) {
      for (let n = 0; n < 240 * 20 && s.seg < segs.length; n++) advance(s, segs, STEP);
      s.pitch = 0;
      s.pitchV = 0;
      render(s, rig, kind);
      settle.current?.();
      return;
    }

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      let dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      while (dt > 1e-6) {
        const h = Math.min(STEP, dt);
        advance(s, segs, h);
        dt -= h;
      }
      render(s, rig, kind);
      const resting = Math.abs(s.pitch) < 0.01 && Math.abs(s.pitchV) < 0.02;
      if (s.seg >= segs.length && resting) {
        settle.current?.();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    render(s, rig, kind);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [planKey, reduce]);
}

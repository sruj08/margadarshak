"use client";

import "./fx.css";
import { Check, ShieldCheck } from "lucide-react";
import {
  animate,
  m,
  useMotionValue,
  useReducedMotionConfig,
  useSpring,
  useTransform,
} from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AadhaarMark, DigiLockerMark } from "./marks";
import { useDrive, useRig, Vehicle } from "./vehicles";

/** Apple-style critically damped spring (no bounce) for things that appear on their own. */
const SETTLE = { type: "spring", bounce: 0, duration: 0.5 } as const;

/* ------------------------------------------------------------------------------------------ */

type LinkState = "idle" | "forward" | "back" | "linked" | "verified";

/** A dashed track that fills solid once linked; data pulses run along it while it is in use. */
function Link({ state }: { state: LinkState }) {
  const running = state === "forward" || state === "back";
  return (
    <span className="fx-link" data-state={state} aria-hidden="true">
      <span className="fx-link__track" />
      <span className="fx-link__fill" />
      {running ? (
        <>
          <span className="fx-link__run" data-dir={state}>
            <span className="fx-link__dot" />
          </span>
          <span className="fx-link__run fx-link__run--late" data-dir={state}>
            <span className="fx-link__dot" />
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Which link carries data at each step: (1) open a secure link to DigiLocker, (2) consent is
 * recorded at DigiLocker, (3) DigiLocker checks Aadhaar, (4) the details travel back to the app.
 */
const DESTINATION = [1, 1, 2, 0] as const;

function linkStates(i: number, total: number): [LinkState, LinkState] {
  if (i >= total) return ["verified", "verified"];
  if (i === 0) return ["forward", "idle"];
  if (i === 1) return ["linked", "idle"];
  if (i === 2) return ["linked", "forward"];
  return ["back", "back"];
}

/**
 * The connect moment (mParivahan pattern: licence → state → connect Aadhaar → details fetched):
 * three nodes joined by links that light up as each step completes, and a checklist that ticks one
 * step at a time. Calls onDone after the last tick. Labels come from the message files.
 */
export function ConnectFlow({
  labels,
  steps,
  onDone,
  stepMs = 750,
}: {
  labels: { app: string; locker: string; aadhaar: string };
  steps: string[];
  onDone: () => void;
  stepMs?: number;
}) {
  const reduce = useReducedMotionConfig() ?? false;
  const [i, setI] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (i >= steps.length) {
      const h = setTimeout(() => done.current(), reduce ? 0 : 450);
      return () => clearTimeout(h);
    }
    const h = setTimeout(() => setI((v) => v + 1), reduce ? 120 : stepMs);
    return () => clearTimeout(h);
  }, [i, steps.length, stepMs, reduce]);

  const [a, b] = linkStates(i, steps.length);
  const active = i >= steps.length ? -1 : (DESTINATION[Math.min(i, DESTINATION.length - 1)] ?? -1);
  const nodes = [
    {
      key: "app",
      label: labels.app,
      badge: (
        <span className="fx-node__badge fx-node__badge--app">
          <img src="/brand/margdarshak-mark-light.svg" alt="" width={36} height={36} />
        </span>
      ),
    },
    {
      key: "locker",
      label: labels.locker,
      badge: (
        <span className="fx-node__badge fx-node__badge--mark">
          <DigiLockerMark size={52} />
        </span>
      ),
    },
    {
      key: "aadhaar",
      label: labels.aadhaar,
      badge: (
        <span className="fx-node__badge fx-node__badge--mark">
          <AadhaarMark size={52} />
        </span>
      ),
    },
  ];

  return (
    <div className="fx-connect" role="status" aria-live="polite">
      <div className="fx-connect__nodes">
        {nodes.map((n, k) => (
          <ConnectNode
            key={n.key}
            index={k}
            label={n.label}
            badge={n.badge}
            active={active === k}
            verified={i >= steps.length}
            reduce={reduce}
            link={k < 2 ? <Link state={k === 0 ? a : b} /> : null}
          />
        ))}
      </div>
      <ul className="fx-steps">
        {steps.map((s, n) => {
          const state = n < i ? "done" : n === i ? "busy" : "todo";
          return (
            <m.li
              key={s}
              className="fx-step"
              data-state={state}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: n <= i ? 1 : 0.5, y: 0 }}
              transition={{ ...SETTLE, delay: reduce ? 0 : 0.18 + n * 0.05 }}
            >
              <span className="fx-step__icon">
                {state === "done" ? (
                  <m.span
                    className="fx-step__check"
                    initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", bounce: 0.35, duration: 0.4 }}
                  >
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </m.span>
                ) : null}
              </span>
              {s}
            </m.li>
          );
        })}
      </ul>
    </div>
  );
}

function ConnectNode({
  index,
  label,
  badge,
  active,
  verified,
  reduce,
  link,
}: {
  index: number;
  label: string;
  badge: ReactNode;
  active: boolean;
  verified: boolean;
  reduce: boolean;
  link: ReactNode;
}) {
  return (
    <>
      <m.div
        className="fx-node"
        data-active={active ? "true" : undefined}
        data-verified={verified ? "true" : undefined}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...SETTLE, delay: reduce ? 0 : index * 0.07 }}
      >
        <span className="fx-node__ring">{badge}</span>
        <span className="fx-node__label">{label}</span>
      </m.div>
      {link}
    </>
  );
}

/* ------------------------------------------------------------------------------------------ */

/** Tilt limits in degrees: enough to read as a physical card, not enough to blur the text. */
const TILT_X = 6;
const TILT_Y = 8;

/**
 * A card that arrives with a short spring and, under a mouse or pen, tilts toward the pointer with a
 * light sheen. Touch skips the tilt so scrolling never leaves the card skewed; flat under reduced
 * motion.
 */
export function Tilt3D({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotionConfig() ?? false;
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 170, damping: 22, mass: 0.7 };
  const rx = useSpring(useTransform(py, [0, 1], [TILT_X, -TILT_X]), spring);
  const ry = useSpring(useTransform(px, [0, 1], [-TILT_Y, TILT_Y]), spring);
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    if (reduce || e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    px.set(x);
    py.set(y);
    ref.current?.style.setProperty("--fx-x", `${Math.round(x * 100)}%`);
    ref.current?.style.setProperty("--fx-y", `${Math.round(y * 100)}%`);
  };
  const leave = () => {
    px.set(0.5);
    py.set(0.5);
  };
  return (
    <div className={`fx-tilt ${className ?? ""}`} onPointerMove={move} onPointerLeave={leave}>
      <m.div
        ref={ref}
        {...(reduce ? {} : { style: { rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" } })}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduce ? { duration: 0.2 } : { type: "spring", bounce: 0.12, duration: 0.7 }}
      >
        {children}
      </m.div>
    </div>
  );
}

export interface IdentityFields {
  name: string;
  nameHi: string;
  dob: string;
  gender: string;
  last4: string;
}

const FINDERS = [
  [0, 0],
  [14, 0],
  [0, 14],
] as const;

/** Deterministic QR-like matrix (decorative; carries no data). */
function MiniQr({ seed }: { seed: string }) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++) {
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      const f = FINDERS.find(([ox, oy]) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7);
      const on = f
        ? (() => {
            const dx = x - f[0];
            const dy = y - f[1];
            return (
              dx === 0 ||
              dy === 0 ||
              dx === 6 ||
              dy === 6 ||
              (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
            );
          })()
        : h % 2 === 0;
      if (on) cells.push([x, y]);
    }
  return (
    <svg
      className="fx-aadhaar__qr"
      viewBox="0 0 21 21"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#111" />
      ))}
    </svg>
  );
}

/**
 * The identity fetched over DigiLocker, laid out like the familiar Aadhaar card so people recognise
 * it at a glance, but clearly a demo: no national emblem, no "Government of India" mark, a
 * "Simulated" seal, a silhouette instead of a face, and only the last 4 digits (D-07, D-19).
 */
export function IdentityCard({
  f,
  labels,
}: {
  f: IdentityFields;
  labels: {
    band: string;
    bandHi: string;
    seal: string;
    dob: string;
    gender: string;
    footer: string;
  };
}) {
  return (
    <Tilt3D>
      <div className="fx-aadhaar" data-testid="id-card">
        <div className="fx-aadhaar__top">
          <span className="fx-aadhaar__seal" aria-hidden="true">
            <ShieldCheck />
          </span>
          <span className="fx-aadhaar__bands">
            <span className="fx-aadhaar__band fx-aadhaar__band--saffron" lang="hi">
              {labels.bandHi}
            </span>
            <span className="fx-aadhaar__band fx-aadhaar__band--green">{labels.band}</span>
          </span>
        </div>
        <div className="fx-aadhaar__body">
          <span className="fx-aadhaar__photo" aria-hidden="true">
            <svg viewBox="0 0 60 72">
              <rect width="60" height="72" fill="#eef2f7" />
              <circle cx="30" cy="27" r="13" fill="#9aa8bb" />
              <path d="M6 72 Q8 46 30 46 Q52 46 54 72 Z" fill="#9aa8bb" />
            </svg>
          </span>
          <span className="fx-aadhaar__fields">
            <span className="fx-aadhaar__hi" lang="hi">
              {f.nameHi}
            </span>
            <span className="fx-aadhaar__name">{f.name.toUpperCase()}</span>
            <span>
              {labels.dob}: <b>{f.dob}</b>
            </span>
            <span>
              {labels.gender}: <b>{f.gender}</b>
            </span>
          </span>
          <MiniQr seed={f.name + f.last4} />
        </div>
        <span className="fx-aadhaar__num">XXXX XXXX {f.last4}</span>
        <span className="fx-aadhaar__rule" aria-hidden="true" />
        <span className="fx-aadhaar__footer">
          <span className="fx-aadhaar__stamp">{labels.seal}</span> · {labels.footer}
        </span>
      </div>
    </Tilt3D>
  );
}

/* ------------------------------------------------------------------------------------------ */

/** Toll scene, 360 x 120: the lane's ground line, the barrier pivot and where the car halts. */
const TOLL = {
  w: 360,
  ground: 106,
  post: 240,
  /** The arm hinges on a bracket right of the post, so when raised it never covers the light. */
  pivot: [253, 84] as const,
  armLength: 72,
  stopAt: 152,
};
/** Barrier: a light, stiff arm on a counterweight, so it lifts briskly and bounces once at the top. */
const BARRIER_UP = -84;

/**
 * Payment in progress: the car brakes to a halt beside the booth window and waits at the red light.
 * When the bank confirms, the light turns green, the barrier lifts and the car pulls away. The
 * timing fits the gateway: arrival settles inside its 1.8 s wait, the exit clears inside 1.5 s.
 * Decorative; the status text carries the meaning.
 */
export function TollDrive({ done }: { done: boolean }) {
  const reduce = useReducedMotionConfig() ?? false;
  const rig = useRig();
  const arm = useRef<SVGGElement>(null);
  const segments = done
    ? [{ kind: "wait", ms: 320 } as const, { kind: "accel", a: 360, to: TOLL.w + 40 } as const]
    : [{ kind: "cruise", to: -10 } as const, { kind: "stop", at: TOLL.stopAt } as const];
  useDrive({
    rig,
    kind: "car",
    x0: reduce ? TOLL.stopAt : -80,
    v0: 240,
    segments,
    planKey: done ? "go" : "arrive",
    reduce,
  });

  useEffect(() => {
    const [px, py] = TOLL.pivot;
    const set = (deg: number) =>
      arm.current?.setAttribute("transform", `rotate(${deg.toFixed(2)} ${px} ${py})`);
    if (!done) {
      set(0);
      return;
    }
    if (reduce) {
      set(BARRIER_UP);
      return;
    }
    const controls = animate(0, BARRIER_UP, {
      type: "spring",
      stiffness: 260,
      damping: 17,
      onUpdate: set,
    });
    return () => controls.stop();
  }, [done, reduce]);

  const [px, py] = TOLL.pivot;
  return (
    <svg
      className="fx-toll"
      viewBox={`0 0 ${TOLL.w} 120`}
      aria-hidden="true"
      data-done={done ? "true" : "false"}
    >
      <defs>
        <clipPath id="fx-toll-clip">
          <rect width={TOLL.w} height="120" rx="16" />
        </clipPath>
        <pattern id="fx-toll-stripes" width="16" height="6" patternUnits="userSpaceOnUse">
          <rect width="16" height="6" fill="#f8fafc" />
          <rect width="8" height="6" fill="#e5484d" />
        </pattern>
      </defs>
      <g clipPath="url(#fx-toll-clip)">
        <rect className="fx-scene__sky" width={TOLL.w} height="120" />
        <rect className="fx-scene__verge" y="72" width={TOLL.w} height="8" />
        <rect className="fx-scene__road" y="80" width={TOLL.w} height="40" />
        <rect className="fx-scene__kerb" y="80" width={TOLL.w} height="1.5" />
        <line className="fx-scene__lane" x1="0" y1="113" x2={TOLL.w} y2="113" />

        <g className="fx-toll__booth">
          <rect x="166" y="26" width="58" height="7" rx="2.5" className="fx-toll__roof" />
          <rect x="172" y="33" width="46" height="47" rx="3" className="fx-toll__wall" />
          <rect x="178" y="40" width="34" height="18" rx="2.5" className="fx-toll__glass" />
          <rect x="178" y="62" width="34" height="3" rx="1.5" className="fx-toll__sill" />
        </g>

        <rect x={TOLL.post - 3.5} y="50" width="7" height="36" rx="2" fill="#4b5563" />
        <rect
          x={TOLL.post}
          y={py - 2.5}
          width={px - TOLL.post}
          height="5"
          rx="1.5"
          fill="#4b5563"
        />
        <rect x={TOLL.post - 7} y="34" width="14" height="18" rx="4" fill="#20242c" />
        <circle className="fx-toll__light" cx={TOLL.post} cy="43" r="4.2" />
        <g ref={arm}>
          <rect
            x={px}
            y={py - 3}
            width={TOLL.armLength}
            height="6"
            rx="3"
            fill="url(#fx-toll-stripes)"
          />
          <rect
            x={px}
            y={py - 3}
            width={TOLL.armLength}
            height="6"
            rx="3"
            fill="none"
            stroke="#000"
            strokeOpacity="0.14"
          />
        </g>
        <circle cx={px} cy={py} r="4" fill="#374151" />
        <circle cx={px} cy={py} r="1.6" fill="#9ca3af" />

        <Vehicle kind="car" rig={rig} groundY={TOLL.ground} x0={reduce ? TOLL.stopAt : -80} />
      </g>
    </svg>
  );
}

/** The receipt feeds down out of a slot, with a torn bottom edge. */
export function ReceiptRoll({ children }: { children: ReactNode }) {
  const reduce = useReducedMotionConfig() ?? false;
  return (
    <div className="fx-printer">
      <div className="fx-printer__slot" aria-hidden="true" />
      <div className="fx-printer__paper">
        <m.div
          className="fx-receipt"
          initial={reduce ? { opacity: 0 } : { y: "-100%" }}
          animate={reduce ? { opacity: 1 } : { y: "0%" }}
          transition={
            reduce ? { duration: 0.2 } : { duration: 1.2, delay: 0.15, ease: [0.25, 1, 0.5, 1] }
          }
        >
          {children}
        </m.div>
      </div>
    </div>
  );
}

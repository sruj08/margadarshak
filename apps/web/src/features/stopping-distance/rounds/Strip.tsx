"use client";

import type { Surface } from "@margdarshak/game-core/schema";
import { useId } from "react";
import { SD_UI } from "../config";

export interface StripProps {
  /** Metres shown from the bike (0) to the right edge. */
  maxM: number;
  surface: Surface;
  /** The learner's marker (m). */
  guessM?: number | null;
  /** Thinking and braking segments (m); both drawn from 0. */
  reactionM?: number | null;
  brakingM?: number | null;
  /** Where the bike is drawn (m). */
  bikeM?: number;
  /** Child (round 2) or pedestrian (round 1, beyond the stop point) position (m). */
  personM?: number | null;
  /** Hedge or bend that ends the clear road (round 3). */
  wallM?: number | null;
  /** Parked cars along the kerb (round 2). */
  parked?: boolean;
  moving?: boolean;
  animate?: boolean;
  labels: { title: string; wet: string; you: string; metres: (m: number) => string };
}

const W = 340;
const H = 132;
const PAD = 16;
const ROAD_Y = 34;
const ROAD_H = 56;

/**
 * Top-down road strip in SVG (UI_SPEC_LEARN_GAMES §5.2): metre ticks every 10 m, the bike at 0, the
 * learner's marker, the thinking distance (dotted) and braking distance (solid) as two patterned
 * segments, and a wet surface as a droplet texture plus the word. Shapes and patterns carry every
 * state, never colour alone. The numbers are always printed in the text beside it.
 */
export function Strip(p: StripProps) {
  const id = useId().replaceAll(":", "");
  const x = (m: number) => PAD + (Math.max(0, Math.min(m, p.maxM)) / p.maxM) * (W - 2 * PAD);
  const ticks: number[] = [];
  for (let m = 0; m <= p.maxM; m += SD_UI.tickM) ticks.push(m);
  const segY = ROAD_Y + ROAD_H - 14;
  const reaction = p.reactionM ?? null;
  const braking = p.brakingM ?? null;
  const cls = `sd-strip${p.moving ? " sd-strip--moving" : ""}${p.animate ? " sd-strip--animate" : ""}`;
  return (
    <svg
      className={cls}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={p.labels.title}
      data-testid="sd-strip"
    >
      <title>{p.labels.title}</title>
      <defs>
        <pattern id={`${id}-wet`} width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M7 3c2 3 3 4.5 3 6a3 3 0 0 1-6 0c0-1.5 1-3 3-6z" fill="#56B4E9" opacity="0.55" />
        </pattern>
        <pattern id={`${id}-dots`} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="2.2" fill="#F0E442" />
        </pattern>
      </defs>
      <rect x="0" y={ROAD_Y} width={W} height={ROAD_H} fill="#2A2C33" />
      <path d={`M0 ${ROAD_Y} H${W} M0 ${ROAD_Y + ROAD_H} H${W}`} stroke="#c9ccd3" strokeWidth="2" />
      {p.surface === "wet" ? (
        <rect x="0" y={ROAD_Y} width={W} height={ROAD_H} fill={`url(#${id}-wet)`} />
      ) : null}
      <g className="sd-strip__dashes">
        {Array.from({ length: 18 }, (_, i) => (
          <rect
            key={`d${i * 24}`}
            x={i * 24}
            y={ROAD_Y + ROAD_H / 2 - 1}
            width="12"
            height="2"
            fill="#c9ccd3"
          />
        ))}
      </g>
      {p.parked
        ? Array.from({ length: 6 }, (_, i) => (
            <rect
              key={`car${i * 56}`}
              x={x(6) + i * 50}
              y={ROAD_Y + 2}
              width="34"
              height="12"
              rx="3"
              fill="#8a8f99"
            />
          ))
        : null}
      {p.wallM !== undefined && p.wallM !== null ? (
        <g data-testid="sd-wall">
          <rect
            x={x(p.wallM)}
            y={ROAD_Y - 6}
            width={W - x(p.wallM)}
            height={ROAD_H + 12}
            fill="#3d6b3a"
          />
          <path
            d={`M${x(p.wallM)} ${ROAD_Y - 6} v${ROAD_H + 12}`}
            stroke="#fff"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        </g>
      ) : null}
      {reaction !== null ? (
        <rect
          className="sd-strip__seg"
          x={x(0)}
          y={segY}
          width={Math.max(0, x(reaction) - x(0))}
          height="10"
          fill={`url(#${id}-dots)`}
          stroke="#F0E442"
          data-testid="sd-seg-think"
        />
      ) : null}
      {reaction !== null && braking !== null ? (
        <rect
          className="sd-strip__seg sd-strip__seg--late"
          x={x(reaction)}
          y={segY}
          width={Math.max(0, x(reaction + braking) - x(reaction))}
          height="10"
          fill="#0072B2"
          stroke="#fff"
          data-testid="sd-seg-brake"
        />
      ) : null}
      {p.personM !== undefined && p.personM !== null ? (
        <g transform={`translate(${x(p.personM)} ${ROAD_Y + 18})`} data-testid="sd-person">
          <circle cx="0" cy="-6" r="4" fill="#E69F00" />
          <rect x="-3" y="-2" width="6" height="12" rx="2" fill="#E69F00" />
        </g>
      ) : null}
      <g
        transform={`translate(${x(p.bikeM ?? 0)} ${ROAD_Y + ROAD_H / 2 + 8})`}
        className="sd-strip__bike"
      >
        <rect x="-10" y="-4" width="20" height="8" rx="3" fill="#fff" />
        <circle cx="-7" cy="5" r="3" fill="#fff" />
        <circle cx="7" cy="5" r="3" fill="#fff" />
      </g>
      {p.guessM !== undefined && p.guessM !== null ? (
        <g transform={`translate(${x(p.guessM)} ${ROAD_Y - 2})`} data-testid="sd-guess">
          <path d="M0 0 l-7 -12 h14 z" fill="#CC79A7" stroke="#fff" />
          <path d={`M0 0 v${ROAD_H + 2}`} stroke="#CC79A7" strokeWidth="2" strokeDasharray="3 2" />
        </g>
      ) : null}
      {ticks.map((m) => (
        <g key={m} transform={`translate(${x(m)} ${ROAD_Y + ROAD_H})`}>
          <path d="M0 0 v6" stroke="currentColor" />
          <text y="20" textAnchor="middle" fontSize="11" fill="currentColor">
            {m}
          </text>
        </g>
      ))}
      <text x={PAD} y="14" fontSize="11" fill="currentColor">
        {p.labels.you}
      </text>
      {p.surface === "wet" ? (
        <text x={W - PAD} y="14" fontSize="11" textAnchor="end" fill="currentColor">
          {p.labels.wet}
        </text>
      ) : null}
      <text x={W - PAD} y={H - 2} fontSize="10" textAnchor="end" fill="currentColor">
        {p.labels.metres(p.maxM)}
      </text>
    </svg>
  );
}

/** Rounds a strip length up to the next tick, with one tick of headroom. */
export const stripMax = (m: number, floor: number): number =>
  Math.max(floor, Math.ceil((m + SD_UI.tickM) / SD_UI.tickM) * SD_UI.tickM);

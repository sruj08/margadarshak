"use client";

import { vehicleZones } from "@margdarshak/game-core/scoring";
import type { Polygon } from "@margdarshak/game-core/sim";
import { useId } from "react";
import type { PartB } from "../geometry";
import { BIKE, ZONE_NAMES } from "../geometry";
import type { RideSnapshot } from "../ride";

/** Metres of road shown ahead of and behind the rider [D]. */
export const VIEW = { aheadM: 24, behindM: 8, vergeM: 1.5 } as const;

/**
 * Top-down SVG of the Part B ride for the decision version: the road, the truck with its hatched
 * no-zones, the indicator (arrow plus the word, steady, no blinking) and the rider. Positions come
 * from the ride controller's snapshot.
 */
export function RideDiagram(p: {
  spec: PartB;
  snap: RideSnapshot;
  title: string;
  zoneLabel: string;
  leftWord: string;
  youWord: string;
}) {
  const id = useId().replaceAll(":", "");
  const { snap } = p;
  const W = snap.road.widthM + 2 * VIEW.vergeM;
  const H = VIEW.aheadM + VIEW.behindM;
  const top = snap.rider.prog + VIEW.aheadM;
  // SVG units are metres: x from the left verge, y downward from the top of the view.
  const sx = (lat: number) => lat + VIEW.vergeM;
  const sy = (prog: number) => top - prog;
  const { body, zones } = vehicleZones(p.spec.vehicleType);
  const toRoad = (poly: Polygon) =>
    `${poly
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${sx(snap.truck.lat + v.x).toFixed(2)} ${sy(snap.truck.prog + v.y).toFixed(2)}`,
      )
      .join(" ")}Z`;
  const dashes: number[] = [];
  const first = Math.floor((top - H) / 6) * 6;
  for (let m = first; m <= top; m += 6) dashes.push(m);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="bs-ride"
      role="img"
      aria-label={p.title}
      data-testid="bs-ride-diagram"
    >
      <title>{p.title}</title>
      <defs>
        <pattern
          id={`${id}-h`}
          width="0.8"
          height="0.8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="0.8" height="0.8" fill="#E69F00" opacity="0.3" />
          <path d="M0 0 V0.8" stroke="#E69F00" strokeWidth="0.25" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#3d6b3a" />
      <rect x={sx(0)} y="0" width={snap.road.widthM} height={H} fill="#2A2C33" />
      {dashes.map((m) => (
        <rect
          key={m}
          x={sx(snap.road.laneLeftM) - 0.06}
          y={sy(m)}
          width="0.12"
          height="3"
          fill="#c9ccd3"
        />
      ))}
      {snap.truck.present ? (
        <g data-testid="bs-ride-truck">
          {zones.map((z, i) => (
            <path
              key={ZONE_NAMES[i] ?? i}
              d={toRoad(z)}
              fill={`url(#${id}-h)`}
              stroke="#E69F00"
              strokeWidth="0.08"
            />
          ))}
          <path d={toRoad(body)} fill="#c9ccd3" stroke="#fff" strokeWidth="0.08" />
          {snap.truck.indicating ? (
            <g
              transform={`translate(${sx(snap.truck.lat)} ${sy(snap.truck.prog) + 2})`}
              data-testid="bs-indicator"
            >
              <path d="M-1 0 l1 -0.7 v1.4 z" fill="#F0E442" />
              <text x="0.3" y="0.35" fontSize="0.9" fill="#000" fontWeight="700">
                {p.leftWord}
              </text>
            </g>
          ) : null}
          <text
            x={sx(snap.truck.lat)}
            y={sy(snap.truck.prog) + 6}
            fontSize="0.8"
            textAnchor="middle"
            fill="#fff"
          >
            {p.zoneLabel}
          </text>
        </g>
      ) : null}
      <g
        transform={`translate(${sx(snap.rider.lat)} ${sy(snap.rider.prog)})`}
        data-testid="bs-ride-rider"
      >
        <rect
          x={-BIKE.halfWidthM}
          y={-BIKE.halfLengthM}
          width={2 * BIKE.halfWidthM}
          height={2 * BIKE.halfLengthM}
          rx="0.2"
          fill={snap.zone === null ? "#56B4E9" : "#D55E00"}
          stroke="#fff"
          strokeWidth="0.1"
        />
        <text y={BIKE.halfLengthM + 1} fontSize="0.8" textAnchor="middle" fill="#fff">
          {p.youWord}
        </text>
      </g>
    </svg>
  );
}

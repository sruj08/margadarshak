"use client";

import type { VehicleType } from "@margdarshak/game-core/schema";
import { vehicleZones } from "@margdarshak/game-core/scoring";
import type { Polygon, Vec2 } from "@margdarshak/game-core/sim";
import { useId } from "react";
import { BIKE, geometryOf, type Spot, ZONE_NAMES } from "../geometry";

/** SVG viewBox size (px). */
const VB = { w: 320, h: 380 } as const;

/**
 * Centre (vehicle frame) and scale (px per m) that fit every spot and zone in a w × h box at this
 * orientation, with a bike length of margin. Display only.
 */
export function diagramFrame(
  type: VehicleType,
  spots: readonly Spot[],
  thetaDeg: number,
  w: number,
  h: number,
) {
  const { zones, body } = vehicleZones(type);
  const pts: Vec2[] = [...spots, ...body, ...zones.flat()];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const c = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  const th = (thetaDeg * Math.PI) / 180;
  let rx = 0;
  let ry = 0;
  for (const p of pts) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    rx = Math.max(rx, Math.abs(dx * Math.cos(th) - dy * Math.sin(th)));
    ry = Math.max(ry, Math.abs(dx * Math.sin(th) + dy * Math.cos(th)));
  }
  const m = 2 * BIKE.halfLengthM;
  return { c, scale: Math.min(w / (2 * (rx + m)), h / (2 * (ry + m))) };
}

/**
 * Still top-down diagram of a truck, bus or tanker at its seeded orientation (UI_SPEC_LEARN_GAMES
 * §5.3), with the eight numbered spots. After a commit the four no-zones appear: orange, cross-hatch,
 * an eye-off mark and the words "Can't see you" (shape, pattern and words, never colour alone).
 * Used by the decision version; the Phaser scene draws the same geometry.
 */
export function VehicleDiagram(p: {
  type: VehicleType;
  thetaDeg: number;
  spots: readonly Spot[];
  selected: number | null;
  placed: Vec2 | null;
  placedVisible: boolean | null;
  showZones: boolean;
  zoneLabel: string;
  title: string;
}) {
  const id = useId().replaceAll(":", "");
  const { c, scale } = diagramFrame(p.type, p.spots, p.thetaDeg, VB.w, VB.h);
  const { body, zones } = vehicleZones(p.type);
  const g = geometryOf(p.type);
  const X = (v: Vec2) => (v.x - c.x) * scale;
  const Y = (v: Vec2) => -(v.y - c.y) * scale;
  const path = (poly: Polygon) =>
    `${poly.map((v, i) => `${i === 0 ? "M" : "L"}${X(v).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ")}Z`;
  const centre = (poly: Polygon): Vec2 => ({
    x: poly.reduce((s, v) => s + v.x, 0) / poly.length,
    y: poly.reduce((s, v) => s + v.y, 0) / poly.length,
  });
  const upright = `rotate(${p.thetaDeg})`;
  return (
    <svg
      viewBox={`${-VB.w / 2} ${-VB.h / 2} ${VB.w} ${VB.h}`}
      className="bs-diagram"
      role="img"
      aria-label={p.title}
      data-testid="bs-diagram"
    >
      <title>{p.title}</title>
      <defs>
        <pattern
          id={`${id}-hatch`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill="#E69F00" opacity="0.35" />
          <path d="M0 0 V8 M4 0 V8" stroke="#E69F00" strokeWidth="2" />
        </pattern>
      </defs>
      <rect x={-VB.w / 2} y={-VB.h / 2} width={VB.w} height={VB.h} fill="#2A2C33" />
      <g transform={`rotate(${-p.thetaDeg})`}>
        {p.showZones
          ? zones.map((z, i) => {
              const m = centre(z);
              return (
                <g key={ZONE_NAMES[i] ?? i} data-testid="bs-zone">
                  <path d={path(z)} fill={`url(#${id}-hatch)`} stroke="#E69F00" strokeWidth="1.5" />
                  <g transform={`translate(${X(m)} ${Y(m)}) ${upright}`}>
                    <EyeOff />
                    <text y="16" textAnchor="middle" fontSize="9" fill="#fff">
                      {p.zoneLabel}
                    </text>
                  </g>
                </g>
              );
            })
          : null}
        <path d={path(body)} fill="#c9ccd3" stroke="#fff" />
        <rect
          x={X({ x: -g.widthM / 2, y: 0 })}
          y={Y({ x: 0, y: 0 })}
          width={g.widthM * scale}
          height={Math.min(2.2, g.lengthM / 4) * scale}
          fill="#8a8f99"
        />
        <path d={`M${X({ x: 0, y: 0 })} ${Y({ x: 0, y: 0 }) - 10} l-6 8 h12 z`} fill="#fff" />
        {(p.showZones ? [] : p.spots).map((s) => {
          const on = p.selected === s.n;
          return (
            <g key={s.n} transform={`translate(${X(s)} ${Y(s)}) ${upright}`} data-spot={s.n}>
              <circle
                r="11"
                fill={on ? "#F0E442" : "#1f2026"}
                stroke={on ? "#fff" : "#c9ccd3"}
                strokeWidth={on ? 3 : 1.5}
              />
              <text
                y="4"
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill={on ? "#000" : "#fff"}
              >
                {s.n}
              </text>
            </g>
          );
        })}
        {p.placed ? (
          <g transform={`translate(${X(p.placed)} ${Y(p.placed)})`} data-testid="bs-placed">
            <rect
              x={-BIKE.halfWidthM * scale}
              y={-BIKE.halfLengthM * scale}
              width={2 * BIKE.halfWidthM * scale}
              height={2 * BIKE.halfLengthM * scale}
              fill={p.placedVisible ? "#009E73" : "#D55E00"}
              stroke="#fff"
            />
            <g transform={`translate(0 ${-BIKE.halfLengthM * scale - 10}) ${upright}`}>
              {p.placedVisible ? (
                <path d="M-6 0 l4 4 l8 -8" stroke="#fff" strokeWidth="3" fill="none" />
              ) : (
                <EyeOff />
              )}
            </g>
          </g>
        ) : null}
      </g>
    </svg>
  );
}

function EyeOff() {
  return (
    <g stroke="#fff" strokeWidth="1.6" fill="none">
      <path d="M-7 0 Q0 -6 7 0 Q0 6 -7 0Z" />
      <circle r="2" />
      <path d="M-7 -6 L7 6" />
    </g>
  );
}

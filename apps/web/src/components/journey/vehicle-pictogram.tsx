import type { ReactNode } from "react";

/**
 * Vehicle pictograms (SCR-011 PictureChoice, DESIGN_SYSTEM §6 duotone set): flat shapes, a soft
 * fill and a currentColor outline so they follow light, dark and high contrast. Decorative only:
 * the card's text names the vehicle and its class code.
 */

const SOFT = "var(--md-primary-soft)";

function Wheel({ cx, cy, r = 7 }: { cx: number; cy: number; r?: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={SOFT} stroke="currentColor" strokeWidth="3" />
      <circle cx={cx} cy={cy} r={r / 3} fill="currentColor" />
    </>
  );
}

const S = {
  stroke: "currentColor",
  strokeWidth: 3,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

const PICTURES: Record<string, ReactNode> = {
  scooter: (
    <>
      <path d="M14 44h26c4 0 7-3 8-7l2-8h-9l-4 9H20z" fill={SOFT} {...S} />
      <path d="M44 29l-3-13h-6" fill="none" {...S} />
      <Wheel cx={16} cy={46} />
      <Wheel cx={48} cy={46} />
    </>
  ),
  scooter_50cc: (
    <>
      <path d="M16 43h22c3 0 6-2 7-6l1-6h-8l-3 7H22z" fill={SOFT} {...S} />
      <path d="M42 31l-2-11h-5" fill="none" {...S} />
      <Wheel cx={17} cy={45} r={6} />
      <Wheel cx={46} cy={45} r={6} />
      <text x="32" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">
        50
      </text>
    </>
  ),
  moped_50cc: (
    <>
      <path d="M16 43h22c3 0 6-2 7-6l1-6h-8l-3 7H22z" fill={SOFT} {...S} />
      <Wheel cx={17} cy={45} r={6} />
      <Wheel cx={46} cy={45} r={6} />
    </>
  ),
  bike_gear: (
    <>
      <path d="M17 44l9-14h14l8 14" fill="none" {...S} />
      <path d="M24 30h-6M38 30l4-10h6" fill="none" {...S} />
      <path d="M26 30c2-6 8-8 14-6l-2 6z" fill={SOFT} {...S} />
      <Wheel cx={15} cy={44} r={8} />
      <Wheel cx={49} cy={44} r={8} />
    </>
  ),
  car: (
    <>
      <path d="M8 42v-8l6-2 6-10h22l8 10 6 2v8z" fill={SOFT} {...S} />
      <path d="M22 32h22l-5-7H26z" fill="none" {...S} />
      <Wheel cx={18} cy={43} />
      <Wheel cx={46} cy={43} />
    </>
  ),
  taxi: (
    <>
      <path d="M8 42v-8l6-2 6-10h22l8 10 6 2v8z" fill={SOFT} {...S} />
      <rect x="26" y="14" width="12" height="6" rx="2" fill="currentColor" />
      <Wheel cx={18} cy={43} />
      <Wheel cx={46} cy={43} />
    </>
  ),
  auto_rickshaw: (
    <>
      <path d="M14 42V24c0-5 4-8 9-8h14l9 14v12z" fill={SOFT} {...S} />
      <path d="M24 24h12v8H24z" fill="none" {...S} />
      <Wheel cx={18} cy={44} r={6} />
      <Wheel cx={46} cy={44} r={6} />
    </>
  ),
  e_rickshaw: (
    <>
      <path d="M12 42V20h28l8 12v10z" fill={SOFT} {...S} />
      <path d="M12 20l4-6h20l4 6" fill="none" {...S} />
      <path d="M30 26l-3 5h4l-3 5" fill="none" {...S} />
      <Wheel cx={18} cy={44} r={6} />
      <Wheel cx={44} cy={44} r={6} />
    </>
  ),
  e_cart: (
    <>
      <path d="M8 40V26h26v14zM34 40V30h10l8 6v4z" fill={SOFT} {...S} />
      <path d="M20 29l-3 5h4l-3 5" fill="none" {...S} />
      <Wheel cx={16} cy={43} r={6} />
      <Wheel cx={44} cy={43} r={6} />
    </>
  ),
  goods_light: (
    <>
      <path d="M6 40V22h30v18zM36 40V28h12l8 7v5z" fill={SOFT} {...S} />
      <Wheel cx={16} cy={43} />
      <Wheel cx={46} cy={43} />
    </>
  ),
  goods_medium: (
    <>
      <path d="M4 40V18h34v22zM38 40V26h12l10 8v6z" fill={SOFT} {...S} />
      <Wheel cx={14} cy={43} />
      <Wheel cx={28} cy={43} />
      <Wheel cx={50} cy={43} />
    </>
  ),
  truck: (
    <>
      <path d="M2 40V14h38v26zM40 40V22h12l10 10v8z" fill={SOFT} {...S} />
      <Wheel cx={12} cy={44} />
      <Wheel cx={28} cy={44} />
      <Wheel cx={52} cy={44} />
    </>
  ),
  heavy_transport: (
    <>
      <path d="M2 38V16h44v22zM46 38V24h8l8 8v6z" fill={SOFT} {...S} />
      <path d="M2 38h60" fill="none" {...S} />
      <Wheel cx={10} cy={43} r={5} />
      <Wheel cx={22} cy={43} r={5} />
      <Wheel cx={40} cy={43} r={5} />
      <Wheel cx={54} cy={43} r={5} />
    </>
  ),
  bus: (
    <>
      <path d="M4 42V16c0-2 2-4 4-4h48c2 0 4 2 4 4v26z" fill={SOFT} {...S} />
      <path d="M10 18h10v8H10zM24 18h10v8H24zM38 18h10v8H38zM52 18h4v14" fill="none" {...S} />
      <Wheel cx={16} cy={44} r={6} />
      <Wheel cx={48} cy={44} r={6} />
    </>
  ),
  adapted_vehicle: (
    <>
      <path d="M8 42v-8l6-2 6-10h22l8 10 6 2v8z" fill={SOFT} {...S} />
      <circle cx="32" cy="28" r="3" fill="currentColor" />
      <path d="M30 32v5h6l2 4" fill="none" {...S} strokeWidth={2.5} />
      <Wheel cx={18} cy={43} r={6} />
      <Wheel cx={46} cy={43} r={6} />
    </>
  ),
};

export function VehiclePictogram({ picture, className }: { picture: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 56"
      aria-hidden="true"
      focusable="false"
      className={className}
      width="56"
      height="49"
    >
      {PICTURES[picture] ?? PICTURES["car"]}
    </svg>
  );
}

/** The picture shown for a class code (its first picture in classes.json). */
export const CLASS_PICTURE: Record<string, string> = {
  MC50CC: "scooter_50cc",
  MCWOG: "scooter",
  MCWG: "bike_gear",
  "LMV-NT": "car",
  "LMV-TR": "auto_rickshaw",
  "E-RICKSHAW": "e_rickshaw",
  "E-CART": "e_cart",
  MGV: "goods_medium",
  HGMV: "truck",
  HPMV: "bus",
  HTV: "heavy_transport",
  ADAPTED: "adapted_vehicle",
};

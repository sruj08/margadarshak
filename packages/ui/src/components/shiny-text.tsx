import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ShinyTextProps extends HTMLAttributes<HTMLSpanElement> {
  text?: string;
  children?: ReactNode;
  disabled?: boolean;
  /** Sweep cycle duration in seconds. */
  speed?: number;
}

/**
 * React Bits `ShinyText` (`@react-bits/ShinyText-TS-CSS`).
 * Renders a subtle luminous sweep across eyebrow badges, stage labels, and chips.
 * Automatically disabled in Lite mode and `prefers-reduced-motion: reduce`.
 */
export function ShinyText({
  text,
  children,
  disabled = false,
  speed = 4.5,
  className,
  style,
  ...rest
}: ShinyTextProps) {
  const customStyle = {
    "--rb-shine-duration": `${String(speed)}s`,
    ...style,
  } as CSSProperties;

  return (
    <span
      className={cx("rb-shiny-text", disabled && "rb-shiny-text--disabled", className)}
      style={customStyle}
      {...rest}
    >
      {text ?? children}
    </span>
  );
}

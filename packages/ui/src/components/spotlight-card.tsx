"use client";

import { type HTMLAttributes, type PropsWithChildren, useEffect, useRef } from "react";
import { cx } from "../lib/cx";

export interface SpotlightCardProps extends PropsWithChildren<HTMLAttributes<HTMLDivElement>> {
  /** CSS color for the radial spotlight glow. */
  spotlightColor?: string;
}

export function applySpotlightPosition(
  el: HTMLElement | null,
  clientX: number,
  clientY: number,
  spotlightColor?: string,
): void {
  if (!el) {
    return;
  }
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  el.style.setProperty("--mouse-x", `${String(Math.round(x))}px`);
  el.style.setProperty("--mouse-y", `${String(Math.round(y))}px`);
  if (spotlightColor) {
    el.style.setProperty("--spotlight-color", spotlightColor);
  }
}

/**
 * Client-side spotlight tracker that can be placed inside server-rendered
 * interactive containers (like `VerbTile`) without making the parent a client boundary.
 */
export function SpotlightOverlay({ spotlightColor }: { spotlightColor?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) {
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      applySpotlightPosition(parent, event.clientX, event.clientY, spotlightColor);
    };
    parent.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      parent.removeEventListener("pointermove", onPointerMove);
    };
  }, [spotlightColor]);

  return <span ref={ref} className="rb-spotlight-overlay" aria-hidden="true" />;
}

/**
 * React Bits `SpotlightCard` (`@react-bits/SpotlightCard-TS-CSS`).
 * Tracks pointer position via `--mouse-x` and `--mouse-y` CSS custom properties
 * to project a soft, warm radial spotlight across interactive bento surfaces.
 */
export function SpotlightCard({
  children,
  className = "",
  spotlightColor,
  ...rest
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) {
      return;
    }
    const onMove = (event: MouseEvent) => {
      applySpotlightPosition(el, event.clientX, event.clientY, spotlightColor);
    };
    el.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      el.removeEventListener("mousemove", onMove);
    };
  }, [spotlightColor]);

  return (
    <div ref={divRef} className={cx("rb-card-spotlight", className)} {...rest}>
      {children}
    </div>
  );
}

"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type HTMLAttributes, type ReactNode, useRef } from "react";
import { cx } from "../lib/cx";

gsap.registerPlugin(useGSAP);

export interface AnimatedContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  distance?: number;
  direction?: "vertical" | "horizontal";
  reverse?: boolean;
  duration?: number;
  ease?: string;
  initialOpacity?: number;
  animateOpacity?: boolean;
  scale?: number;
  delay?: number;
  onComplete?: () => void;
}

function shouldSkipContentMotion(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  const root = document.documentElement;
  if (root.getAttribute("data-lite") === "true" || root.getAttribute("data-motion") === "reduced") {
    return true;
  }
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return true;
  }
  return false;
}

/**
 * React Bits `AnimatedContent` (`@react-bits/AnimatedContent-TS-CSS`) powered by GSAP.
 * Orchestrates smooth, spring-like entrance choreography for cards, callouts, and lists.
 */
export function AnimatedContent({
  children,
  distance = 18,
  direction = "vertical",
  reverse = false,
  duration = 0.55,
  ease = "power3.out",
  initialOpacity = 0,
  animateOpacity = true,
  scale = 1,
  delay = 0,
  onComplete,
  className,
  ...rest
}: AnimatedContentProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || shouldSkipContentMotion()) {
        return;
      }
      const axis = direction === "horizontal" ? "x" : "y";
      const offset = reverse ? -distance : distance;

      const tween = gsap.fromTo(
        el,
        {
          [axis]: offset,
          scale,
          opacity: animateOpacity ? initialOpacity : 1,
        },
        {
          [axis]: 0,
          scale: 1,
          opacity: 1,
          duration,
          ease,
          delay,
          overwrite: "auto",
          onComplete: () => {
            gsap.set(el, { clearProps: "transform,opacity,willChange" });
            onComplete?.();
          },
        },
      );

      return () => {
        tween.kill();
      };
    },
    {
      dependencies: [
        distance,
        direction,
        reverse,
        duration,
        ease,
        initialOpacity,
        animateOpacity,
        scale,
        delay,
      ],
      scope: ref,
    },
  );

  return (
    <div ref={ref} className={cx("rb-animated-content", className)} {...rest}>
      {children}
    </div>
  );
}

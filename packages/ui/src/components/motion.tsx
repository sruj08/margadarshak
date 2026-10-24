"use client";

import { domAnimation, LazyMotion, MotionConfig, m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { revealVariants, staggerDelay } from "../lib/motion";

/**
 * Motion primitives (DESIGN_SYSTEM §8.4, MD-023).
 * - LazyMotion + `m.*` keeps the feature bundle small; `strict` throws if someone imports `motion.*`.
 * - reducedMotion follows the OS ("user"), or the in-app toggle (`reduced` = "always").
 * - Reduced motion collapses every preset to an opacity fade: no spatial movement, no loops.
 */
export function MotionRoot({
  children,
  reduced = false,
}: {
  children: ReactNode;
  reduced?: boolean;
}) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reduced ? "always" : "user"}>{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Rises 8 px and fades in once on mount (first paint only; skip on back navigation by not using it). */
export function Reveal({
  children,
  index = 0,
  className,
  as = "div",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const reduced = useReducedMotion() ?? false;
  const variants = revealVariants(reduced, 8, staggerDelay(index, reduced));
  const Comp = as === "li" ? m.li : as === "section" ? m.section : m.div;
  return (
    <Comp className={className} initial="hidden" animate="show" variants={variants}>
      {children}
    </Comp>
  );
}

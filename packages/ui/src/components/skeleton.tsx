"use client";

import { Skeleton as HeroSkeleton } from "@heroui/react";
import { cx } from "../lib/cx";

/**
 * Skeleton (DESIGN_SYSTEM §8.3): static blocks on --md-surface-2; the HeroUI shimmer is switched off.
 * The loading region itself carries aria-busy; skeleton blocks are hidden from assistive tech.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <HeroSkeleton
      animationType="none"
      className={cx("md-skeleton", className)}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ["100%", "92%", "78%", "86%", "64%"];
  return (
    <div className={cx("md-skeleton-text", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <HeroSkeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
          key={i}
          animationType="none"
          className="md-skeleton md-skeleton--line"
          style={{ width: widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}

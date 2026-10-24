"use client";

import { Chip as HeroChip } from "@heroui/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { StatusGlyph, type StatusKind } from "./status-glyph";

/**
 * Chip (DESIGN_SYSTEM §11.2): radius 12, never colour-only. A `tone` adds the matching status glyph
 * unless `glyph={false}`; the label text always carries the meaning.
 */
export type ChipTone =
  | "neutral"
  | "primary"
  | "success"
  | "caution"
  | "danger"
  | "info"
  | "simulated";

const TONE_GLYPH: Partial<Record<ChipTone, StatusKind>> = {
  success: "done",
  caution: "caution",
  danger: "danger",
  info: "info",
  simulated: "simulated",
};

export interface ChipProps {
  tone?: ChipTone;
  glyph?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  lang?: string;
}

export function Chip({
  tone = "neutral",
  glyph = true,
  icon,
  children,
  className,
  lang,
}: ChipProps) {
  const kind = TONE_GLYPH[tone];
  return (
    <HeroChip
      variant="soft"
      size="md"
      className={cx("md-chip", `md-chip--${tone}`, className)}
      {...(lang ? { lang } : {})}
    >
      {icon ?? (glyph && kind ? <StatusGlyph kind={kind} size={16} /> : null)}
      <HeroChip.Label className="md-chip__label">{children}</HeroChip.Label>
    </HeroChip>
  );
}

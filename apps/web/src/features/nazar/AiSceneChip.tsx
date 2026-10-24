"use client";

import { useTranslations } from "next-intl";

/**
 * "AI-generated scene" (ADR-0013): shown on every AI-generated clip, in mocks too (it says nothing
 * about where a hazard is). Read by screen readers, never aria-hidden. `overlay` sits on the clip's
 * top-left corner (clear of the hint line at the bottom); `inline` is a chip in the page flow.
 */
export function AiSceneChip({ variant = "inline" }: { variant?: "overlay" | "inline" }) {
  const t = useTranslations("nazar");
  if (variant === "overlay") {
    return (
      <span
        className="mg-clip__label"
        style={{ top: "var(--md-space-2)", bottom: "auto", zIndex: 1, pointerEvents: "none" }}
        data-testid="ai-scene-chip"
      >
        {t("ai.chip")}
      </span>
    );
  }
  return (
    <span className="mg-chip" data-testid="ai-scene-chip">
      {t("ai.chip")}
    </span>
  );
}

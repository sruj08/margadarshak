"use client";

import { Chip } from "@margdarshak/ui/components/chip";
import { useTranslations } from "next-intl";
import { isAi } from "./rules";
import type { Clip } from "./types";

/** "AI-generated" chip on every AI clip (product decision 2026-10-24); filmed clips show nothing. */
export function OriginChip({ clip }: { clip: Pick<Clip, "origin"> }) {
  const t = useTranslations("curator");
  if (!isAi(clip)) return null;
  return (
    <span className="cu-origin" data-testid="origin-ai">
      <Chip tone="info">{t("origin.ai_generated")}</Chip>
    </span>
  );
}

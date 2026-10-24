"use client";

import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useTranslations } from "next-intl";
import type { IssuesSource } from "@/lib/case/use-case-issues";

/** Says where the blocker list comes from: the server's check of the case, or this phone. */
export function IssuesSourceNote({
  source,
  cantTellYet = false,
}: {
  source: IssuesSource;
  cantTellYet?: boolean;
}) {
  const t = useTranslations("issuesSource");
  return (
    <p className="mj-caption mj-chips" data-testid="issues-source" data-source={source}>
      <StatusGlyph kind="info" size={16} />
      <span>
        {source === "server" ? t("server") : t("device")}
        {cantTellYet ? ` ${t("cantTell")}` : ""}
      </span>
    </p>
  );
}

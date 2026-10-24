"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { SaveStatus } from "@/lib/case/draft";

/** "Saved 2 min ago" / "Saved on this phone, will sync" (autosave line, updated at most each 30 s). */
export function SavedAgo({ at, status }: { at: string | null; status: SaveStatus | null }) {
  const t = useTranslations("autosave");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!at) return <>{t("notYet")}</>;
  if (status === "local") return <>{t("local")}</>;
  if (status === "conflict") return <>{t("conflict")}</>;
  const mins = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  return <>{mins < 1 ? t("justNow") : t("ago", { n: mins })}</>;
}

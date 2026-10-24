"use client";

import { useTranslations } from "next-intl";

/** Below this trust a session counts for practice only (GAME_SDK §6.5). */
export const TRUST_COUNTED_MIN = 0.6;

/**
 * The `not_counted` chip (UI_SPEC_LEARN_GAMES §4.6): neutral, never an accusation. Shown when the
 * server's trust is below 0.6; the "Why?" disclosure explains in one calm line.
 */
export function NotCountedNote({ trust }: { trust: number | null | undefined }) {
  const t = useTranslations("games");
  if (trust === null || trust === undefined || trust >= TRUST_COUNTED_MIN) return null;
  return (
    <details className="mg-notcounted" data-testid="not-counted">
      <summary>
        <span>{t("integrity.notCounted")}</span>
        <span className="mg-notcounted__why">{t("integrity.why")}</span>
      </summary>
      <p>{t("integrity.whyBody")}</p>
    </details>
  );
}

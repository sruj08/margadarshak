"use client";

import { useTranslations } from "next-intl";
import type { Achievement, BadgeKey } from "@/features/learn/api-types";

/**
 * Badges (UI_SPEC_LEARN_GAMES §7.1, GAMIFICATION_ENGINE §9): nine road-sign-shaped slots; each shows
 * its criterion before it is earned (DP-07). Unearned = outline + "Not yet" (never grey alone).
 * Self-declared badges are visually distinct (dashed outline + "Your word"), so they never read as a
 * government check.
 */

const SHAPE: Record<BadgeKey, "rectangle" | "circle" | "triangle" | "octagon"> = {
  khud_licence: "rectangle",
  pehli_baar_pass: "rectangle",
  nazar_90: "circle",
  calibrated: "circle",
  no_zone_navigator: "triangle",
  strap_streak: "circle",
  night_ready: "triangle",
  ghat_ready: "triangle",
  golden_hour_ready: "octagon",
};

export const BADGE_ORDER: BadgeKey[] = [
  "khud_licence",
  "pehli_baar_pass",
  "nazar_90",
  "calibrated",
  "no_zone_navigator",
  "strap_streak",
  "night_ready",
  "ghat_ready",
  "golden_hour_ready",
];

export function BadgeShape({ shape, earned }: { shape: string; earned: boolean }) {
  const fill = earned ? "var(--md-primary)" : "none";
  const stroke = earned ? "var(--md-primary)" : "var(--md-ink-2)";
  const p = { fill, stroke, strokeWidth: 3 };
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
      {shape === "circle" ? <circle cx="24" cy="24" r="20" {...p} /> : null}
      {shape === "triangle" ? <path d="M24 5l20 36H4Z" strokeLinejoin="round" {...p} /> : null}
      {shape === "octagon" ? <path d="M16 4h16l12 12v16L32 44H16L4 32V16Z" {...p} /> : null}
      {shape === "rectangle" ? <rect x="6" y="9" width="36" height="30" rx="4" {...p} /> : null}
    </svg>
  );
}

export function Badges({ badges }: { badges: Achievement["badges"] }) {
  const t = useTranslations("me.badge");
  const byKey = new Map(badges.map((b) => [b.badge_id, b] as const));
  const earned = badges.filter((b) => b.awarded_at !== null).length;
  return (
    <section className="md-stack" aria-labelledby="me-badges">
      <h2 id="me-badges" className="md-h2">
        {t("title", { e: earned })}
      </h2>
      <p className="ml-small">{t("tap")}</p>
      <ul className="ml-badges" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {BADGE_ORDER.map((k) => {
          const b = byKey.get(k);
          const isEarned = !!b?.awarded_at;
          const word = b?.self_declared === true;
          return (
            <li key={k}>
              <details
                className="ml-badge"
                data-word={word ? "true" : undefined}
                data-testid={`badge-${k}`}
              >
                <summary
                  style={{
                    listStyle: "none",
                    cursor: "pointer",
                    display: "grid",
                    justifyItems: "center",
                    gap: 4,
                  }}
                >
                  <BadgeShape shape={SHAPE[k]} earned={isEarned} />
                  <span className="font-semibold">{t(`${k}.name`)}</span>
                  <span>{isEarned ? t("earned") : t("notYet")}</span>
                  {word ? <span className="ml-chip ml-chip--word">{t("yourWord")}</span> : null}
                  {b?.label === "self_checked" ? (
                    <span className="ml-chip">{t("selfChecked")}</span>
                  ) : null}
                </summary>
                <p className="ml-small">{t(`${k}.criterion`)}</p>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="ml-small">{t("note")}</p>
    </section>
  );
}

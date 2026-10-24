import type { ShareCardContentWire } from "@/features/games/api-types";
import { keralaFormat } from "@/features/nazar/format";
import type { ShareCardLabels } from "./ShareCardView";

/** A next-intl translator for the "games" namespace, from `useTranslations` or `getTranslations`. */
export type GamesT = (key: string, values?: Record<string, string | number>) => string;

/**
 * Localised lines of a card; every number comes from the server's content (or the rule pack).
 * `aiScenes` is the nazar `ai.shareCard` line: the score was earned on AI-generated scenes (ADR-0013).
 */
export function cardLabels(
  t: GamesT,
  content: ShareCardContentWire,
  opts: { showRank: boolean; aiScenes?: string },
): ShareCardLabels {
  const fmt = keralaFormat();
  return {
    brand: t("share.brand"),
    scoreLabel: t("share.scoreLabel"),
    counted: t("share.counted", { n: content.counted_sessions }),
    rank: opts.showRank ? t(`share.rank.${content.rank}`) : null,
    badge: content.badge ? t(`share.badge.${content.badge}`) : null,
    tagline: t("share.antic"),
    challenge: t("share.challenge", { n: fmt.clips }),
    keralaLine: content.kerala_line
      ? t("share.keralaLine", { pass: fmt.passMark, total: fmt.totalMarks })
      : null,
    percentile:
      content.percentile !== null && content.percentile !== undefined
        ? t("share.percentile", { p: content.percentile })
        : null,
    footer: t("share.footer"),
    aiScenes: opts.aiScenes ?? null,
  };
}

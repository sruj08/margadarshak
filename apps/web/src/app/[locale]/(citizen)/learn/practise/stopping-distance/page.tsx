import "@/features/games/games.css";
import "@/features/stopping-distance/brief/brief.css";
import { GAME_CONFIG } from "@margdarshak/game-core/scoring";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { StateLoading } from "@/features/games/states";
import { SdBrief } from "@/features/stopping-distance/brief/SdBrief";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sims.sd");
  return { title: t("title") };
}

/**
 * Stopping Distance brief (UI_SPEC_LEARN_GAMES §5.2). The teaching values come from game-core's
 * GAME_CONFIG on the server; nothing game-related loads until Start.
 */
export default async function StoppingDistanceBriefPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  const c = GAME_CONFIG.stoppingDistance;
  return (
    <Suspense
      fallback={
        <div className="md-page">
          <StateLoading />
        </div>
      }
    >
      <SdBrief teaching={{ rt: c.reactionTimeS, dry: c.mu.dry, wet: c.mu.wet }} />
    </Suspense>
  );
}

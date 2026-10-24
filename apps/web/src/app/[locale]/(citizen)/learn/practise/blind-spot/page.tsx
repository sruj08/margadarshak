import "@/features/games/games.css";
import "@/features/stopping-distance/brief/brief.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BsBrief } from "@/features/blind-spot/BsBrief";
import { StateLoading } from "@/features/games/states";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sims.bs");
  return { title: t("title") };
}

/** Blind Spot brief (UI_SPEC_LEARN_GAMES §5.3). No game code, and no Phaser, until Start. */
export default async function BlindSpotBriefPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  return (
    <Suspense
      fallback={
        <div className="md-page">
          <StateLoading />
        </div>
      }
    >
      <BsBrief />
    </Suspense>
  );
}

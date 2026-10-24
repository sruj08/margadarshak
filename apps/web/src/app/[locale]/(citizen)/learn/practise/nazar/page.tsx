import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { StateLoading } from "@/features/games/states";
import { keralaFormat } from "@/features/nazar/format";
import { NazarBrief } from "@/features/nazar/NazarBrief";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nazar");
  return { title: t("title") };
}

/**
 * Nazar brief (UI_SPEC_LEARN_GAMES §5.1): `?mode=mock|practice|learn` preselects a mode and
 * `?drill=DR-…` carries a debrief drill to the play route. The Kerala format numbers come from the
 * KL rule pack on the server; nothing game-related loads until Start.
 */
export default async function NazarBriefPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <Suspense
      fallback={
        <div className="md-page">
          <StateLoading />
        </div>
      }
    >
      <NazarBrief format={keralaFormat()} />
    </Suspense>
  );
}

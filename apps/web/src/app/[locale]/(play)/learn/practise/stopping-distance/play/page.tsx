import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SdPlay } from "@/features/stopping-distance/SdPlay";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sims.sd");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Stopping Distance play (full-screen `(play)` shell). Static HTML with a client island: the host
 * and the game chunk load after mount, never in this route's first load.
 */
export default async function StoppingDistancePlayPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  return (
    <Suspense fallback={null}>
      <SdPlay />
    </Suspense>
  );
}

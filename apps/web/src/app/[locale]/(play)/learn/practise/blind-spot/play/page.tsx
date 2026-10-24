import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BsPlay } from "@/features/blind-spot/BsPlay";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sims.bs");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Blind Spot play (full-screen `(play)` shell). The host and the game chunk load after mount;
 * Phaser loads only if the canvas variant mounts (never for `?variant=decision`).
 */
export default async function BlindSpotPlayPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  return (
    <Suspense fallback={null}>
      <BsPlay />
    </Suspense>
  );
}

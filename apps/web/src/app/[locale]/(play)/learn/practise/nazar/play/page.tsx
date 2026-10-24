import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { NazarPlay } from "@/features/nazar/NazarPlay";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nazar");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Nazar play (full-screen `(play)` shell, UI_SPEC_LEARN_GAMES §5.1). Static HTML with a client
 * island: the host and the Nazar chunk load after mount, never in this route's first load.
 */
export default async function NazarPlayPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <Suspense fallback={null}>
      <NazarPlay />
    </Suspense>
  );
}

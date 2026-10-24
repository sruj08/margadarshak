import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { catalogueFor, DEBRIEF_GAMES } from "@/features/debrief/catalogue.server";
import { DebriefScreen } from "@/features/debrief/DebriefScreen";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("games");
  return { title: t("debrief.title"), robots: { index: false } };
}

/**
 * Debrief (UI_SPEC_LEARN_GAMES §6.1). `?game=` picks the catalogue slice (default nazar); the card
 * itself renders on the device from the session saved on this phone (template first, FRONTEND §8.4).
 */
export default async function DebriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; sid: string }>;
  searchParams: Promise<{ game?: string }>;
}) {
  await enterLocale(params);
  const { sid } = await params;
  const { game } = await searchParams;
  const gameId = game && DEBRIEF_GAMES.includes(game) ? game : "nazar";
  return <DebriefScreen sid={sid} catalogue={catalogueFor(gameId)} />;
}

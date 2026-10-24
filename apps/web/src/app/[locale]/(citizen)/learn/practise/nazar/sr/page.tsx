import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScreenReaderAlt } from "@/features/nazar/sr/ScreenReaderAlt";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nazar");
  return { title: t("sr.title") };
}

/** Nazar screen-reader alternative (EC-18): untimed still frames, never a hard block. */
export default async function NazarSrPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return <ScreenReaderAlt />;
}

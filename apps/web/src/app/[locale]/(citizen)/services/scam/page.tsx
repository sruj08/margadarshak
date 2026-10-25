import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScamCheckScreen } from "@/features/ai/ScamCheckScreen";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.scam");
  return { title: t("title"), robots: { index: false } };
}

/** Scam checker (F-33, API-43): rules decide, AI only explains. */
export default async function ScamPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return <ScamCheckScreen />;
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DecodeScreen } from "@/features/ai/DecodeScreen";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.decode");
  return { title: t("title"), robots: { index: false } };
}

/** Screenshot decoder (MD-319, API-42): the picture is covered on the phone, then matched. */
export default async function DecodePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return <DecodeScreen />;
}

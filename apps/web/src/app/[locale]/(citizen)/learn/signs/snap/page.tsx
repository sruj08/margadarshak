import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignSnapScreen } from "@/features/ai/SignSnapScreen";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.snap");
  return { title: t("title"), robots: { index: false } };
}

/** Road Sign Snap (MD-320, API-75). */
export default async function SignSnapPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return <SignSnapScreen />;
}

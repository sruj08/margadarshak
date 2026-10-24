import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckAnswers } from "@/components/apply/check-answers";
import { OfflineBanner } from "@/components/journey/status";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: t("check"), robots: { index: false } };
}

/** SCR-038 Check your answers (MD-111). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <CheckAnswers />
    </div>
  );
}

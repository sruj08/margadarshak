import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Documents } from "@/components/apply/documents";
import { OfflineBanner } from "@/components/journey/status";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: t("documents"), robots: { index: false } };
}

/** SCR-034 Documents checklist. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <Documents />
    </div>
  );
}

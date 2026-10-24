import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PrivacyCentre } from "@/components/privacy/privacy-centre";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return { title: t("title") };
}

/** Privacy centre (SCR-150, MD-134, F-54): consents, export, delete, grievance officer. */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <PrivacyCentre />
    </div>
  );
}

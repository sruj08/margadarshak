import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LicenceTab } from "@/components/journey/licence-tab";
import { OfflineBanner } from "@/components/journey/status";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("licence");
  return { title: t("title") };
}

/** My Licence tab: parcel tracker, case clock, LL/DL mirrors and timeline (SCR-070, MD-123/124/132). */
export default async function LicencePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page md-page--wide">
      <OfflineBanner />
      <LicenceTab />
    </div>
  );
}

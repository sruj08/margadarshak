import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfflineBanner } from "@/components/journey/status";
import { PlanWizard } from "@/components/plan/plan-wizard";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plan");
  return { title: t("title") };
}

/** S1 Licence Plan in 3 taps (SCR-010..013, MD-101). Works offline with the TS rules mirror. */
export default async function PlanPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <PlanWizard />
    </div>
  );
}

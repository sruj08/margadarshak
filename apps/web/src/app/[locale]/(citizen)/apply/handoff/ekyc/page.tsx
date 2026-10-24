import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EkycSimulation } from "@/components/apply/handoff";
import { OfflineBanner } from "@/components/journey/status";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: t("ekyc"), robots: { index: false } };
}

/** Simulated eKYC/OTP step, demo tenant only (MD-115). No input fields. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <EkycSimulation />
    </div>
  );
}

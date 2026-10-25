import "@/components/journey/journey.css";
import "@/features/flow/flow.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfflineBanner } from "@/components/journey/status";
import { DigiLockerConsent } from "@/features/flow/digilocker";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("flow.digilocker");
  return { title: t("signinTitle"), robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <DigiLockerConsent />
    </div>
  );
}

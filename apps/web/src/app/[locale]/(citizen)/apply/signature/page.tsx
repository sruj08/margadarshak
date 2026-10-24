import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ImageFixer } from "@/components/apply/image-fixer";
import { OfflineBanner } from "@/components/journey/status";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: t("signature"), robots: { index: false } };
}

/** SCR-037 Signature fixer, on device (MD-113). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <ImageFixer mode="signature" />
    </div>
  );
}

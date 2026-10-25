import "@/components/journey/journey.css";
import "@/features/flow/flow.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfflineBanner } from "@/components/journey/status";
import { Compare } from "@/features/flow/demo";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("flow.compare");
  return { title: t("title"), robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <OfflineBanner />
      <Compare />
    </div>
  );
}

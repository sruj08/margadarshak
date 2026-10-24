import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ServicesList } from "@/components/home/services-list";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("services");
  return { title: t("title") };
}

/** SCR-004 All services, grouped by who you are (MD-120). Every row opens a live route. */
export default async function ServicesPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <ServicesList />
    </div>
  );
}

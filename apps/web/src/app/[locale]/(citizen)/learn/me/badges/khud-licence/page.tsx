import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { KhudLicence } from "@/features/achievements/khud-licence";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me.khud");
  return { title: t("title") };
}

/** LRN-031 Khud Licence declaration (UI_SPEC_LEARN_GAMES §7.2, API-44). */
export default async function KhudLicencePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("me.khud");
  return (
    <div className="md-page md-stack">
      <Link href="/learn/me" className="md-link">
        {t("back")}
      </Link>
      <h1 className="md-h1">{t("title")}</h1>
      <KhudLicence />
    </div>
  );
}

import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Streak } from "@/features/achievements/streak";
import { buildBank } from "@/features/learn/content/bank-build";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me.streak");
  return { title: t("title") };
}

/** LRN-032 Weekly repairable streak (UI_SPEC_LEARN_GAMES §7.3). */
export default async function StreakPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("me.streak");
  return (
    <div className="md-page md-stack">
      <Link href="/learn/me" className="md-link">
        {t("back")}
      </Link>
      <h1 className="md-h1">{t("title")}</h1>
      <Streak conceptCounts={buildBank(locale).conceptCounts} />
    </div>
  );
}

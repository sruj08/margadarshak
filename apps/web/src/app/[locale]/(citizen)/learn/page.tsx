import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildBank } from "@/features/learn/content/bank-build";
import { moduleIndex } from "@/features/learn/content/curriculum";
import { gameHref } from "@/features/learn/content/routes";
import { LearnHub } from "@/features/learn/hub/learn-hub";
import { LearnNav } from "@/features/learn/ui/learn-nav";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.hub");
  return { title: t("title") };
}

/** LRN-001 Learn hub: today's review and the skill tree (F-20, MD-210). */
export default async function LearnPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("learnHub.hub");
  const bank = buildBank(locale);
  return (
    <div className="md-page md-stack">
      <LearnNav active="learn" />
      <h1 className="md-h1">{t("title")}</h1>
      <LearnHub
        modules={moduleIndex(locale)}
        conceptCounts={bank.conceptCounts}
        nazarHref={gameHref("nazar")}
      />
      <a href={`/${locale}/lite/learn`} className="md-link">
        {t("lite")}
      </a>
    </div>
  );
}

import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MeTab } from "@/features/achievements/me-tab";
import { CoachPlanCard } from "@/features/ai/CoachPlanCard";
import { buildBank } from "@/features/learn/content/bank-build";
import { moduleIndex } from "@/features/learn/content/curriculum";
import { routeExists } from "@/features/learn/content/routes";
import { LearnNav } from "@/features/learn/ui/learn-nav";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me");
  return { title: t("title") };
}

/** LRN-030 Me tab: XP, rank, badges, streak, squad (UI_SPEC_LEARN_GAMES §7.1, F-26). */
export default async function MePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("me");
  const nodeNames = Object.fromEntries(moduleIndex(locale).map((m) => [m.nodeId, m.short]));
  return (
    <div className="md-page md-stack">
      <LearnNav active="me" />
      <h1 className="md-h1">{t("title")}</h1>
      <CoachPlanCard />
      <MeTab
        conceptCounts={buildBank(locale).conceptCounts}
        nodeNames={nodeNames}
        shareHref={routeExists("(citizen)", "learn", "me", "share") ? "/learn/me/share" : null}
      />
    </div>
  );
}

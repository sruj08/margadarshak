import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildBank } from "@/features/learn/content/bank-build";
import { allLlFormats } from "@/features/ll-sim/format";
import { ReadinessScreen } from "@/features/readiness/readiness-screen";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.ready");
  return { title: t("title") };
}

/** LRN-007 Test Readiness (F-21, MD-213). */
export default async function ReadinessPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("learnHub.ready");
  const rtoStates = Object.values(allLlFormats())
    .filter((f) => !f.online_test_available)
    .map((f) => f.state);
  return (
    <div className="md-page md-stack">
      <Link href="/learn" className="md-link">
        {t("back")}
      </Link>
      <h1 className="md-h1">{t("title")}</h1>
      <ReadinessScreen conceptCounts={buildBank(locale).conceptCounts} rtoStates={rtoStates} />
    </div>
  );
}

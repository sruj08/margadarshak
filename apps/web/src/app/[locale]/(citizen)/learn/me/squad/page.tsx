import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SquadScreen } from "@/features/squads/squad";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me.squad");
  return { title: t("title") };
}

/** LRN-033 Squad (co-op, UI_SPEC_LEARN_GAMES §7.4, MD-233). */
export default async function SquadPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("me.squad");
  return (
    <div className="md-page md-stack">
      <Link href="/learn/me" className="md-link">
        {t("back")}
      </Link>
      <h1 className="md-h1">{t("title")}</h1>
      <SquadScreen />
    </div>
  );
}

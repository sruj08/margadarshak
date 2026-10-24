import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewSquad } from "@/features/squads/new-squad";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me.squad");
  return { title: t("newTitle") };
}

/** LRN-034 Start a squad (API-39 createSquad). */
export default async function NewSquadPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("me.squad");
  return (
    <div className="md-page md-stack">
      <Link href="/learn/me/squad" className="md-link">
        {t("back")}
      </Link>
      <h1 className="md-h1">{t("newTitle")}</h1>
      <NewSquad />
    </div>
  );
}

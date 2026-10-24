import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BlockersScreen } from "@/components/plan/blockers-screen";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blockers");
  return { title: t("h1"), robots: { index: false } };
}

/** SCR-020 Things to sort out first (MD-107). */
export default async function BlockersPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <BlockersScreen />
    </div>
  );
}

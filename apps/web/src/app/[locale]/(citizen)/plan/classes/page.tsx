import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClassPlannerScreen } from "@/components/plan/class-planner";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("planner");
  return { title: t("h1"), robots: { index: false } };
}

/** SCR-015 Smart class planner (MD-105). */
export default async function ClassPlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  return (
    <div className="md-page">
      <ClassPlannerScreen />
    </div>
  );
}

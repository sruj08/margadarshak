import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlanCardScreen } from "@/components/plan/plan-card";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plan");
  return { title: t("title"), robots: { index: false } };
}

/** SCR-014 Your licence plan (MD-103). Rendered from the plan saved on this phone. */
export default async function PlanCardPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page md-page--wide">
      <PlanCardScreen />
    </div>
  );
}

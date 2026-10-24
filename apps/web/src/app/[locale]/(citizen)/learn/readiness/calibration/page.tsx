import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalibrationView } from "@/features/readiness/calibration-view";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.cal");
  return { title: t("title") };
}

/** LRN-006 Calibration view (UI_SPEC_LEARN_GAMES §2.6). */
export default async function CalibrationPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("learnHub.cal");
  return (
    <div className="md-page md-stack">
      <Link href="/learn/readiness" className="md-link">
        {t("back")}
      </Link>
      <h1 className="md-h1">{t("title")}</h1>
      <CalibrationView />
    </div>
  );
}

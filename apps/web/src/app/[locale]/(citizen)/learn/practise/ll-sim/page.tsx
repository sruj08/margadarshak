import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { allLlFormats, STATE_CODES } from "@/features/ll-sim/format";
import { FormatCard } from "@/features/ll-sim/format-card";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("llSim");
  return { title: t("title") };
}

/** LRN-010 LL test simulator: format card (UI_SPEC_LEARN_GAMES §3.1, F-22, MD-214). */
export default async function LlSimPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("llSim");
  return (
    <div className="md-page md-stack" data-screen="LRN-010">
      <Link href="/learn/practise" className="md-link">
        {t("back")}
      </Link>
      <h1 className="md-h1">{t("title")}</h1>
      <Suspense fallback={null}>
        <FormatCard formats={allLlFormats()} states={[...STATE_CODES]} />
      </Suspense>
    </div>
  );
}

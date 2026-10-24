import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { allLlFormats } from "@/features/ll-sim/format";
import { GuidedRoute } from "@/features/ll-sim/guided-run";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("llSim.guided");
  return { title: t("title") };
}

/** LRN-011 Guided first run (UI_SPEC_LEARN_GAMES §3.2). */
export default async function GuidedPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("llSim.guided");
  return (
    <div className="md-page md-stack" data-screen="LRN-011">
      <h1 className="md-h1">{t("title")}</h1>
      <Suspense fallback={null}>
        <GuidedRoute formats={allLlFormats()} />
      </Suspense>
    </div>
  );
}

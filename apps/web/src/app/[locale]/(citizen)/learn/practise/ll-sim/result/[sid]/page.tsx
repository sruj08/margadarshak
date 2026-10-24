import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LlResult } from "@/features/ll-sim/result";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("llSim.result");
  return { title: t("title"), robots: { index: false } };
}

/** LRN-013 Exam result (UI_SPEC_LEARN_GAMES §3.4). The run is read from this phone by session ID. */
export default async function LlResultPage({
  params,
}: {
  params: Promise<{ locale: string; sid: string }>;
}) {
  await enterLocale(params);
  const { sid } = await params;
  const t = await getTranslations("llSim.result");
  return (
    <div className="md-page md-stack" data-screen="LRN-013">
      <h1 className="md-h1">{t("title")}</h1>
      <Suspense fallback={null}>
        <LlResult sid={sid} />
      </Suspense>
    </div>
  );
}

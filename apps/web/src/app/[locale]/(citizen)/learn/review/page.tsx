import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { buildBank } from "@/features/learn/content/bank-build";
import { ReviewRoute } from "@/features/learn/review/review-route";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.review");
  return { title: t("title") };
}

/** LRN-003 Review queue session (UI_SPEC_LEARN_GAMES §2.3, MD-211). */
export default async function ReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("learnHub.review");
  const bank = buildBank(locale);
  return (
    <div className="md-page md-stack" data-screen="LRN-003">
      <h1 className="md-sr-only">{t("title")}</h1>
      <Suspense fallback={null}>
        <ReviewRoute conceptCounts={bank.conceptCounts} />
      </Suspense>
    </div>
  );
}

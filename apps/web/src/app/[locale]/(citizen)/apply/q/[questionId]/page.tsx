import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { QuestionPage } from "@/components/apply/question-page";
import { OfflineBanner } from "@/components/journey/status";
import { enterLocale } from "@/i18n/page-locale";
import { QUESTIONS } from "@/lib/journey/form-engine";

export function generateStaticParams() {
  return QUESTIONS.map((q) => ({ questionId: q.id }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: t("question"), robots: { index: false } };
}

/** SCR-031 Question page: one question per screen (MD-110). Static per question, works offline. */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; questionId: string }>;
}) {
  await enterLocale(params);
  const { questionId } = await params;
  if (!QUESTIONS.some((q) => q.id === questionId)) notFound();
  return (
    <div className="md-page">
      <OfflineBanner />
      <QuestionPage questionId={questionId} />
    </div>
  );
}

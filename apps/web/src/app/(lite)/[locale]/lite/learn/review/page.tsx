import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildBank, buildPracticeKey } from "@/features/learn/content/bank-build";
import { LiteQuiz } from "@/features/lite-learn/lite-quiz";
import { liteSet } from "@/features/lite-learn/quiz";
import { liteQuizText } from "@/features/lite-learn/text";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.lite");
  return { title: t("reviewTitle") };
}

/** LRN-L03 Lite review set (EC-19): 8 practice cards with "How sure are you?" before feedback. */
export default async function LiteReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("learnHub.lite");
  const bank = buildBank(locale);
  const key = buildPracticeKey(locale);
  return (
    <div className="md-page md-stack" data-screen="LRN-L03" data-testid="lite-review">
      <h1 className="md-h1">{t("reviewTitle")}</h1>
      <p>{t("reviewIntro")}</p>
      <LiteQuiz
        items={liteSet(bank, key, 8, "lite:review")}
        answerKey={key}
        locale={locale}
        kind="review"
        state="JK"
        pass={null}
        text={await liteQuizText()}
      />
    </div>
  );
}

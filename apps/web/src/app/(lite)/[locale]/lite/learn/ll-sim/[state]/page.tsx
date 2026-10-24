import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buildBank, buildPracticeKey } from "@/features/learn/content/bank-build";
import { LiteQuiz } from "@/features/lite-learn/lite-quiz";
import { liteSet } from "@/features/lite-learn/quiz";
import { liteQuizText } from "@/features/lite-learn/text";
import { examSize } from "@/features/ll-sim/exam-items";
import { llFormatFor, STATE_CODES } from "@/features/ll-sim/format";
import { enterLocale } from "@/i18n/page-locale";

export function generateStaticParams() {
  return STATE_CODES.map((state) => ({ state }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("llSim");
  return { title: t("title") };
}

/**
 * LRN-L02 Lite LL practice test (EC-19): the state's format from the rule pack, as an HTML form of
 * practice questions. Scored by the server when online, on the phone when offline; practice only.
 */
export default async function LiteLlSimPage({
  params,
}: {
  params: Promise<{ locale: string; state: string }>;
}) {
  const locale = await enterLocale(params);
  const { state } = await params;
  if (!(STATE_CODES as readonly string[]).includes(state)) notFound();
  const t = await getTranslations("learnHub.lite");
  const tf = await getTranslations("llSim.format");
  const ts = await getTranslations("llSim.states");
  const f = llFormatFor(state);
  const { questions, pass } = examSize(f);
  const bank = buildBank(locale);
  const key = buildPracticeKey(locale);
  const items = liteSet(bank, key, questions, `lite:${state}`);
  const name = ts(state as "JK");
  return (
    <div className="md-page md-stack" data-screen="LRN-L02" data-testid="lite-llsim">
      <h1 className="md-h1">{t("llTitle")}</h1>
      <p className="font-semibold" data-testid="lite-format">
        {f.known
          ? `${tf("for", { state: name })}: ${tf("line", { q: questions, p: pass })}`
          : tf("unknown", { state: name, q: questions, p: pass })}
      </p>
      {f.provenance.source_title ? (
        <p className="ml-small">{tf("source", { s: f.provenance.source_title })}</p>
      ) : null}
      {!f.online_test_available ? (
        <p className="ml-feedback" data-testid="lite-rto">
          {tf("rto", { state: name })}
        </p>
      ) : null}
      <p className="ml-small">{t("practiceOnly")}</p>
      <LiteQuiz
        items={items}
        answerKey={key}
        locale={locale}
        kind="ll"
        state={state}
        pass={pass}
        text={await liteQuizText()}
      />
    </div>
  );
}

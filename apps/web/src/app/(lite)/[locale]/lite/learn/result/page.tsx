import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildBank, buildPracticeKey } from "@/features/learn/content/bank-build";
import { decodeAnswers, scoreLite } from "@/features/lite-learn/quiz";
import { examSize } from "@/features/ll-sim/exam-items";
import { llFormatFor, STATE_CODES } from "@/features/ll-sim/format";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.lite");
  return { title: t("resultTitle"), robots: { index: false } };
}

/**
 * LRN-L04 Lite result: the posted practice set scored on the server with the practice key, with the
 * reviewed explanation for each wrong answer. Never red; practice only.
 */
export default async function LiteResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await enterLocale(params);
  const sp = await searchParams;
  const t = await getTranslations("learnHub.lite");
  const raw = typeof sp["a"] === "string" ? sp["a"] : "";
  const kind = sp["k"] === "review" ? "review" : "ll";
  const stateRaw = typeof sp["s"] === "string" ? sp["s"] : "JK";
  const state = (STATE_CODES as readonly string[]).includes(stateRaw) ? stateRaw : "JK";
  const key = buildPracticeKey(locale);
  const bank = buildBank(locale);
  const answers = decodeAnswers(raw).filter((a) => key[a.itemId]);
  const s = scoreLite(answers, key);
  const pass = kind === "ll" ? examSize(llFormatFor(state)).pass : null;
  const items = new Map(bank.items.map((i) => [i.id, i] as const));
  return (
    <div className="md-page md-stack" data-testid="lite-result">
      <h1 className="md-h1">{t("resultTitle")}</h1>
      <p className="ml-score">
        {s.right} / {s.total}
      </p>
      {pass !== null ? (
        <p className="md-h3">
          {s.right >= pass ? t("passed", { p: pass }) : t("notYet", { p: pass })}
        </p>
      ) : null}
      {kind === "review" ? <p>{t("sureWrong", { k: s.sureAndWrong })}</p> : null}
      <p className="ml-small">{t("practiceOnly")}</p>
      {s.wrong.length > 0 ? (
        <section className="md-stack">
          <h2 className="md-h2">{t("wrongTitle")}</h2>
          {s.wrong.map((w) => {
            const it = items.get(w.itemId);
            const k = key[w.itemId];
            if (!it || !k) return null;
            const right = it.options.find((o) => o.id === k.correct);
            return (
              <div key={w.itemId} className="ml-feedback">
                <p className="font-semibold">{it.stem}</p>
                {right ? <p>{t("answer", { a: right.text })}</p> : null}
                {k.explanation ? <p>{k.explanation}</p> : null}
              </div>
            );
          })}
        </section>
      ) : null}
      <a href={`/${locale}/lite/learn`} className="md-link">
        {t("back")}
      </a>
    </div>
  );
}

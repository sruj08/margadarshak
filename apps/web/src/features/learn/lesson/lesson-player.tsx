"use client";

import { ratingFromEvidence } from "@margdarshak/game-core/learning";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { AnswerSubmission } from "../api-types";
import { loadBank, loadPracticeKey } from "../bank-client";
import type { BankItem, LlTopicId, PracticeKey } from "../content/bank-types";
import type { ModuleDetail } from "../content/curriculum";
import { markLessonDone, refreshNodeHistory } from "../nodes";
import { reviewStore } from "../offline/review-store";
import { notePending, syncOutbox } from "../offline/sync";
import { awardSession } from "../progress";
import { type AnswerEvent, QuestionCard } from "../question/question-card";
import { OfflineBanner } from "../ui/states";

/**
 * Lesson player (UI_SPEC_LEARN_GAMES §2.4, Thin): one concept in short steps (see → explain → myth →
 * check), all text from the reviewed content pack (objective, key fact with its source, a common
 * myth and its correction). An LL lesson ends with 2 practice questions that feed FSRS; a road-safety
 * lesson ends with a myth-or-fact check. Back and Next are always present; nothing autoplays.
 */

type Step = "intro" | "fact" | "myth" | "check" | "done";
const STEPS: Step[] = ["intro", "fact", "myth", "check"];

export function LessonPlayer({
  module,
  index,
  lessonId,
  checkItemIds,
  conceptCounts,
  game,
}: {
  module: ModuleDetail;
  index: number;
  lessonId: string;
  checkItemIds: string[];
  conceptCounts: Record<LlTopicId, number>;
  game: { title: string; href: string } | null;
}) {
  const t = useTranslations("learnHub.lesson");
  const locale = useLocale();
  const [step, setStep] = useState<Step>("intro");
  const [items, setItems] = useState<BankItem[]>([]);
  const [key, setKey] = useState<PracticeKey>({});
  const [qi, setQi] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [myth, setMyth] = useState<boolean | null>(null);
  const started = useRef(Date.now());
  const sid = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);

  const lesson = module.lessons[index];
  const objective = module.objectives[index] ?? module.objectives[0] ?? "";
  const fact = module.facts.length ? module.facts[index % module.facts.length] : undefined;
  const mythRow = module.myths.length ? module.myths[index % module.myths.length] : undefined;

  useEffect(() => {
    if (checkItemIds.length === 0) return;
    void Promise.all([loadBank(locale), loadPracticeKey(locale)])
      .then(([bank, pk]) => {
        setItems(
          checkItemIds
            .map((id) => bank.items.find((i) => i.id === id))
            .filter((i): i is BankItem => !!i),
        );
        setKey(pk);
      })
      .catch(() => setItems([]));
  }, [checkItemIds, locale]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const pos = STEPS.indexOf(step);
  const go = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  const finish = async (pct: number) => {
    const end = Date.now();
    awardSession(
      { gameId: "lesson", mode: "learn", score: { pct }, integrity: { trust: 1, flags: [] } },
      started.current,
      end,
      "lesson",
    );
    markLessonDone(lessonId);
    refreshNodeHistory(await reviewStore().log(), end, conceptCounts);
    go("done");
    void syncOutbox();
  };

  const onAnswered = async (item: BankItem, a: AnswerEvent) => {
    setResults((r) => [...r, a.correct]);
    const { rating, overconfident } = ratingFromEvidence({
      correct: a.correct,
      confidence: a.confidence,
      latencyMs: a.latencyMs,
    });
    const id = crypto.randomUUID();
    const at = Date.now();
    const [question, variant] = item.id.split(":");
    const sub: AnswerSubmission = {
      client_answer_id: id,
      card_id: item.concept,
      question_id: question ?? item.concept,
      variant_id: variant ?? "v1",
      option_id: a.optionId,
      confidence: a.confidence,
      latency_ms: a.latencyMs,
      answered_at: new Date(at).toISOString(),
      mode: "practice",
    };
    await reviewStore().append(
      [
        {
          id,
          cardId: item.concept,
          itemId: item.id,
          optionId: a.optionId,
          rating,
          reviewedAt: at,
          correct: a.correct,
          overconfident,
          confidence: a.confidence,
          latencyMs: a.latencyMs,
          sourceSid: sid.current,
          mode: "lesson",
          wasDue: false,
        },
      ],
      [sub],
    );
    await notePending();
  };

  if (!lesson) return null;
  const total = STEPS.length;

  return (
    <div className="md-stack" data-screen="LRN-004" data-testid="lesson-player">
      <OfflineBanner />
      <div className="ml-row ml-row--between">
        <Link href={`/learn/skill/${module.nodeId}`} className="md-link">
          {t("close")}
        </Link>
        {step !== "done" ? (
          <span className="ml-num">{t("step", { i: pos + 1, n: total })}</span>
        ) : null}
      </div>
      <h1 ref={heading} tabIndex={-1} className="md-h1">
        {module.id} · {lesson.title}
      </h1>
      {step !== "done" ? (
        <div className="ml-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(((pos + 1) / total) * 100)}%` }} />
        </div>
      ) : null}

      {step === "intro" ? (
        <section className="ml-card">
          <h2 className="md-h3">{t("objective")}</h2>
          <p>{objective}</p>
        </section>
      ) : null}

      {step === "fact" && fact ? (
        <section className="ml-card">
          <h2 className="md-h3">{t("fact")}</h2>
          <p>{fact.text}</p>
          {fact.source ? <p className="ml-small">{t("source", { s: fact.source })}</p> : null}
          {!fact.verified ? <p className="ml-small">{t("beingChecked")}</p> : null}
        </section>
      ) : null}

      {step === "myth" && mythRow ? (
        <section className="ml-card">
          <h2 className="md-h3">{t("myth")}</h2>
          <p>{mythRow.myth}</p>
          <h2 className="md-h3">{t("truth")}</h2>
          <p>{mythRow.correction}</p>
        </section>
      ) : null}

      {step === "check" ? (
        items.length > 0 ? (
          items[qi] ? (
            <QuestionCard
              key={items[qi].id}
              item={items[qi]}
              seed={sid.current}
              answerKey={key[items[qi].id] ?? null}
              onAnswered={(a) => {
                const it = items[qi];
                if (it) void onAnswered(it, a);
              }}
              onContinue={() => {
                if (qi + 1 < items.length) setQi(qi + 1);
                else {
                  const right = results.filter(Boolean).length;
                  void finish(Math.round((right / Math.max(1, items.length)) * 100));
                }
              }}
            />
          ) : null
        ) : mythRow ? (
          <section className="ml-card ml-q">
            <h2 className="md-h3">{t("mythQ")}</h2>
            <p>{mythRow.myth}</p>
            {myth === null ? (
              <div className="ml-row">
                <button type="button" className={buttonClassName({})} onClick={() => setMyth(true)}>
                  {t("true")}
                </button>
                <button
                  type="button"
                  className={buttonClassName({})}
                  onClick={() => setMyth(false)}
                >
                  {t("false")}
                </button>
              </div>
            ) : (
              <>
                <div className="ml-feedback" data-tone={myth ? "warn" : "ok"} role="status">
                  <p className="md-h3">{myth ? `▲ ${t("mythWrong")}` : `✓ ${t("mythRight")}`}</p>
                  <p>{mythRow.correction}</p>
                </div>
                <button
                  type="button"
                  className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
                  onClick={() => void finish(myth ? 0 : 100)}
                >
                  {t("finish")}
                </button>
              </>
            )}
          </section>
        ) : (
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={() => void finish(100)}
          >
            {t("finish")}
          </button>
        )
      ) : null}

      {step === "done" ? (
        <section className="ml-card" role="status">
          <p className="md-h3">
            {items.length > 0 ? t("done", { n: items.length }) : t("doneNoCards")}
          </p>
          {game ? (
            <Link
              href={game.href}
              className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            >
              {t("doneCta", { game: game.title })}
            </Link>
          ) : null}
          <Link href={`/learn/skill/${module.nodeId}`} className="md-link">
            {t("backToSkill")}
          </Link>
        </section>
      ) : null}

      {step !== "check" && step !== "done" ? (
        <div className="ml-row">
          {pos > 0 ? (
            <button
              type="button"
              className={buttonClassName({ size: "lg" })}
              onClick={() => go(STEPS[pos - 1] ?? "intro")}
            >
              {t("back")}
            </button>
          ) : null}
          <button
            type="button"
            className={buttonClassName({ variant: "primary", size: "lg" })}
            onClick={() => {
              let next = STEPS[pos + 1] ?? "check";
              if (next === "fact" && !fact) next = mythRow ? "myth" : "check";
              if (next === "myth" && !mythRow) next = "check";
              go(next);
            }}
          >
            {t("next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

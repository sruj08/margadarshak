"use client";

import { ratingFromEvidence } from "@margdarshak/game-core/learning";
import { REVIEWS_PER_STREAK_SESSION, sureAndWrong } from "@margdarshak/gamification";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { getReviewQueue, LEARN_API_MODE } from "../api";
import type { AnswerSubmission } from "../api-types";
import { loadBank, loadPracticeKey } from "../bank-client";
import type { BankItem, LlTopicId, PracticeKey } from "../content/bank-types";
import { nextDue } from "../learning";
import { mockServerStats } from "../mock-api";
import { refreshNodeHistory } from "../nodes";
import { LEARN_KEYS, readKv, writeKv } from "../offline/kv";
import { type LogEntry, reviewStore } from "../offline/review-store";
import { bindOutbox, notePending, onSyncState, type SyncState, syncOutbox } from "../offline/sync";
import { awardReviews, countStreakSession } from "../progress";
import { type AnswerEvent, QuestionCard } from "../question/question-card";
import { ErrorState, LoadingState, OfflineBanner } from "../ui/states";
import { byConcept, pickVariant, rememberVariant } from "../variants";

/**
 * Review queue session (UI_SPEC_LEARN_GAMES §2.3, MD-211). Runs the FSRS-due cards (API-31, or the
 * device queue from the pinned scheduler when offline / in mock mode), one QuestionCard per card with
 * a variant that avoids the last 2 surface forms seen. Every answer goes to the device review log
 * and the API-32 outbox in one write, so the sitting works fully offline and syncs once.
 */

interface Card {
  item: BankItem;
  due: boolean;
}

type Phase = "loading" | "error" | "empty" | "asking" | "done";

declare global {
  interface Window {
    __mdLearn?: {
      server: () => { answers: number; batches: number };
      outbox: () => Promise<number>;
    };
  }
}

export function ReviewSession({
  conceptCounts,
  topic,
}: {
  conceptCounts: Record<LlTopicId, number>;
  topic: LlTopicId | null;
}) {
  const t = useTranslations("learnHub.review");
  const tt = useTranslations("learnHub.topics");
  const locale = useLocale();
  const format = useFormatter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [cards, setCards] = useState<Card[]>([]);
  const [key, setKey] = useState<PracticeKey>({});
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerEvent[]>([]);
  const [summary, setSummary] = useState<{ xp: number; next: number | null } | null>(null);
  const [sync, setSync] = useState<SyncState>("idle");
  const [leaving, setLeaving] = useState(false);
  const sid = useRef<string>("");
  const started = useRef(0);
  const live = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const [bank, pk] = await Promise.all([loadBank(locale), loadPracticeKey(locale)]);
      const practice = bank.items.filter((i) => i.pool === "practice" && pk[i.id]);
      const now = Date.now();
      const queue = (await getReviewQueue(practice, now, topic)).data;
      const variants = byConcept(practice);
      const seen = readKv<Record<string, string[]>>(LEARN_KEYS.seen, {});
      sid.current = crypto.randomUUID();
      const picked: Card[] = [];
      for (const q of queue) {
        const v = pickVariant(variants.get(q.card_id) ?? [], seen[q.card_id] ?? [], sid.current);
        if (v) picked.push({ item: v, due: (q.retrievability ?? 0) > 0 });
      }
      setKey(pk);
      setCards(picked);
      setIndex(0);
      setAnswers([]);
      started.current = Date.now();
      setPhase(picked.length === 0 ? "empty" : "asking");
    } catch {
      setPhase("error");
    }
  }, [locale, topic]);

  useEffect(() => {
    bindOutbox();
    void load();
    const off = onSyncState((s) => setSync(s));
    if (LEARN_API_MODE === "mock")
      window.__mdLearn = {
        server: mockServerStats,
        outbox: async () => (await reviewStore().outbox()).length,
      };
    return off;
  }, [load]);

  const card = cards[index];

  const onAnswered = async (a: AnswerEvent) => {
    if (!card) return;
    setAnswers((prev) => [...prev, a]);
    const { rating, overconfident } = ratingFromEvidence({
      correct: a.correct,
      confidence: a.confidence,
      latencyMs: a.latencyMs,
    });
    const id = crypto.randomUUID();
    const at = Date.now();
    const entry: LogEntry = {
      id,
      cardId: card.item.concept,
      itemId: card.item.id,
      optionId: a.optionId,
      rating,
      reviewedAt: at,
      correct: a.correct,
      overconfident,
      confidence: a.confidence,
      latencyMs: a.latencyMs,
      sourceSid: sid.current,
      mode: "review",
      wasDue: card.due,
    };
    const [question, variant] = card.item.id.split(":");
    const sub: AnswerSubmission = {
      client_answer_id: id,
      card_id: card.item.concept,
      question_id: question ?? card.item.concept,
      variant_id: variant ?? "v1",
      option_id: a.optionId,
      confidence: a.confidence,
      latency_ms: a.latencyMs,
      answered_at: new Date(at).toISOString(),
      mode: "review",
    };
    const seen = readKv<Record<string, string[]>>(LEARN_KEYS.seen, {});
    writeKv(LEARN_KEYS.seen, {
      ...seen,
      [card.item.concept]: rememberVariant(seen[card.item.concept] ?? [], card.item.id),
    });
    await reviewStore().append([entry], [sub]);
    await notePending();
  };

  const finish = async () => {
    const end = Date.now();
    const due = cards.filter((c, i) => c.due && i < answers.length).length;
    const award = awardReviews(due, started.current, end);
    if (due >= REVIEWS_PER_STREAK_SESSION) countStreakSession(end);
    const log = await reviewStore().log();
    refreshNodeHistory(log, end, conceptCounts);
    setSummary({ xp: award.xp, next: nextDue(log, end) });
    setPhase("done");
    void syncOutbox();
  };

  const onContinue = () => {
    if (index + 1 >= cards.length) {
      void finish();
      return;
    }
    setIndex(index + 1);
    if (live.current) live.current.textContent = t("progress", { i: index + 2, n: cards.length });
  };

  if (phase === "loading") return <LoadingState rows={4} />;
  if (phase === "error") return <ErrorState onRetry={() => void load()} />;

  if (phase === "empty")
    return (
      <div className="md-stack">
        <OfflineBanner />
        <EmptyState
          as="h1"
          title={t("emptyTitle")}
          line={t("emptyLine")}
          action={
            <Link
              href="/learn/practise"
              className={buttonClassName({ variant: "primary", size: "lg" })}
            >
              {t("emptyCta")}
            </Link>
          }
        />
      </div>
    );

  const syncNote = sync === "synced" ? t("synced") : sync === "idle" ? null : t("pending");

  if (phase === "done" && summary) {
    const right = answers.filter((a) => a.correct).length;
    const weakTopic = cards.find((_c, i) => answers[i] && !answers[i]?.correct)?.item.topic ?? null;
    return (
      <div className="md-stack" data-testid="review-done">
        <h1 className="md-h1">{t("doneTitle")}</h1>
        <div className="ml-card">
          <p className="md-h3">{t("doneScore", { n: answers.length, right })}</p>
          <p>{t("doneCal", { k: sureAndWrong(answers) })}</p>
          <p className="ml-num">{t("doneXp", { xp: summary.xp })}</p>
          <p>
            {summary.next === null
              ? t("doneNextNone")
              : t("doneNext", {
                  when: format.dateTime(new Date(summary.next), { dateStyle: "medium" }),
                })}
          </p>
          {syncNote ? (
            <p className="ml-chip" role="status" data-testid="sync-state" data-state={sync}>
              {syncNote}
            </p>
          ) : null}
        </div>
        <div className="ml-actions">
          <Link
            href={weakTopic ? `/learn/review?topic=${weakTopic}` : "/learn/practise/ll-sim"}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          >
            {weakTopic ? t("doneWeak", { topic: tt(weakTopic) }) : t("doneMock")}
          </Link>
          <Link href="/learn" className="md-link">
            {t("backToRoad")}
          </Link>
        </div>
      </div>
    );
  }

  if (!card) return null;
  return (
    <div className="md-stack" data-testid="review-session">
      <OfflineBanner />
      <div className="ml-row ml-row--between">
        {leaving ? (
          <div className="ml-card" role="alertdialog" aria-label={t("leaveConfirm")}>
            <p>{t("leaveConfirm")}</p>
            <div className="ml-row">
              <Link href="/learn" className={buttonClassName({ variant: "secondary" })}>
                {t("leaveYes")}
              </Link>
              <button type="button" className="ml-link-btn" onClick={() => setLeaving(false)}>
                {t("leaveNo")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="ml-link-btn" onClick={() => setLeaving(true)}>
            {t("close")}
          </button>
        )}
        <span className="ml-num">{t("progress", { i: index + 1, n: cards.length })}</span>
      </div>
      <div className="ml-bar" aria-hidden="true">
        <span style={{ width: `${Math.round((index / cards.length) * 100)}%` }} />
      </div>
      <p ref={live} className="md-sr-only" aria-live="polite" />
      {syncNote && sync !== "synced" ? (
        <p className="ml-chip" data-testid="sync-state" data-state={sync}>
          {syncNote}
        </p>
      ) : null}
      <QuestionCard
        key={card.item.id}
        item={card.item}
        seed={sid.current}
        answerKey={key[card.item.id] ?? null}
        topicLabel={tt(card.item.topic)}
        onAnswered={(a) => void onAnswered(a)}
        onContinue={onContinue}
      />
    </div>
  );
}

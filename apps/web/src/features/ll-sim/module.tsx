"use client";

import { SCORING_VERSIONS } from "@margdarshak/game-core";
import type { SessionContext } from "@margdarshak/game-core/schema";
import { GAME_CONFIG } from "@margdarshak/game-core/scoring";
import type { EventRecorder } from "@margdarshak/game-core/sdk";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CoachSummary, type SummaryLink, type SummaryRow } from "@/features/ai/CoachSummary";
import { getSessionRecord } from "@/features/games/results-store";
import type { SessionOutcome, WebGame, WebGameModule, WebGameProps } from "@/features/games/types";
import { loadPracticeKey } from "@/features/learn/bank-client";
import type { PracticeKey } from "@/features/learn/content/bank-types";
import { QuestionCard } from "@/features/learn/question/question-card";
import { SignVisual } from "@/features/learn/ui/sign-visual";
import { Link } from "@/i18n/navigation";
import type { ExamPublic } from "./exam-items";

/**
 * G10 LL Test Simulator as a game module for the shared game host (MD-214, GAME_DESIGN §11,
 * UI_SPEC_LEARN_GAMES §3.3). The host starts the session (API-34, or a device session from the
 * practice bank), records, pauses and submits; this component only shows the questions and emits
 * game-core events: `item_start`, `answer {qref, optionId, latencyMs}` when the learner presses Next
 * (changing an answer before Next is allowed), `confidence` (practice mode, before feedback) and
 * `item_end` (done, or timeout when the format has a per-question timer; the rule packs have none
 * today, so no timer is shown). Exam mode is undecorated: no confidence picker, no feedback, no
 * motion, no sound until the end.
 */

if (typeof window !== "undefined") {
  const w = window as unknown as { __mdGames?: Record<string, boolean> };
  w.__mdGames = { ...w.__mdGames, ll_sim: true };
}

interface Q {
  ref: string;
  doc: ExamPublic;
}

function questions(props: WebGameProps): Q[] {
  return props.session.items.flatMap((it) =>
    it.public ? [{ ref: it.item_ref, doc: it.public as unknown as ExamPublic }] : [],
  );
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function LlSimGame(props: WebGameProps) {
  const t = useTranslations("llSim.exam");
  const locale = useLocale();
  const id = useId();
  const qs = questions(props);
  const practice = props.ctx.mode === "practice" || props.ctx.mode === "learn";
  const [index, setIndex] = useState(-1);
  const [choice, setChoice] = useState<string | null>(null);
  const [key, setKey] = useState<PracticeKey>({});
  const [left, setLeft] = useState<number | null>(null);
  const rec = useRef<EventRecorder | null>(null);
  const shownAt = useRef(0);
  const open = useRef<number | null>(null);
  const announced = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ optionId: string; confidence: string } | null>(null);
  const { register, setHud, setCurrentItem, onEnd } = props;

  const q = index >= 0 ? qs[index] : undefined;

  const startItem = useCallback(
    (i: number) => {
      const next = qs[i];
      if (!next) return;
      rec.current?.emit("item_start", { ref: next.ref }, { item: i });
      open.current = i;
      shownAt.current = performance.now();
      setIndex(i);
      setChoice(null);
      setLeft(next.doc.timer_s);
      setCurrentItem(i, next.doc.timer_s !== null);
      setHud({ counter: { current: i + 1, total: qs.length }, tag: null });
    },
    [qs, setCurrentItem, setHud],
  );

  const endItem = useCallback(
    (reason: "done" | "timeout", optionId: string | null, confidence?: 50 | 75 | 100) => {
      const i = open.current;
      const cur = i === null ? undefined : qs[i];
      if (i === null || !cur) return;
      const latencyMs = Math.min(
        600_000,
        Math.max(0, Math.round(performance.now() - shownAt.current)),
      );
      if (confidence !== undefined)
        rec.current?.emit("confidence", { qref: cur.doc.id, p: confidence }, { item: i });
      if (optionId !== null && reason === "done")
        rec.current?.emit("answer", { qref: cur.doc.id, optionId, latencyMs }, { item: i });
      rec.current?.emit("item_end", { ref: cur.ref, reason }, { item: i });
      open.current = null;
      if (i + 1 < qs.length) startItem(i + 1);
      else {
        setCurrentItem(null, false);
        onEnd("completed");
      }
    },
    [qs, startItem, setCurrentItem, onEnd],
  );

  // Register the module with the host once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one module per mount
  useEffect(() => {
    const m: WebGameModule = {
      timingMode: "none",
      init(_ctx: SessionContext, recorder: EventRecorder) {
        rec.current = recorder;
        props.reportProgress({ loaded: qs.length, total: qs.length, unit: "items" });
      },
      start() {
        startItem(0);
      },
      // Real tests don't pause their clock; there is no timer to stop when none is configured.
      pause() {},
      resume() {},
      onItemVoided() {
        endItem("timeout", null);
      },
      end() {
        const i = open.current;
        const cur = i === null ? undefined : qs[i];
        if (i !== null && cur)
          rec.current?.emit("item_end", { ref: cur.ref, reason: "done" }, { item: i });
        open.current = null;
      },
      getPreview: () => null,
      destroy() {
        rec.current = null;
      },
    };
    return register(m);
  }, []);

  useEffect(() => {
    if (practice)
      void loadPracticeKey(locale)
        .then(setKey)
        .catch(() => setKey({}));
  }, [practice, locale]);

  // Per-question timer, only when the format has one. Announced at 10 s and 5 s only.
  useEffect(() => {
    if (left === null || props.paused) return;
    if (left <= 0) {
      endItem("timeout", null);
      return;
    }
    const h = window.setTimeout(() => setLeft((s) => (s === null ? null : s - 1)), 1000);
    if ((left === 10 || left === 5) && announced.current)
      announced.current.textContent = t("secondsLeft", { s: left });
    return () => window.clearTimeout(h);
  }, [left, props.paused, endItem, t]);

  if (!q) return <div className="ml-exam" data-testid="ll-exam" data-phase="ready" />;

  if (practice)
    return (
      <div className="ml-exam" data-testid="ll-exam" data-mode="practice">
        <QuestionCard
          key={q.doc.id}
          item={q.doc}
          seed={props.ctx.sid}
          answerKey={key[q.doc.id] ?? null}
          onAnswered={(a) => {
            // Recorded on Continue, so the event order is confidence → answer → item_end.
            pending.current = a;
          }}
          onContinue={() => {
            const a = pending.current;
            pending.current = null;
            endItem(
              "done",
              a?.optionId ?? null,
              a ? (Number(a.confidence) as 50 | 75 | 100) : undefined,
            );
          }}
        />
      </div>
    );

  const isLast = index + 1 >= qs.length;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: A–D and Enter shortcuts for the radio group
    <div
      className="ml-exam"
      data-testid="ll-exam"
      data-mode="mock"
      onKeyDown={(e) => {
        const n = LETTERS.indexOf(e.key.toUpperCase());
        const opt = n >= 0 ? q.doc.options[n] : undefined;
        if (opt) {
          setChoice(opt.id);
          e.preventDefault();
        } else if (e.key === "Enter" && choice) {
          endItem("done", choice);
          e.preventDefault();
        }
      }}
    >
      <div className="ml-exambar">
        <span data-testid="exam-counter">{t("q", { i: index + 1, n: qs.length })}</span>
        {left !== null ? (
          <span data-low={left <= 5 ? "true" : undefined} aria-live="off">
            {`0:${String(Math.max(0, left)).padStart(2, "0")}`}
          </span>
        ) : null}
      </div>
      <p ref={announced} className="md-sr-only" aria-live="polite" />
      {q.doc.visuals.map((v) => (
        <SignVisual key={v.id} visual={v} />
      ))}
      <fieldset className="ml-q" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="md-h3" id={`${id}-stem`}>
          {q.doc.stem}
        </legend>
        {q.doc.options.map((o, i) => (
          <label key={o.id} className="ml-opt">
            <input
              type="radio"
              name={`${id}-${q.doc.id}`}
              value={o.id}
              checked={choice === o.id}
              onChange={() => setChoice(o.id)}
            />
            <span>
              {LETTERS[i]}. {o.text}
            </span>
            {o.visual ? <span className="md-sr-only">{o.visual.alt}</span> : null}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        onClick={() => endItem("done", choice)}
        data-testid="exam-next"
      >
        {isLast ? t("submit") : t("next")}
      </button>
    </div>
  );
}

/** Lines under the host's score: the state's pass rule, in plain words, never red; then the
 * coach's session summary (practice and mock). */
function LlResultsExtra({ outcome }: { outcome: SessionOutcome }) {
  const t = useTranslations("llSim.result");
  const r = outcome.checked?.result;
  if (!r) return null;
  const below = r.findings.find((f) => f.findingId === "LL_MOCK_BELOW_PASS");
  const pass = below?.facts["pass_mark"];
  return (
    <div className="md-stack">
      {outcome.mode === "mock" && r.score.passed === false && typeof pass === "number" ? (
        <p>{t("not", { r: r.score.raw, n: r.score.max, p: pass })}</p>
      ) : null}
      <LlSummary outcome={outcome} />
      {outcome.mode === "mock" ? (
        <Link href={`/learn/practise/ll-sim/result/${outcome.sid}`} className="md-link">
          {t("details")}
        </Link>
      ) : null}
    </div>
  );
}

/** One row per question of the run (its own public documents and the scorer's components). */
function LlSummary({ outcome }: { outcome: SessionOutcome }) {
  const tt = useTranslations("learnHub.topics");
  const ts = useTranslations("ai.summary");
  const rec = getSessionRecord(outcome.sid);
  const components = outcome.checked?.result?.score.components ?? [];
  const rows: SummaryRow[] = (rec?.items ?? []).flatMap((it, i) => {
    const doc = it.public as unknown as ExamPublic | undefined;
    const comp = components[i];
    if (!doc || !comp) return [];
    return [{ ref: doc.id, correct: comp.value > 0, label: tt(doc.topic) }];
  });
  const weak = (rec?.items ?? [])
    .map((it, i) => ((components[i]?.value ?? 1) > 0 ? null : (it.public as unknown as ExamPublic)))
    .find((d) => d)?.topic;
  const links: SummaryLink[] = [
    ...(weak
      ? [{ href: `/learn/review?topic=${weak}`, label: ts("reviewTopic", { topic: tt(weak) }) }]
      : []),
    { href: "/learn/practise/ll-sim", label: ts("mock") },
  ];
  return <CoachSummary game="ll" sessionKey={outcome.sid} rows={rows} links={links} />;
}

const game: WebGame = {
  gameId: "ll_sim",
  replayManifest: {
    gameId: "ll_sim",
    version: "1.0.0",
    scoringVersion: SCORING_VERSIONS.ll_sim?.[0] ?? "1.0",
    budgets: GAME_CONFIG.budgets.ll_sim,
  },
  Component: LlSimGame,
  hostStart: true,
  ResultsExtra: LlResultsExtra,
};

// biome-ignore lint/style/noDefaultExport: the game host loads a module's default WebGame
export default game;

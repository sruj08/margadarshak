"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { DeviceItems, SessionOutcome } from "@/features/games/types";
import type { LlFormat } from "@/features/learn/api-types";
import { StudyError, StudyLoading } from "./states";

/** The host loads only once a game phase starts: nothing of it enters the study pages' first load. */
const GameStage = dynamic(
  () => import("@/features/games/host/GameStage").then((m) => m.GameStage),
  { ssr: false, loading: () => <StudyLoading /> },
);

/**
 * The study's fixed 15-question LL set (FIELD_STUDY §4.2): the common LL format, identical for
 * everyone and not any state's test (`known: false`), 9 of 15 to pass. On a device session the
 * questions are dealt from the practice bank with a fixed seed and no "seen" history, so every
 * participant gets the same set; with the API, the server deals the study set (H's `FormItems`).
 */
export const STUDY_LL_FORMAT: LlFormat = {
  state: "JK",
  rule_id: "STUDY-LL-15",
  known: false,
  questions: 15,
  pass_correct: 9,
  pass_pct: 60,
  per_question_timer_s: null,
  total_timer_s: null,
  online_test_available: true,
  where: ["home_online"],
  languages: ["en", "hi"],
  provenance: {
    source_title: "FIELD_STUDY §4.2 study instrument",
    source_url: null,
    verified_on: null,
    confidence: null,
    verified: false,
  },
};
export const STUDY_LL_SEED = "nazar-study-ll-v1";

export interface LlResult {
  sid: string;
  score: { raw: number; max: number } | null;
}

/** Part 1: the LL module (D's simulator) through the game host, study phase `ll_mock`. */
export function LlPhase({
  participantCode,
  onDone,
}: {
  participantCode: string;
  onDone: (r: LlResult) => void;
}) {
  const t = useTranslations("study");
  const locale = useLocale();
  const [device, setDevice] = useState<DeviceItems | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt;
    let alive = true;
    setFailed(false);
    (async () => {
      try {
        const [bankClient, exam] = await Promise.all([
          import("@/features/learn/bank-client"),
          import("@/features/ll-sim/exam-items"),
        ]);
        const [bank, key] = await Promise.all([
          bankClient.loadBank(locale),
          bankClient.loadPracticeKey(locale),
        ]);
        const practice = bank.items.filter((i) => i.pool === "practice" && key[i.id]);
        const items = exam.pickExamItems(practice, 15, {}, STUDY_LL_SEED);
        if (alive) setDevice(exam.examDeviceItems(items, key, STUDY_LL_FORMAT));
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale, attempt]);

  if (failed) return <StudyError onRetry={() => setAttempt((n) => n + 1)} />;
  if (!device) return <StudyLoading label={t("phase.loading")} />;

  // The host scores a device run from the documents it was given (deviceDocs); the server wins.
  const complete = (o: SessionOutcome) => {
    const s = o.checked?.score;
    onDone({ sid: o.sid, score: s ? { raw: s.raw, max: s.max } : null });
  };

  return (
    <div className="st-stage" data-testid="study-ll">
      <GameStage
        gameId="ll_sim"
        mode="mock"
        study={{ participantCode, phase: "ll_mock" }}
        load={() => import("@/features/ll-sim/module")}
        deviceItems={device}
        exitHref="/nazar"
        debriefHref={() => null}
        onComplete={complete}
      />
    </div>
  );
}

/** Parts 2 and 3: C's Nazar module through the host, study phase `test` (10 clips) or `fresh` (5). */
export function NazarPhase({
  participantCode,
  phase,
  onDone,
}: {
  participantCode: string;
  phase: "test" | "fresh";
  onDone: (sid: string) => void;
}) {
  return (
    <div className="st-stage" data-testid={`study-${phase}`}>
      <GameStage
        gameId="nazar"
        mode="mock"
        study={{ participantCode, phase }}
        exitHref="/nazar"
        debriefHref={() => null}
        onComplete={(o) => onDone(o.sid)}
      />
    </div>
  );
}

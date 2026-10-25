"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { DeviceItems, SessionOutcome } from "@/features/games/types";
import type { LlFormat } from "@/features/learn/api-types";
import { loadBank, loadPracticeKey } from "@/features/learn/bank-client";
import type { LlMockRecord } from "@/features/learn/mock-api";
import { LEARN_KEYS, readKv, writeKv } from "@/features/learn/offline/kv";
import { type LogEntry, reviewStore } from "@/features/learn/offline/review-store";
import { ErrorState, LoadingState } from "@/features/learn/ui/states";
import { rememberVariant } from "@/features/learn/variants";
import { examDeviceItems, examPublicDoc, examSize, pickExamItems } from "./exam-items";

/** The host loads only here, after the exam route mounts: nothing of it enters the first load. */
const GameStage = dynamic(
  () => import("@/features/games/host/GameStage").then((m) => m.GameStage),
  { ssr: false, loading: () => <LoadingState rows={3} /> },
);

/**
 * LL exam / practice in the play shell (UI_SPEC_LEARN_GAMES §3.3). Deals the session's questions
 * from the practice bank for the device fallback (the server deals mock-pool items when API-34 is
 * live), mounts the shared game host with the LL module, and on completion keeps the mock on this
 * phone (for the readiness gate and "Your mocks") and, for an unchecked run, its FSRS evidence.
 */
export function ExamPlay({ formats }: { formats: Record<string, LlFormat> }) {
  const t = useTranslations("llSim");
  const locale = useLocale();
  const q = useSearchParams();
  const mode = q.get("mode") === "practice" ? "practice" : "mock";
  const state = q.get("state") ?? "JK";
  const sarathiTest = q.get("real") === "1" ? "&real=1" : "";
  const format = formats[state] ?? formats["JK"];
  const [device, setDevice] = useState<DeviceItems | null>(null);
  const [publicDoc, setPublicDoc] = useState<ReturnType<typeof examPublicDoc> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!format) return;
    let alive = true;
    (async () => {
      try {
        const [bank, key] = await Promise.all([loadBank(locale), loadPracticeKey(locale)]);
        const practice = bank.items.filter((i) => i.pool === "practice" && key[i.id]);
        const seen = readKv<Record<string, string[]>>(LEARN_KEYS.seen, {});
        const n = mode === "practice" ? 10 : examSize(format).questions;
        const items = pickExamItems(practice, n, seen, crypto.randomUUID());
        const next = { ...seen };
        for (const it of items) next[it.concept] = rememberVariant(next[it.concept] ?? [], it.id);
        writeKv(LEARN_KEYS.seen, next);
        if (!alive) return;
        // A server session deals its own questions (mock pool for a mock): show them from the bank.
        setPublicDoc(() => examPublicDoc(bank.items, format));
        setDevice(examDeviceItems(items, key, format));
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [format, locale, mode]);

  if (!format || error) return <ErrorState onRetry={() => window.location.reload()} />;
  if (!device || !publicDoc) return <LoadingState rows={3} label={t("exam.loading")} />;

  // The host scores a device run itself (provisional) from `deviceItems`, so the outcome is final.
  const onComplete = (o: SessionOutcome) => void recordOutcome(o, format, mode);
  return (
    <GameStage
      gameId="ll_sim"
      mode={mode}
      tenant={format.state}
      load={() => import("./module")}
      deviceItems={device}
      publicDoc={publicDoc}
      exitHref={sarathiTest ? "/test/ll" : `/learn/practise/ll-sim?state=${state}`}
      debriefHref={(o) => `/learn/practise/ll-sim/result/${o.sid}?state=${state}${sarathiTest}`}
      onComplete={onComplete}
    />
  );
}

async function recordOutcome(o: SessionOutcome, format: LlFormat, mode: "mock" | "practice") {
  const r = o.checked?.result;
  if (!r) return;
  const at = Date.now();
  if (mode === "mock") {
    const { pass } = examSize(format);
    const rec: LlMockRecord = {
      sid: o.sid,
      at,
      state: format.state,
      correct: r.score.raw,
      total: r.score.max,
      pass,
      passed: r.score.passed === true,
      pct: r.score.pct,
      provisional: o.status !== "verified",
      passPct: format.pass_pct ?? 60,
      wrong: [],
    };
    const all = readKv<LlMockRecord[]>(LEARN_KEYS.llsim, []).filter((m) => m.sid !== o.sid);
    writeKv(LEARN_KEYS.llsim, [...all, rec].slice(-20));
  }
  // A server-checked run's evidence is written by the server (API-35); a device run keeps its
  // evidence on this phone only, so nothing is counted twice.
  if (o.status === "verified") return;
  const entries: LogEntry[] = r.evidence.map((e) => ({
    id: `${o.sid}:${e.cardId}`,
    cardId: e.cardId,
    itemId: "",
    optionId: "",
    rating: e.rating as LogEntry["rating"],
    reviewedAt: at,
    correct: e.correct,
    overconfident: e.overconfident,
    ...(e.confidence ? { confidence: e.confidence } : {}),
    sourceSid: o.sid,
    mode: mode === "mock" ? "mock" : "practice",
    wasDue: false,
  }));
  await reviewStore().append(entries, []);
}

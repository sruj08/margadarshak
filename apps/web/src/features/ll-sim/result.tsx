"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { LlAttemptPanel } from "@/features/flow/ll-test";
import { getSessionRecord, type SessionRecord } from "@/features/games/results-store";
import { loadPracticeKey } from "@/features/learn/bank-client";
import type { PracticeKey } from "@/features/learn/content/bank-types";
import type { LlMockRecord } from "@/features/learn/mock-api";
import { LEARN_KEYS, readKv, writeKv } from "@/features/learn/offline/kv";
import { LoadingState } from "@/features/learn/ui/states";
import { Link } from "@/i18n/navigation";
import type { ExamPublic } from "./exam-items";

/**
 * Exam result (UI_SPEC_LEARN_GAMES §3.4). The score under the state's own pass rule, in --ink and
 * never red ("Not this time: 5 / 10. Pass mark 6."; the word "failed" never appears), the post-exam
 * "how many did you think you got?" (the mock-mode confidence), and the wrong answers grouped by
 * sign family with the reviewed explanation where the item's key is client-safe.
 */

const FAMILY_ORDER = ["MANDATORY", "CAUTIONARY", "INFORMATORY", "MARKINGS", "SIGNALS", "OTHER"];

export function LlResult({ sid }: { sid: string }) {
  const t = useTranslations("llSim.result");
  const tf = useTranslations("llSim.family");
  const locale = useLocale();
  const q = useSearchParams();
  const state = q.get("state") ?? "JK";
  const [rec, setRec] = useState<SessionRecord | null | undefined>(undefined);
  const [key, setKey] = useState<PracticeKey>({});
  const [guess, setGuess] = useState<number | null>(null);

  useEffect(() => {
    setRec(getSessionRecord(sid) ?? null);
    void loadPracticeKey(locale)
      .then(setKey)
      .catch(() => setKey({}));
  }, [sid, locale]);

  if (rec === undefined) return <LoadingState rows={3} />;
  if (rec === null || !rec.checked?.result)
    return (
      <div className="ml-card" data-testid="ll-result-missing">
        <p className="md-h3">{t("missing")}</p>
        <Link href={`/learn/practise/ll-sim?state=${state}`} className="md-link">
          {t("again")}
        </Link>
      </div>
    );

  const r = rec.checked.result;
  const below = r.findings.find((f) => f.findingId === "LL_MOCK_BELOW_PASS");
  const mockRec = readKv<LlMockRecord[]>(LEARN_KEYS.llsim, []).find((m) => m.sid === sid);
  const pass =
    mockRec?.pass ??
    (typeof below?.facts["pass_mark"] === "number" ? below.facts["pass_mark"] : null);
  const provisional = rec.status !== "verified";

  // Wrong answers from the run's own events and public question documents.
  const answers = new Map<number, string>();
  for (const e of rec.events)
    if (e.type === "answer" && typeof e.item === "number")
      answers.set(e.item, (e.p as { optionId: string }).optionId);
  const wrong = rec.items.flatMap((it, i) => {
    const doc = it.public as unknown as ExamPublic | undefined;
    if (!doc) return [];
    const comp = r.score.components[i];
    if (comp && comp.value > 0) return [];
    const chosen = doc.options.find((o) => o.id === answers.get(i));
    const k = key[doc.id];
    const right = doc.options.find((o) => o.id === k?.correct);
    const sign = right?.visual ?? doc.visuals.find((v) => v.kind === "sign");
    return [
      { doc, chosen, right, explanation: k?.explanation ?? null, family: sign?.family ?? "OTHER" },
    ];
  });
  const groups = FAMILY_ORDER.map((f) => ({
    f,
    items: wrong.filter((w) => w.family === f),
  })).filter((g) => g.items.length > 0);
  const weakTopic = wrong[0]?.doc.topic;

  const saveGuess = (n: number) => {
    setGuess(n);
    const all = readKv<LlMockRecord[]>(LEARN_KEYS.llsim, []);
    writeKv(
      LEARN_KEYS.llsim,
      all.map((m) => (m.sid === sid ? { ...m, selfEstimate: n } : m)),
    );
  };

  const sarathiTest = q.get("real") === "1" && rec.mode === "mock";

  return (
    <div className="md-stack" data-testid="ll-result" data-passed={String(r.score.passed)}>
      <div className="ml-result-head">
        <p className="ml-score" data-testid="ll-result-score">
          {r.score.raw} / {r.score.max}
        </p>
        {rec.mode === "mock" ? (
          r.score.passed ? (
            <p className="md-h3">
              {pass !== null ? t("passMark", { p: pass }) : null} ✓ {t("passed")}
            </p>
          ) : (
            <p className="md-h3">{t("not", { r: r.score.raw, n: r.score.max, p: pass ?? "" })}</p>
          )
        ) : null}
        {provisional ? <p className="ml-chip">{t("provisional")}</p> : null}
      </div>

      {sarathiTest ? <LlAttemptPanel passed={r.score.passed === true} sid={sid} /> : null}

      {rec.mode === "mock" ? (
        <fieldset className="ml-card">
          <legend className="md-h3">{t("guess")}</legend>
          <div className="ml-guess">
            {Array.from({ length: r.score.max + 1 }, (_, n) => (
              <label key={n} className="ml-opt">
                <input
                  type="radio"
                  name="guess"
                  checked={guess === n}
                  onChange={() => saveGuess(n)}
                />
                <span className="mj-num">{n}</span>
              </label>
            ))}
          </div>
          {guess !== null ? (
            <p role="status">{t("guessNote", { g: guess, r: r.score.raw })}</p>
          ) : null}
        </fieldset>
      ) : null}

      {groups.length > 0 ? (
        <section className="md-stack" aria-labelledby="ll-wrong">
          <h2 id="ll-wrong" className="md-h2">
            {t("wrongBy")}
          </h2>
          {groups.map((g) => (
            <details key={g.f} className="ml-card">
              <summary className="font-semibold">
                {tf(g.f as "OTHER")} ({g.items.length})
              </summary>
              <ul className="ml-list">
                {g.items.map((w) => (
                  <li key={w.doc.id} className="ml-feedback">
                    <p className="font-semibold">{w.doc.stem}</p>
                    {w.chosen ? (
                      <p>{t("youChose", { a: w.chosen.text })}</p>
                    ) : (
                      <p>{t("noAnswer")}</p>
                    )}
                    {w.right ? <p>{t("answer", { a: w.right.text })}</p> : null}
                    {w.explanation ? <p>{w.explanation}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {groups.some((g) => g.f === "MANDATORY" || g.f === "CAUTIONARY" || g.f === "SIGNALS") ? (
            <p className="ml-small">{t("colour")}</p>
          ) : null}
        </section>
      ) : null}

      <div className="ml-actions">
        {wrong.length > 0 ? (
          <Link
            href={weakTopic ? `/learn/review?topic=${weakTopic}` : "/learn/review"}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          >
            {t("practise", { n: wrong.length })}
          </Link>
        ) : null}
        <Link href={`/learn/practise/ll-sim/exam?mode=mock&state=${state}`} className="md-link">
          {t("again")}
        </Link>
        <Link href="/learn/readiness" className="md-link">
          {t("readiness")}
        </Link>
      </div>
      <p className="ml-small">{t("label")}</p>
    </div>
  );
}

"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { getLlFormat } from "@/features/learn/api";
import type { LlFormat } from "@/features/learn/api-types";
import { LEARN_KEYS, useKv } from "@/features/learn/offline/kv";
import { OfflineBanner } from "@/features/learn/ui/states";
import { Link, useRouter } from "@/i18n/navigation";
import { getActiveCase, getCachedCase } from "@/lib/case/case-store";
import { examSize } from "./exam-items";
import { LastMocks } from "./last-mocks";

/**
 * Format card (UI_SPEC_LEARN_GAMES §3.1, GAME_DESIGN §11.3). "Format for J&K: 10 questions, 6 to
 * pass. Source …, checked DATE" straight from the rule pack (API-05, or the rules mirror on this
 * phone). An unknown format is shown as a practice default, never as the state's; EC-10 says plainly
 * when the LL test is taken at the RTO. The per-question timer line appears only when the format
 * has a timer.
 */
export function FormatCard({
  formats,
  states,
}: {
  formats: Record<string, LlFormat>;
  states: string[];
}) {
  const t = useTranslations("llSim");
  const ts = useTranslations("llSim.states");
  const format = useFormatter();
  const router = useRouter();
  const id = useId();
  const q = useSearchParams();
  const [state, setState] = useState(q.get("state") ?? "JK");
  const [f, setF] = useState<LlFormat | undefined>(formats[state]);
  const guided = useKv<boolean>(LEARN_KEYS.guided, false);

  useEffect(() => {
    if (q.get("state")) return;
    const c = getActiveCase();
    const tenant = c ? getCachedCase(c.caseId)?.tenant : undefined;
    if (typeof tenant === "string" && formats[tenant]) setState(tenant);
  }, [q, formats]);

  useEffect(() => {
    const fallback = formats[state];
    if (!fallback) return;
    setF(fallback);
    void getLlFormat(state, fallback)
      .then((r) => setF(r.data))
      .catch(() => setF(fallback));
  }, [state, formats]);

  if (!f) return null;
  const { questions, pass } = examSize(f);
  const name = ts(state as "JK");
  const checked = f.provenance.verified_on
    ? format.dateTime(new Date(`${f.provenance.verified_on}T00:00:00+05:30`), {
        dateStyle: "medium",
      })
    : null;
  const examHref = (mode: string) => `/learn/practise/ll-sim/exam?mode=${mode}&state=${state}`;

  return (
    <div className="md-stack" data-testid="ll-format" data-state={state}>
      <OfflineBanner />
      <div className="ml-row">
        <label htmlFor={`${id}-s`} className="font-semibold">
          {t("format.stateLabel")}
        </label>
        <select
          id={`${id}-s`}
          className="ml-input"
          style={{ maxWidth: 240 }}
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            router.replace(`/learn/practise/ll-sim?state=${e.target.value}`);
          }}
        >
          {states.map((s) => (
            <option key={s} value={s}>
              {ts(s as "JK")}
            </option>
          ))}
        </select>
      </div>

      <section className="ml-card" aria-labelledby={`${id}-h`}>
        {f.known ? (
          <>
            <h2 id={`${id}-h`} className="md-h2">
              {t("format.for", { state: name })}
            </h2>
            <p className="md-h3" data-testid="ll-format-line">
              {t("format.line", { q: questions, p: pass })}
            </p>
          </>
        ) : (
          <>
            <h2 id={`${id}-h`} className="md-h2">
              {t("format.unknownTitle", { state: name })}
            </h2>
            <p className="md-h3" data-testid="ll-format-line">
              {t("format.unknown", { state: name, q: questions, p: pass })}
            </p>
          </>
        )}
        {f.per_question_timer_s !== null ? (
          <p>{t("format.timer", { s: f.per_question_timer_s })}</p>
        ) : null}
        {f.provenance.source_title ? (
          <p className="ml-small">
            {t("format.source", { s: f.provenance.source_title })}
            {checked ? ` · ${t("format.checked", { date: checked })}` : ""}
          </p>
        ) : null}
        {f.provenance.confidence && f.provenance.confidence !== "high" ? (
          <p className="ml-small">
            ▲ {t("format.confidence", { c: t(`format.conf.${f.provenance.confidence}`) })} ·{" "}
            {t("format.disagree")}
          </p>
        ) : null}
      </section>

      {!f.online_test_available ? (
        <p className="ml-feedback" data-tone="warn" data-testid="ll-rto">
          {t("format.rto", { state: name })}
        </p>
      ) : null}

      <div className="ml-actions">
        <Link
          href="/learn/practise/ll-sim/guided"
          className={buttonClassName({
            variant: guided ? "secondary" : "primary",
            size: "lg",
            fullWidth: true,
          })}
        >
          {t("format.guided", { min: 2 })}
        </Link>
        <Link
          href={examHref("mock")}
          className={buttonClassName({
            variant: guided ? "primary" : "outline",
            size: "lg",
            fullWidth: true,
          })}
          data-testid="ll-start"
        >
          {t("format.start")}
        </Link>
        <Link href={examHref("practice")} className="md-link">
          {t("format.practice")}
        </Link>
      </div>
      <LastMocks />
      <p className="ml-small">{t("format.deviceNote")}</p>
      <p className="ml-small">{t("label")}</p>
    </div>
  );
}

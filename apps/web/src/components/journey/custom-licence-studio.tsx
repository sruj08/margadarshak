"use client";

import { Check, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { IndianDrivingLicenceCard } from "@/components/home/indian-driving-licence-card";
import { type ActiveCase, getCaseFacts } from "@/lib/case/case-store";
import { readVault } from "@/lib/case/vault";
import type { Case } from "@/lib/journey/api-types";
import { type TrackStep, trackerSteps } from "@/lib/journey/stage";

const BLANK_DATE = "••-••-••••";
const MILESTONES = ["ll_test", "dl_test", "card"] as const;

function formatIsoToDdMmYyyy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Steps of the licence road that are done, as a whole percentage. No case yet means 0. */
function roadProgress(steps: TrackStep[] | null): number {
  if (!steps || steps.length === 0) return 0;
  const done = steps.filter((s) => s.status === "done").length;
  return Math.round((done / steps.length) * 100);
}

/**
 * Licence card progress (My Licence): the card prints in from the left as the learner clears
 * each step of the road, and the bar says how close they are to the real licence. Nothing here
 * is typed in; it all comes from the case (the same steps as the parcel tracker below).
 */
export function CustomLicenceStudio({
  activeCase,
  cachedCase,
}: {
  activeCase?: ActiveCase | null;
  cachedCase?: Case | null;
}) {
  const t = useTranslations("licenceTab.cardStudio");
  const tt = useTranslations("tracker");

  const [vaultName, setVaultName] = useState<string | null>(null);
  const [shown, setShown] = useState<number>(0);
  const shownRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  const steps = useMemo(() => (cachedCase ? trackerSteps(cachedCase) : null), [cachedCase]);
  const target = roadProgress(steps);
  const doneCount = steps ? steps.filter((s) => s.status === "done").length : 0;
  const total = steps?.length ?? 9;
  const current = steps?.find((s) => s.status === "now") ?? null;
  const complete = target >= 100;

  // The holder's own name, if they saved it in their vault; never invented.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeCase?.caseId) {
        setVaultName(null);
        return;
      }
      try {
        const v = await readVault(activeCase.caseId);
        if (!cancelled) setVaultName(v["full_name"]?.trim() || null);
      } catch {
        if (!cancelled) setVaultName(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeCase?.caseId]);

  // Ease the card from wherever it is to the real progress.
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const from = shownRef.current;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === target) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const duration = 1400;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      const v = from + (target - from) * eased;
      shownRef.current = v;
      setShown(v);
      if (k < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = 0;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  // Only what the case really knows goes on the card; the rest stays blank until it is real.
  const card = useMemo(() => {
    const name = vaultName || activeCase?.memberLabel?.trim() || "—";
    const last4 = cachedCase?.dl?.number_last4 ?? null;
    const prefix = cachedCase ? cachedCase.tenant : "••";
    const dlNumber = `${prefix}-•• •••• •••${last4 ?? "••••"}`;
    const dl = cachedCase?.dl ?? null;
    const doi = formatIsoToDdMmYyyy(dl?.issued_on) ?? BLANK_DATE;
    const validTill = dl?.valid_to_non_transport
      ? `${formatIsoToDdMmYyyy(dl.valid_to_non_transport)} (NT)`
      : BLANK_DATE;
    const facts = activeCase?.caseId ? getCaseFacts(activeCase.caseId) : null;
    const dob =
      (facts?.age.kind === "dob" ? formatIsoToDdMmYyyy(facts.age.dob) : null) ?? BLANK_DATE;
    const classes = cachedCase?.classes.map((c) => c.class_code) ?? [];
    return {
      name,
      dlNumber,
      doi,
      validTill,
      dob,
      covCodes: classes.length > 0 ? classes.slice(0, 2) : ["•••"],
    };
  }, [vaultName, activeCase?.memberLabel, activeCase?.caseId, cachedCase]);

  const currentName = current ? tt(`step.${current.id}` as "step.plan") : t("allDone");
  const animating = Math.abs(shown - target) > 0.5;
  const pct = Math.round(shown);
  const stageText = complete
    ? t("stageReady")
    : cachedCase
      ? t("stageNow", { step: currentName })
      : t("stageStart");

  return (
    <section
      className="mj-card md-card-studio"
      aria-labelledby="lt-card-studio-title"
      data-testid="custom-licence-studio"
    >
      <div className="md-card-studio__grid">
        <div className="md-card-studio__controls">
          <div className="md-card-studio__head">
            <div className="md-card-studio__badges">
              <span className="md-card-studio__eyebrow">
                <Sparkles size={13} aria-hidden="true" />
                {t("eyebrow")}
              </span>
              <span
                className={`md-card-studio__status${complete ? "" : " md-card-studio__status--busy"}`}
                data-testid="card-studio-status"
              >
                <span className="md-card-studio__status-dot" aria-hidden="true" />
                {complete ? t("statusReady") : t("statusLoading", { pct })}
              </span>
            </div>

            <h2 id="lt-card-studio-title" className="mj-h2 md-card-studio__title">
              {t("title")}
            </h2>
            <p className="mj-caption md-card-studio__sub">{t("subtitle")}</p>
          </div>

          <div
            className={`md-card-loader${complete ? " md-card-loader--done" : " md-card-loader--active"}`}
            data-testid="card-loading-bar"
            data-loading={complete ? "false" : "true"}
            role="progressbar"
            aria-label={t("loaderAria")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={target}
            aria-valuetext={t("valueText", { done: doneCount, total })}
          >
            <div className="md-card-loader__top">
              <span className="md-card-loader__stage">
                <span className="md-card-loader__pulse" aria-hidden="true" />
                {stageText}
              </span>
              <span className="md-card-loader__pct mj-num" data-testid="card-loading-pct">
                {String(pct).padStart(2, "0")}%
              </span>
            </div>

            <div className="md-card-loader__track">
              <div
                className="md-card-loader__fill"
                style={{ width: `${Math.max(0, Math.min(100, shown))}%` }}
              >
                <span className="md-card-loader__head" aria-hidden="true" />
              </div>
            </div>

            <ul className="md-card-loader__steps" aria-hidden="true">
              {MILESTONES.map((id) => {
                const done = steps?.find((s) => s.id === id)?.status === "done";
                return (
                  <li key={id} data-done={done ? "true" : "false"}>
                    <span className="md-card-loader__step-icon">
                      {done ? <Check size={11} strokeWidth={3} /> : null}
                    </span>
                    <span>{tt(`step.${id}` as "step.plan")}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <dl className="md-card-studio__meta" data-testid="custom-card-meta">
            <div>
              <dt>{t("metaDone")}</dt>
              <dd className="mj-num">{t("metaDoneVal", { done: doneCount, total })}</dd>
            </div>
            <div>
              <dt>{t("metaNow")}</dt>
              <dd>{currentName}</dd>
            </div>
            <div>
              <dt>{t("metaWho")}</dt>
              <dd>{current ? tt(`who.${current.who}` as "who.you") : "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="md-card-studio__stage-wrap">
          <IndianDrivingLicenceCard
            holderName={card.name}
            dlNumber={card.dlNumber}
            doi={card.doi}
            validTill={card.validTill}
            dob={card.dob}
            bloodGroup="•"
            covCodes={card.covCodes}
            isLoading={animating}
            loadProgress={shown}
            revealProgress={shown}
            loadStageLabel={complete ? "" : currentName}
          />
          <p className="md-card-studio__hint">{t("deviceNote")}</p>
        </div>
      </div>
    </section>
  );
}

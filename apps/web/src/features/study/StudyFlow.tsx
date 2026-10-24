"use client";

import { Fieldset } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  enrolStudy,
  grantStudyConsent,
  type Source,
  StudyApiError,
  StudyOffline,
  setStudyApiLocale,
} from "./api";
import { FeedbackStep } from "./Feedback";
import {
  clearFlow,
  type FlowState,
  type FlowStep,
  initialFlow,
  loadFlow,
  STEP_TOTAL,
  saveFlow,
  stepNumber,
} from "./flow-store";
import { LiveCounters } from "./LiveCounters";
import { NearMissStep } from "./NearMiss";
import { ScoreStep } from "./ScoreCard";
import { LlPhase, NazarPhase } from "./StudyStage";
import { StudyError, StudyLoading, StudyOfflineNote } from "./states";
import {
  AGE_BANDS,
  type AgeBand,
  LICENCES,
  type Licence,
  type StudyEnrolment,
  YEARS,
  type Years,
} from "./types";

/**
 * The scripted Nazar field-study flow (FIELD_STUDY §4.3, NAZAR §10, MD-237), about 6 minutes:
 * consent → bands → enrolment (participant code + form A/B/C) → 15-question LL module (phase
 * ll_mock) → 10 test clips (phase test) → replay feedback on 2 clips → 5 fresh clips (phase fresh)
 * → score card and share → optional near-miss line → thanks.
 *
 * Declining consent (or answering "under 18") ends the flow with **no request and nothing stored**.
 * Progress is kept in sessionStorage only after the consent was accepted (flow-store.ts).
 */
export function StudyFlow() {
  const t = useTranslations("study");
  const locale = useLocale();
  const [flow, setFlow] = useState<FlowState | null>(null);
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const first = useRef(true);

  useEffect(() => {
    setStudyApiLocale(locale);
    setFlow(loadFlow() ?? initialFlow());
  }, [locale]);

  const go = useCallback((patch: Partial<FlowState>) => {
    setFlow((prev) => {
      const next = { ...(prev ?? initialFlow()), ...patch, sids: { ...prev?.sids, ...patch.sids } };
      saveFlow(next);
      return next;
    });
  }, []);

  const step = flow?.step;
  // New step: back to the top, focus its heading (screen readers hear where they are).
  useEffect(() => {
    if (!step) return;
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    headRef.current?.focus();
  }, [step]);

  if (!flow) return <StudyLoading />;

  const inGame = step === "ll" || step === "test" || step === "fresh";
  const n = stepNumber(flow.step);

  return (
    <div
      className={inGame ? "st-flow st-flow--game" : "st-flow"}
      data-testid="study-flow"
      data-step={flow.step}
    >
      <StudyOfflineNote />
      {flow.step !== "done" && flow.step !== "declined" && flow.step !== "under18" ? (
        <p className="st-progress" data-testid="study-progress">
          {t("progress", { n, total: STEP_TOTAL })}
        </p>
      ) : null}
      <StepHeading step={flow.step} headRef={headRef} participant={flow.participant} />
      <StepBody flow={flow} go={go} setFlow={setFlow} />
    </div>
  );
}

/** The body of the current step (one per FIELD_STUDY §4.3 step). */
function StepBody({
  flow,
  go,
  setFlow,
}: {
  flow: FlowState;
  go: (patch: Partial<FlowState>) => void;
  setFlow: (f: FlowState) => void;
}) {
  const t = useTranslations("study");
  const participant = flow.participant;
  const code = participant?.participant_code;
  switch (flow.step) {
    case "consent":
      return (
        <ConsentStep
          onAgree={(consentId, source) =>
            go({ step: "bands", consentId, source, startedAt: Date.now() })
          }
          onDecline={() => setFlow({ ...initialFlow(), step: "declined" })}
          onUnder18={() => setFlow({ ...initialFlow(), step: "under18" })}
        />
      );
    case "declined":
      return <Declined onBack={() => setFlow(initialFlow())} />;
    case "under18":
      return <Under18 />;
    case "bands":
      return (
        <BandsStep
          consentId={flow.consentId ?? null}
          onEnrolled={(p, source) => go({ step: "enrolled", participant: p, source })}
        />
      );
    case "score":
      return (
        <ScoreStep sids={flow.sids} ll={flow.ll ?? null} onNext={() => go({ step: "nearmiss" })} />
      );
    case "feedback":
      return <FeedbackStep sid={flow.sids.test ?? ""} onDone={() => go({ step: "fresh" })} />;
    default:
      break;
  }
  if (!participant || !code) {
    return (
      <StudyError
        line={t("states.errorTitle")}
        onRetry={() => {
          clearFlow();
          setFlow(initialFlow());
        }}
      />
    );
  }
  switch (flow.step) {
    case "enrolled":
      return (
        <Enrolled
          participant={participant}
          mock={flow.source === "mock"}
          onStart={() => go({ step: "ll" })}
        />
      );
    case "ll":
      return (
        <>
          <p className="st-hint">{t("phase.llNote")}</p>
          <LlPhase
            participantCode={code}
            onDone={(r) => go({ step: "test", sids: { ll: r.sid }, ll: r.score })}
          />
        </>
      );
    case "test":
      return (
        <NazarPhase
          participantCode={code}
          phase="test"
          onDone={(sid) => go({ step: "feedback", sids: { test: sid } })}
        />
      );
    case "fresh":
      return (
        <NazarPhase
          participantCode={code}
          phase="fresh"
          onDone={(sid) => go({ step: "score", sids: { fresh: sid } })}
        />
      );
    case "nearmiss":
      return <NearMissStep participantCode={code} onDone={() => go({ step: "done" })} />;
    default:
      return <Done participant={participant} />;
  }
}

function StepHeading({
  step,
  headRef,
  participant,
}: {
  step: FlowStep;
  headRef: RefObject<HTMLHeadingElement | null>;
  participant: StudyEnrolment | undefined;
}) {
  const t = useTranslations("study");
  const title: Record<FlowStep, string> = {
    consent: t("consent.h1"),
    declined: t("declined.h1"),
    under18: t("under18.h1"),
    bands: t("bands.h1"),
    enrolled: t("enrolled.h1", { code: participant?.participant_code ?? "" }),
    ll: t("phase.ll"),
    test: t("phase.test"),
    feedback: t("phase.test"),
    fresh: t("phase.fresh"),
    score: t("score.h1"),
    nearmiss: t("nearMiss.h1"),
    done: t("done.h1"),
  };
  return (
    <h1 ref={headRef} tabIndex={-1} className="md-h1 st-h1" data-testid="study-h1">
      {title[step]}
    </h1>
  );
}

function ConsentStep({
  onAgree,
  onDecline,
  onUnder18,
}: {
  onAgree: (consentId: string | null, source: Source) => void;
  onDecline: () => void;
  onUnder18: () => void;
}) {
  const t = useTranslations("study");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<"offline" | "error" | null>(null);
  const agree = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await grantStudyConsent();
      onAgree(r.consentId, r.source);
    } catch (e) {
      setErr(e instanceof StudyOffline ? "offline" : "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="st-card" data-testid="study-consent" aria-label={t("consent.h1")}>
      <p className="st-strong">{t("consent.intro")}</p>
      <ul className="st-list">
        {(["p1", "p2", "p3", "p4", "p5", "p6", "p7"] as const).map((k) => (
          <li key={k}>{t(`consent.${k}`)}</li>
        ))}
      </ul>
      {locale === "hi" ? <p className="st-hint">{t("consent.reviewNote")}</p> : null}
      {err === "offline" ? <StudyOfflineNote force /> : null}
      {err === "error" ? <StudyError /> : null}
      <div className="st-actions">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          isPending={busy}
          onPress={() => void agree()}
          data-testid="consent-agree"
        >
          {t("consent.agree")}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          isDisabled={busy}
          onPress={onDecline}
          data-testid="consent-decline"
        >
          {t("consent.decline")}
        </Button>
      </div>
      <Button
        variant="ghost"
        fullWidth
        isDisabled={busy}
        onPress={onUnder18}
        data-testid="consent-under18"
      >
        {t("consent.under18")}
      </Button>
    </section>
  );
}

function Declined({ onBack }: { onBack: () => void }) {
  const t = useTranslations("study");
  return (
    <section className="st-card" data-testid="study-declined">
      <p>{t("declined.line")}</p>
      <Link
        href="/learn/practise/nazar"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {t("declined.practise")}
      </Link>
      <Button variant="ghost" fullWidth onPress={onBack}>
        {t("declined.back")}
      </Button>
    </section>
  );
}

function Under18() {
  const t = useTranslations("study");
  return (
    <section className="st-card" data-testid="study-under18">
      <p>{t("under18.line")}</p>
      <Link
        href="/learn/practise/nazar"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {t("under18.practise")}
      </Link>
    </section>
  );
}

function BandsStep({
  consentId,
  onEnrolled,
}: {
  consentId: string | null;
  onEnrolled: (p: StudyEnrolment, source: Source) => void;
}) {
  const t = useTranslations("study");
  const id = useId();
  const [age, setAge] = useState<AgeBand | null>(null);
  const [licence, setLicence] = useState<Licence | null>(null);
  const [years, setYears] = useState<Years | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<"offline" | "consent" | "error" | null>(null);
  const key = useRef(crypto.randomUUID());

  const submit = async () => {
    if (!age || !licence || !years) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setErr(null);
    setBusy(true);
    try {
      const r = await enrolStudy(
        {
          ...(consentId && /^cns_[0-9A-Z]{6,26}$/.test(consentId) ? { consent_id: consentId } : {}),
          age_ok: true,
          age_band: age,
          licence_held: licence,
          years_driving: years,
          retake_of: null,
        },
        key.current,
      );
      onEnrolled(r.data, r.source);
    } catch (e) {
      setErr(
        e instanceof StudyOffline
          ? "offline"
          : e instanceof StudyApiError && e.status === 403
            ? "consent"
            : "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const group = <V extends string>(
    name: string,
    legend: string,
    values: readonly V[],
    label: (v: V) => string,
    value: V | null,
    set: (v: V) => void,
  ) => (
    <Fieldset className="st-fieldset" data-testid={`band-${name}`}>
      <Fieldset.Legend className="st-label">{legend}</Fieldset.Legend>
      {values.map((v) => (
        <label key={v} className="st-choice">
          <input
            type="radio"
            name={`${id}-${name}`}
            value={v}
            checked={value === v}
            onChange={() => set(v)}
            data-testid={`band-${name}-${v}`}
          />
          <span>{label(v)}</span>
        </label>
      ))}
    </Fieldset>
  );

  return (
    <section className="st-card" data-testid="study-bands" aria-label={t("bands.h1")}>
      <p className="st-hint">{t("bands.lead")}</p>
      {group("age", t("bands.age"), AGE_BANDS, (v) => t(`bands.ageOpt.${v}`), age, setAge)}
      {group(
        "licence",
        t("bands.licence"),
        LICENCES,
        (v) => t(`bands.licenceOpt.${v}`),
        licence,
        setLicence,
      )}
      {group("years", t("bands.years"), YEARS, (v) => t(`bands.yearsOpt.${v}`), years, setYears)}
      {missing ? (
        <p role="alert" className="st-error">
          {t("bands.missing")}
        </p>
      ) : null}
      {err === "offline" ? <StudyOfflineNote force /> : null}
      {err === "error" || err === "consent" ? <StudyError /> : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        isPending={busy}
        onPress={() => void submit()}
        data-testid="bands-continue"
      >
        {busy ? t("bands.enrolling") : t("bands.continue")}
      </Button>
    </section>
  );
}

function Enrolled({
  participant,
  mock,
  onStart,
}: {
  participant: StudyEnrolment;
  mock: boolean;
  onStart: () => void;
}) {
  const t = useTranslations("study");
  return (
    <section className="st-card" data-testid="study-enrolled" data-form={participant.form}>
      <p className="st-code" data-testid="participant-code">
        {participant.participant_code}
      </p>
      <p>{t("enrolled.keep")}</p>
      <p data-testid="participant-form">{t("enrolled.form", { form: participant.form })}</p>
      {mock ? <p className="st-hint">{t("enrolled.mock")}</p> : null}
      <p>{t("enrolled.plan")}</p>
      <Button variant="primary" size="lg" fullWidth onPress={onStart} data-testid="enrolled-start">
        {t("enrolled.start")}
      </Button>
    </section>
  );
}

function Done({ participant }: { participant: StudyEnrolment }) {
  const t = useTranslations("study");
  return (
    <section className="st-card" data-testid="study-done">
      <p data-testid="done-code">{t("done.line", { code: participant.participant_code })}</p>
      <p>{t("done.debrief")}</p>
      <LiveCounters />
      <Link
        href="/learn/practise/nazar"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {t("done.practise")}
      </Link>
      <Link href="/" className={buttonClassName({ variant: "ghost", fullWidth: true })}>
        {t("done.home")}
      </Link>
    </section>
  );
}

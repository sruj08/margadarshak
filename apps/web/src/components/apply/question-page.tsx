"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { ProgressBar } from "@margdarshak/ui/components/progress";
import { QuestionScreen } from "@margdarshak/ui/components/question-screen";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CheckRow, ChoiceCards } from "@/components/journey/choices";
import { Link, useRouter } from "@/i18n/navigation";
import { getActiveCase, setActiveCase } from "@/lib/case/case-store";
import { openMemberCase } from "@/lib/case/family";
import { useCaseSession } from "@/lib/case/use-case-session";
import { API_MODE, addFamilyMember, setParentalConsent, whoAmI } from "@/lib/journey/api";
import type { FamilyMember } from "@/lib/journey/api-types";
import {
  type AnswerValue,
  applyAnswer,
  type FieldError,
  nextInTask,
  positionInTask,
  prevInTask,
  question,
  validate,
} from "@/lib/journey/form-engine";
import { type AgeAnswer, type AgeBand, bandOf, yearsBefore } from "@/lib/journey/plan-model";
import { logEvent, recordScreen } from "@/lib/journey/trial-log";
import { containsIdentityNumber } from "@/lib/redact/redact";
import { SavedAgo } from "./saved-ago";

const API_BAND: Record<AgeBand, FamilyMember["age_band"]> = {
  under_16: "under_16",
  "16_17": "16_17",
  "18_19": "18_25",
  "20_39": "26_40",
  "40_plus": "41_60",
};

type Q = (key: string, values?: Record<string, string | number>) => string;

/**
 * The member's date of birth for API-59 (the server derives the age band from it). An age given
 * as a band stands in with the band's youngest age, as the rules engine does.
 */
function memberDob(age: AgeAnswer, today: string): { dob: string; precision: "day" | "year_only" } {
  if (age.kind === "dob") return { dob: age.dob, precision: "day" };
  if (age.kind === "year") return { dob: `${age.year}-12-31`, precision: "year_only" };
  return { dob: yearsBefore(today, age.band === "under_16" ? 15 : 16), precision: "day" };
}

/**
 * Family mode needs a signed-in adult account holder (API-07/08): adding a family member and
 * recording verifiable parental consent are account actions. Everything else works anonymously.
 */
function FamilySignInGate({ questionId }: { questionId: string }) {
  const t = useTranslations("familySignIn");
  const tc = useTranslations("common");
  return (
    <div className="mj-screen" data-screen="SCR-031" data-testid="family-signin-gate">
      <Link href="/apply/q/member_kind" className="mj-back">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        <span>{tc("back")}</span>
      </Link>
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      <ul className="mj-ticks">
        {(["b1", "b2", "b3"] as const).map((k) => (
          <li key={k}>
            <StatusGlyph kind="info" size={20} />
            <span>{t(k)}</span>
          </li>
        ))}
      </ul>
      <div className="mj-actions">
        <Link
          href={`/signin?return=${encodeURIComponent(`/apply/q/${questionId}`)}`}
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          data-testid="family-signin"
        >
          {t("cta")}
        </Link>
        <Link href="/apply" className={buttonClassName({ variant: "tertiary", fullWidth: true })}>
          {t("later")}
        </Link>
      </div>
    </div>
  );
}

/**
 * Question page (SCR-031, MD-110): one question per screen with "why we ask", inline validation
 * (GOV.UK error summary, focus moves to it), back without loss, progress in steps, autosave to the
 * IndexedDB draft and API-12. Personal values (non-Aadhaar path) go to the on-device vault only.
 */
export function QuestionPage({ questionId }: { questionId: string }) {
  const t = useTranslations("q");
  const ta = useTranslations("apply");
  const tc = useTranslations("common");
  const router = useRouter();
  const s = useCaseSession();
  const q = question(questionId);
  const tq: Q = (key, values) => t(`${questionId}.${key}` as "for_whom.title", values as never);

  const [value, setValue] = useState<AnswerValue | undefined>(undefined);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const needsAccount = q?.id === "parental_consent" && !s.active?.memberId;

  useEffect(() => {
    if (!needsAccount) return;
    let live = true;
    void whoAmI().then((r) => {
      if (live) setSignedIn(r.signedIn);
    });
    return () => {
      live = false;
    };
  }, [needsAccount]);

  useEffect(() => {
    setReturnTo(new URLSearchParams(window.location.search).get("return"));
    recordScreen(`apply.q.${questionId}`);
  }, [questionId]);

  useEffect(() => {
    if (!s.ready || seeded.current) return;
    seeded.current = true;
    setValue(s.answers[questionId] ?? undefined);
    if (q?.kind === "text") {
      const init: Record<string, string> = {};
      for (const f of q.fields ?? []) init[f.id] = s.vault[f.id] ?? "";
      setTexts(init);
    }
  }, [s.ready, s.answers, s.vault, q, questionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: title and focus are set once per question
  useEffect(() => {
    if (!q) return;
    const pos = positionInTask(questionId, s.answers, s.ctx);
    document.title = `${ta("questionOf", { i: pos.i, n: pos.n })}: ${tq("title")} · Margdarshak`;
    document.getElementById("q-title")?.focus();
  }, [questionId, q]);

  if (!q) {
    return (
      <EmptyState
        as="h1"
        title={ta("noQuestion")}
        action={
          <Link href="/apply" className={buttonClassName({ variant: "primary", size: "lg" })}>
            {ta("backToTasks")}
          </Link>
        }
      />
    );
  }
  if (s.ready && !s.active) {
    return (
      <EmptyState
        as="h1"
        title={ta("noCaseTitle")}
        line={ta("noCaseLine")}
        action={
          <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
            {ta("makePlan")}
          </Link>
        }
      />
    );
  }

  if (needsAccount && signedIn === false) return <FamilySignInGate questionId={questionId} />;
  if (needsAccount && signedIn === null) return <div className="mj-screen" aria-busy="true" />;

  const pos = positionInTask(questionId, s.answers, s.ctx);
  const prev = prevInTask(questionId, s.answers, s.ctx);
  const backHref = returnTo === "check" ? "/apply/check" : prev ? `/apply/q/${prev}` : "/apply";
  const memberLabel = s.active?.memberLabel ?? null;

  const options: { id: string; label: string; description?: string }[] =
    q.id === "office"
      ? s.ctx.offices.map((o) => ({ id: o.id, label: o.name }))
      : (q.options ?? []).map((o) => {
          const desc = t.has(`${questionId}.d.${o}` as "for_whom.title") ? tq(`d.${o}`) : undefined;
          return { id: o, label: tq(`o.${o}`), ...(desc ? { description: desc } : {}) };
        });

  const errorText = (e: FieldError) => ta(`err.${e}`);

  const submit = async () => {
    const err = validate(q, value, texts, containsIdentityNumber);
    if (err) {
      setError(err);
      logEvent("error", `apply.q.${questionId}`, err);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setError(null);
    setBusy(true);
    if (q.kind === "text") {
      await s.saveVault(texts);
      await s.save({ [`${questionId}_done`]: true });
      logEvent("typed", `apply.q.${questionId}`, String(Object.keys(texts).length));
    } else {
      const next = applyAnswer(s.answers, questionId, value ?? null, s.ctx);
      const patch: Record<string, AnswerValue | undefined> = { [questionId]: value ?? null };
      for (const k of Object.keys(s.answers)) if (!(k in next)) patch[k] = undefined;
      if (!("check_confirmed" in next) && "check_confirmed" in s.answers)
        patch["check_confirmed"] = undefined;
      await s.save(patch);
      logEvent("select", `apply.q.${questionId}`, String(value));
    }
    if (q.id === "parental_consent" && value === true) await recordParentalConsent();
    const after = applyAnswer(s.answers, questionId, value ?? null, s.ctx);
    const nextQ = returnTo === "check" ? null : nextInTask(questionId, after, s.ctx);
    router.push(returnTo === "check" ? "/apply/check" : nextQ ? `/apply/q/${nextQ}` : "/apply");
  };

  const recordParentalConsent = async () => {
    const active = getActiveCase();
    if (!active || !s.facts) return;
    const today = new Date().toISOString().slice(0, 10);
    const band = bandOf(s.facts.age, today);
    const { dob, precision } = memberDob(s.facts.age, today);
    try {
      const kind = String(s.answers["member_kind"] ?? "child");
      const relation = (
        ["child", "parent", "spouse", "sibling", "other"].includes(kind) ? kind : "child"
      ) as FamilyMember["relation"];
      const member = active.memberId
        ? null
        : await addFamilyMember({
            relation,
            dob,
            dob_precision: precision,
            age_band: API_BAND[band],
            is_minor: true,
          });
      const memberId = active.memberId ?? member?.data.member_id ?? null;
      const consent = memberId ? await setParentalConsent(memberId, "grant") : null;
      // The account now holds the member and the consent: open the application as their case.
      const moved =
        API_MODE === "real" &&
        !active.local &&
        memberId &&
        member?.source === "server" &&
        consent?.source === "server"
          ? await openMemberCase(active, memberId, member.data.label ?? null).catch(() => null)
          : null;
      setActiveCase(moved ?? { ...active, memberId, minor: true });
    } catch {
      // Offline: the consent answer is saved in the draft and replayed with the case.
    }
  };

  const errorSummary = error ? (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      className="mj-error-summary"
      data-testid="error-summary"
    >
      <strong>{tc("problem")}</strong>
      <a href="#q-field">{errorText(error)}</a>
    </div>
  ) : null;

  const inline = (() => {
    if (q.id === "aadhaar_relation_line" && value === "no")
      return { title: tq("noteNoTitle"), body: tq("noteNo") };
    if (q.id === "mobile_linked" && value === "no")
      return { title: tq("noteNoTitle"), body: tq("noteNo") };
    if (q.id === "licence_held" && (value === "ll" || value === "dl"))
      return { title: tq("noteHeldTitle"), body: tq("noteHeld") };
    if (q.id === "category" && value === "divyang")
      return { title: tq("noteDivyangTitle"), body: tq("noteDivyang") };
    if (q.id === "form1a" && value === "not_yet")
      return { title: tq("noteNotYetTitle"), body: tq("noteNotYet") };
    return null;
  })();

  return (
    <QuestionScreen
      screenId="SCR-031"
      back={
        <Link
          href={backHref}
          className="mj-back"
          onClick={() => logEvent("back", `apply.q.${questionId}`)}
        >
          <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
          <span>{returnTo === "check" ? ta("backToCheck") : tc("back")}</span>
        </Link>
      }
      progress={
        <ProgressBar
          label={`${ta(`task.${q.task}`)} · ${ta("questionOf", { i: pos.i, n: pos.n })}`}
          value={pos.i}
          max={Math.max(1, pos.n)}
        />
      }
      errorSummary={errorSummary}
      question={
        <span id="q-title" tabIndex={-1}>
          {memberLabel && t.has(`${questionId}.titleFor` as "for_whom.title")
            ? tq("titleFor", { name: memberLabel })
            : tq("title")}
        </span>
      }
      {...(t.has(`${questionId}.hint` as "for_whom.title") ? { hint: tq("hint") } : {})}
      whyWeAsk={{ label: tc("whyWeAsk"), body: tq("why") }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      primaryAction={
        <Button variant="primary" size="lg" type="submit" isPending={busy} data-testid="q-continue">
          {returnTo === "check" ? ta("saveAndReturn") : tc("continue")}
        </Button>
      }
      autosaveNote={
        <span role="status">
          <StatusGlyph kind="done" size={16} /> <SavedAgo at={s.savedAt} status={s.saveStatus} />
        </span>
      }
    >
      <div id="q-field">
        {q.kind === "radio" ? (
          <ChoiceCards
            labelledBy="q-title"
            value={typeof value === "string" ? value : null}
            onChange={(v) => {
              setValue(v);
              setError(null);
            }}
            invalid={error !== null}
            choices={options}
          />
        ) : null}
        {q.kind === "consent" || q.kind === "acknowledge" ? (
          <div className="mj-screen" style={{ gap: 14 }}>
            <div className="mj-card mj-card--well">
              <ul className="mj-ticks">
                {(["b1", "b2", "b3", "b4"] as const)
                  .filter((k) => t.has(`${questionId}.${k}` as "for_whom.title"))
                  .map((k) => (
                    <li key={k}>
                      <StatusGlyph kind="info" size={20} />
                      <span>{tq(k, { name: memberLabel ?? tc("yourChild") })}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <CheckRow
              checked={value === true}
              onChange={(v) => setValue(v)}
              invalid={error !== null}
            >
              {tq("agree", { name: memberLabel ?? tc("yourChild") })}
            </CheckRow>
          </div>
        ) : null}
        {q.kind === "text" ? (
          <div className="mj-screen" style={{ gap: 14 }}>
            {(q.fields ?? []).map((f) => (
              <div key={f.id} className="mj-input-group">
                <label htmlFor={`f-${f.id}`} className="md-field__label">
                  {tq(`f.${f.id}`)}
                </label>
                {f.id === "home" ? (
                  <textarea
                    id={`f-${f.id}`}
                    className="mj-input"
                    value={texts[f.id] ?? ""}
                    autoComplete={f.autoComplete}
                    aria-invalid={error !== null && !(texts[f.id] ?? "").trim() ? true : undefined}
                    onChange={(e) => setTexts((x) => ({ ...x, [f.id]: e.target.value }))}
                  />
                ) : (
                  <input
                    id={`f-${f.id}`}
                    className="mj-input"
                    value={texts[f.id] ?? ""}
                    autoComplete={f.autoComplete}
                    aria-invalid={error !== null && !(texts[f.id] ?? "").trim() ? true : undefined}
                    onChange={(e) => setTexts((x) => ({ ...x, [f.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <p className="mj-caption">{tq("vault")}</p>
          </div>
        ) : null}
      </div>
      {inline ? (
        <Banner tone="caution" title={inline.title}>
          {inline.body}
        </Banner>
      ) : null}
    </QuestionScreen>
  );
}

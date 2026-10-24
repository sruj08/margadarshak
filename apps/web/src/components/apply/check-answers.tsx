"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CheckRow } from "@/components/journey/choices";
import { IssuesSourceNote } from "@/components/journey/issues-source";
import { useFmt } from "@/components/journey/rule-source";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink } from "@/components/journey/status";
import { IssueCard } from "@/components/plan/issue-card";
import { Link, useRouter } from "@/i18n/navigation";
import { useCaseIssues } from "@/lib/case/use-case-issues";
import { useCaseSession } from "@/lib/case/use-case-session";
import {
  applies,
  isAnswered,
  QUESTIONS,
  TASKS,
  type TaskId,
  taskStatus,
} from "@/lib/journey/form-engine";
import { track } from "@/lib/journey/track";
import { logEvent, recordScreen } from "@/lib/journey/trial-log";

/**
 * Check your answers (SCR-038, MD-111): every answer grouped by task with "Change" (which comes
 * straight back here), the carried plan facts, a warning that Sarathi locks edits after payment,
 * the open issues, and a required confirmation before the fee.
 */
export function CheckAnswers() {
  const t = useTranslations("check");
  const ta = useTranslations("apply");
  const tq = useTranslations("q");
  const tc = useTranslations("common");
  const rt = useRuleText();
  const { date } = useFmt();
  const router = useRouter();
  const s = useCaseSession();
  const caseIssues = useCaseIssues(s);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(false);
  const [show, setShow] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    recordScreen("apply.check");
    track("check_answers_viewed");
  }, []);
  useEffect(() => {
    if (s.ready) setConfirmed(s.answers["check_confirmed"] === true);
  }, [s.ready, s.answers]);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.facts || !s.plan) {
    return (
      <EmptyState
        as="h1"
        title={ta("noCaseTitle")}
        action={
          <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
            {ta("makePlan")}
          </Link>
        }
      />
    );
  }

  const otherTasks = TASKS.filter((x) => x !== "check");
  const allDone = otherTasks.every((x) => taskStatus(x, s.answers, s.ctx, s.vault) === "done");
  const issues = caseIssues.issues;
  const facts = s.facts;
  const planId = s.active.planId;

  const value = (id: string): string | null => {
    const q = QUESTIONS.find((x) => x.id === id);
    if (!q) return null;
    if (q.kind === "text") {
      const parts = (q.fields ?? []).map((f) => s.vault[f.id] ?? "").filter(Boolean);
      if (parts.length === 0) return null;
      return show ? parts.join(", ") : "••••••";
    }
    const v = s.answers[id];
    if (q.kind === "consent" || q.kind === "acknowledge") return v === true ? t("agreed") : null;
    if (id === "office") return s.ctx.offices.find((o) => o.id === v)?.name ?? null;
    if (typeof v !== "string") return null;
    return tq(`${id}.o.${v}` as "for_whom.o.self");
  };

  type Row = { id: string; label: string; value: string | null; href: string };
  const rows: Partial<Record<TaskId, Row[]>> = {};
  for (const task of ["about", "licence", "route", "health"] as const) {
    rows[task] = QUESTIONS.filter(
      (q) => q.task === task && applies(q, s.answers, s.ctx) && !q.carried,
    )
      .filter((q) => q.inFlow !== false || isAnswered(q, s.answers, s.vault))
      .map((q) => ({
        id: q.id,
        label: tq(`${q.id}.short` as "for_whom.short"),
        value: value(q.id),
        href: `/apply/q/${q.id}?return=check`,
      }));
  }
  const ageText =
    facts.age.kind === "dob"
      ? date(facts.age.dob, "long")
      : facts.age.kind === "year"
        ? t("yearOnly", { year: facts.age.year })
        : t("band", { band: tc(`band.${facts.age.band}` as "band.18_19") });
  const classes = s.plan.requested_classes
    .map((c) => {
      const res = s.plan?.classes.find((x) => x.class_code === c);
      return `${rt(res?.name_key)} (${c})`;
    })
    .join(", ");
  const carried: Row[] = [
    {
      id: "dob",
      label: t("dob"),
      value: ageText,
      href: planId ? `/plan?from=${encodeURIComponent(planId)}&step=1` : "/plan",
    },
    {
      id: "classes",
      label: t("classes"),
      value: classes,
      href: planId ? `/plan/classes?id=${encodeURIComponent(planId)}` : "/plan",
    },
    {
      id: "aadhaar_address_match",
      label: tq("aadhaar_address_match.short"),
      value:
        value("aadhaar_address_match") ??
        (facts.aadhaar ? tq(`aadhaar_address_match.o.${facts.aadhaar}`) : null),
      href: "/apply/q/aadhaar_address_match?return=check",
    },
    {
      id: "born_in_india",
      label: tq("born_in_india.short"),
      value: value("born_in_india") ?? tq("born_in_india.o.yes"),
      href: "/apply/q/born_in_india?return=check",
    },
  ];
  const docsRow: Row = {
    id: "documents",
    label: t("documents"),
    value: s.ctx.documentsDone ? t("docsReady") : null,
    href: "/apply/documents",
  };

  const confirm = async () => {
    if (!allDone) return;
    if (!confirmed) {
      setError(true);
      logEvent("error", "apply.check", "agree_required");
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    await s.save({ check_confirmed: true });
    router.push("/apply/fee");
  };

  const section = (title: string, list: Row[], key: string) => (
    <section className="mj-card" aria-labelledby={`ca-${key}`} key={key}>
      <h2 id={`ca-${key}`} className="mj-h2">
        {title}
      </h2>
      <dl className="mj-answers">
        {list.map((r) => (
          <div key={r.id} data-testid={`answer-${r.id}`}>
            <dt>{r.label}</dt>
            <dd>
              {r.value ?? (
                <span className="mj-missing">
                  <StatusGlyph kind="danger" size={16} />
                  {t("notAnswered")}
                </span>
              )}
            </dd>
            <dd className="mj-answers__change">
              <Link
                href={r.href}
                className="md-link"
                onClick={() => logEvent("note", `change.${r.id}`)}
              >
                {r.value ? t("change") : t("answerNow")}
                <span className="md-sr-only"> {r.label}</span>
              </Link>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );

  return (
    <div className="mj-screen" data-screen="SCR-038">
      <BackLink href="/apply">{ta("backToTasks")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      {error ? (
        <div ref={errRef} tabIndex={-1} role="alert" className="mj-error-summary">
          <strong>{tc("problem")}</strong>
          <a href="#ca-confirm">{t("errConfirm")}</a>
        </div>
      ) : null}
      {section(t("fromPlan"), carried, "plan")}
      {section(ta("task.about"), rows.about ?? [], "about")}
      {section(ta("task.licence"), rows.licence ?? [], "licence")}
      {section(ta("task.route"), rows.route ?? [], "route")}
      {section(ta("task.health"), rows.health ?? [], "health")}
      {section(ta("task.documents"), [docsRow], "documents")}
      {s.ctx.path === "non_aadhaar" ? (
        <Button variant="tertiary" onPress={() => setShow((v) => !v)}>
          {show ? t("hide") : t("show")}
        </Button>
      ) : null}

      {issues.length > 0 ? (
        <section className="mj-issues" aria-labelledby="ca-issues" data-testid="check-issues">
          <h2 id="ca-issues" className="mj-h2">
            {t("issuesTitle", { n: issues.length })}
          </h2>
          <IssuesSourceNote source={caseIssues.source} cantTellYet={caseIssues.cantTellYet} />
          {issues.map((i) => (
            <IssueCard key={i.rule_id} issue={i} />
          ))}
        </section>
      ) : null}

      {!allDone ? (
        <Banner tone="caution" title={t("incompleteTitle")}>
          {t("incompleteBody")}
        </Banner>
      ) : null}

      <div id="ca-confirm">
        <CheckRow
          checked={confirmed}
          onChange={(v) => {
            setConfirmed(v);
            setError(false);
          }}
          invalid={error}
        >
          {t("confirm")}
        </CheckRow>
      </div>
      <div className="mj-sticky mj-actions">
        <Button
          variant="primary"
          size="lg"
          isDisabled={!allDone}
          onPress={() => void confirm()}
          data-testid="check-continue"
        >
          {t("cta")}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Chip } from "@margdarshak/ui/components/chip";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { ProgressBar } from "@margdarshak/ui/components/progress";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { IssuesSourceNote } from "@/components/journey/issues-source";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink } from "@/components/journey/status";
import { IssueCard } from "@/components/plan/issue-card";
import { classNames } from "@/components/plan/plan-card";
import { Link } from "@/i18n/navigation";
import { deviceIssues, useCaseIssues } from "@/lib/case/use-case-issues";
import { type CaseSession, useCaseSession } from "@/lib/case/use-case-session";
import {
  doneCount,
  firstOpen,
  nextTask,
  TASKS,
  type TaskId,
  taskStatus,
} from "@/lib/journey/form-engine";
import { recordScreen } from "@/lib/journey/trial-log";
import { SavedAgo } from "./saved-ago";

export function taskHref(task: TaskId, s: CaseSession): string {
  if (task === "documents") return "/apply/documents";
  if (task === "check") return "/apply/check";
  const q = firstOpen(task, s.answers, s.ctx, s.vault);
  return q ? `/apply/q/${q}` : "/apply";
}

/** Issues the person should sort out before Sarathi (blockers and warnings), from the case plan. */
export const caseIssues = deviceIssues;

/**
 * Application task list (SCR-030, F-05): the whole application on one page, status per task in
 * words (never colour alone), the next task as the single primary action, and the hand-off
 * locked until everything is done.
 */
export function TaskList() {
  const t = useTranslations("apply");
  const tc = useTranslations("common");
  const tf = useTranslations("flow.digilocker");
  const rt = useRuleText();
  const s = useCaseSession();
  const open = useCaseIssues(s);

  useEffect(() => {
    recordScreen("apply.tasks");
  }, []);

  if (!s.ready) {
    return (
      <div className="mj-screen" aria-busy="true" data-screen="SCR-030">
        <Skeleton className="mj-skel-title" />
        <Skeleton className="mj-skel-row" />
        <Skeleton className="mj-skel-row" />
      </div>
    );
  }
  if (!s.active) {
    return (
      <div className="mj-screen" data-screen="SCR-030">
        <EmptyState
          as="h1"
          title={t("noCaseTitle")}
          line={t("noCaseLine")}
          action={
            <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {t("makePlan")}
            </Link>
          }
        />
      </div>
    );
  }

  const done = doneCount(s.answers, s.ctx, s.vault);
  const next = nextTask(s.answers, s.ctx, s.vault);
  const issues = open.issues;
  const pathWord = s.ctx.path === "non_aadhaar" ? t("pathNonAadhaar") : t("pathAadhaar");

  return (
    <div className="mj-screen" data-screen="SCR-030">
      <BackLink href="/">{tc("home")}</BackLink>
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <p className="mj-eyebrow">
          {s.plan ? classNames(s.plan, rt) : ""} ·{" "}
          {s.plan ? tc(`state.${s.plan.state}` as "state.JK") : ""} · {pathWord}
        </p>
        <h1 className="mj-title">{t("h1")}</h1>
        {s.active.minor || s.answers["for_whom"] === "family" ? (
          <Chip tone="primary" className="mj-persona-chip">
            {s.active.memberLabel
              ? t("familyChipNamed", { name: s.active.memberLabel })
              : t("familyChip")}
          </Chip>
        ) : null}
      </header>
      <ProgressBar
        label={t("progress", { done, n: TASKS.length })}
        value={done}
        max={TASKS.length}
      />
      <p className="mj-caption" role="status">
        <SavedAgo at={s.savedAt} status={s.saveStatus} />
      </p>

      <Link
        href="/apply/digilocker"
        className="mj-card mj-card--soft"
        style={{ textDecoration: "none", color: "inherit" }}
        data-testid="digilocker-card"
      >
        <span className="mj-chips">
          <StatusGlyph
            kind={s.answers["digilocker_prefill"] === "yes" ? "done" : "info"}
            size={20}
          />
          <strong>
            {s.answers["digilocker_prefill"] === "yes" ? tf("cardDone") : tf("cardTitle")}
          </strong>
        </span>
        <span className="mj-caption">{tf("cardLine")}</span>
      </Link>

      <ol className="mj-tasks" aria-label={t("tasksLabel")}>
        {TASKS.map((task, i) => {
          const st = taskStatus(task, s.answers, s.ctx, s.vault);
          const word = t(`status.${st}`);
          const glyph =
            st === "done" ? "done" : st === "locked" ? "later" : task === next ? "now" : "later";
          const inner = (
            <>
              <span className="mj-task__n">{i + 1}</span>
              <span className="mj-task__name">{t(`task.${task}`)}</span>
              <span className="mj-chips">
                <StatusGlyph kind={glyph} size={18} />
                <span className="mj-caption">{word}</span>
              </span>
            </>
          );
          return (
            <li key={task} data-testid={`task-${task}`} data-status={st}>
              {st === "locked" ? (
                <div className="mj-task mj-task--locked">{inner}</div>
              ) : (
                <Link href={taskHref(task, s)} className="mj-task">
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mj-card mj-card--well">
        <p>{t("then")}</p>
      </div>

      {issues.length > 0 ? (
        <section className="mj-issues" aria-labelledby="ap-issues" data-testid="case-issues">
          <h2 id="ap-issues" className="mj-h2">
            {t("issuesTitle", { n: issues.length })}
          </h2>
          <IssuesSourceNote source={open.source} cantTellYet={open.cantTellYet} />
          {issues.map((i) => (
            <IssueCard key={i.rule_id} issue={i} />
          ))}
        </section>
      ) : null}

      {s.stale ? (
        <Banner tone="offline" title={t("staleTitle")}>
          {t("staleBody")}
        </Banner>
      ) : null}

      <div className="mj-sticky mj-actions">
        {next ? (
          <Link
            href={taskHref(next, s)}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="continue-task"
          >
            {t("continue", { task: t(`task.${next}`) })}
          </Link>
        ) : (
          <Link
            href="/apply/fee"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="continue-task"
          >
            {t("toFee")}
          </Link>
        )}
      </div>
    </div>
  );
}

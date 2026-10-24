"use client";

import type { Issue } from "@margdarshak/rules";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { BackLink } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";
import { isDismissed } from "@/lib/journey/fixes";
import { packs } from "@/lib/journey/rules";
import { recordScreen } from "@/lib/journey/trial-log";
import { IssueCard } from "./issue-card";
import { useIssueActions } from "./plan-card";
import { usePlanFromUrl } from "./use-plan-record";

/** How many problem rows the rules check for this state (blockers, warnings and notices). */
export function checksFor(state: string): number {
  const c = packs().get(state);
  if (!c) return 0;
  return c.rules.filter((r) => r.kind === "blocker" || r.kind === "warning" || r.kind === "notice")
    .length;
}

/**
 * Blocker check (SCR-020, F-04, MD-107): every rule row that could stop this case, before Sarathi.
 * "Needs you" (blocks or changes the path) and "Keep in mind" (notices), each with the fix, source
 * and confidence; the count of checks that passed comes from the rule pack.
 */
export function BlockersScreen() {
  const t = useTranslations("blockers");
  const { record, status } = usePlanFromUrl();
  const action = useIssueActions(record);

  useEffect(() => {
    recordScreen("plan.blockers");
  }, []);

  if (status === "loading") {
    return (
      <div className="mj-screen" aria-busy="true" data-screen="SCR-020">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="mj-skel-row" />
        ))}
      </div>
    );
  }
  if (!record) {
    return (
      <div className="mj-screen" data-screen="SCR-020">
        <EmptyState
          as="h1"
          title={t("noPlan")}
          action={
            <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {t("makePlan")}
            </Link>
          }
        />
      </div>
    );
  }
  const { plan, answers } = record;
  const open = (i: Issue) => !isDismissed(record.dismissed, i.rule_id, answers);
  const needs = [...plan.blockers, ...plan.warnings].filter(open);
  const mind = plan.notices;
  const total = checksFor(plan.state);
  const fired = plan.blockers.length + plan.warnings.length + plan.notices.length;
  const passed = Math.max(0, total - fired);

  return (
    <div className="mj-screen" data-screen="SCR-020">
      <BackLink href={`/plan/card?id=${encodeURIComponent(record.id)}`}>{t("backToPlan")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("summary", { total, need: needs.length, mind: mind.length })}</p>
      </header>
      {needs.length === 0 && mind.length === 0 ? (
        <EmptyState title={t("nothing", { total })} />
      ) : null}
      {needs.length > 0 ? (
        <section className="mj-issues" aria-labelledby="bl-needs">
          <h2 id="bl-needs" className="mj-h2">
            {t("needsYou", { n: needs.length })}
          </h2>
          {needs.map((i) => (
            <IssueCard key={i.rule_id} issue={i} action={action(i)} />
          ))}
        </section>
      ) : null}
      {mind.length > 0 ? (
        <section className="mj-issues" aria-labelledby="bl-mind">
          <h2 id="bl-mind" className="mj-h2">
            {t("keepInMind", { n: mind.length })}
          </h2>
          {mind.map((i) => (
            <IssueCard key={i.rule_id} issue={i} />
          ))}
        </section>
      ) : null}
      <p className="mj-caption">{t("passed", { n: passed })}</p>
      <div className="mj-actions">
        <Link
          href={`/apply/start?plan=${encodeURIComponent(record.id)}`}
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("cta")}
        </Link>
      </div>
    </div>
  );
}

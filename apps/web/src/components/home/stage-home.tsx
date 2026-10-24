"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Chip } from "@margdarshak/ui/components/chip";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { CaseCountdown } from "@/components/journey/case-clock";
import { useFmt } from "@/components/journey/rule-source";
import { useOnline } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";
import { type ActiveCase, cacheCase, useCachedCase } from "@/lib/case/case-store";
import { getCase, getTimeline } from "@/lib/journey/api";
import type { TimelineEvent } from "@/lib/journey/api-types";
import { clockDrifted, serverToday } from "@/lib/journey/dates";
import { deriveCase, stageView } from "@/lib/journey/stage";
import { recordScreen } from "@/lib/journey/trial-log";

const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"] as const;

/**
 * Stage-aware home (SCR-060, MD-122, F-08): one header line, one primary action and at most two
 * quiet links for the journey state the server computed (API-11 `display_stage`, `next_action`).
 * Offline it shows the last known state with "Updated {ago}"; countdowns use the server clock
 * offset, so a wrong phone clock never moves a date (EC-15).
 */
export function StageHome({ active, extra }: { active: ActiveCase; extra?: ReactNode }) {
  const t = useTranslations("stage");
  const th = useTranslations("homeStage");
  const tc = useTranslations("common");
  const tp = useTranslations("personas");
  const { date } = useFmt();
  const online = useOnline();
  const cached = useCachedCase(active.caseId);
  const [coming, setComing] = useState<TimelineEvent[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    recordScreen("home.stage");
    void getCase(active.caseId)
      .then((r) => {
        cacheCase(r.data);
        setFailed(false);
      })
      .catch(() => setFailed(true));
    void getTimeline(active.caseId)
      .then((r) => setComing(r.data.items.filter((i) => i.status === "scheduled").slice(0, 2)))
      .catch(() => setComing([]));
  }, [active.caseId]);

  if (!cached) {
    return (
      <div className="mj-stage" aria-busy="true" data-screen="SCR-060">
        <Skeleton className="mj-skel-title" />
        <Skeleton className="mj-skel-row" />
      </div>
    );
  }
  const today = serverToday();
  const data = failed ? deriveCase(cached, today) : cached;
  const view = stageView(data, today);
  const stageIndex = STAGES.indexOf(
    view.stage === "S6F" ? "S6" : (view.stage as (typeof STAGES)[number]),
  );
  const values: Record<string, string | number> = {
    d: view.clock?.days ?? 0,
    date: view.clock ? date(view.clock.date, "long") : "",
    name: active.memberLabel ?? "",
  };
  const updatedMins = cached.cached_at
    ? Math.round((Date.now() - Date.parse(cached.cached_at)) / 60000)
    : 0;

  return (
    <section
      className={`mj-stage mj-stage--${view.tone}`}
      aria-labelledby="stage-h1"
      data-screen="SCR-060"
      data-stage={view.display}
      data-testid="stage-home"
    >
      <div className="mj-glow" aria-hidden="true" />
      <ol className="mj-stage__strip" aria-label={th("strip", { stage: view.stage })}>
        {STAGES.map((s, i) => (
          <li key={s} data-state={i < stageIndex ? "done" : i === stageIndex ? "now" : "later"}>
            <span className="md-sr-only">
              {s}:{" "}
              {i < stageIndex
                ? tc("statusDone")
                : i === stageIndex
                  ? tc("statusNow")
                  : tc("statusLater")}
            </span>
          </li>
        ))}
      </ol>
      <div className="mj-chips">
        {active.persona ? (
          <Chip tone="simulated">{tp("chip", { name: tp(`p.${active.persona}.name`) })}</Chip>
        ) : null}
        {active.minor || data.flags?.includes("for_minor_family_member") ? (
          <Chip tone="primary" glyph={false}>
            {active.memberLabel ? th("familyNamed", { name: active.memberLabel }) : th("family")}
          </Chip>
        ) : null}
      </div>
      {clockDrifted() ? (
        <Banner tone="info" title={th("clockTitle")}>
          {th("clockBody")}
        </Banner>
      ) : null}
      {(!online || failed) && cached.cached_at ? (
        <p className="mj-caption" role="status">
          {th("updated", { n: Math.max(0, updatedMins) })}
        </p>
      ) : null}
      <h1 id="stage-h1" className="mj-stage__h1" data-testid="stage-h1">
        {t(`${view.key}.h1` as "PLAN.h1", values)}
      </h1>
      {view.clock ? (
        <CaseCountdown
          clock={view.clock}
          tone={view.tone}
          caseId={data.case_id}
          sourceRuleId={view.clock.ruleId}
          compact
        />
      ) : null}
      <div className="mj-actions">
        <Link
          href={view.href}
          className={buttonClassName({
            variant: view.tone === "danger" ? "danger" : "primary",
            size: "lg",
            fullWidth: true,
          })}
          data-testid="stage-primary"
        >
          {t(`${view.key}.primary` as "PLAN.primary", values)}
        </Link>
        {view.secondary.length > 0 ? (
          <div className="mj-inline-actions">
            {view.secondary.map((s) => (
              <Link key={s.id} href={s.href} className="md-link">
                {th(`secondary.${s.id}` as "secondary.tracker")}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      {coming.length > 0 ? (
        <section className="mj-card" aria-labelledby="stage-coming">
          <h2 id="stage-coming" className="mj-card__title">
            {th("comingUp")}
          </h2>
          <ul className="mj-coming">
            {coming.map((e) => (
              <li key={e.event_id}>
                <span>{th(`event.${e.code}` as "event.LL_EXPIRY")}</span>
                <span className="mj-num mj-muted">
                  {e.due_at ? date(e.due_at.slice(0, 10)) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Link href="/licence" className="md-link">
        {th("seeTracker")}
        <ChevronRight aria-hidden="true" size={18} />
      </Link>
      {extra}
    </section>
  );
}

"use client";

import { Button } from "@margdarshak/ui/components/button";
import { CalendarPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildIcs } from "@/lib/journey/ics";
import type { StageClock } from "@/lib/journey/stage";
import { download } from "@/lib/journey/trial-log";
import { useFmt } from "./rule-source";

/**
 * Case clock (MD-132, F-09, EC-15): whole days to a real, dated deadline from the server's clock,
 * a calm meter, and "Add to calendar" (ICS). Red only for the LL-expiry deadline. Never seconds.
 */
export function CaseCountdown({
  clock,
  tone,
  caseId,
  sourceRuleId,
  compact = false,
}: {
  clock: StageClock;
  tone: "calm" | "caution" | "danger";
  caseId: string;
  /** The rule-pack row behind the deadline; required so no countdown is invented in the UI. */
  sourceRuleId: string;
  /** Hide the big number when the page heading already says it (stage-aware home). */
  compact?: boolean;
}) {
  const t = useTranslations("clock");
  const { date } = useFmt();
  const total = clock.kind === "unlock" && clock.from ? 30 : clock.kind === "expiry" ? 180 : 0;
  const pct = total > 0 ? Math.min(100, Math.max(0, ((total - clock.days) / total) * 100)) : 0;
  const addToCalendar = () => {
    const ics = buildIcs({
      uid: `${caseId}-${clock.kind}-${clock.date}`,
      date: clock.date,
      title: t(`ics.${clock.kind}` as "ics.unlock"),
      description: t("icsDescription"),
    });
    download(`margdarshak-${clock.kind}.ics`, ics, "text/calendar");
  };
  return (
    <div
      className="mj-screen"
      style={{ gap: 10 }}
      data-testid="case-clock"
      data-source-rule={sourceRuleId}
    >
      {compact ? null : (
        <p className="mj-clock">
          <span className="mj-clock__days" data-testid="clock-days">
            {clock.days}
          </span>
          <span className="mj-clock__unit">
            {t(`unit.${clock.kind}` as "unit.unlock", { n: clock.days })}
          </span>
        </p>
      )}
      <p className="mj-muted">
        {t(`line.${clock.kind}` as "line.unlock", { date: date(clock.date, "long") })}
      </p>
      {total > 0 ? (
        <div>
          <meter
            className="md-sr-only"
            min={0}
            max={total}
            value={Math.max(0, total - clock.days)}
            aria-label={t("meterLabel")}
            aria-valuetext={t("meterText", { days: clock.days, date: date(clock.date, "long") })}
          />
          <div
            className={`mj-meter${tone === "danger" ? " mj-meter--danger" : ""}`}
            aria-hidden="true"
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
      {clock.kind !== "expired" && clock.kind !== "payment" ? (
        <Button variant="tertiary" onPress={addToCalendar} className="mj-ics">
          <CalendarPlus aria-hidden="true" />
          {t("addToCalendar")}
        </Button>
      ) : null}
    </div>
  );
}

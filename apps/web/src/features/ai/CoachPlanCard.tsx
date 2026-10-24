"use client";

import { Input, Label } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { drillHref } from "@/features/debrief/build-card";
import { Link } from "@/i18n/navigation";
import { type CoachPlan, getCoachPlan, saveCoachIntention } from "./api";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * The weekly plan (MD-312, API-76): drills chosen in code, worded by the CoachAgent when allowed
 * ("Coach plan") or by the template ("Auto plan"). The implementation-intention line has day and
 * time slots the learner fills; saving stores it (no nudge is sent from here). Offline or mock
 * mode shows nothing rather than a made-up plan.
 */
export function CoachPlanCard({ familyMemberId }: { familyMemberId?: string }) {
  const t = useTranslations("ai.coach");
  const [plan, setPlan] = useState<CoachPlan | null>(null);
  const [day, setDay] = useState<(typeof DAYS)[number]>("sat");
  const [time, setTime] = useState("18:00");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getCoachPlan(familyMemberId).then((r) => alive && r.ok && setPlan(r.data));
    return () => {
      alive = false;
    };
  }, [familyMemberId]);
  if (!plan) return null;

  const first = plan.items[0];
  const prompt = plan.intention_prompt
    .replace("{{slot:day}}", t(`days.${day}`))
    .replace("{{slot:time}}", time);
  return (
    <section
      className="mj-card"
      aria-labelledby="coach-plan-title"
      data-testid="coach-plan"
      data-source={plan.source}
    >
      <h2 id="coach-plan-title" className="md-h3">
        {t("title")}{" "}
        <span className="mg-chip">{plan.source === "ai" ? t("coached") : t("auto")}</span>
      </h2>
      <p>{plan.headline}</p>
      <p className="mj-caption">{t("goal", { count: plan.week_goal_sessions })}</p>
      <ol>
        {plan.items.map((it) => (
          <li key={it.drill_id}>
            {it.why ?? it.drill_id}{" "}
            {it.deep_link ? (
              <Link href={drillHref(it.deep_link, it.drill_id)} className="md-link">
                {t("open")}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
      {first ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveCoachIntention(day, time, first.drill_id).then((r) => setSaved(r.ok));
          }}
        >
          <h3 className="md-h4">{t("intention")}</h3>
          <p>{prompt}</p>
          <Label className="md-field__label" htmlFor="coach-day">
            {t("day")}
          </Label>
          <select
            id="coach-day"
            className="mj-input"
            value={day}
            onChange={(e) => setDay(e.target.value as (typeof DAYS)[number])}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {t(`days.${d}`)}
              </option>
            ))}
          </select>
          <Label className="md-field__label" htmlFor="coach-time">
            {t("time")}
          </Label>
          <Input
            id="coach-time"
            className="mj-input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <Button variant="primary" type="submit">
            {t("save")}
          </Button>
          {saved ? (
            <p role="status" className="mj-caption">
              {t("saved")}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

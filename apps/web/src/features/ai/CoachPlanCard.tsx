"use client";

import { Input, Label } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { drillHref } from "@/features/debrief/build-card";
import { listSessionRecords, subscribeSessionRecords } from "@/features/games/results-store";
import type { LlTopicId } from "@/features/learn/content/bank-types";
import type { LlMockRecord } from "@/features/learn/mock-api";
import { LEARN_KEYS, readKv } from "@/features/learn/offline/kv";
import { reviewStore } from "@/features/learn/offline/review-store";
import { Link } from "@/i18n/navigation";
import { type CoachPlan, getCoachPlan, saveCoachIntention } from "./api";
import { buildPrepPlan, type PrepPlan, type PrepRec, topicOfCard } from "./prep-plan";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** This phone's practice history, read fresh so the plan follows the latest session. */
async function devicePlan(): Promise<PrepPlan> {
  const log = await reviewStore()
    .log()
    .catch(() => []);
  const answers = log.flatMap((e) => {
    const topic = topicOfCard(e.cardId);
    return topic ? [{ topic, correct: e.correct, at: e.reviewedAt }] : [];
  });
  // A server-checked LL run writes its evidence on the server, not in this log: read its result.
  for (const r of listSessionRecords("ll_sim")) {
    if (r.status !== "verified") continue;
    const comps = r.checked?.result?.score.components ?? [];
    r.items.forEach((it, i) => {
      const topic = (it.public as { topic?: LlTopicId } | undefined)?.topic;
      const c = comps[i];
      if (topic && c) answers.push({ topic, correct: c.value > 0, at: r.savedAt });
    });
  }
  const mocks = readKv<LlMockRecord[]>(LEARN_KEYS.llsim, []).map((m) => ({
    at: m.at,
    passed: m.passed,
  }));
  const nazarAt = listSessionRecords("nazar").map((r) => r.savedAt);
  return buildPrepPlan({ answers, mocks, nazarAt, now: Date.now() });
}

/**
 * The prep buddy (F-26, M-03; MD-312 extended). "Next up" is computed in code from this phone's
 * practice (weakest topics first, a mock test, Nazar) and changes after every session. Below it,
 * the weekly plan from API-76: drills chosen in code, worded by the CoachAgent when allowed ("Coach
 * plan") or by the template ("Auto plan"), with the implementation-intention line the learner
 * fills; saving stores it (no nudge is sent from here). The weekly plan needs the API; the device
 * plan doesn't.
 */
export function CoachPlanCard({ familyMemberId }: { familyMemberId?: string }) {
  const t = useTranslations("ai.coach");
  const tb = useTranslations("ai.buddy");
  const tt = useTranslations("learnHub.topics");
  const [plan, setPlan] = useState<CoachPlan | null>(null);
  const [device, setDevice] = useState<PrepPlan | null>(null);
  const [day, setDay] = useState<(typeof DAYS)[number]>("sat");
  const [time, setTime] = useState("18:00");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getCoachPlan(familyMemberId).then((r) => alive && r.ok && setPlan(r.data));
    const refresh = () => void devicePlan().then((p) => alive && setDevice(p));
    refresh();
    const off = subscribeSessionRecords(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [familyMemberId]);
  if (!plan && !device) return null;

  const recText = (r: PrepRec) =>
    r.kind === "review"
      ? tb("rec.review", { topic: tt(r.topic), pct: r.pct })
      : r.kind === "start"
        ? tb("rec.start", { topic: tt(r.topic) })
        : tb(`rec.${r.kind}`);
  const [next, ...then] = device?.recs ?? [];
  const first = plan?.items[0];
  const prompt = plan?.intention_prompt
    .replace("{{slot:day}}", t(`days.${day}`))
    .replace("{{slot:time}}", time);
  return (
    <section
      className="mj-card"
      aria-labelledby="prep-buddy-title"
      data-testid="coach-plan"
      data-source={plan?.source ?? "device"}
    >
      <h2 id="prep-buddy-title" className="md-h3">
        {tb("title")}
      </h2>
      {device ? (
        <div className="md-stack" data-testid="prep-buddy">
          <p className="mj-caption">{tb("week", { d: device.activeDays })}</p>
          {next ? (
            <>
              <h3 className="md-h4">{tb("today")}</h3>
              <p>{recText(next)}</p>
              <Link
                href={next.href}
                className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
                data-testid="prep-next"
              >
                {tb("start")}
              </Link>
            </>
          ) : null}
          {then.length > 0 ? (
            <>
              <h3 className="md-h4">{tb("then")}</h3>
              <ul>
                {then.map((r) => (
                  <li key={`${r.kind}-${"topic" in r ? r.topic : ""}`}>
                    <Link href={r.href} className="md-link">
                      {recText(r)}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {!plan ? <p className="mj-caption">{tb("device")}</p> : null}
        </div>
      ) : null}
      {plan ? (
        <div className="md-stack" data-testid="coach-week">
          <h3 className="md-h4">
            {t("title")}{" "}
            <span className="mg-chip">{plan.source === "ai" ? t("coached") : t("auto")}</span>
          </h3>
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
              <h4 className="md-h4">{t("intention")}</h4>
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
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { STREAK_GOAL_MAX, STREAK_GOAL_MIN } from "@margdarshak/gamification";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { LEARN_API_MODE } from "@/features/learn/api";
import type { LlTopicId } from "@/features/learn/content/bank-types";
import { setGoal } from "@/features/learn/progress";
import { ErrorState, LoadingState, OfflineBanner } from "@/features/learn/ui/states";
import { useLearner } from "@/features/learn/use-learner";
import { streakLines } from "./streak-copy";

/**
 * Weekly repairable streak (UI_SPEC_LEARN_GAMES §7.3, GAMIFICATION_ENGINE §7). Weeks, not days; one
 * freeze token per completed week applies itself silently; a missed week can be "filled" next week.
 * A break produces no message at all (no push, no sad copy): the screen simply starts a new week.
 */
export function Streak({ conceptCounts }: { conceptCounts: Record<LlTopicId, number> }) {
  const t = useTranslations("me.streak");
  const id = useId();
  const { state, error, reload } = useLearner(conceptCounts);
  const [saved, setSaved] = useState(false);
  if (error) return <ErrorState onRetry={() => void reload()} />;
  if (!state) return <LoadingState rows={3} />;
  const s = state.achievement.streak;
  const lines = streakLines(s);
  const dots = s.status === "repairable" ? s.weekly_goal + 2 : s.weekly_goal;

  return (
    <div className="md-stack" data-screen="LRN-032" data-testid="streak">
      <OfflineBanner />
      <div className="ml-card">
        <div className="ml-road" aria-hidden="true">
          {Array.from({ length: dots }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one dot per goal session, fixed order
            <span key={i} className="ml-dot" data-on={i < s.this_week ? "true" : undefined} />
          ))}
        </div>
        {lines.map((l) => {
          switch (l.key) {
            case "week":
              return (
                <p key="week" className="md-h3">
                  {t("week", { d: l.d, n: l.n })}
                </p>
              );
            case "new":
              return (
                <p key="new" className="md-h3">
                  {t("new", { n: l.n })}
                </p>
              );
            case "fill":
              return (
                <p key="fill" className="ml-feedback">
                  {t("fill", { w: l.w, g: l.g, n: l.n })}
                </p>
              );
            case "freeze":
              return <p key="freeze">{t("freeze", { k: l.k })}</p>;
            case "weeks":
              return <p key="weeks">{t("weeks", { w: l.w })}</p>;
            case "archived":
              return (
                <p key="archived" className="md-h3">
                  {t("archived", { w: l.w })}
                </p>
              );
            case "end":
              return (
                <p key="end" className="ml-small">
                  {t("end")}
                </p>
              );
            default:
              return null;
          }
        })}
      </div>
      {LEARN_API_MODE === "mock" || state.achievementSource === "device" ? (
        <div className="ml-card">
          <label htmlFor={id} className="font-semibold">
            {t("goalLabel")}
          </label>
          <select
            id={id}
            className="ml-input"
            defaultValue={s.weekly_goal}
            onChange={(e) => {
              setGoal(Number(e.target.value), Date.now());
              setSaved(true);
              void reload();
            }}
          >
            {Array.from({ length: STREAK_GOAL_MAX - STREAK_GOAL_MIN + 1 }, (_, i) => {
              const n = STREAK_GOAL_MIN + i;
              return (
                <option key={n} value={n}>
                  {t("goal", { n })}
                </option>
              );
            })}
          </select>
          {saved ? (
            <p className="ml-small" role="status">
              {t("goalSaved")}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="ml-small">{t("what")}</p>
    </div>
  );
}

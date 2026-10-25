"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { SplitText } from "@margdarshak/ui/components/split-text";
import { SpotlightOverlay } from "@margdarshak/ui/components/spotlight-card";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CoachPlanCard } from "@/features/ai/CoachPlanCard";
import { Link } from "@/i18n/navigation";
import { getReviewQueue } from "../api";
import type { ReviewItem } from "../api-types";
import { loadBank } from "../bank-client";
import type { LlTopicId } from "../content/bank-types";
import type { ModuleSummary } from "../content/curriculum";
import { SkillTree } from "../skill-tree/skill-tree";
import { DeviceNote, ErrorState, FamilyChip, LoadingState, OfflineBanner } from "../ui/states";
import { useLearner } from "../use-learner";

/**
 * Learn hub (UI_SPEC_LEARN_GAMES §2.1, F-20): today's review queue first (the one primary action),
 * then where the learner stands on the curriculum (the skill tree). Rank, XP, the readiness number
 * and this week's streak sit in one quiet line on top.
 */
export function LearnHub({
  modules,
  conceptCounts,
  nazarHref,
}: {
  modules: ModuleSummary[];
  conceptCounts: Record<LlTopicId, number>;
  nazarHref: string | null;
}) {
  const t = useTranslations("learnHub.hub");
  const tt = useTranslations("learnHub.topics");
  const tr = useTranslations("me.ranks");
  const ta = useTranslations("ai.tools");
  const locale = useLocale();
  const { state, error, reload } = useLearner(conceptCounts);
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bank = await loadBank(locale);
        const items = bank.items.filter((i) => i.pool === "practice");
        const q = await getReviewQueue(items, Date.now());
        if (alive) setQueue(q.data);
      } catch {
        if (alive) setQueue([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale]);

  const answered = state?.log.length ?? 0;
  const due = queue?.filter((q) => (q.retrievability ?? 0) > 0) ?? [];
  const fresh = queue?.filter((q) => (q.retrievability ?? 0) === 0) ?? [];
  const byTopic = new Map<string, number>();
  for (const q of queue ?? []) byTopic.set(q.topic_id, (byTopic.get(q.topic_id) ?? 0) + 1);
  const minutes = Math.max(1, Math.round((queue?.length ?? 0) * 0.5));
  const a = state?.achievement;

  return (
    <div className="md-stack" data-screen="LRN-001">
      <OfflineBanner />
      {state?.profile.kind === "family_minor" ? <FamilyChip holder={null} /> : null}
      {error ? <ErrorState onRetry={() => void reload()} /> : null}
      {a ? (
        <div className="ml-row ml-row--between">
          <Link href="/learn/me" className="md-link">
            {t("rankLine", { rank: tr(a.rank), xp: a.xp_total })}
          </Link>
          <Link href="/learn/readiness" className="md-link" data-testid="hub-readiness">
            {t("readinessMini", { s: state?.readiness.readiness.score ?? 0 })}
          </Link>
        </div>
      ) : null}
      {a ? (
        <p className="ml-small">
          {t("weekLine", { d: a.streak.this_week, n: a.streak.weekly_goal })}
        </p>
      ) : null}

      <section className="ml-card rb-card-spotlight" aria-labelledby="hub-review">
        <SpotlightOverlay />
        <h2 id="hub-review" className="md-h2">
          <SplitText text={t("reviewTitle")} delay={35} duration={0.5} splitType="words" />
        </h2>
        {queue === null ? (
          <LoadingState rows={1} />
        ) : queue.length === 0 ? (
          <>
            <p>{t("reviewEmpty")}</p>
            <Link
              href={nazarHref ?? "/learn/practise"}
              className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
            >
              {nazarHref ? t("reviewEmptyCta") : t("practiseCta")}
            </Link>
          </>
        ) : (
          <>
            <p data-testid="hub-queue">
              {answered === 0 && due.length === 0
                ? t("reviewStart", { n: fresh.length, min: minutes })
                : t("reviewMeta", { n: queue.length, min: minutes })}
            </p>
            <p className="ml-small">
              {[...byTopic.entries()]
                .map(([topic, n]) => `${tt(topic as LlTopicId)} ${n}`)
                .join(" · ")}
            </p>
            <Link
              href="/learn/review"
              className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            >
              {t("reviewCta")}
            </Link>
          </>
        )}
      </section>

      <CoachPlanCard />

      <section className="ml-card" aria-labelledby="hub-ai" data-testid="hub-ai-tools">
        <h2 id="hub-ai" className="md-h3">
          {ta("title")}
        </h2>
        <ul className="ml-list">
          {(["snap", "scam"] as const).map((k) => (
            <li key={k}>
              <Link
                href={k === "snap" ? "/learn/signs/snap" : "/services/scam"}
                className="md-link"
              >
                {ta(`${k}.title`)}
              </Link>
              <p className="ml-small">{ta(`${k}.line`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {state ? (
        <SkillTree modules={modules} nodeStates={state.nodeStates} masteries={state.masteries} />
      ) : (
        <LoadingState rows={4} />
      )}
      {state?.readiness.source === "device" ? <DeviceNote kind="saved" /> : null}
    </div>
  );
}

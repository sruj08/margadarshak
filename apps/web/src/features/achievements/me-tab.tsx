"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import type { LlTopicId } from "@/features/learn/content/bank-types";
import {
  DeviceNote,
  ErrorState,
  FamilyChip,
  LoadingState,
  OfflineBanner,
} from "@/features/learn/ui/states";
import { useLearner } from "@/features/learn/use-learner";
import { Link } from "@/i18n/navigation";
import { BadgeShape, Badges } from "./badges";

/**
 * Me tab (UI_SPEC_LEARN_GAMES §7.1, F-26): XP with today's multiplier shown honestly, the rider rank
 * with exactly what the next rank still needs (XP alone can't buy a rank), the nine badges, this
 * week's streak and the squad. Works the same in family mode; squads show the parent step first.
 */

const RANK_SHAPE = {
  gali: "rectangle",
  mohalla: "rectangle",
  shehar: "circle",
  highway: "triangle",
  ghat: "octagon",
} as const;

export function MeTab({
  conceptCounts,
  nodeNames,
  shareHref,
}: {
  conceptCounts: Record<LlTopicId, number>;
  nodeNames: Record<string, string>;
  shareHref: string | null;
}) {
  const t = useTranslations("me");
  const tr = useTranslations("me.ranks");
  const { state, error, reload } = useLearner(conceptCounts);
  if (error) return <ErrorState onRetry={() => void reload()} />;
  if (!state) return <LoadingState rows={5} />;
  const a = state.achievement;
  const req = a.rank_requirements;
  const missing = req?.missing_nodes ?? [];
  const next = req?.next ?? null;
  const mult = a.xp_multiplier_today ?? 1;
  const minor = state.profile.kind === "family_minor";

  return (
    <div
      className="md-stack"
      data-screen="LRN-030"
      data-testid="me-tab"
      data-source={state.achievementSource}
    >
      <OfflineBanner />
      {minor ? <FamilyChip holder={null} /> : null}
      {minor ? <p className="ml-small">{t("u18")}</p> : null}

      <section className="ml-card" aria-labelledby="me-rank">
        <div className="ml-row">
          <BadgeShape shape={RANK_SHAPE[a.rank]} earned />
          <h2 id="me-rank" className="md-h2">
            {t("rankName", { rank: tr(a.rank) })}
          </h2>
        </div>
        <p className="ml-num" data-testid="me-xp">
          {t("xpTotal", { xp: a.xp_total })}
        </p>
        {next ? (
          <>
            <p>
              {missing.length > 0
                ? t("rankNext", {
                    rank: tr(next),
                    xp: a.xp_total + (req?.xp_missing ?? 0),
                    node: missing.map((m) => nodeNames[m] ?? m).join(", "),
                  })
                : t("rankNextXp", { rank: tr(next), xp: a.xp_total + (req?.xp_missing ?? 0) })}
            </p>
            {(req?.nazar_mocks_missing ?? 0) > 0 ? (
              <p className="ml-small">{t("rankMocks", { n: req?.nazar_mocks_missing ?? 0 })}</p>
            ) : null}
            <Link
              href={missing[0] ? `/learn/skill/${missing[0]}` : "/learn/review"}
              className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            >
              {t("nextCta", { rank: tr(next) })}
            </Link>
          </>
        ) : (
          <p>{t("rankTop")}</p>
        )}
      </section>

      <section className="ml-card" aria-labelledby="me-xp-today">
        <h2 id="me-xp-today" className="md-h3">
          {t("xpToday", { xp: a.xp_today ?? 0 })}
        </h2>
        <p data-testid="me-multiplier">
          {mult === 1 ? t("multFull") : t("multLow", { m: mult, after: mult === 0.5 ? 45 : 90 })}
        </p>
        <details>
          <summary className="md-link">{t("xpHow")}</summary>
          <p>{t("xpRules")}</p>
          <p>{t("xpNever")}</p>
        </details>
      </section>

      <Badges badges={a.badges} />

      <ul className="ml-list">
        <li>
          <Link href="/learn/me/streak" className="ml-node">
            <span className="ml-node__text">
              <span className="font-semibold">{t("streakLink")}</span>
              <span className="ml-small">
                {t("streakLine", { d: a.streak.this_week, n: a.streak.weekly_goal })}
              </span>
            </span>
          </Link>
        </li>
        <li>
          <Link href="/learn/me/squad" className="ml-node">
            <span className="ml-node__text">
              <span className="font-semibold">{t("squadLink")}</span>
              <span className="ml-small">{minor ? t("squadParent") : t("squadLine")}</span>
            </span>
          </Link>
        </li>
        <li>
          <Link href="/learn/me/badges/khud-licence" className="ml-node">
            <span className="ml-node__text">
              <span className="font-semibold">{t("khudLink")}</span>
              <span className="ml-small">{t("khudLine")}</span>
            </span>
          </Link>
        </li>
        {shareHref ? (
          <li>
            <Link href={shareHref} className="ml-node">
              <span className="ml-node__text">
                <span className="font-semibold">{t("shareLink")}</span>
              </span>
            </Link>
          </li>
        ) : null}
      </ul>
      {state.achievementSource === "device" ? <DeviceNote kind="saved" /> : null}
    </div>
  );
}

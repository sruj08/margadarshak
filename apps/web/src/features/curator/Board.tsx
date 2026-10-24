"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { CuratorOffline, listClips, type Source } from "./api";
import { OriginChip } from "./OriginChip";
import { isAi, type NextAction, nextAction } from "./rules";
import {
  CuratorEmpty,
  CuratorError,
  CuratorLoading,
  CuratorOfflineNote,
  CuratorOfflineState,
  MockSourceNote,
} from "./states";
import { CLIP_STATUSES, type Clip, type ClipStatus } from "./types";

/** Bank targets (NAZAR §3.4): ≥ 12 usable clips or the six-clip backup triggers; 20 is the goal. */
const TARGET = 20;
const TRIGGER = 12;

type Load =
  | { k: "loading" }
  | { k: "offline" }
  | { k: "error" }
  | { k: "ready"; clips: Clip[]; source: Source };

const ACTION_PATH: Record<NextAction, string> = {
  ingest: "",
  audit: "/blur",
  review: "/review",
  rate: "/rate",
  adjudicate: "/adjudicate",
  cues: "/cues",
  publish: "/publish",
  none: "",
};

/**
 * Pipeline board (UI_SPEC_LEARN_GAMES §12.1): counts per clip-pipeline status, the usable-clip
 * counter against the ≥ 12 backup trigger, and one card per clip with its next step.
 */
export function Board() {
  const t = useTranslations("curator");
  const id = useId();
  const [load, setLoad] = useState<Load>({ k: "loading" });
  const [filter, setFilter] = useState<ClipStatus | "all">("all");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    void attempt;
    let alive = true;
    setLoad({ k: "loading" });
    listClips()
      .then((r) => alive && setLoad({ k: "ready", clips: r.data, source: r.source }))
      .catch(
        (e: unknown) => alive && setLoad({ k: e instanceof CuratorOffline ? "offline" : "error" }),
      );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const counts = useMemo(() => {
    const c = new Map<ClipStatus, number>();
    if (load.k === "ready")
      for (const clip of load.clips) c.set(clip.status, (c.get(clip.status) ?? 0) + 1);
    return c;
  }, [load]);

  const shown =
    load.k === "ready" ? load.clips.filter((c) => filter === "all" || c.status === filter) : [];
  const published = counts.get("published") ?? 0;

  return (
    <div className="cu-page" data-screen="ADMIN-CLIPS" data-testid="curator-board">
      <CuratorOfflineNote />
      <h1 className="md-h1">{t("board.h1")}</h1>
      <p className="cu-lead">{t("board.lead")}</p>
      {load.k === "loading" ? <CuratorLoading /> : null}
      {load.k === "offline" ? <CuratorOfflineState /> : null}
      {load.k === "error" ? <CuratorError onRetry={retry} /> : null}
      {load.k === "ready" ? (
        <>
          <MockSourceNote source={load.source} />
          <p className="cu-usable" data-testid="board-usable">
            {t("board.usable", { n: published, target: TARGET, trigger: TRIGGER })}
          </p>
          <ul className="cu-counts" aria-label={t("board.filter")}>
            {CLIP_STATUSES.map((s) => (
              <li key={s}>
                <span className="cu-counts__n">{counts.get(s) ?? 0}</span>
                <span className="cu-counts__label">{t(`status.${s}`)}</span>
              </li>
            ))}
          </ul>
          <label className="cu-field" htmlFor={`${id}-filter`}>
            <span className="cu-label">{t("board.filter")}</span>
            <select
              id={`${id}-filter`}
              className="cu-select"
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value as ClipStatus | "all")}
              data-testid="board-filter"
            >
              <option value="all">{t("board.all")}</option>
              {CLIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)} ({counts.get(s) ?? 0})
                </option>
              ))}
            </select>
          </label>
          <p className="cu-hint" role="status">
            {t("board.count", { n: shown.length })}
          </p>
          {shown.length === 0 ? (
            <CuratorEmpty
              title={t("board.empty")}
              line={t("board.emptyLine")}
              href="/admin/clips/new"
              cta={t("nav.register")}
            />
          ) : (
            <ul className="cu-cards">
              {shown.map((c) => (
                <ClipCard key={c.clip_id} clip={c} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function ClipCard({ clip }: { clip: Clip }) {
  const t = useTranslations("curator");
  const action = nextAction(clip);
  const audit = clip.blur_audit;
  const ai = isAi(clip);
  return (
    <li className="cu-card" data-testid={`clip-card-${clip.clip_id}`} data-status={clip.status}>
      <div className="cu-card__head">
        <Link href={`/admin/clips/${clip.clip_id}`} className="cu-card__id md-link">
          {clip.clip_id}
        </Link>
        <span className={`cu-status cu-status--${clip.status}`}>{t(`status.${clip.status}`)}</span>
      </div>
      <OriginChip clip={clip} />
      <p className="cu-card__meta">
        {[
          clip.city,
          clip.road_type ? t(`options.road.${clip.road_type}`) : null,
          clip.duration_ms ? t("board.seconds", { s: Math.round(clip.duration_ms / 1000) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="cu-card__meta">
        {t("board.ratings", { n: clip.rating_count })} ·{" "}
        {ai
          ? `${t("steps.review")}: ${clip.synthetic_review?.passed ? t("review.statePassed") : t("review.stateFailed")}`
          : !audit
            ? t("board.auditNone")
            : audit.passed
              ? t("board.auditPassed")
              : t("board.auditFailed", { n: audit.misses })}
      </p>
      {ACTION_PATH[action] ? (
        <Link
          href={`/admin/clips/${clip.clip_id}${ACTION_PATH[action]}`}
          className={buttonClassName({ variant: "secondary" })}
          data-testid={`clip-action-${clip.clip_id}`}
        >
          {t(`board.action.${action}`)}
        </Link>
      ) : action === "ingest" ? (
        <p className="cu-hint">{t("board.action.ingest")}</p>
      ) : null}
    </li>
  );
}

"use client";

import type { GameMode } from "@margdarshak/game-core/schema";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

/** The host and the game chunk load only here, after the play route mounts (FRONTEND §10.1). */
const GameStage = dynamic(
  () => import("@/features/games/host/GameStage").then((m) => m.GameStage),
  { ssr: false, loading: () => <StageSkeleton /> },
);

export function StageSkeleton() {
  const t = useTranslations("games");
  return (
    <div className="mg-stage" data-phase="boot">
      <div className="mg-overlay" role="status">
        <span className="mg-spinner" aria-hidden="true" />
        <p>{t("stage.starting")}</p>
      </div>
    </div>
  );
}

const MODES: readonly GameMode[] = ["learn", "practice"];
const loadSd = () => import("@/features/stopping-distance/module");

/** Stopping Distance play: `?mode=practice|learn`, `?drill=DR-SD-…`, `?member=` (family mode). */
export function SdPlay() {
  const q = useSearchParams();
  const raw = q.get("mode");
  const mode: GameMode = MODES.includes(raw as GameMode) ? (raw as GameMode) : "practice";
  const drill = q.get("drill") ?? undefined;
  const member = q.get("member") ?? undefined;
  return (
    <GameStage
      gameId="stopping_distance"
      mode={mode}
      exitHref="/learn/practise/stopping-distance"
      load={loadSd}
      {...(drill ? { drillId: drill } : {})}
      {...(member ? { familyMemberId: member } : {})}
      debriefHref={(o) => `/learn/practise/sessions/${o.sid}/debrief?game=stopping_distance`}
    />
  );
}

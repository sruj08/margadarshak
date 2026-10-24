"use client";

import type { GameMode } from "@margdarshak/game-core/schema";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { StageSkeleton } from "@/features/stopping-distance/SdPlay";

/** The host and the game chunk load only after mount; Phaser is a further chunk (FRONTEND §10.2). */
const GameStage = dynamic(
  () => import("@/features/games/host/GameStage").then((m) => m.GameStage),
  { ssr: false, loading: () => <StageSkeleton /> },
);

const MODES: readonly GameMode[] = ["learn", "practice"];
const loadBs = () => import("@/features/blind-spot/module");

/**
 * Blind Spot play: `?mode=practice|learn`, `?drill=`, `?member=`, and `?variant=decision` for the
 * picture-choice version (read by the game itself, so the same module serves both).
 */
export function BsPlay() {
  const q = useSearchParams();
  const raw = q.get("mode");
  const mode: GameMode = MODES.includes(raw as GameMode) ? (raw as GameMode) : "practice";
  const drill = q.get("drill") ?? undefined;
  const member = q.get("member") ?? undefined;
  return (
    <GameStage
      gameId="blind_spot"
      mode={mode}
      exitHref="/learn/practise/blind-spot"
      load={loadBs}
      {...(drill ? { drillId: drill } : {})}
      {...(member ? { familyMemberId: member } : {})}
      debriefHref={(o) => `/learn/practise/sessions/${o.sid}/debrief?game=blind_spot`}
    />
  );
}

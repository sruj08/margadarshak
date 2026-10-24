"use client";

import type { GameMode } from "@margdarshak/game-core/schema";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { PreGameBrief } from "@/features/games/brief/PreGameBrief";
import { OfflineNote } from "@/features/games/states";
import { LastRuns } from "./LastRuns";

const MODES: readonly GameMode[] = ["practice", "learn"];

/**
 * Stopping Distance brief (UI_SPEC_LEARN_GAMES §4.1, §5.2): what you practise, how it is scored,
 * controls, options and the mode; `?mode=` preselects and `?drill=` (a debrief's next step) is
 * carried to the play route. The teaching values are passed in from game-core by the page, never
 * typed into copy. No game code loads here.
 */
export function SdBrief({ teaching }: { teaching: { rt: number; dry: number; wet: number } }) {
  const t = useTranslations("sims.sd");
  const f = useFormatter();
  const q = useSearchParams();
  const raw = q.get("mode");
  const initial: GameMode = MODES.includes(raw as GameMode) ? (raw as GameMode) : "practice";
  const drill = q.get("drill");
  const n = (v: number) => f.number(v, { maximumFractionDigits: 2 });
  return (
    <div className="md-page mg-page" data-screen="SD-BRIEF">
      <OfflineNote />
      <PreGameBrief
        title={t("name")}
        practise={t("practise")}
        scored={t("scored")}
        controls={t("controls")}
        defaultMode={initial}
        modes={[
          { id: "practice", label: t("modes.practice"), line: t("modes.practiceLine") },
          { id: "learn", label: t("modes.learn"), line: t("modes.learnLine") },
        ]}
        playHref={(mode) =>
          `/learn/practise/stopping-distance/play?mode=${mode}${drill ? `&drill=${encodeURIComponent(drill)}` : ""}`
        }
      >
        <div className="mg-notes">
          <p className="mg-note mg-note--ink" data-testid="sd-teaching">
            {t("teachingLine", { rt: n(teaching.rt), dry: n(teaching.dry), wet: n(teaching.wet) })}
          </p>
          <p className="mg-note mg-note--ink">{t("speedNote")}</p>
        </div>
        <LastRuns gameId="stopping_distance" />
      </PreGameBrief>
    </div>
  );
}

"use client";

import type { GameMode } from "@margdarshak/game-core/schema";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PreGameBrief } from "@/features/games/brief/PreGameBrief";
import { OfflineNote } from "@/features/games/states";
import { LastRuns } from "@/features/stopping-distance/brief/LastRuns";

const MODES: readonly GameMode[] = ["practice", "learn"];

/**
 * Blind Spot brief (UI_SPEC_LEARN_GAMES §4.1, §5.3): practise / scored / controls, options, the
 * mode, the decision version link (picture choices, no Phaser; for screen readers, Lite and phones
 * without WebGL, labelled as a different format) and the "zones vary" note. No game code here.
 */
export function BsBrief() {
  const t = useTranslations("sims.bs");
  const q = useSearchParams();
  const raw = q.get("mode");
  const initial: GameMode = MODES.includes(raw as GameMode) ? (raw as GameMode) : "practice";
  const drill = q.get("drill");
  const tail = drill ? `&drill=${encodeURIComponent(drill)}` : "";
  return (
    <div className="md-page mg-page" data-screen="BS-BRIEF">
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
        playHref={(mode) => `/learn/practise/blind-spot/play?mode=${mode}${tail}`}
        srHref={`/learn/practise/blind-spot/play?mode=${initial}&variant=decision${tail}`}
      >
        <div className="mg-notes">
          <p className="mg-note mg-note--ink">{t("zonesNote")}</p>
          <p className="mg-note mg-note--ink">{t("rule")}</p>
          <p className="mg-note mg-note--ink" data-testid="bs-decision-note">
            <strong>{t("decisionLink")}.</strong> {t("decisionNote")}
          </p>
        </div>
        <LastRuns gameId="blind_spot" />
      </PreGameBrief>
    </div>
  );
}

"use client";

import type { GameMode } from "@margdarshak/game-core/schema";
import { SourceChip } from "@margdarshak/ui/components/source-chip";
import { formatIsoDate } from "@margdarshak/ui/lib/format";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { PreGameBrief } from "@/features/games/brief/PreGameBrief";
import { listSessionRecords } from "@/features/games/results-store";
import { OfflineNote } from "@/features/games/states";
import type { KeralaFormat } from "./format";
import { PackDownload } from "./pack/PackDownload";

const MODES: readonly GameMode[] = ["mock", "practice", "learn"];

/**
 * Nazar brief (UI_SPEC_LEARN_GAMES §4.1, §5.1): mode choice (Kerala-format mock, practice, learn),
 * the format line from the KL rule pack with its source and status (EC-28), the photosensitivity
 * notice, the screen-reader alternative link, and the offline practice pack with its size shown
 * first. "Practice, not Kerala's test" stays on screen, and so does the line that the clips are
 * AI-generated road scenes (ADR-0013).
 */
export function NazarBrief({ format }: { format: KeralaFormat }) {
  const t = useTranslations("nazar");
  const tg = useTranslations("games");
  const locale = useLocale();
  const q = useSearchParams();
  const raw = q.get("mode");
  const initial: GameMode = MODES.includes(raw as GameMode) ? (raw as GameMode) : "mock";
  const drill = q.get("drill");

  // Runs finished offline earlier are submitted when this page opens online.
  useEffect(() => {
    if (!navigator.onLine || !listSessionRecords().some((r) => r.status === "queued")) return;
    // The queue (and game-core) load only when there is something to send.
    void import("@/features/games/host/queue").then((m) => m.syncPending()).catch(() => {});
  }, []);

  const checked = format.checkedOn ? formatIsoDate(format.checkedOn, locale, "long") : "";
  const onHold = format.status !== "announced" && format.status !== "in_force";
  return (
    <div className="md-page mg-page" data-screen="NAZ-BRIEF">
      <OfflineNote>{t("offline")}</OfflineNote>
      <PreGameBrief
        title={t("name")}
        practise={t("practise")}
        scored={t("scored")}
        controls={t("controls")}
        defaultMode={initial}
        modes={[
          { id: "mock", label: t("modes.mock"), line: t("modes.mockLine", { n: format.clips }) },
          { id: "practice", label: t("modes.practice"), line: t("modes.practiceLine") },
          { id: "learn", label: t("modes.learn"), line: t("modes.learnLine") },
        ]}
        playHref={(mode) =>
          `/learn/practise/nazar/play?mode=${mode}${drill ? `&drill=${encodeURIComponent(drill)}` : ""}`
        }
        srHref="/learn/practise/nazar/sr"
      >
        <div className="mg-notes">
          <p className="mg-note mg-note--ink" data-testid="nazar-ai-line">
            {t("ai.brief")}
          </p>
          <p data-testid="nazar-format">
            {onHold
              ? t("formatOnHold", { status: format.status, date: checked })
              : t("format", {
                  clips: format.clips,
                  marks: format.marksPerClip,
                  pass: format.passMark,
                  total: format.totalMarks,
                })}
          </p>
          <SourceChip
            source={format.sourceTitle.split(":")[0] ?? format.sourceTitle}
            checked={tg("checkedOn", { date: checked })}
            sourceTitle={format.sourceTitle}
            {...(format.sourceUrl ? { sourceUrl: format.sourceUrl } : {})}
            labels={{
              heading: tg("source.heading"),
              openSource: tg("source.open"),
              newTab: tg("source.newTab"),
            }}
          />
          <p className="mg-note mg-note--ink">{t("notTest")}</p>
          <p className="mg-note mg-note--ink" data-testid="nazar-photo">
            {t("photo")}
          </p>
          <p className="mg-note mg-note--ink">{t("srLinkLine")}</p>
        </div>
        <PackDownload />
      </PreGameBrief>
    </div>
  );
}

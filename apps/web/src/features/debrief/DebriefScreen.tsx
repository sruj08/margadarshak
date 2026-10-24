"use client";

import type { DebriefCard, DebriefCatalogue } from "@margdarshak/game-core/debrief";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { NotCountedNote } from "@/features/games/integrity/NotCountedNote";
import {
  getSessionRecord,
  listSessionRecords,
  type SessionRecord,
  subscribeSessionRecords,
} from "@/features/games/results-store";
import { OfflineNote, StateEmpty, StateError, StateLoading } from "@/features/games/states";
import { Link } from "@/i18n/navigation";
import { buildTemplateCard, historyFor, sessionResultOf } from "./build-card";
import { TemplateCard } from "./TemplateCard";
import { type DebriefSource, useDebrief } from "./use-debrief";

function useRecord(sid: string): { mounted: boolean; rec: SessionRecord | null } {
  const [state, setState] = useState<{ mounted: boolean; rec: SessionRecord | null }>({
    mounted: false,
    rec: null,
  });
  useEffect(() => {
    const read = () => setState({ mounted: true, rec: getSessionRecord(sid) });
    read();
    return subscribeSessionRecords(read);
  }, [sid]);
  return state;
}

/** The template card for a saved run; null when it has no score yet, "error" when it fails. */
function buildFor(
  rec: SessionRecord | null,
  catalogue: DebriefCatalogue,
  locale: "en" | "hi",
): DebriefCard | null | "error" {
  const result = rec ? sessionResultOf(rec) : null;
  if (!rec || !result) return null;
  try {
    return buildTemplateCard({
      result,
      history: historyFor(rec, listSessionRecords(rec.gameId)),
      catalogue,
      locale,
      now: new Date(rec.savedAt).toISOString(),
    }).card;
  } catch (e) {
    console.warn("template card failed", e);
    return "error";
  }
}

/**
 * Debrief screen (UI_SPEC_LEARN_GAMES §6.1, FRONTEND §8.4). The template card renders on this phone
 * from the session's findings (server findings once checked; the device's while provisional) with
 * the catalogue slice the server page passed in. API-36 is tried for a coach card; the AI path is
 * P3, so 501/404 keep the template. A queued run shows its card once it has a score.
 */
export function DebriefScreen({ sid, catalogue }: { sid: string; catalogue: DebriefCatalogue }) {
  const t = useTranslations("games");
  const locale = useLocale() === "hi" ? "hi" : "en";
  const { mounted, rec } = useRecord(sid);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `retry` re-runs the build on demand
  const built = useMemo(() => buildFor(rec, catalogue, locale), [rec, catalogue, locale, retry]);
  const template = built && built !== "error" ? built : null;
  const { card, source } = useDebrief(sid, template, rec?.source === "server");
  const back = rec ? `/learn/practise/${rec.gameId.replaceAll("_", "-")}` : "/learn/practise/nazar";
  const waiting = mounted && rec !== null && !rec.checked;

  return (
    <div className="md-page mg-page" data-screen="DEBRIEF" data-testid="debrief-screen">
      <OfflineNote>{t("debrief.offline")}</OfflineNote>
      <h1 className="md-h1">{t("debrief.title")}</h1>
      {!mounted ? <StateLoading /> : null}
      {mounted && !rec ? (
        <StateEmpty
          title={t("debrief.missing")}
          line={t("debrief.missingLine")}
          href={back}
          cta={t("debrief.practise")}
        />
      ) : null}
      {waiting ? (
        <StateEmpty
          title={t("debrief.waiting")}
          line={t("reveal.queued")}
          href={back}
          cta={t("debrief.practise")}
        />
      ) : null}
      {built === "error" ? <StateError onRetry={() => setRetry((n) => n + 1)} /> : null}
      {rec && card ? (
        <DebriefBody rec={rec} card={card} source={source} sid={sid} back={back} />
      ) : null}
    </div>
  );
}

function DebriefBody({
  rec,
  card,
  source,
  sid,
  back,
}: {
  rec: SessionRecord;
  card: DebriefCard;
  source: DebriefSource;
  sid: string;
  back: string;
}) {
  const t = useTranslations("games");
  const checked = rec.checked;
  return (
    <>
      {rec.status !== "verified" ? (
        <p className="mg-chip mg-chip--provisional" data-testid="debrief-provisional">
          {rec.status === "queued" ? t("reveal.queued") : t("debrief.provisional")}
        </p>
      ) : null}
      <NotCountedNote trust={checked?.server_checked ? checked.integrity.trust : null} />
      <TemplateCard card={card} findings={checked?.findings ?? []} sid={sid} source={source} />
      <nav className="mg-links" aria-label={t("debrief.more")}>
        {rec.mode === "mock" && rec.status === "verified" ? (
          <Link href="/learn/me/share" className="md-link">
            {t("debrief.share")}
          </Link>
        ) : null}
        <Link href={back} className="md-link">
          {t("debrief.practise")}
        </Link>
      </nav>
    </>
  );
}

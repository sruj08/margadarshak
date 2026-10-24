"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getGameSessionReplay } from "@/features/games/api";
import type { GameSessionReplay } from "@/features/games/api-types";
import { useGameA11y } from "@/features/games/host/a11y-context";
import { getSessionRecord, type SessionRecord } from "@/features/games/results-store";
import { OfflineNote, StateEmpty, StateError, StateLoading } from "@/features/games/states";
import { hazardLabel } from "@/features/nazar/hazard-labels";
import { clipOrigin } from "@/features/nazar/origin";
import { ReplayScrubber } from "@/features/nazar/replay/ReplayScrubber";
import { Link } from "@/i18n/navigation";

type Clip = GameSessionReplay["clips"][number];

type State =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "notfound" }
  | { k: "error" }
  | { k: "ready"; rec: SessionRecord; clip: Clip; hazardType: string | null };

/** `0:04.2` from milliseconds. */
export function clockTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

async function loadView(rec: SessionRecord): Promise<GameSessionReplay | null> {
  if (rec.source === "server") {
    const server = await getGameSessionReplay(rec.sid);
    if (server) return server;
  }
  const mock = await import("@/features/games/mock-api");
  return mock.deviceReplayView({
    ctx: rec.ctx,
    items: rec.items,
    events: rec.events,
    content: rec.deviceContent ?? null,
  });
}

/**
 * Replay of one finding's moment (UI_SPEC_LEARN_GAMES §6.3, NAZAR §3.2): the clip's final window
 * (from the replay endpoint after API-35; on a device session, from the fixture clip) with the
 * learner's own taps from this phone's event log, the late seconds turned into metres at the
 * clip's estimated speed, and "Try a clip like this".
 */
export function ReplayScreen({ sid, findingId }: { sid: string; findingId: string }) {
  const t = useTranslations("games");
  const locale = useLocale();
  const { reducedMotion } = useGameA11y();
  const [state, setState] = useState<State>({ k: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt;
    const rec = getSessionRecord(sid);
    if (!rec) return setState({ k: "missing" });
    const finding = rec.checked?.findings.find((f) => f.findingId === findingId);
    const ordinalFact = finding?.facts["clip_ordinal"];
    const fromRef = finding?.itemRef
      ? rec.ctx.items.findIndex((i) => i.ref === finding.itemRef) + 1
      : 0;
    const ordinal = typeof ordinalFact === "number" ? ordinalFact : fromRef;
    if (!finding || ordinal < 1) return setState({ k: "notfound" });
    const ht = finding.facts["hazard_type"];
    let alive = true;
    loadView(rec)
      .then((view) => {
        if (!alive) return;
        const clip = view?.clips.find((c) => c.ordinal === ordinal);
        setState(
          clip
            ? { k: "ready", rec, clip, hazardType: typeof ht === "string" ? ht : null }
            : { k: "notfound" },
        );
      })
      .catch(() => alive && setState({ k: "error" }));
    return () => {
      alive = false;
    };
  }, [sid, findingId, attempt]);

  const debrief = `/learn/practise/sessions/${sid}/debrief?game=nazar`;
  return (
    <div className="md-page mg-page" data-screen="REPLAY" data-testid="replay-screen">
      <OfflineNote>{t("replay.offline")}</OfflineNote>
      <Link href={debrief} className="md-link">
        ← {t("replay.back")}
      </Link>
      {state.k === "loading" ? <StateLoading /> : null}
      {state.k === "missing" ? (
        <StateEmpty
          title={t("debrief.missing")}
          line={t("debrief.missingLine")}
          href="/learn/practise/nazar"
          cta={t("debrief.practise")}
        />
      ) : null}
      {state.k === "notfound" ? (
        <StateEmpty title={t("replay.notFound")} href={debrief} cta={t("replay.back")} />
      ) : null}
      {state.k === "error" ? <StateError onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {state.k === "ready" ? (
        <Moment {...state} locale={locale} reducedMotion={reducedMotion} />
      ) : null}
    </div>
  );
}

function Moment({
  rec,
  clip,
  hazardType,
  locale,
  reducedMotion,
}: {
  rec: SessionRecord;
  clip: Clip;
  hazardType: string | null;
  locale: string;
  reducedMotion: boolean;
}) {
  const t = useTranslations("games");
  const win = clip.windows.find((w) => w.hazard_type === hazardType) ?? clip.windows[0];
  const a = clip.analysis?.hazards.find((h) => h.hazard_id === win?.hazard_id);
  const taps = rec.events
    .filter((e) => e.type === "tap" && e.item === clip.ordinal - 1 && typeof e.mt === "number")
    .map((e) => e.mt as number);
  const tapMt = a?.tap_mt ?? null;
  const early = win && tapMt === null && taps.some((m) => m >= win.a_ms - 1000 && m < win.a_ms);
  const type = win?.hazard_type ?? hazardType ?? "other";
  const assetUrl = rec.media === "video" ? clip.asset_url : undefined;
  // The replay clip says how it was made; a record kept from API-34 says it too.
  const origin = clipOrigin(
    clip.origin ? clip : rec.items.find((it) => it.item_ref === clip.item_ref),
    rec.media,
  );
  return (
    <section aria-labelledby="moment-h" data-testid="replay-moment">
      <h1 id="moment-h" className="md-h1">
        {t("replay.clip", { n: clip.ordinal })} · {hazardLabel(type, locale)}
      </h1>
      {rec.media === "placeholder" ? (
        <p className="mg-note mg-note--ink">{t("replay.placeholder")}</p>
      ) : null}
      <ReplayScrubber
        durationMs={clip.duration_ms}
        windows={clip.windows.map((w) => ({ hazardId: w.hazard_id, aMs: w.a_ms, bMs: w.b_ms }))}
        taps={taps}
        reducedMotion={reducedMotion}
        {...(win ? { onsetMs: win.a_ms } : {})}
        {...(assetUrl ? { assetUrl } : {})}
        {...(origin ? { origin } : {})}
      />
      <dl className="mg-facts">
        {win ? (
          <div>
            <dt>{t("replay.began")}</dt>
            <dd data-testid="replay-began">{clockTime(win.a_ms)}</dd>
          </div>
        ) : null}
        {tapMt !== null ? (
          <div>
            <dt>{t("replay.tapped")}</dt>
            <dd data-testid="replay-tapped">{clockTime(tapMt)}</dd>
          </div>
        ) : null}
      </dl>
      {a && a.late_s !== null && a.late_s > 0 ? (
        <p className="mg-late" data-testid="replay-late">
          {t("replay.late", { s: a.late_s.toFixed(1), m: Math.round(a.metres ?? 0) })}
        </p>
      ) : null}
      {tapMt === null && !early ? <p data-testid="replay-missed">{t("replay.missed")}</p> : null}
      {early ? <p>{t("replay.early")}</p> : null}
      {typeof clip.speed_kmh_est === "number" ? (
        <p className="mg-note mg-note--ink">{t("replay.speed", { kmh: clip.speed_kmh_est })}</p>
      ) : null}
      <Link
        href={`/learn/practise/nazar?mode=learn&drill=DR-NAZ-OCCL-${type.toUpperCase()}`}
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        data-testid="replay-try"
      >
        {t("replay.try")}
      </Link>
    </section>
  );
}

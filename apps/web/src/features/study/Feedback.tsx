"use client";

import { Button } from "@margdarshak/ui/components/button";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { GameSessionReplay } from "@/features/games/api-types";
import type { SessionRecord } from "@/features/games/results-store";
import { pickFeedbackClips } from "./score";
import { StudyLoading } from "./states";

/** C's replay scrubber, loaded with this step only. */
const ReplayScrubber = dynamic(
  () => import("@/features/nazar/replay/ReplayScrubber").then((m) => m.ReplayScrubber),
  { ssr: false, loading: () => <StudyLoading /> },
);

type Clip = GameSessionReplay["clips"][number];

interface View {
  rec: SessionRecord;
  clips: Clip[];
}

/** `0:04.2` from milliseconds. */
function clock(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

async function loadView(sid: string): Promise<View | null> {
  const { getSessionRecord } = await import("@/features/games/results-store");
  const rec = getSessionRecord(sid);
  if (!rec) return null;
  let view: GameSessionReplay | null = null;
  if (rec.source === "server") {
    const { getGameSessionReplay } = await import("@/features/games/api");
    view = await getGameSessionReplay(sid).catch(() => null);
  }
  if (!view) {
    const mock = await import("@/features/games/mock-api");
    try {
      view = mock.deviceReplayView({ ctx: rec.ctx, items: rec.items, events: rec.events });
    } catch {
      view = null;
    }
  }
  return view ? { rec, clips: pickFeedbackClips(view.clips) } : null;
}

type Hazard = NonNullable<Clip["analysis"]>["hazards"][number];
type StudyT = ReturnType<typeof useTranslations<"study">>;

/** The late fact of one hazard, every number from the replay analysis (FIELD_STUDY §4.3 step 5). */
function factLine(t: StudyT, clip: Clip, a: Hazard | undefined, early: boolean): string {
  if (!a || a.tap_mt === null) return early ? t("feedback.early") : t("feedback.missed");
  if (a.late_s === null || a.late_s <= 0) return t("feedback.onTime");
  if (typeof clip.speed_kmh_est !== "number")
    return t("feedback.lateNoSpeed", { s: a.late_s.toFixed(1) });
  return t("feedback.late", {
    s: a.late_s.toFixed(1),
    m: Math.round(a.metres ?? (a.late_s * clip.speed_kmh_est) / 3.6),
    kmh: clip.speed_kmh_est,
  });
}

/**
 * Part 2b, feedback replay on 2 test clips (FIELD_STUDY §4.3 step 5): the hazard band on the scrub
 * bar with the participant's own taps and the late fact ("hazard began 0:04.2, you tapped 0:05.6 →
 * 1.4 s late ≈ 16 m at 40 km/h", numbers from the replay endpoint or the device replay). Windows
 * are shown only now, after the test session is complete.
 */
export function FeedbackStep({ sid, onDone }: { sid: string; onDone: () => void }) {
  const t = useTranslations("study");
  const [view, setView] = useState<View | null | undefined>(undefined);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    loadView(sid)
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, [sid]);

  if (view === undefined) return <StudyLoading label={t("feedback.loading")} />;
  if (!view || view.clips.length === 0) {
    return (
      <section className="st-card" data-testid="feedback-none">
        <p>{t("feedback.none")}</p>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={onDone}
          data-testid="feedback-continue"
        >
          {t("feedback.continue")}
        </Button>
      </section>
    );
  }

  const clip = view.clips[i] as Clip;
  const last = i >= view.clips.length - 1;
  const win = clip.windows[0];
  const a = clip.analysis?.hazards.find((h) => h.hazard_id === win?.hazard_id);
  const taps = view.rec.events
    .filter((e) => e.type === "tap" && e.item === clip.ordinal - 1 && typeof e.mt === "number")
    .map((e) => e.mt as number);
  const early =
    !!win && (a?.tap_mt ?? null) === null && taps.some((m) => m >= win.a_ms - 1000 && m < win.a_ms);

  return (
    <section
      className="st-card"
      aria-labelledby="fb-h"
      data-testid="feedback"
      data-clip={clip.ordinal}
    >
      <h2 id="fb-h" className="md-h2">
        {t("feedback.h1", { n: i + 1, total: view.clips.length })}
      </h2>
      <p className="st-hint">{t("feedback.lead")}</p>
      {view.rec.media === "placeholder" ? (
        <p className="st-hint">{t("feedback.placeholder")}</p>
      ) : null}
      <div className="st-replay">
        <ReplayScrubber
          key={clip.ordinal}
          durationMs={clip.duration_ms}
          windows={clip.windows.map((w) => ({ hazardId: w.hazard_id, aMs: w.a_ms, bMs: w.b_ms }))}
          taps={taps}
          reducedMotion
          {...(win ? { onsetMs: win.a_ms } : {})}
          {...(view.rec.media === "video" && clip.asset_url ? { assetUrl: clip.asset_url } : {})}
          {...(view.rec.media === "video" && clip.origin ? { origin: clip.origin } : {})}
        />
      </div>
      <dl className="st-facts">
        {win ? (
          <div>
            <dt>{t("feedback.began")}</dt>
            <dd data-testid="feedback-began">{clock(win.a_ms)}</dd>
          </div>
        ) : null}
        {a?.tap_mt !== null && a?.tap_mt !== undefined ? (
          <div>
            <dt>{t("feedback.tapped")}</dt>
            <dd data-testid="feedback-tapped">{clock(a.tap_mt)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="st-late" data-testid="feedback-fact">
        {factLine(t, clip, a, early)}
      </p>
      <Button
        variant="primary"
        size="lg"
        fullWidth
        onPress={() => (last ? onDone() : setI((n) => n + 1))}
        data-testid={last ? "feedback-continue" : "feedback-next"}
      >
        {last ? t("feedback.continue") : t("feedback.next")}
      </Button>
    </section>
  );
}

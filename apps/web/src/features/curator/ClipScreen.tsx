"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Link } from "@/i18n/navigation";
import { type Source, simulateIngest } from "./api";
import { hazardLabel } from "./hazards";
import { OriginChip } from "./OriginChip";
import { useProblemText } from "./problem";
import { clockTime, isAi } from "./rules";
import {
  CuratorEmpty,
  CuratorError,
  CuratorLoading,
  CuratorOfflineNote,
  CuratorOfflineState,
  MockSourceNote,
} from "./states";
import type { Clip } from "./types";
import { useClip } from "./use-clip";

export type Step = "audit" | "review" | "rate" | "adjudicate" | "cues" | "publish";
const STEP_PATH: Record<Step, string> = {
  audit: "blur",
  review: "review",
  rate: "rate",
  adjudicate: "adjudicate",
  cues: "cues",
  publish: "publish",
};

/**
 * Shell of every per-clip screen: loads the clip with the five states, then renders the step nav
 * and the step's body with the loaded clip (and a setter for the server's fresh copy).
 */
export function ClipScreen({
  clipId,
  step,
  children,
}: {
  clipId: string;
  step: Step | null;
  children: (clip: Clip, set: (c: Clip, s: Source) => void, source: Source) => ReactNode;
}) {
  const t = useTranslations("curator");
  const { state, reload, set } = useClip(clipId);
  return (
    <div className="cu-page" data-screen={`ADMIN-CLIP-${step ?? "overview"}`}>
      <CuratorOfflineNote />
      <Link href="/admin/clips" className="md-link">
        ← {t("states.back")}
      </Link>
      {state.k === "loading" ? <CuratorLoading /> : null}
      {state.k === "offline" ? <CuratorOfflineState /> : null}
      {state.k === "error" ? <CuratorError onRetry={reload} /> : null}
      {state.k === "forbidden" ? <CuratorError line={t("states.forbidden")} /> : null}
      {state.k === "notfound" ? (
        <CuratorEmpty title={t("states.notFound")} href="/admin/clips" cta={t("states.back")} />
      ) : null}
      {state.k === "ready" ? (
        <>
          <StepNav clip={state.clip} current={step} />
          <MockSourceNote source={state.source} />
          {children(state.clip, set, state.source)}
        </>
      ) : null}
    </div>
  );
}

function StepNav({ clip, current }: { clip: Clip; current: Step | null }) {
  const t = useTranslations("curator");
  // AI clips skip the blur audit and take the synthetic review instead.
  const steps: Step[] = [isAi(clip) ? "review" : "audit", "rate", "adjudicate", "cues", "publish"];
  return (
    <nav aria-label={t("overview.steps")} className="cu-steps">
      <Link
        href={`/admin/clips/${clip.clip_id}`}
        className="cu-steps__link"
        aria-current={current === null ? "page" : undefined}
      >
        {clip.clip_id} · {t(`status.${clip.status}`)}
      </Link>
      {steps.map((s) => (
        <Link
          key={s}
          href={`/admin/clips/${clip.clip_id}/${STEP_PATH[s]}`}
          className="cu-steps__link"
          aria-current={current === s ? "page" : undefined}
        >
          {t(`steps.${s}`)}
        </Link>
      ))}
    </nav>
  );
}

/** Clip overview: coarse facts, final windows, workflow runs and (mock) the ingest stand-in. */
export function ClipOverview({ clipId }: { clipId: string }) {
  return (
    <ClipScreen clipId={clipId} step={null}>
      {(clip, set, source) => <Overview clip={clip} set={set} source={source} />}
    </ClipScreen>
  );
}

function Overview({
  clip,
  set,
  source,
}: {
  clip: Clip;
  set: (c: Clip, s: Source) => void;
  source: Source;
}) {
  const t = useTranslations("curator");
  const locale = useLocale();
  const problem = useProblemText();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ingest = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await simulateIngest(clip.clip_id);
      set(r.data, r.source);
    } catch (e) {
      setErr(problem(e));
    } finally {
      setBusy(false);
    }
  };
  const facts: [string, string][] = [
    [t("overview.city"), clip.city ?? "—"],
    [t("overview.road"), clip.road_type ? t(`options.road.${clip.road_type}`) : "—"],
    [t("overview.month"), clip.captured_month ?? "—"],
    [
      t("overview.speed"),
      typeof clip.speed_kmh_est === "number"
        ? t("overview.speedValue", { kmh: clip.speed_kmh_est })
        : t("overview.speedMissing"),
    ],
    [t("overview.duration"), clip.duration_ms ? clockTime(clip.duration_ms) : "—"],
    [t("overview.version"), String(clip.version)],
  ];
  return (
    <section aria-labelledby="ov-h" data-testid="clip-overview">
      <h1 id="ov-h" className="md-h1">
        {clip.clip_id}
      </h1>
      <OriginChip clip={clip} />
      <h2 className="md-h3">{t("overview.facts")}</h2>
      <dl className="cu-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {(clip.status === "raw" || clip.status === "transcoded") && source === "mock" ? (
        <Banner
          tone="simulated"
          title={t("mock.ingest")}
          action={
            <Button
              variant="secondary"
              isPending={busy}
              onPress={() => void ingest()}
              data-testid="mock-ingest"
            >
              {t("mock.ingest")}
            </Button>
          }
        >
          {t("mock.ingestLine")}
        </Banner>
      ) : null}
      {err ? (
        <p role="alert" className="cu-error">
          {err}
        </p>
      ) : null}
      <h2 className="md-h3">{t("overview.hazards")}</h2>
      {(clip.hazards ?? []).length === 0 ? (
        <p className="cu-hint">{t("overview.noHazards")}</p>
      ) : (
        <ul className="cu-list">
          {(clip.hazards ?? []).map((h) => (
            <li key={h.hazard_id}>
              {h.hazard_id} · {hazardLabel(h.hazard_type, locale)} · {clockTime(h.a_ms)} –{" "}
              {clockTime(h.b_ms)}
            </li>
          ))}
        </ul>
      )}
      <h2 className="md-h3">{t("overview.runs")}</h2>
      {(clip.workflow_runs ?? []).length === 0 ? (
        <p className="cu-hint">{t("overview.noRuns")}</p>
      ) : (
        <ul className="cu-list">
          {(clip.workflow_runs ?? []).map((r) => (
            <li key={r.run_id}>
              {r.job} · {r.run_id} · {r.status}
            </li>
          ))}
        </ul>
      )}
      {clip.raw_deleted_at ? (
        <p className="cu-hint">
          {t("overview.rawDeleted")}: {clip.raw_deleted_at.slice(0, 10)}
        </p>
      ) : null}
    </section>
  );
}

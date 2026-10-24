"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getPublicStats } from "./api";
import { StudyLoading } from "./states";
import type { PublicStatsWire } from "./types";

/**
 * Live counters for the S2 study (NAZAR §10 "Live numbers", API-71): people who started, sessions
 * analysed after the pre-registered exclusions, and the share below 60/100 with its 95% CI, once
 * `stats.field_study_publish` has run. Honest labels: convenience sample, our clips, no crash
 * outcomes; "collecting" until the freeze. Read-only, no session, so it never writes anything.
 */
export function LiveCounters() {
  const t = useTranslations("study");
  const [stats, setStats] = useState<PublicStatsWire | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getPublicStats().then((s) => alive && setStats(s));
    return () => {
      alive = false;
    };
  }, []);

  const n = stats?.nazar;
  const pct = (v: number) => Math.round(v * 100);
  const below =
    typeof n?.below_kerala_60_pct === "number"
      ? n.ci95
        ? t("counters.belowValue", {
            pct: pct(n.below_kerala_60_pct),
            lo: pct(n.ci95[0]),
            hi: pct(n.ci95[1]),
          })
        : `${pct(n.below_kerala_60_pct)}%`
      : t("counters.pending");

  return (
    <section className="st-counters" aria-labelledby="counters-h" data-testid="live-counters">
      <h2 id="counters-h" className="md-h3">
        {t("counters.h2")}
      </h2>
      {stats === undefined ? <StudyLoading label={t("counters.loading")} /> : null}
      {stats === null ? (
        <p className="st-hint" data-testid="counters-none">
          {t("counters.none")}
        </p>
      ) : null}
      {stats ? (
        <>
          <dl className="st-stats">
            <div>
              <dt>{t("counters.joined")}</dt>
              <dd data-testid="counter-joined">{stats.counters?.["nazar_participants"] ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("counters.analysed")}</dt>
              <dd data-testid="counter-analysed">{n?.participants ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("counters.below")}</dt>
              <dd data-testid="counter-below">{below}</dd>
            </div>
          </dl>
          {n?.status !== "published" ? <p className="st-hint">{t("counters.collecting")}</p> : null}
          {n?.prereg_hash ? (
            <p className="st-hint">{t("counters.prereg", { hash: n.prereg_hash })}</p>
          ) : null}
        </>
      ) : null}
      <p className="st-hint">{t("counters.note")}</p>
    </section>
  );
}

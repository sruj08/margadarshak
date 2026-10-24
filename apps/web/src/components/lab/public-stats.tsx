"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useFmt } from "@/components/journey/rule-source";
import { publicStats, type PublicStats as Stats } from "@/lib/journey/api";
import { type StatCell, statCells } from "@/lib/journey/stats";

/** The IST calendar date of an RFC 3339 instant. */
function istDay(at: string): string {
  const ms = Date.parse(at);
  return Number.isNaN(ms)
    ? at.slice(0, 10)
    : new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Live field-study counters for judges (API-71). Every count of people below 5 shows as "fewer
 * than 5" (k-anonymity, as the API's digest); medians only with at least 5 participants. A
 * convenience sample, pre-registered, and said so. `variant="card"` is the small "Field study so
 * far" card on All services; `variant="lab"` is the full list on the lab page.
 */
export function PublicStats({ variant }: { variant: "card" | "lab" }) {
  const t = useTranslations("publicStats");
  const locale = useLocale();
  const { date } = useFmt();
  const [stats, setStats] = useState<Stats | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void publicStats().then((s) => {
      if (live) setStats(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const cells = stats ? statCells(stats) : [];
  const shown =
    variant === "card"
      ? cells.filter((c) =>
          ["plans_computed", "cases_started", "journey_participants"].includes(c.id),
        )
      : cells;
  const value = (c: StatCell) =>
    c.suppressed
      ? t("suppressed")
      : c.unit === "seconds"
        ? t("seconds", { n: c.value ?? 0 })
        : new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN").format(c.value ?? 0);

  const lab = variant === "lab";
  // The lab page keeps the replica's fixed light styling (it is a research screen, not themed).
  const cls = lab
    ? { box: "mj-lab-log", h2: undefined, caption: undefined, dl: undefined, dd: undefined }
    : {
        box: "mj-card mj-card--well",
        h2: "mj-card__title",
        caption: "mj-caption",
        dl: "mj-facts",
        dd: "mj-num",
      };

  return (
    <section
      className={cls.box}
      aria-labelledby={`stats-${variant}`}
      data-testid={`public-stats-${variant}`}
      data-source={stats ? "server" : "none"}
    >
      <h2
        id={`stats-${variant}`}
        className={cls.h2}
        style={lab ? { fontWeight: 700, marginBottom: 8 } : undefined}
      >
        {t("title")}
      </h2>
      {stats === undefined ? (
        <p className={cls.caption} aria-busy="true">
          {t("loading")}
        </p>
      ) : stats === null ? (
        <p className={cls.caption}>{t("unavailable")}</p>
      ) : (
        <>
          <dl className={cls.dl}>
            {shown.map((c) => (
              <div key={c.id} data-testid={`stat-${c.id}`} data-suppressed={c.suppressed}>
                <dt style={lab ? { fontWeight: 700 } : undefined}>{t(`label.${c.id}`)}</dt>
                <dd className={cls.dd} style={lab ? { margin: "0 0 6px" } : undefined}>
                  {value(c)}
                </dd>
              </div>
            ))}
          </dl>
          <p className={cls.caption}>{t("note", { date: date(istDay(stats.as_of)) })}</p>
        </>
      )}
    </section>
  );
}

"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { SessionOutcome } from "@/features/games/types";

const KNOWN = ["placement", "no_zone_time", "mirror_checks", "hold_back"] as const;
type Known = (typeof KNOWN)[number];
const isKnown = (id: string): id is Known => (KNOWN as readonly string[]).includes(id);

/**
 * Blind Spot's score parts inside the host's results reveal, from the checked result (the
 * server's once verified, D-11). When the left-overtake cap applied, says so first.
 */
export function BsResultsExtra({ outcome }: { outcome: SessionOutcome }) {
  const t = useTranslations("sims.bs.results");
  const f = useFormatter();
  const result = outcome.checked;
  if (!result) return null;
  const parts = result.score.components.filter((c) => isKnown(c.id));
  const critical = result.score.capApplied === "critical_left_overtake_part_b_0";
  const n = (v: number) => f.number(v, { maximumFractionDigits: 1 });
  return (
    <div className="mg-reveal__extra" data-testid="bs-results">
      <p className="mg-reveal__skill">{t("skill")}</p>
      {critical ? (
        <p className="mg-reveal__verdict" data-testid="bs-results-critical">
          {t("critical")}
        </p>
      ) : null}
      <ul className="sims-parts">
        {parts.map((c) => (
          <li key={c.id} data-testid={`bs-part-${c.id}`}>
            {t(c.id as Known, { v: n(c.value), max: n(c.max) })}
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { SessionOutcome } from "@/features/games/types";

const KNOWN = new Set(["estimation", "no_collision", "speed_for_sight"]);

/**
 * The score's three parts inside the host's results reveal (UI_SPEC_LEARN_GAMES §5.2: estimation 30
 * + no contact 20 + speed choice 50). Values are the checked result's components (the server's once
 * verified, D-11); nothing is computed here.
 */
export function SdResultsExtra({ outcome }: { outcome: SessionOutcome }) {
  const t = useTranslations("sims.sd.results");
  const f = useFormatter();
  const parts = (outcome.checked?.score.components ?? []).filter((c) => KNOWN.has(c.id));
  if (parts.length === 0) return null;
  const n = (v: number) => f.number(v, { maximumFractionDigits: 1 });
  return (
    <div className="mg-reveal__extra" data-testid="sd-results">
      <p className="mg-reveal__skill">{t("skill")}</p>
      <ul className="sims-parts">
        {parts.map((c) => (
          <li key={c.id} data-testid={`sd-part-${c.id}`}>
            {t(c.id as "estimation", { v: n(c.value), max: n(c.max) })}
          </li>
        ))}
      </ul>
      <p className="mg-note">{t("note")}</p>
    </div>
  );
}

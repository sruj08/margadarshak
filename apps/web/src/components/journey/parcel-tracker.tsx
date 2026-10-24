"use client";

import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useTranslations } from "next-intl";
import type { Case } from "@/lib/journey/api-types";
import { trackerSteps } from "@/lib/journey/stage";
import { useFmt } from "./rule-source";

/**
 * Parcel-style tracker (SCR-070, MD-123): the whole road as a delivery timeline, vertical on
 * phones. Each step says done / current / upcoming in words and has a "who acts" chip; the current
 * step carries aria-current="step" and explains the wait.
 */
export function ParcelTracker({ data }: { data: Case }) {
  const t = useTranslations("tracker");
  const { date } = useFmt();
  const steps = trackerSteps(data);
  const n = steps.length;
  return (
    <ol className="mj-tracker" aria-label={t("label")} data-testid="parcel-tracker">
      {steps.map((s, i) => {
        const word = t(`status.${s.status}`);
        return (
          <li
            key={s.id}
            data-status={s.status}
            aria-current={s.status === "now" ? "step" : undefined}
            aria-label={t("aria", {
              i: i + 1,
              n,
              name: t(`step.${s.id}` as "step.plan"),
              status: word,
            })}
          >
            <StatusGlyph kind={s.status} size={28} />
            <span>
              <span className="mj-tracker__title">{t(`step.${s.id}` as "step.plan")}</span>
              <span className="mj-who">{t(`who.${s.who}`)}</span>
              <span className="md-sr-only"> · {word}</span>
              {s.status === "now" ? (
                <span className="mj-tracker__now">
                  <span>{t(`now.${s.id}` as "now.plan")}</span>
                </span>
              ) : null}
            </span>
            <span className="mj-tracker__date">{s.date ? date(s.date) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

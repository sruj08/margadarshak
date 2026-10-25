"use client";

import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Case } from "@/lib/journey/api-types";
import { trackerSteps } from "@/lib/journey/stage";
import { useFmt } from "./rule-source";

/** Where each step is done in the app (the simulated Sarathi / RTO screens for official steps). */
const ACTION_HREF: Record<string, string> = {
  plan: "/plan",
  applied: "/apply",
  ll_test: "/test/ll",
  practice: "/learn",
  book: "/dl/apply",
  dl_test: "/dl/test-day",
  approval: "/dl/issued",
  card: "/dl/issued",
  digilocker: "/dl/issued",
};

/**
 * Parcel-style tracker (SCR-070, MD-123): the whole road as a delivery timeline, vertical on
 * phones. Each step says done / current / upcoming in words and has a "who acts" chip; the current
 * step carries aria-current="step", explains the wait and links to where it is done. During the
 * practice month the booking step also links ahead, because a slot can be booked for a day on or
 * after the unlock.
 */
export function ParcelTracker({ data }: { data: Case }) {
  const t = useTranslations("tracker");
  const { date } = useFmt();
  const steps = trackerSteps(data);
  const n = steps.length;
  const practising = steps.some((s) => s.id === "practice" && s.status === "now");
  const unlock = data.key_dates?.["dl_test_unlock"] ?? null;
  return (
    <ol className="mj-tracker" aria-label={t("label")} data-testid="parcel-tracker">
      {steps.map((s, i) => {
        const word = t(`status.${s.status}`);
        const href = ACTION_HREF[s.id];
        const bookEarly = s.id === "book" && s.status === "later" && practising;
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
                  {href ? (
                    <Link
                      href={href}
                      className="mj-tracker__action"
                      data-testid={`tracker-action-${s.id}`}
                    >
                      {t(`action.${s.id}` as "action.plan")}
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  ) : null}
                </span>
              ) : null}
              {bookEarly ? (
                <Link
                  href="/dl/apply"
                  className="mj-tracker__ahead"
                  data-testid="tracker-book-early"
                >
                  {unlock ? t("bookEarly", { date: date(unlock) }) : t("bookEarlyNoDate")}
                  <ChevronRight aria-hidden="true" />
                </Link>
              ) : null}
            </span>
            <span className="mj-tracker__date">{s.date ? date(s.date) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

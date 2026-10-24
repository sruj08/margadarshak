"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";

/**
 * "Book anyway" (UI_SPEC_LEARN_GAMES §2.7, GAMIFICATION_ENGINE §5.2, DP-06 interface interference).
 * The 85 gate is advisory: a way to book is ALWAYS on screen, at every score. Below the gate it is the
 * text link "Book my LL test anyway" with "We suggest 85. It's your choice."; at the gate with every
 * condition met it becomes the primary "Book your LL test". The confirmation is one neutral question
 * with two equal answers: no confirm-shaming, no countdown, nothing pre-selected.
 */
export function BookAnyway({
  score,
  gateMet,
  threshold = 85,
  atRto = false,
  href = "/apply",
}: {
  score: number;
  gateMet: boolean;
  threshold?: number;
  atRto?: boolean;
  href?: string;
}) {
  const t = useTranslations("learnHub.ready");
  const [asking, setAsking] = useState(false);

  if (gateMet)
    return (
      <Link
        href={href}
        data-testid="book-anyway"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {atRto ? t("bookRto") : t("book")}
      </Link>
    );

  return (
    <div className="md-stack">
      {asking ? (
        <div className="ml-card">
          <p>{t("confirm", { s: score, g: threshold })}</p>
          <div className="ml-row">
            <Link href={href} className={buttonClassName({ variant: "secondary" })}>
              {t("confirmYes")}
            </Link>
            <Button variant="secondary" onPress={() => setAsking(false)}>
              {t("confirmNo")}
            </Button>
          </div>
        </div>
      ) : null}
      <Link
        href={href}
        data-testid="book-anyway"
        className="md-link"
        onClick={(e) => {
          // Without JS the link still goes straight to booking; with JS one neutral question first.
          e.preventDefault();
          setAsking(true);
        }}
      >
        {atRto ? t("anywayRto") : t("anyway")}
      </Link>
      <p className="ml-small">{t("anywayNote", { g: threshold })}</p>
    </div>
  );
}

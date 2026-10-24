"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Family mode (D-13 revised, GAMIFICATION_ENGINE §13): a minor's profile can make a share card only
 * after the parent turns on the `share_cards` consent. A calm note with the way to the parent's
 * settings; no lock icon, nothing else is blocked, and the learner's practice is unaffected.
 */
export function ParentConsentGate({ name }: { name: string | null }) {
  const t = useTranslations("games");
  return (
    <section className="mg-callout" data-testid="parent-consent-gate" aria-labelledby="pcg-h">
      <h2 id="pcg-h" className="md-h3">
        {t("share.consentTitle")}
      </h2>
      <p>{name ? t("share.consentLineNamed", { name }) : t("share.consentLine")}</p>
      <p className="mg-note mg-note--ink">{t("share.consentPractice")}</p>
      <Link href="/privacy" className={buttonClassName({ variant: "secondary" })}>
        {t("share.consentCta")}
      </Link>
    </section>
  );
}

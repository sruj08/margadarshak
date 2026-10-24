import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { getTranslations } from "next-intl/server";
import { LiveCounters } from "@/features/study/LiveCounters";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

/**
 * `/nazar`: the field-study landing page and QR target (FIELD_STUDY §4–§6, MD-237). Honest copy:
 * a practice test in Kerala's announced format, not Kerala's test; 18+; anonymous; about 6 minutes.
 * Static HTML plus the live-counters island (API-71, read-only). Nothing is written here.
 */
export default async function NazarStudyLanding({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  const t = await getTranslations("study");
  return (
    <div className="st-landing" data-screen="NAZAR-STUDY" data-testid="study-landing">
      <p className="st-kicker">{t("landing.kicker")}</p>
      <h1 className="md-h1">{t("landing.h1")}</h1>
      <p className="st-lead">{t("landing.lead")}</p>
      <section aria-labelledby="facts-h" className="st-card">
        <h2 id="facts-h" className="md-h3">
          {t("landing.facts")}
        </h2>
        <ul className="st-list">
          <li>{t("landing.fact1")}</li>
          <li>{t("landing.fact2")}</li>
          <li>{t("landing.fact3")}</li>
          <li>{t("landing.fact4")}</li>
        </ul>
        <p className="st-hint">{t("landing.sound")}</p>
      </section>
      <Link
        href="/nazar/flow"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        data-testid="study-start"
      >
        {t("landing.start")}
      </Link>
      <Link href="/privacy" className="md-link st-privacy">
        {t("landing.privacy")}
      </Link>
      <LiveCounters />
    </div>
  );
}

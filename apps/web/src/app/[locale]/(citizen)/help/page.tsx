import "@/components/journey/journey.css";
import { Banner } from "@margdarshak/ui/components/banner";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VoiceButton } from "@/components/home/voice-sheet";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";
import { GOV_HELPDESK_EMAIL, GRIEVANCE_EMAIL } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("help");
  return { title: t("title") };
}

/** Help tab (SCR-181): contacts, scam hygiene, live voice guide, and AI/Voice settings shortcut. */
export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("help");
  const tf = await getTranslations("footer");
  const ta = await getTranslations("ai.tools");
  return (
    <div className="md-page" data-screen="SCR-181">
      <div className="md-stack">
        <h1 className="md-h1">{t("title")}</h1>
        <p className="md-lead">{t("intro")}</p>
      </div>

      <section className="md-section" aria-labelledby="help-voice">
        <h2 id="help-voice" className="md-h3">
          {t("voiceTitle")}
        </h2>
        <p>{t("voiceBody")}</p>
        <VoiceButton />
        <div className="mj-actions">
          <Link
            href="/settings"
            className={buttonClassName({ variant: "secondary" })}
            data-testid="help-settings-link"
          >
            <SlidersHorizontal aria-hidden="true" size={16} />
            <span>{t("openSettingsCta")}</span>
          </Link>
        </div>
      </section>

      <section className="md-section" aria-labelledby="help-contact">
        <h2 id="help-contact" className="md-h3">
          {t("contactTitle")}
        </h2>
        <div className="md-info-card">
          <p>{t("govHelpdesk")}</p>
          <a className="md-link md-email" href={`mailto:${GOV_HELPDESK_EMAIL}`}>
            {GOV_HELPDESK_EMAIL}
          </a>
        </div>
        <div className="md-info-card">
          <p>{t("ourGrievance")}</p>
          <a className="md-link md-email" href={`mailto:${GRIEVANCE_EMAIL}`}>
            {GRIEVANCE_EMAIL}
          </a>
          <Link href="/grievance" className="md-link">
            {tf("grievance")}
          </Link>
        </div>
      </section>

      <section className="md-section">
        <Banner tone="caution" title={t("scamTitle")} role="note">
          {t("scamBody")}
        </Banner>
        <Link href="/services/scam" className="md-link" data-testid="help-scam-link">
          {ta("scam.title")}
        </Link>
      </section>
    </div>
  );
}

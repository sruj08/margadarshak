import { AnimatedContent } from "@margdarshak/ui/components/animated-content";
import { SplitText } from "@margdarshak/ui/components/split-text";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WelcomeAck } from "@/components/onboarding/welcome-ack";
import { BrandMark } from "@/components/shell/brand-mark";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("welcome");
  return { title: t("title") };
}

/**
 * SCR-002 First-launch notice (MD-005, D-01, D-07): who we are and are not, before anything else.
 * Shown once per device; "Clear this device" brings it back. Re-viewable from the footer.
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("welcome");
  const tm = await getTranslations("meta");
  const tb = await getTranslations("brand");
  return (
    <div className="md-page md-page--narrow" data-screen="SCR-002">
      <section className="md-onboard" aria-labelledby="welcome-h1">
        <div className="md-hero__glow" aria-hidden="true" />
        <BrandMark name={tb("name")} locale={locale} variant="stacked" />
        <h1 id="welcome-h1" className="md-display">
          <SplitText text={tm("tagline")} delay={45} duration={0.6} splitType="words" />
        </h1>
        <h2 className="md-h3">{t("title")}</h2>
        <AnimatedContent delay={0.08} distance={14} duration={0.5}>
          <ul className="md-promises">
            <li>
              <StatusGlyph kind="done" size={24} />
              <span>{t("promise1")}</span>
            </li>
            <li>
              <StatusGlyph kind="done" size={24} />
              <span>{t("promise2")}</span>
            </li>
            <li>
              <StatusGlyph kind="done" size={24} />
              <span>{t("promise3")}</span>
            </li>
          </ul>
        </AnimatedContent>
        <WelcomeAck label={t("cta")} locale={locale} />
        <p className="md-footer__notice">{t("simulated")}</p>
        <p>
          <Link href="/grievance" className="md-link">
            {t("grievance")}
          </Link>
        </p>
      </section>
    </div>
  );
}

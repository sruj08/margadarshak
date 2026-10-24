import "@/components/journey/journey.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/journey/status";
import { enterLocale } from "@/i18n/page-locale";
import { NOTICE_VERSION } from "@/lib/journey/constants";
import { GRIEVANCE_EMAIL } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notice");
  return { title: t("h1") };
}

const SECTIONS = [
  "who",
  "collect",
  "never",
  "why",
  "ai",
  "family",
  "processors",
  "kept",
  "rights",
  "complain",
] as const;

/**
 * Privacy notice (MD-135, PRIVACY.md §5): short sentences, the "built to the DPDP Rules" wording,
 * the children's data position (family mode with verifiable parental consent; no tracking or ads
 * on a child's data), and Google and Sarvam listed as disclosed processors. Versioned.
 */
export default async function NoticePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("notice");
  return (
    <div className="md-page" data-screen="SCR-150-NOTICE">
      <article className="mj-screen">
        <BackLink href="/privacy">{t("back")}</BackLink>
        <header className="mj-head">
          <h1 className="mj-title">{t("h1")}</h1>
          <p className="mj-sub">{t("lead")}</p>
          <p className="mj-caption">{t("version", { version: NOTICE_VERSION })}</p>
        </header>
        {SECTIONS.map((s) => (
          <section key={s} className="mj-card" aria-labelledby={`nt-${s}`}>
            <h2 id={`nt-${s}`} className="mj-h2">
              {t(`${s}.title`)}
            </h2>
            <p>{t(`${s}.body`, { email: GRIEVANCE_EMAIL })}</p>
          </section>
        ))}
      </article>
    </div>
  );
}

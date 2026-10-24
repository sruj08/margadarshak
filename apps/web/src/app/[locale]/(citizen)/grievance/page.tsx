import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { enterLocale } from "@/i18n/page-locale";
import { GOV_HELPDESK_EMAIL, GRIEVANCE_EMAIL } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("grievance");
  return { title: t("title") };
}

/** Grievance officer (IT Rules 2021 Rule 3(2); DPDP Rules Rule 9). Linked from every footer (MD-005). */
export default async function GrievancePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("grievance");
  return (
    <div className="md-page md-prose" data-screen="SCR-GRV">
      <h1 className="md-h1">{t("title")}</h1>
      <p className="md-lead">{t("body")}</p>
      <div className="md-info-card">
        <p className="md-h3">{t("officer")}</p>
        <p>{t("emailLabel")}</p>
        <a className="md-link md-email" href={`mailto:${GRIEVANCE_EMAIL}`}>
          {GRIEVANCE_EMAIL}
        </a>
      </div>
      <p>{t("board")}</p>
      <div className="md-info-card">
        <p>{t("notGov")}</p>
        <a className="md-link md-email" href={`mailto:${GOV_HELPDESK_EMAIL}`}>
          {GOV_HELPDESK_EMAIL}
        </a>
      </div>
    </div>
  );
}

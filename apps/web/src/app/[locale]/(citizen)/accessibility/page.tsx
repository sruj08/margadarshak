import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accessibility");
  return { title: t("title") };
}

/** Accessibility statement (ACCESSIBILITY §10 template). Never "certified" or "fully accessible". */
export default async function AccessibilityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  const t = await getTranslations("accessibility");
  const tf = await getTranslations("footer");
  return (
    <div className="md-page md-prose" data-screen="SCR-A11Y">
      <h1 className="md-h1">{t("title")}</h1>
      <p className="md-lead">{t("body")}</p>
      <p>{t("canDo")}</p>
      <p>{t("known")}</p>
      <p>{t("tell")}</p>
      <p>
        <Link href="/grievance" className="md-link">
          {tf("grievance")}
        </Link>
      </p>
    </div>
  );
}

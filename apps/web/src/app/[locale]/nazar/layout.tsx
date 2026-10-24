import "@/features/study/study.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = await enterLocale(params);
  const t = await getTranslations({ locale, namespace: "study" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/**
 * Nazar field-study shell (`/nazar`, the QR target; FIELD_STUDY §4, UI_SPEC_LEARN_GAMES §5.1): a
 * small header and the page, no citizen tab bar. The non-affiliation footer comes from
 * `[locale]/layout.tsx`. Server component with no client imports.
 */
export default async function NazarStudyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  const t = await getTranslations("study");
  return (
    <>
      <header className="st-top">
        <Link href="/nazar" className="st-top__brand">
          {t("brand")}
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="md-main st-main">
        {children}
      </main>
    </>
  );
}

import "@/features/curator/curator.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AdminGate } from "@/features/curator/AdminGate";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = await enterLocale(params);
  const t = await getTranslations({ locale, namespace: "curator" });
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false, nocache: true },
  };
}

/**
 * Clip admin shell (plan D4, UI_SPEC_LEARN_GAMES §12): no citizen top bar or tabs; never indexed
 * (meta robots here, X-Robots-Tag in next.config). Every screen sits behind AdminGate (admin scope);
 * the API checks the scope again on every call. The non-affiliation footer comes from
 * `[locale]/layout.tsx`.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  const t = await getTranslations("curator");
  return (
    <>
      <header className="cu-top">
        <nav aria-label={t("nav.label")} className="cu-top__nav">
          <span className="cu-top__brand">{t("brand")}</span>
          <Link href="/admin/clips" className="cu-top__link">
            {t("nav.board")}
          </Link>
          <Link href="/admin/clips/generate" className="cu-top__link">
            {t("nav.generate")}
          </Link>
          <Link href="/admin/clips/new" className="cu-top__link">
            {t("nav.register")}
          </Link>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="md-main cu-main">
        <AdminGate>{children}</AdminGate>
      </main>
    </>
  );
}

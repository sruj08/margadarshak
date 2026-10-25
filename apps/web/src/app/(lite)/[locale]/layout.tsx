import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { isAppLocale, routing } from "@/i18n/routing";

/**
 * Lite mode shell (FRONTEND §9, EC-19, F-51): `/[locale]/lite/…`. A separate root layout so none of
 * the full app's client framework (providers, HeroUI runtime, the message catalogue) loads: server
 * HTML, system fonts, plain links. Keeps the non-affiliation footer on every page (D-01, D-19).
 * Only `/lite/learn/**` lives here for now; other Lite routes can join this group.
 */

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isAppLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  return { title: { default: t("title"), template: t("titleTemplate", { page: "%s" }) } };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function LiteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("footer");
  const tl = await getTranslations("learnHub.lite");
  return (
    <html lang={locale} dir="ltr" data-theme="light" className="light" suppressHydrationWarning>
      <body
        className="md-body"
        style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
      >
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <a href="#main" className="md-skip">
          {tl("skip")}
        </a>
        <header
          className="md-page"
          style={{
            paddingBottom: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <a href={`/${locale}/lite/learn`} className="md-link">
            Margdarshak · {tl("badge")}
          </a>
          <a href={`/${locale}/learn`} className="md-link">
            {tl("full")}
          </a>
        </header>
        <main id="main" tabIndex={-1} className="md-main">
          {children}
        </main>
        <footer className="md-footer" data-testid="non-affiliation-footer">
          <div className="md-footer__inner">
            <p className="md-footer__notice">{t("notAffiliated")}</p>
            <p>
              <a className="md-footer__link" href={`/${locale}/privacy`}>
                {t("privacy")}
              </a>{" "}
              ·{" "}
              <a className="md-footer__link" href={`/${locale}/grievance`}>
                {t("grievance")}
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

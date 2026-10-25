import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Providers } from "@/components/shell/providers";
import { SiteFooter } from "@/components/shell/site-footer";
import { routing } from "@/i18n/routing";
import { fontVariables } from "../fonts";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: { default: t("title"), template: t("titleTemplate", { page: "%s" }) },
    description: t("description"),
    applicationName: t("title"),
    appleWebApp: { capable: true, title: t("title"), statusBarStyle: "default" },
    formatDetection: { telephone: false },
    icons: {
      icon: [{ url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
      apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180" }],
    },
    alternates: { languages: { en: "/en", hi: "/hi" } },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout viewport, so dvh-bounded sheets keep their inputs in view.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0f" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("a11y");

  return (
    <html lang={locale} dir="ltr" className={fontVariables} suppressHydrationWarning>
      <body className="md-body">
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <a href="#main" className="md-skip">
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <Providers locale={locale}>
            {children}
            <SiteFooter />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import { Banner } from "@margdarshak/ui/components/banner";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offline");
  return { title: t("title") };
}

/** Offline fallback (MC-121). Precached by the service worker for both locales. */
export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("offline");
  return (
    <div className="md-page md-stack" data-screen="SCR-171">
      <h1 className="md-h1">{t("title")}</h1>
      <Banner tone="offline" title={t("body")} />
      <Link href="/" className={buttonClassName({ variant: "primary", size: "lg" })}>
        {t("retry")}
      </Link>
    </div>
  );
}

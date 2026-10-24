import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { getTranslations } from "next-intl/server";
import { TopBar } from "@/components/shell/top-bar";
import { Link } from "@/i18n/navigation";

/** 404 inside a locale (MC-126). The locale layout adds the non-affiliation footer. */
export default async function LocaleNotFound() {
  const t = await getTranslations("notFound");
  return (
    <>
      <TopBar minimal />
      <main id="main" tabIndex={-1} className="md-main">
        <div className="md-page" data-screen="SCR-404">
          <EmptyState
            as="h1"
            title={t("title")}
            line={t("body")}
            action={
              <Link href="/" className={buttonClassName({ variant: "primary", size: "lg" })}>
                {t("cta")}
              </Link>
            }
          />
        </div>
      </main>
    </>
  );
}

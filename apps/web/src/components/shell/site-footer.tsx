import { formatIsoDate } from "@margdarshak/ui/lib/format";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SITE_UPDATED } from "@/lib/site";
import { BrandMark } from "./brand-mark";

/**
 * Non-affiliation footer (C-04, MD-005, D-01): on every page, every theme, including errors and the
 * 404. The text is MC-001 verbatim. Links are 48 px tall so they pass the target-size check.
 */
export async function SiteFooter({ compact = false }: { compact?: boolean }) {
  const t = await getTranslations("footer");
  const tb = await getTranslations("brand");
  const locale = await getLocale();
  const updated = formatIsoDate(SITE_UPDATED, locale, "long");
  return (
    <footer className="md-footer" data-testid="non-affiliation-footer">
      <div className="md-footer__inner">
        <BrandMark name={tb("name")} locale={locale} />
        <p className="md-footer__notice">{t("notAffiliated")}</p>
        {compact ? null : (
          <ul className="md-footer__links">
            <li>
              <Link href="/settings" className="md-footer__link">
                {t("settings")}
              </Link>
            </li>
            <li>
              <Link href="/welcome" className="md-footer__link">
                {t("about")}
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="md-footer__link">
                {t("privacy")}
              </Link>
            </li>
            <li>
              <Link href="/grievance" className="md-footer__link">
                {t("grievance")}
              </Link>
            </li>
            <li>
              <Link href="/accessibility" className="md-footer__link">
                {t("accessibility")}
              </Link>
            </li>
          </ul>
        )}
        <p className="md-footer__meta">{t("updated", { date: updated })}</p>
      </div>
    </footer>
  );
}

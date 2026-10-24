"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Settings2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { BrandMark } from "./brand-mark";
import { SettingsSheet } from "./settings-sheet";

/**
 * TopBar (UI_SPEC_JOURNEY §1.1): wordmark, हि / EN switch, settings. 56 px tall, canvas-tinted with a
 * hairline; the language switch is two links so it works without JavaScript and keeps the page.
 */
export function TopBar({ minimal = false }: { minimal?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="md-topbar">
      <div className="md-topbar__inner">
        <Link href="/" className="md-topbar__brand" aria-label={t("brand.homeLink")}>
          <BrandMark name={t("brand.name")} locale={locale} />
        </Link>
        <div className="md-topbar__actions">
          <nav aria-label={t("topbar.language")} className="md-langswitch">
            <Link
              href={pathname}
              locale="hi"
              lang="hi"
              hrefLang="hi"
              className="md-langswitch__opt"
              aria-current={locale === "hi" ? "true" : undefined}
            >
              हि<span className="md-sr-only"> · {t("topbar.switchToHindi")}</span>
            </Link>
            <Link
              href={pathname}
              locale="en"
              lang="en"
              hrefLang="en"
              className="md-langswitch__opt"
              aria-current={locale === "en" ? "true" : undefined}
            >
              EN<span className="md-sr-only"> · {t("topbar.switchToEnglish")}</span>
            </Link>
          </nav>
          {minimal ? null : (
            <Button
              variant="ghost"
              isIconOnly
              aria-label={t("topbar.settings")}
              className="md-topbar__settings"
              onPress={() => setSettingsOpen(true)}
            >
              <Settings2 aria-hidden="true" strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </div>
      {minimal ? null : <SettingsSheet isOpen={settingsOpen} onOpenChange={setSettingsOpen} />}
    </header>
  );
}

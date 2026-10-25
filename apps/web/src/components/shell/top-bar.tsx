"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Moon, Settings2, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { type AppLocale, isAppLocale, LANGUAGE_META } from "@/i18n/routing";
import { BrandMark } from "./brand-mark";
import { usePrefs } from "./providers";
import { SettingsSheet } from "./settings-sheet";

const TOPBAR_LANG_PILLS: Record<AppLocale, string> = {
  hi: "हि",
  en: "EN",
  doi: "डो",
  pa: "ਪੰ",
  mr: "म",
  gu: "ગુ",
  ta: "த",
};

/**
 * TopBar (UI_SPEC_JOURNEY §1.1): wordmark, 7-language switch, Light/Dark theme toggle, and settings.
 * 56 px tall, canvas-tinted with a hairline; the language switch uses links so it keeps the page and theme.
 */
export function TopBar({ minimal = false }: { minimal?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const { prefs, setPrefs } = usePrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isDark = prefs.theme === "dark";
  const toggleTheme = () => {
    setPrefs({ theme: isDark ? "light" : "dark" });
  };

  return (
    <header className="md-topbar">
      <div className="md-topbar__inner">
        <Link href="/" className="md-topbar__brand" aria-label={t("brand.homeLink")}>
          <BrandMark name={t("brand.name")} locale={locale} compact />
        </Link>
        <div className="md-topbar__actions">
          <nav aria-label={t("topbar.language")} className="md-langswitch">
            {(locale !== "hi" && locale !== "en" && isAppLocale(locale)
              ? ([locale, "hi", "en"] as const)
              : (["hi", "en"] as const)
            ).map((code) => {
              const meta = LANGUAGE_META[code];
              const isCurrent = locale === code;
              return (
                <Link
                  key={code}
                  href={pathname}
                  locale={code}
                  lang={code}
                  hrefLang={code}
                  title={`${meta.nativeLabel} (${meta.englishLabel})`}
                  className="md-langswitch__opt"
                  aria-current={isCurrent ? "true" : undefined}
                >
                  {TOPBAR_LANG_PILLS[code]}
                  <span className="md-sr-only">
                    {" "}
                    · {meta.nativeLabel} ({meta.englishLabel})
                  </span>
                </Link>
              );
            })}
          </nav>
          <Button
            variant="ghost"
            isIconOnly
            aria-label={isDark ? t("settings.themeLight") : t("settings.themeDark")}
            aria-pressed={isDark}
            className="md-topbar__theme"
            onPress={toggleTheme}
          >
            {isDark ? (
              <Sun aria-hidden="true" strokeWidth={1.85} />
            ) : (
              <Moon aria-hidden="true" strokeWidth={1.85} />
            )}
          </Button>
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

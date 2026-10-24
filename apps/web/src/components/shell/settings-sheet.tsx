"use client";

import { Switch, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { clearThisDevice } from "@/lib/prefs/device";
import type { ThemePref } from "@/lib/prefs/prefs";
import { usePrefs } from "./providers";

/**
 * Settings sheet: appearance, high contrast, reduced motion, language, and "Clear this device"
 * (EC-14). Clearing asks once, with "Keep my data" listed first (equal weight, no confirm-shaming).
 */
export function SettingsSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("settings");
  const ta = useTranslations("a11y");
  const { prefs, setPrefs } = usePrefs();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const themes: { id: ThemePref; label: string; icon: React.ReactNode }[] = [
    { id: "system", label: t("themeSystem"), icon: <Monitor aria-hidden="true" size={18} /> },
    { id: "light", label: t("themeLight"), icon: <Sun aria-hidden="true" size={18} /> },
    { id: "dark", label: t("themeDark"), icon: <Moon aria-hidden="true" size={18} /> },
  ];

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) setConfirming(false);
        onOpenChange(open);
      }}
      title={t("title")}
      description={t("description")}
      closeLabel={ta("close")}
      footer={
        <Button variant="primary" size="lg" slot="close" className="md-settings__done">
          {t("done")}
        </Button>
      }
    >
      <div className="md-settings">
        <section className="md-settings__group" aria-labelledby="md-settings-appearance">
          <h3 id="md-settings-appearance" className="md-settings__heading">
            {t("appearance")}
          </h3>
          <ToggleButtonGroup
            aria-labelledby="md-settings-appearance"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([prefs.theme])}
            onSelectionChange={(keys) => {
              const [first] = [...keys];
              if (first === "system" || first === "light" || first === "dark") {
                setPrefs({ theme: first });
              }
            }}
            className="md-segmented"
          >
            {themes.map((th) => (
              <ToggleButton key={th.id} id={th.id} className="md-segmented__opt">
                {th.icon}
                <span>{th.label}</span>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </section>

        <section className="md-settings__group">
          <Switch
            isSelected={prefs.contrast}
            onChange={(v) => setPrefs({ contrast: v })}
            className="md-switch"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">{t("contrast")}</span>
                <span className="md-switch__hint">{t("contrastHint")}</span>
              </span>
              <Switch.Control className="md-switch__control">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          <Switch
            isSelected={prefs.reducedMotion}
            onChange={(v) => setPrefs({ reducedMotion: v })}
            className="md-switch"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">{t("motion")}</span>
                <span className="md-switch__hint">{t("motionHint")}</span>
              </span>
              <Switch.Control className="md-switch__control">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </section>

        <section className="md-settings__group" aria-labelledby="md-settings-language">
          <h3 id="md-settings-language" className="md-settings__heading">
            {t("language")}
          </h3>
          <Link href="/language" className={buttonClassName({ variant: "secondary" })}>
            {t("changeLanguage")}
          </Link>
        </section>

        <section
          className="md-settings__group md-settings__danger"
          aria-labelledby="md-settings-clear"
        >
          <h3 id="md-settings-clear" className="md-settings__heading">
            {t("clearTitle")}
          </h3>
          <p className="md-settings__hint">{confirming ? t("clearConfirm") : t("clearHint")}</p>
          {confirming ? (
            <div className="md-settings__row">
              <Button variant="secondary" onPress={() => setConfirming(false)}>
                {t("clearKeep")}
              </Button>
              <Button
                variant="danger"
                isPending={clearing}
                onPress={async () => {
                  setClearing(true);
                  await clearThisDevice();
                  window.location.assign("/");
                }}
              >
                {t("clearNow")}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onPress={() => setConfirming(true)}>
              {t("clearCta")}
            </Button>
          )}
        </section>
      </div>
    </Sheet>
  );
}

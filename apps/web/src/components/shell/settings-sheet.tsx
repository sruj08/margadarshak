"use client";

import { Switch, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { ArrowRight, Mic, Monitor, Moon, Sparkles, Sun, Volume2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { APP_LOCALES, LANGUAGE_META } from "@/i18n/routing";
import { changeConsent, listConsents } from "@/lib/journey/api";
import { clearThisDevice, rememberLanguage } from "@/lib/prefs/device";
import type { ThemePref } from "@/lib/prefs/prefs";
import { usePrefs } from "./providers";

const COACH_VOICE_KEY = "md.coach.voice";

/**
 * Settings sheet: AI Coach & Voice Commands, appearance, high contrast, reduced motion,
 * language, link to the full /settings hub, and "Clear this device" (EC-14).
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
  const locale = useLocale();
  const pathname = usePathname();
  const { prefs, setPrefs } = usePrefs();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [aiCoachOn, setAiCoachOn] = useState(false);
  const [aiVoiceOn, setAiVoiceOn] = useState(false);
  const [coachSpeakOn, setCoachSpeakOn] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadAiConsents = async () => {
    try {
      const r = await listConsents();
      setAiCoachOn(r.data.some((c) => c.purpose === "ai_coach" && c.status === "active"));
      setAiVoiceOn(r.data.some((c) => c.purpose === "ai_voice" && c.status === "active"));
    } catch {
      /* ignore */
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when sheet opens
  useEffect(() => {
    if (!isOpen) return;
    try {
      setCoachSpeakOn(window.localStorage.getItem(COACH_VOICE_KEY) !== "off");
    } catch {
      /* private mode */
    }
    void loadAiConsents();
  }, [isOpen]);

  async function toggleAiConsent(purpose: "ai_coach" | "ai_voice", on: boolean) {
    setBusyKey(purpose);
    if (purpose === "ai_coach") setAiCoachOn(on);
    if (purpose === "ai_voice") setAiVoiceOn(on);
    try {
      await changeConsent(purpose, on ? "grant" : "revoke");
      await loadAiConsents();
    } catch {
      if (purpose === "ai_coach") setAiCoachOn(!on);
      if (purpose === "ai_voice") setAiVoiceOn(!on);
    } finally {
      setBusyKey(null);
    }
  }

  function toggleCoachSpeak(on: boolean) {
    setCoachSpeakOn(on);
    try {
      window.localStorage.setItem(COACH_VOICE_KEY, on ? "on" : "off");
    } catch {
      /* private mode */
    }
  }

  async function enableAllAiAndVoice() {
    setBusyKey("all");
    toggleCoachSpeak(true);
    setAiCoachOn(true);
    setAiVoiceOn(true);
    try {
      await changeConsent("ai_coach", "grant");
      await changeConsent("ai_voice", "grant");
      await loadAiConsents();
    } catch {
      /* ignore */
    } finally {
      setBusyKey(null);
    }
  }

  const allAiActive = aiCoachOn && aiVoiceOn && coachSpeakOn;

  const themes: { id: ThemePref; label: string; icon: React.ReactNode }[] = [
    { id: "light", label: t("themeLight"), icon: <Sun aria-hidden="true" size={18} /> },
    { id: "dark", label: t("themeDark"), icon: <Moon aria-hidden="true" size={18} /> },
    { id: "system", label: t("themeSystem"), icon: <Monitor aria-hidden="true" size={18} /> },
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
        <section
          className="md-settings__group md-settings__ai-box"
          aria-labelledby="md-settings-ai"
          data-testid="sheet-ai-controls"
        >
          <div className="md-settings__ai-head">
            <h3 id="md-settings-ai" className="md-settings__heading">
              <Sparkles aria-hidden="true" size={16} />
              <span>{t("aiSectionTitle")}</span>
            </h3>
            {!allAiActive ? (
              <Button
                variant="primary"
                size="md"
                isDisabled={busyKey !== null}
                onPress={enableAllAiAndVoice}
                data-testid="sheet-enable-all-ai"
              >
                {t("enableAllAi")}
              </Button>
            ) : null}
          </div>
          <p className="md-settings__hint">{t("aiSectionLead")}</p>

          <Switch
            isSelected={aiCoachOn}
            isDisabled={busyKey === "ai_coach" || busyKey === "all"}
            onChange={(v) => toggleAiConsent("ai_coach", v)}
            className="md-switch"
            data-testid="sheet-consent-ai_coach"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">
                  <Sparkles aria-hidden="true" size={15} /> {t("aiCoachLabel")}
                </span>
                <span className="md-switch__hint">{t("aiCoachHint")}</span>
              </span>
              <Switch.Control className="md-switch__control">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>

          <Switch
            isSelected={aiVoiceOn}
            isDisabled={busyKey === "ai_voice" || busyKey === "all"}
            onChange={(v) => toggleAiConsent("ai_voice", v)}
            className="md-switch"
            data-testid="sheet-consent-ai_voice"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">
                  <Mic aria-hidden="true" size={15} /> {t("aiVoiceLabel")}
                </span>
                <span className="md-switch__hint">{t("aiVoiceHint")}</span>
              </span>
              <Switch.Control className="md-switch__control">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>

          <Switch
            isSelected={coachSpeakOn}
            onChange={toggleCoachSpeak}
            className="md-switch"
            data-testid="sheet-coach-voice"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">
                  <Volume2 aria-hidden="true" size={15} /> {t("coachSpeakLabel")}
                </span>
                <span className="md-switch__hint">{t("coachSpeakHint")}</span>
              </span>
              <Switch.Control className="md-switch__control">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>

          <Link
            href="/settings"
            onClick={() => onOpenChange(false)}
            className={buttonClassName({ variant: "secondary" })}
            data-testid="sheet-open-full-settings"
          >
            <span>{t("openFullSettings")}</span>
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </section>

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
          <div className="md-settings__lang-grid">
            {APP_LOCALES.map((code) => {
              const meta = LANGUAGE_META[code];
              const active = locale === code;
              return (
                <Link
                  key={code}
                  href={pathname}
                  locale={code}
                  lang={code}
                  onClick={() => {
                    rememberLanguage(code);
                    onOpenChange(false);
                  }}
                  aria-current={active ? "true" : undefined}
                  className={buttonClassName({ variant: active ? "primary" : "secondary" })}
                >
                  <span>{meta.nativeLabel}</span>
                </Link>
              );
            })}
          </div>
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

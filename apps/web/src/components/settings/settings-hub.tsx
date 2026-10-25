"use client";

import { Switch, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { BlurText } from "@margdarshak/ui/components/blur-text";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Chip } from "@margdarshak/ui/components/chip";
import { SplitText } from "@margdarshak/ui/components/split-text";
import {
  ArrowRight,
  Bell,
  Camera,
  CheckCircle2,
  FileSearch,
  Globe,
  Mic,
  Monitor,
  Moon,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { VoiceButton } from "@/components/home/voice-sheet";
import { usePrefs } from "@/components/shell/providers";
import { Link, usePathname } from "@/i18n/navigation";
import { APP_LOCALES, LANGUAGE_META } from "@/i18n/routing";
import { changeConsent, listConsents } from "@/lib/journey/api";
import type { ConsentArtefact, ConsentPurpose } from "@/lib/journey/api-types";
import { clearThisDevice, rememberLanguage } from "@/lib/prefs/device";
import type { ThemePref } from "@/lib/prefs/prefs";

const COACH_VOICE_KEY = "md.coach.voice";

const REMINDER_PURPOSES = [
  "whatsapp_updates",
  "email_updates",
  "web_push",
] as const satisfies readonly ConsentPurpose[];

const SHARING_PURPOSES = [
  "helper_link",
  "school_share",
  "parent_card",
  "analytics",
  "field_study",
] as const satisfies readonly ConsentPurpose[];

export function SettingsHub() {
  const t = useTranslations("settings");
  const tp = useTranslations("purpose");
  const tpr = useTranslations("privacyCentre");
  const locale = useLocale();
  const pathname = usePathname();
  const { prefs, setPrefs } = usePrefs();

  const [consents, setConsents] = useState<ConsentArtefact[]>([]);
  const [coachSpeakOn, setCoachSpeakOn] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadConsents = async () => {
    try {
      const r = await listConsents();
      setConsents(r.data);
    } catch {
      /* ignore */
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    try {
      setCoachSpeakOn(window.localStorage.getItem(COACH_VOICE_KEY) !== "off");
    } catch {
      /* private mode */
    }
    void loadConsents();
  }, []);

  const isConsentActive = (p: ConsentPurpose) =>
    consents.some((c) => c.purpose === p && c.status === "active");

  const aiCoachOn = isConsentActive("ai_coach");
  const aiVoiceOn = isConsentActive("ai_voice");
  const allAiActive = aiCoachOn && aiVoiceOn && coachSpeakOn;

  async function onToggleConsent(purpose: ConsentPurpose, on: boolean) {
    setBusyKey(purpose);
    try {
      await changeConsent(purpose, on ? "grant" : "revoke");
      await loadConsents();
    } finally {
      setBusyKey(null);
    }
  }

  function onToggleCoachSpeak(on: boolean) {
    setCoachSpeakOn(on);
    try {
      window.localStorage.setItem(COACH_VOICE_KEY, on ? "on" : "off");
    } catch {
      /* private mode */
    }
  }

  async function onEnableAllAi() {
    setBusyKey("all_ai");
    onToggleCoachSpeak(true);
    try {
      await changeConsent("ai_coach", "grant");
      await changeConsent("ai_voice", "grant");
      await loadConsents();
    } finally {
      setBusyKey(null);
    }
  }

  const themes: { id: ThemePref; label: string; icon: React.ReactNode }[] = [
    { id: "light", label: t("themeLight"), icon: <Sun aria-hidden="true" size={18} /> },
    { id: "dark", label: t("themeDark"), icon: <Moon aria-hidden="true" size={18} /> },
    { id: "system", label: t("themeSystem"), icon: <Monitor aria-hidden="true" size={18} /> },
  ];

  return (
    <div className="mj-screen" data-screen="SCR-SETTINGS" data-testid="settings-hub">
      <header className="mj-head">
        <h1 className="mj-title">
          <SplitText text={t("pageTitle")} delay={35} duration={0.5} splitType="words" />
        </h1>
        <p className="mj-sub">
          <BlurText text={t("pageLead")} delay={25} duration={0.4} />
        </p>
      </header>

      {/* 1. AI COACH & VOICE COMMANDS */}
      <section
        className="mj-card md-settings-hub__ai-card"
        aria-labelledby="settings-ai-h"
        data-testid="settings-ai-section"
      >
        <div className="mj-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2
            id="settings-ai-h"
            className="mj-h2"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <Sparkles aria-hidden="true" size={20} />
            <span>{t("aiSectionTitle")}</span>
          </h2>
          {allAiActive ? (
            <Chip tone="success">
              <CheckCircle2 aria-hidden="true" size={14} /> {t("allAiEnabled")}
            </Chip>
          ) : (
            <Button
              variant="primary"
              size="md"
              isDisabled={busyKey !== null}
              onPress={onEnableAllAi}
              data-testid="settings-enable-all-ai"
            >
              <Sparkles aria-hidden="true" size={16} />
              <span>{t("enableAllAi")}</span>
            </Button>
          )}
        </div>
        <p className="mj-muted">{t("aiSectionLead")}</p>

        <div className="md-settings__group">
          <Switch
            isSelected={aiCoachOn}
            isDisabled={busyKey === "ai_coach" || busyKey === "all_ai"}
            onChange={(v) => onToggleConsent("ai_coach", v)}
            className="md-switch"
            data-testid="settings-consent-ai_coach"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">
                  <Sparkles aria-hidden="true" size={16} /> {t("aiCoachLabel")}
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
            isDisabled={busyKey === "ai_voice" || busyKey === "all_ai"}
            onChange={(v) => onToggleConsent("ai_voice", v)}
            className="md-switch"
            data-testid="settings-consent-ai_voice"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">
                  <Mic aria-hidden="true" size={16} /> {t("aiVoiceLabel")}
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
            onChange={onToggleCoachSpeak}
            className="md-switch"
            data-testid="settings-coach-voice"
          >
            <Switch.Content className="md-switch__row">
              <span className="md-switch__text">
                <span className="md-switch__label">
                  <Volume2 aria-hidden="true" size={16} /> {t("coachSpeakLabel")}
                </span>
                <span className="md-switch__hint">{t("coachSpeakHint")}</span>
              </span>
              <Switch.Control className="md-switch__control">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>

        <div className="md-settings-hub__tools">
          <h3 className="md-settings__heading">{t("aiToolsTitle")}</h3>
          <VoiceButton />
          <div className="mj-actions">
            <Link href="/learn" className={buttonClassName({ variant: "secondary" })}>
              <Sparkles aria-hidden="true" size={16} />
              <span>{t("aiToolCoach")}</span>
            </Link>
            <Link href="/learn/signs/snap" className={buttonClassName({ variant: "secondary" })}>
              <Camera aria-hidden="true" size={16} />
              <span>{t("aiToolSnap")}</span>
            </Link>
            <Link href="/services/decode" className={buttonClassName({ variant: "secondary" })}>
              <FileSearch aria-hidden="true" size={16} />
              <span>{t("aiToolDecode")}</span>
            </Link>
            <Link href="/services/scam" className={buttonClassName({ variant: "secondary" })}>
              <ShieldAlert aria-hidden="true" size={16} />
              <span>{t("aiToolScam")}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 2. APPEARANCE, DISPLAY & LANGUAGE */}
      <section
        className="mj-card"
        aria-labelledby="settings-appearance-h"
        data-testid="settings-appearance-section"
      >
        <h2
          id="settings-appearance-h"
          className="mj-h2"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <Sun aria-hidden="true" size={18} />
          <span>
            {t("appearance")} & {t("language")}
          </span>
        </h2>
        <p className="mj-muted">{t("description")}</p>

        <ToggleButtonGroup
          aria-labelledby="settings-appearance-h"
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

        <div className="md-settings__group">
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
        </div>

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
                onClick={() => rememberLanguage(code)}
                aria-current={active ? "true" : undefined}
                className={buttonClassName({ variant: active ? "primary" : "secondary" })}
              >
                <span>{meta.nativeLabel}</span>
                {meta.englishLabel !== meta.nativeLabel ? (
                  <span style={{ opacity: 0.78, fontSize: "0.85em" }}>· {meta.englishLabel}</span>
                ) : null}
              </Link>
            );
          })}
        </div>

        <div className="mj-actions">
          <Link href="/language" className={buttonClassName({ variant: "secondary" })}>
            <Globe aria-hidden="true" size={16} />
            <span>{t("changeLanguage")}</span>
          </Link>
        </div>
      </section>

      {/* 3. REMINDERS & NOTIFICATIONS */}
      <section
        className="mj-card"
        aria-labelledby="settings-reminders-h"
        data-testid="settings-reminders-section"
      >
        <h2
          id="settings-reminders-h"
          className="mj-h2"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <Bell aria-hidden="true" size={18} />
          <span>{t("remindersSectionTitle")}</span>
        </h2>
        <p className="mj-muted">{t("remindersSectionLead")}</p>
        <div className="md-settings__group">
          {REMINDER_PURPOSES.map((p) => {
            const on = isConsentActive(p);
            return (
              <Switch
                key={p}
                isSelected={on}
                isDisabled={busyKey === p}
                onChange={(v) => onToggleConsent(p, v)}
                className="md-switch"
                data-testid={`settings-consent-${p}`}
              >
                <Switch.Content className="md-switch__row">
                  <span className="md-switch__text">
                    <span className="md-switch__label">{tp(`${p}.name`)}</span>
                    <span className="md-switch__hint">{tp(`${p}.ask`)}</span>
                  </span>
                  <Switch.Control className="md-switch__control">
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            );
          })}
        </div>
      </section>

      {/* 4. SHARING & STUDY PERMISSIONS */}
      <section
        className="mj-card"
        aria-labelledby="settings-sharing-h"
        data-testid="settings-sharing-section"
      >
        <h2
          id="settings-sharing-h"
          className="mj-h2"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <Share2 aria-hidden="true" size={18} />
          <span>{t("sharingSectionTitle")}</span>
        </h2>
        <p className="mj-muted">{t("sharingSectionLead")}</p>
        <div className="md-settings__group">
          {SHARING_PURPOSES.map((p) => {
            const on = isConsentActive(p);
            return (
              <Switch
                key={p}
                isSelected={on}
                isDisabled={busyKey === p}
                onChange={(v) => onToggleConsent(p, v)}
                className="md-switch"
                data-testid={`settings-consent-${p}`}
              >
                <Switch.Content className="md-switch__row">
                  <span className="md-switch__text">
                    <span className="md-switch__label">{tp(`${p}.name`)}</span>
                    <span className="md-switch__hint">{tp(`${p}.ask`)}</span>
                  </span>
                  <Switch.Control className="md-switch__control">
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            );
          })}
        </div>
      </section>

      {/* 5. PRIVACY, EXPORT & CLEAR THIS DEVICE */}
      <section
        className="mj-card"
        aria-labelledby="settings-device-h"
        data-testid="settings-device-section"
      >
        <h2
          id="settings-device-h"
          className="mj-h2"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            {tpr("h1")} & {t("clearTitle")}
          </span>
        </h2>
        <p className="mj-muted">{t("clearHint")}</p>
        <div className="mj-actions">
          <Link href="/privacy" className={buttonClassName({ variant: "secondary" })}>
            <ShieldCheck aria-hidden="true" size={16} />
            <span>{t("openPrivacyCentre")}</span>
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
          {confirmingClear ? (
            <>
              <Button variant="secondary" onPress={() => setConfirmingClear(false)}>
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
            </>
          ) : (
            <Button variant="outline" onPress={() => setConfirmingClear(true)}>
              <Trash2 aria-hidden="true" size={16} />
              <span>{t("clearCta")}</span>
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

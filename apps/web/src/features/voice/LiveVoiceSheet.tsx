"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { Mic } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLiveVoice } from "./use-live-voice";

/**
 * Live voice guide (MD-314, VOICE.md §2): the orb, live captions of both sides (on by default; the
 * on-screen text is the answer, the audio only reads it), confirm cards for big jumps and form
 * values, the "mic on, not stored" chip, and a text box that drives the same agent. When the
 * guide is unavailable (no consent, flag off, cap, offline, mock) it calls onUnavailable and the
 * caller shows the plain text sheet instead (MD-316).
 */
export function LiveVoiceSheet({
  isOpen,
  onOpenChange,
  onUnavailable,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUnavailable: () => void;
}) {
  const t = useTranslations("voice");
  const ta = useTranslations("a11y");
  const locale = useLocale();
  // Dogri is voice input only (M-08): a toggle, not a UI locale.
  const [lang, setLang] = useState<"hi" | "en" | "doi">(locale === "hi" ? "hi" : "en");
  const router = useRouter();
  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );
  const v = useLiveVoice(lang, navigate);
  const [text, setText] = useState("");
  useEffect(() => {
    if (v.unavailable || v.phase === "failed") onUnavailable();
  }, [v.unavailable, v.phase, onUnavailable]);
  useEffect(() => {
    if (v.dogriDraft !== null) setText(v.dogriDraft);
  }, [v.dogriDraft]);

  const status =
    v.phase === "connecting"
      ? t("live.connecting")
      : v.phase === "live"
        ? t("live.listening")
        : t("live.textOnly");

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={status}
      closeLabel={ta("close")}
    >
      <div className="mj-screen" style={{ gap: 12 }} data-screen="SCR-005" data-testid="voice-live">
        <div className={`mj-voice__orb mj-voice__orb--${v.phase}`} aria-hidden="true">
          <Mic size={32} strokeWidth={1.75} />
        </div>
        {v.phase === "live" ? (
          <details className="mj-chip" data-testid="voice-mic-chip">
            <summary>{t("live.micChip")}</summary>
            <p className="mj-caption">{t("live.micChipLine")}</p>
          </details>
        ) : null}
        <p className="mj-caption">{t("boundary")}</p>
        <Button
          variant="secondary"
          onPress={() => setLang(lang === "doi" ? (locale === "hi" ? "hi" : "en") : "doi")}
          aria-pressed={lang === "doi"}
          data-testid="voice-dogri-toggle"
        >
          {lang === "doi" ? t("live.leaveDogri") : t("live.useDogri")}
        </Button>

        <ol
          className="mj-captions"
          aria-live="polite"
          aria-label={t("title")}
          data-testid="voice-captions"
        >
          {v.captions.map((c) => (
            <li key={c.id} className={`mj-caption mj-caption--${c.who}`}>
              <strong>{c.who === "you" ? t("live.you") : t("live.guide")}:</strong> {c.text}
            </li>
          ))}
        </ol>

        {v.confirm.map((c) => (
          <fieldset key={c.actionId} className="mj-card mj-card--soft">
            <legend>
              {c.kind === "navigate" ? t("live.confirmOpen") : t("live.confirmField")}
            </legend>
            <p>
              <strong>{c.label}</strong>
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant="primary"
                onPress={() => v.accept(c.actionId)}
                data-testid="voice-confirm-yes"
              >
                {t("live.yes")}
              </Button>
              <Button variant="secondary" onPress={() => v.reject(c.actionId)}>
                {t("live.no")}
              </Button>
            </div>
          </fieldset>
        ))}

        {v.blocked ? (
          <Banner tone="info" title={t("redactedTitle")} role="status">
            {t("live.blocked")}
          </Banner>
        ) : null}

        {lang === "doi" && v.phase !== "connecting" ? (
          <Button
            variant="secondary"
            size="lg"
            onPressStart={() => void v.holdStart()}
            onPressEnd={() => v.holdEnd()}
            data-testid="voice-dogri-hold"
          >
            <Mic aria-hidden="true" />
            {t("live.dogriPush")}
          </Button>
        ) : null}
        {v.dogriDraft !== null ? <p className="mj-caption">{t("live.dogriCheck")}</p> : null}

        <form
          className="mj-screen"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            v.sendText(text);
            setText("");
          }}
        >
          <label htmlFor="voice-text" className="md-field__label">
            {t("live.typeHere")}
          </label>
          <input
            id="voice-text"
            className="mj-input"
            value={text}
            maxLength={500}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            data-testid="voice-text"
          />
          <Button
            variant="primary"
            type="submit"
            isDisabled={text.trim() === "" || v.phase === "connecting"}
          >
            {t("live.send")}
          </Button>
        </form>
        <p className="mj-caption">{t("live.onScreenWins")}</p>
        <p className="mj-caption">{t("privacy")}</p>
      </div>
    </Sheet>
  );
}

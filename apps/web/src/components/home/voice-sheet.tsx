"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { INTENT_HREF, type Intent, routeIntent } from "@/lib/journey/intents";
import { redact } from "@/lib/redact/redact";

/**
 * Mic placeholder (SCR-003 "Or just tell us", MD-119). The voice guide arrives in P3; until then the
 * mic opens this sheet: it says so plainly, and offers a "tell us" box routed to the same intents.
 * Text is redacted on the device first (EC-20): Aadhaar-like numbers, OTPs and phone numbers are
 * removed, and we say why. Available to every user, including family mode (D-13 revised).
 */
export function VoiceButton() {
  const t = useTranslations("voice");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="mj-voice"
        onClick={() => setOpen(true)}
        data-testid="voice-open"
      >
        <span className="mj-voice__orb" aria-hidden="true">
          <Mic size={24} strokeWidth={1.75} />
        </span>
        <span className="mj-voice__text">
          <span className="mj-voice__title">{t("cta")}</span>
          <span className="mj-voice__line">{t("ctaLine")}</span>
        </span>
      </button>
      <VoiceSheet isOpen={open} onOpenChange={setOpen} />
    </>
  );
}

export function VoiceSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("voice");
  const ta = useTranslations("a11y");
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [redacted, setRedacted] = useState(false);
  const chips = [t("chip1"), t("chip2"), t("chip3")];

  const ask = (value: string) => {
    const r = redact(value);
    setRedacted(r.changed);
    setText(r.text);
    setIntent(routeIntent(r.text));
  };

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("comingSoon")}
      closeLabel={ta("close")}
    >
      <div className="mj-screen" style={{ gap: 14 }} data-screen="SCR-005">
        <p>{t("whatItWillDo")}</p>
        <p className="mj-muted">{t("boundary")}</p>
        <form
          className="mj-screen"
          style={{ gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <div className="mj-input-group">
            <label htmlFor="tell-us" className="md-field__label">
              {t("tellUs")}
            </label>
            <input
              id="tell-us"
              className="mj-input"
              value={text}
              autoComplete="off"
              onChange={(e) => {
                setText(e.target.value);
                setIntent(null);
              }}
              data-testid="tell-us"
            />
          </div>
          <fieldset className="mj-chips" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="md-sr-only">{t("examples")}</legend>
            {chips.map((c) => (
              <Button
                key={c}
                variant="secondary"
                onPress={() => ask(c)}
                aria-label={t("askChip", { q: c })}
              >
                {c}
              </Button>
            ))}
          </fieldset>
          <Button variant="primary" size="lg" type="submit" isDisabled={text.trim() === ""}>
            {t("go")}
          </Button>
        </form>
        {redacted ? (
          <Banner tone="info" title={t("redactedTitle")} role="status">
            {t("redacted")}
          </Banner>
        ) : null}
        {intent ? (
          <div className="mj-card mj-card--soft" role="status" data-testid="intent-result">
            <p>{t(`intent.${intent}`)}</p>
            <Link
              href={INTENT_HREF[intent]}
              className={buttonClassName({ variant: "secondary", fullWidth: true })}
              onClick={() => onOpenChange(false)}
            >
              {t(`go_${intent}`)}
            </Link>
          </div>
        ) : null}
        <p className="mj-caption">{t("privacy")}</p>
      </div>
    </Sheet>
  );
}

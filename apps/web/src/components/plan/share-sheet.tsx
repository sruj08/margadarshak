"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { notify } from "@margdarshak/ui/components/toast";
import { Copy, MessageCircle, Share2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { CheckRow } from "@/components/journey/choices";
import { useOnline } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";

/**
 * Share the plan / "Show papa" card (SCR-017, MD-104 client side). "Send on WhatsApp" opens the
 * person's own WhatsApp through a wa.me link, so we collect no phone number. The link carries only
 * an age band, vehicles and state (never a date of birth). Reminders on our WhatsApp number are a
 * separate, unticked opt-in (F-53). A minor's plan needs the parent's consent before it is shared
 * (D-13 revised).
 */
export function ShareSheet({
  isOpen,
  onOpenChange,
  summary,
  link,
  minor,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  summary: {
    classes: string;
    fee: string;
    date: string;
    steps: number;
    visits: number;
    docs: string;
  };
  link: string;
  minor: boolean;
}) {
  const t = useTranslations("share");
  const ta = useTranslations("a11y");
  const locale = useLocale();
  const online = useOnline();
  const [parentOk, setParentOk] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const blocked = minor && !parentOk;
  const text = t("waText", {
    classes: summary.classes,
    fee: summary.fee,
    date: summary.date,
    link,
  });
  const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify(t("copied"), { tone: "success" });
    } catch {
      notify(t("copyFailed"));
    }
  };
  const nativeShare = async () => {
    try {
      await navigator.share({ title: t("cardTitle"), text, url: link });
    } catch {
      // dismissed
    }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Sheet isOpen={isOpen} onOpenChange={onOpenChange} title={t("title")} closeLabel={ta("close")}>
      <div className="mj-screen" style={{ gap: 16 }} data-screen="SCR-017">
        <figure
          className="mj-card mj-card--soft"
          style={{ margin: 0 }}
          aria-label={t("previewLabel")}
        >
          <p className="mj-eyebrow">{t("cardTitle")}</p>
          <p className="mj-h2">{summary.classes}</p>
          <p>
            {t("cardFee", { fee: summary.fee })} · {t("cardDate", { date: summary.date })}
          </p>
          <p className="mj-muted">
            {t("cardSteps", { steps: summary.steps, visits: summary.visits })}
          </p>
          <p className="mj-muted">{t("cardDocs", { docs: summary.docs })}</p>
          <p>
            <strong>{t("cardAgents")}</strong>
          </p>
          <p className="mj-caption">{t("cardMade")}</p>
        </figure>

        {minor ? (
          <CheckRow checked={parentOk} onChange={setParentOk} description={t("parentConsentDesc")}>
            {t("parentConsent")}
          </CheckRow>
        ) : null}

        <div className="mj-actions">
          {blocked || !online ? (
            <Button variant="primary" size="lg" isDisabled>
              <MessageCircle aria-hidden="true" />
              {online ? t("whatsapp") : t("needsInternet")}
            </Button>
          ) : (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
              data-testid="share-whatsapp"
            >
              <MessageCircle aria-hidden="true" />
              {t("whatsapp")}
              <span className="md-sr-only"> {ta("externalNewTab")}</span>
            </a>
          )}
          <div className="mj-inline-actions">
            <Button variant="secondary" isDisabled={blocked} onPress={() => void copy()}>
              <Copy aria-hidden="true" />
              {t("copyLink")}
            </Button>
            {canShare ? (
              <Button variant="secondary" isDisabled={blocked} onPress={() => void nativeShare()}>
                <Share2 aria-hidden="true" />
                {t("more")}
              </Button>
            ) : null}
          </div>
        </div>

        <CheckRow checked={optIn} onChange={setOptIn} description={t("optInDesc")}>
          {t("optIn")}
        </CheckRow>
        {optIn ? (
          <p>
            <Link href="/privacy#consent-whatsapp_updates" className="md-link">
              {t("optInNext")}
            </Link>
          </p>
        ) : null}
        <p className="mj-caption" lang={locale}>
          {t("noNumber")}
        </p>
      </div>
    </Sheet>
  );
}

"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CheckRow, ChoiceCards } from "@/components/journey/choices";
import { useFmt } from "@/components/journey/rule-source";
import { BackLink } from "@/components/journey/status";
import { Link, useRouter } from "@/i18n/navigation";
import { cacheCase, getActiveCase } from "@/lib/case/case-store";
import { useCaseSession } from "@/lib/case/use-case-session";
import { writeVault } from "@/lib/case/vault";
import { getCase, postEvent } from "@/lib/journey/api";
import type { CaseEventCreate } from "@/lib/journey/api-types";
import { addDays, daysBetween, istToday } from "@/lib/journey/dates";
import { track } from "@/lib/journey/track";
import { logEvent, recordScreen } from "@/lib/journey/trial-log";
import { PAY_STATUS_URL, SARATHI_URL } from "./handoff";

async function record(ev: CaseEventCreate): Promise<void> {
  const active = getActiveCase();
  if (!active) return;
  try {
    await postEvent(active.caseId, ev);
    const fresh = await getCase(active.caseId);
    cacheCase(fresh.data);
  } catch {
    // Offline: the outcome is kept on this screen; the person can record it again from My Licence.
  }
}

const OUTCOMES = ["paid", "pending", "failed", "stuck", "down", "not_yet"] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * Back from Sarathi (SCR-042, API-15): we cannot see Sarathi, so the person tells us in one tap and
 * the case moves on. Debited-but-pending goes to the EC-09 guidance; "Sarathi wasn't working" to the
 * EC-11 card.
 */
export function SarathiReturn() {
  const t = useTranslations("return");
  const tc = useTranslations("common");
  const tx = useTranslations("a11y");
  const router = useRouter();
  const [value, setValue] = useState<Outcome | null>(null);
  const [shown, setShown] = useState<Outcome | null>(null);
  const [error, setError] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    recordScreen("apply.return");
  }, []);

  const go = async () => {
    if (!value) {
      setError(true);
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    logEvent("select", "apply.return", value);
    const today = istToday();
    if (value === "paid") {
      await record({ type: "payment_confirmed", occurred_on: today });
      router.push("/apply/application-number");
    } else if (value === "pending") {
      track("payment_pending_reported");
      await record({ type: "payment_pending", occurred_on: today });
      router.push("/apply/payment-pending");
    } else if (value === "not_yet") {
      router.push("/apply/handoff");
    } else {
      setShown(value);
    }
  };

  return (
    <div className="mj-screen" data-screen="SCR-042">
      <BackLink href="/apply/handoff">{tc("back")}</BackLink>
      <h1 className="mj-title" id="ret-q">
        {t("h1")}
      </h1>
      {error ? (
        <div ref={errRef} tabIndex={-1} role="alert" className="mj-error-summary">
          <strong>{tc("problem")}</strong>
          <span>{t("errChoose")}</span>
        </div>
      ) : null}
      <ChoiceCards
        labelledBy="ret-q"
        value={value}
        onChange={(v) => {
          setValue(v as Outcome);
          setShown(null);
          setError(false);
        }}
        choices={OUTCOMES.map((o) => ({ id: o, label: t(`o.${o}`) }))}
      />
      {shown === "failed" ? (
        <Banner
          tone="info"
          title={t("failedTitle")}
          action={
            <a href={SARATHI_URL} target="_blank" rel="noopener noreferrer" className="md-link">
              {t("openSarathi")} <ArrowUpRight aria-hidden="true" size={18} />
              <span className="md-sr-only"> {tx("externalNewTab")}</span>
            </a>
          }
        >
          {t("failedBody")}
        </Banner>
      ) : null}
      {shown === "stuck" ? (
        <Banner
          tone="info"
          title={t("stuckTitle")}
          action={
            <Link href="/help" className="md-link">
              {t("stuckLink")}
            </Link>
          }
        >
          {t("stuckBody")}
        </Banner>
      ) : null}
      {shown === "down" ? (
        <Banner tone="caution" title={t("downTitle")}>
          {t("downBody")}
        </Banner>
      ) : null}
      <div className="mj-sticky mj-actions">
        <Button variant="primary" size="lg" onPress={() => void go()} data-testid="return-continue">
          {tc("continue")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Payment pending (SCR-043, MD-112, EC-09): stop double payment and cancellation, give the exact
 * next steps with dates computed from the payment day (Sarathi FAQ: visit the RTO cashier after
 * 3 days pending).
 */
export function PaymentPending() {
  const t = useTranslations("pending");
  const tx = useTranslations("a11y");
  const { date } = useFmt();
  const router = useRouter();
  const s = useCaseSession();
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    recordScreen("apply.payment_pending");
  }, []);
  const paidOn = s.caseData?.key_dates?.["payment_on"] ?? istToday();
  const day = Math.min(3, Math.max(1, daysBetween(paidOn, istToday()) + 1));
  const cashier = addDays(paidOn, 3);
  return (
    <div className="mj-screen" data-screen="SCR-043">
      <BackLink href="/apply/handoff/return">{t("back")}</BackLink>
      <Banner tone="caution" title={t("banner")} role="note" />
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("cancel")}</p>
      </header>
      <section className="mj-card" aria-labelledby="pp-what">
        <h2 id="pp-what" className="mj-h2">
          {t("whatTitle")}
        </h2>
        <ol className="mj-ol">
          <li>
            <span>
              {t("step1")}{" "}
              <a
                href={PAY_STATUS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="md-link"
              >
                {t("open")} <ArrowUpRight aria-hidden="true" size={18} />
                <span className="md-sr-only"> {tx("externalNewTab")}</span>
              </a>
            </span>
          </li>
          <li>{t("step2", { date: date(cashier, "long") })}</li>
          <li>{t("step3")}</li>
        </ol>
        <p className="mj-chips">
          <StatusGlyph kind="now" size={18} />
          <span data-testid="pending-day">{t("clock", { date: date(paidOn), day })}</span>
        </p>
      </section>
      <CheckRow checked={remind} onChange={setRemind} description={t("remindDesc")}>
        {t("remind", { date: date(cashier) })}
      </CheckRow>
      {remind ? (
        <p>
          <Link href="/privacy#consent-whatsapp_updates" className="md-link">
            {t("remindNext")}
          </Link>
        </p>
      ) : null}
      <p className="mj-caption">{t("source")}</p>
      <div className="mj-sticky mj-actions">
        <Button
          variant="primary"
          size="lg"
          isPending={busy}
          onPress={async () => {
            setBusy(true);
            await record({ type: "payment_confirmed", occurred_on: istToday() });
            router.push("/apply/application-number");
          }}
        >
          {t("cta")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Application number (SCR-044): kept on this phone only (Sarathi uses 10/15/16/20-digit numbers on
 * different screens and people lose them). The server sees at most the last 4 digits.
 */
export function ApplicationNumber() {
  const t = useTranslations("appNumber");
  const router = useRouter();
  const [value, setValue] = useState("");
  useEffect(() => {
    recordScreen("apply.application_number");
  }, []);
  const save = async () => {
    const active = getActiveCase();
    const digits = value.replace(/\s/g, "");
    if (active && digits) await writeVault(active.caseId, { application_number: digits });
    router.push("/");
  };
  return (
    <div className="mj-screen" data-screen="SCR-044">
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      <div className="mj-input-group">
        <label htmlFor="app-no" className="md-field__label">
          {t("label")}
        </label>
        <input
          id="app-no"
          className="mj-input mj-num"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d ]/g, ""))}
          aria-describedby="app-no-hint"
        />
        <p id="app-no-hint" className="md-field__hint">
          {t("hint")}
        </p>
      </div>
      <div className="mj-actions">
        <Button
          variant="primary"
          size="lg"
          onPress={() => void save()}
          data-testid="app-number-save"
        >
          {t("save")}
        </Button>
        <Link href="/" className={buttonClassName({ variant: "tertiary", fullWidth: true })}>
          {t("skip")}
        </Link>
      </div>
    </div>
  );
}

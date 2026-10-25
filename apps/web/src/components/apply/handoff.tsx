"use client";

import { adapterProvenance } from "@margdarshak/api-client";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { SimulatedChip } from "@margdarshak/ui/components/simulated-chip";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { ArrowUpRight, ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useFmt } from "@/components/journey/rule-source";
import { BackLink, SarathiStatusBanner, useOnline } from "@/components/journey/status";
import { FeeBreakdown } from "@/components/plan/fee-breakdown";
import { Link } from "@/i18n/navigation";
import { cacheCase } from "@/lib/case/case-store";
import { useCaseSession } from "@/lib/case/use-case-session";
import { API_MODE, DEMO_TENANT, getCase, getHandoff, postEvent } from "@/lib/journey/api";
import { istToday } from "@/lib/journey/dates";
import { track } from "@/lib/journey/track";
import { recordScreen } from "@/lib/journey/trial-log";
import { PayOnline } from "./pay-online";

export const SARATHI_URL = "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do";
export const PAY_STATUS_URL = "https://sarathi.parivahan.gov.in/paymentscov/PayStatusVeri.jsp";

function NoCase() {
  const ta = useTranslations("apply");
  return (
    <EmptyState
      as="h1"
      title={ta("noCaseTitle")}
      action={
        <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
          {ta("makePlan")}
        </Link>
      }
    />
  );
}

/**
 * Fee before Sarathi (SCR-039, MD-112, EC-09 prevention): the amount Sarathi will show at the LL
 * stage (rule-pack paise, Intl-formatted), what comes later, and how to pay safely.
 */
export function FeeScreen() {
  const t = useTranslations("feeScreen");
  const ta = useTranslations("apply");
  const tp = useTranslations("flow.pay");
  const { inr } = useFmt();
  const s = useCaseSession();
  useEffect(() => {
    recordScreen("apply.fee");
  }, []);
  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan?.fees) return <NoCase />;
  const q = s.plan.fees;
  const later = q.total_paise - q.ll_stage_paise;
  return (
    <div className="mj-screen" data-screen="SCR-039">
      <BackLink href="/apply/check">{ta("backToCheck")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("now")}</p>
        <p className="mj-big-fee" data-testid="fee-now">
          {inr(q.ll_stage_paise)}
        </p>
      </header>
      <section className="mj-card" aria-labelledby="fee-ll">
        <h2 id="fee-ll" className="mj-card__title">
          {t("breakdown")}
        </h2>
        <FeeBreakdown quote={q} stage="LL" />
      </section>
      <section className="mj-card mj-card--well" aria-labelledby="fee-later">
        <h2 id="fee-later" className="mj-card__title">
          {t("later")}
        </h2>
        <p>
          <span className="mj-num">{inr(later)}</span> · {t("laterWhat")}
        </p>
      </section>
      <section className="mj-card" aria-labelledby="fee-safe">
        <h2 id="fee-safe" className="mj-h2">
          {t("safeTitle")}
        </h2>
        <ul className="mj-ticks">
          <li>
            <StatusGlyph kind="done" size={20} />
            <span>{t("safe1")}</span>
          </li>
          <li>
            <StatusGlyph kind="done" size={20} />
            <span>{t("safe2")}</span>
          </li>
          <li>
            <StatusGlyph kind="danger" size={20} />
            <span>{t("safe3")}</span>
          </li>
        </ul>
      </section>
      <PayOnline s={s} />
      <div className="mj-sticky mj-actions">
        <Link
          href="/pay?for=ll"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          data-testid="fee-pay"
        >
          {tp("payNow", { amount: inr(q.ll_stage_paise) })}
        </Link>
        <Link
          href="/apply/handoff"
          className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
          data-testid="fee-continue"
        >
          {tp("orSarathi")}
        </Link>
      </div>
    </div>
  );
}

/**
 * Sarathi hand-off, Mode A (SCR-040, MD-114, F-07, D-07): the honest boundary. eKYC, OTP, payment
 * and submission happen on Sarathi; Margdarshak prepares the person with a copy-pack. The adapter
 * provenance drives the "Simulated" chip. EC-11: if Sarathi is down, the answers stay saved here.
 */
export function Handoff() {
  const t = useTranslations("handoff");
  const ta = useTranslations("apply");
  const ts = useTranslations("simulated");
  const tx = useTranslations("a11y");
  const { inr } = useFmt();
  const s = useCaseSession();
  const online = useOnline();
  const [down, setDown] = useState(false);
  // MD-045: the chip follows the hand-off pack's adapter provenance (API-16). The device stand-in
  // (mock mode, or the API unreachable) is always simulated.
  const [prov, setProv] = useState<{ adapterMode: string | null; simulated: boolean }>({
    adapterMode: "mock",
    simulated: true,
  });
  const caseRef = s.active?.caseId;

  useEffect(() => {
    recordScreen("apply.handoff");
    track("handoff_opened", { mode: "A" });
  }, []);

  useEffect(() => {
    if (!caseRef || API_MODE !== "real") return;
    void getHandoff(caseRef, "")
      .then((r) => {
        if (r.source === "server") setProv(adapterProvenance(r.data));
      })
      .catch(() => undefined);
  }, [caseRef]);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active) return <NoCase />;
  const fee = s.plan?.fees ? inr(s.plan.fees.ll_stage_paise) : "";
  const nonAadhaar = s.ctx.path === "non_aadhaar";
  const caseId = s.active.caseId;

  const opened = async () => {
    try {
      await postEvent(caseId, { type: "handoff_done", occurred_on: istToday() });
      const fresh = await getCase(caseId);
      cacheCase(fresh.data);
    } catch {
      // offline: the case moves on when the person tells us how it went
    }
  };

  return (
    <div className="mj-screen" data-screen="SCR-040">
      <BackLink href="/apply/fee">{ta("backToFee")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
        <div className="mj-chips">
          <SimulatedChip
            adapterMode={prov.adapterMode}
            simulated={prov.simulated}
            label={ts("chip")}
            detail={ts("detailSarathi")}
          />
        </div>
      </header>
      <SarathiStatusBanner onStatus={setDown} />
      <ol className="mj-ol" aria-label={t("stepsLabel")}>
        <li>{t("step1")}</li>
        <li>{nonAadhaar ? t("step2NonAadhaar") : t("step2")}</li>
        <li>{t("step3", { fee })}</li>
        <li>{t("step4")}</li>
      </ol>
      <Link
        href="/apply/handoff/pack"
        className="mj-card mj-card--soft"
        style={{ textDecoration: "none", color: "inherit" }}
        data-testid="open-pack"
      >
        <span className="mj-chips">
          <ClipboardList aria-hidden="true" />
          <strong>{t("packTitle")}</strong>
        </span>
        <span>{t("packLine")}</span>
      </Link>
      <section aria-labelledby="ho-tips" className="mj-card">
        <h2 id="ho-tips" className="mj-card__title">
          {t("tipsTitle")}
        </h2>
        <ul className="mj-ticks">
          {(["tip1", "tip2", "tip3", "tip4"] as const).map((k) => (
            <li key={k}>
              <StatusGlyph kind="info" size={20} />
              <span>{t(k)}</span>
            </li>
          ))}
        </ul>
      </section>
      {DEMO_TENANT ? (
        <p>
          <Link href="/apply/handoff/ekyc" className="md-link">
            {t("seeEkyc")}
          </Link>
        </p>
      ) : null}
      <ul className="mj-ticks mj-muted">
        <li>
          <StatusGlyph kind="info" size={20} />
          <span>{t("boundary")}</span>
        </li>
      </ul>
      {down ? (
        <Banner tone="info" title={t("savedTitle")}>
          {t("savedBody")}
        </Banner>
      ) : null}
      <div className="mj-sticky mj-actions">
        {online && !down ? (
          <a
            href={SARATHI_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={() => void opened()}
            data-testid="open-sarathi"
          >
            {t("open")}
            <ArrowUpRight aria-hidden="true" />
            <span className="md-sr-only"> {tx("externalNewTab")}</span>
          </a>
        ) : (
          <Button variant="primary" size="lg" isDisabled>
            {online ? t("openDown") : t("needsInternet")}
          </Button>
        )}
        <span className="mj-caption" style={{ textAlign: "center" }}>
          sarathi.parivahan.gov.in
        </span>
        <Link
          href="/apply/handoff/return"
          className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
          data-testid="back-from-sarathi"
        >
          {t("back")}
        </Link>
      </div>
    </div>
  );
}

/**
 * Simulated eKYC/OTP step for the demo tenant (MD-115, D-07, R-03). It shows the shape of the
 * Sarathi step and has no input element at all: no Aadhaar number, no VID, no OTP, ever.
 */
export function EkycSimulation() {
  const t = useTranslations("ekyc");
  const ts = useTranslations("simulated");
  useEffect(() => {
    recordScreen("apply.ekyc_sim");
  }, []);
  const box = (label: string) => (
    <div className="mj-card mj-card--well" aria-hidden="true">
      <span className="mj-caption">{label}</span>
      <span className="mj-num" style={{ letterSpacing: "0.3em", color: "var(--md-ink-3)" }}>
        ············
      </span>
    </div>
  );
  return (
    <div className="mj-screen" data-screen="SCR-040-SIM">
      <BackLink href="/apply/handoff">{t("back")}</BackLink>
      <Banner tone="simulated" title={ts("detailSarathi")}>
        {t("banner")}
      </Banner>
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      <ol className="mj-ol" aria-label={t("stepsLabel")}>
        <li>{t("s1")}</li>
        <li>{t("s2")}</li>
        <li>{t("s3")}</li>
        <li>{t("s4")}</li>
      </ol>
      <figure className="mj-card" style={{ margin: 0 }} aria-label={t("shapeLabel")}>
        <p className="mj-card__title">{t("shapeTitle")}</p>
        {box(t("fieldAadhaar"))}
        {box(t("fieldOtp"))}
        <p className="mj-caption">{t("consents")}</p>
      </figure>
      <p>
        <strong>{t("never")}</strong>
      </p>
      <div className="mj-actions">
        <Link
          href="/apply/handoff"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("done")}
        </Link>
      </div>
    </div>
  );
}

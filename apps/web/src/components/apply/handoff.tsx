"use client";

import "@/features/flow/flow.css";
import { adapterProvenance } from "@margdarshak/api-client";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { SimulatedChip } from "@margdarshak/ui/components/simulated-chip";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import {
  ArrowUpRight,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileText,
  IdCard,
  IndianRupee,
  Lock,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ReceiptRoll } from "@/components/fx/moments";
import { loadPersona } from "@/components/home/persona-switcher";
import { useFmt } from "@/components/journey/rule-source";
import { BackLink, SarathiStatusBanner, useOnline } from "@/components/journey/status";
import { FeeBreakdown } from "@/components/plan/fee-breakdown";
import { PseudoQr } from "@/features/flow/bits";
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
  const tp = useTranslations("personas");
  return (
    <EmptyState
      as="h1"
      title={ta("noCaseTitle")}
      action={
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
            {ta("makePlan")}
          </Link>
          {DEMO_TENANT ? (
            <Button
              variant="secondary"
              size="lg"
              data-testid="nocase-load-demo"
              onPress={() => void loadPersona("kabir_day12", false)}
            >
              {tp("outageDemo")}
            </Button>
          ) : null}
        </div>
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

function formatClassesLabel(classes: readonly string[] | undefined): string {
  return classes && classes.length > 0 ? classes.join(", ") : "MCWG, LMV";
}

/**
 * Sarathi hand-off, Mode A (SCR-040, MD-114, F-07, D-07): the honest boundary. eKYC, OTP, payment
 * and submission happen on Sarathi; Margdarshak prepares the person with a copy-pack. The adapter
 * provenance drives the "Simulated" chip. EC-11: if Sarathi is down, the answers stay saved here.
 */
export function Handoff() {
  const t = useTranslations("handoff");
  const ta = useTranslations("apply");
  const tp = useTranslations("flow.pay");
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
  const fee = s.plan?.fees ? inr(s.plan.fees.ll_stage_paise) : inr(95000);
  const classesLabel = formatClassesLabel(s.plan?.requested_classes);
  const stateCode = s.plan?.state ?? s.facts?.state ?? "JK";
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
        <div className="mj-chips">
          <SimulatedChip
            adapterMode={prov.adapterMode}
            simulated={prov.simulated}
            label={ts("chip")}
            detail={ts("detailSarathi")}
          />
        </div>
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>

      {/* 1. Live NIC / Parivahan Upstream Sync Bar (n8n W15 Watchdog) */}
      <SarathiStatusBanner onStatus={setDown} />

      {/* 2. Reimagined Portal Application Shell (fl-shell design language) */}
      <section className="fl-shell" aria-labelledby="ho-prepared">
        <div className="fl-shell__bar fl-shell__bar--dl">
          <span className="fl-shell__ident">
            <span className="fl-emblem" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <span className="fl-shell__brand">
              <strong id="ho-prepared">{t("preparedTitle")}</strong>
              <span>{t("preparedSub")}</span>
            </span>
          </span>
          <span className="fl-shell__lock">
            <Lock aria-hidden="true" />
            TLS
          </span>
        </div>

        <div className="fl-shell__body" style={{ gap: "18px", padding: "20px" }}>
          <dl className="fl-kv">
            <div>
              <dt>{t("offlineFieldApplicant")}</dt>
              <dd>{String(s.vault["full_name"] || "Kabir Sharma")}</dd>
            </div>
            <div>
              <dt>{t("offlineFieldRto")}</dt>
              <dd className="mj-num">
                {String(s.answers["rto_office"] || `${stateCode}-02 (Jammu)`)}
              </dd>
            </div>
            <div>
              <dt>{t("preparedClasses")}</dt>
              <dd className="mj-num">{classesLabel}</dd>
            </div>
            <div>
              <dt>{t("preparedFee")}</dt>
              <dd className="mj-num">{fee}</dd>
            </div>
          </dl>

          <div className="fl-grid" style={{ gap: "10px" }}>
            <div className="fl-doc">
              <span className="fl-doc__icon" aria-hidden="true">
                <IdCard />
              </span>
              <div className="fl-doc__text">
                <strong>{t("verifiedKycTitle")}</strong>
                <small>{t("verifiedKycSub")}</small>
              </div>
              <span className="fl-stamp">✓ {t("stampReady")}</span>
            </div>

            <Link
              href="/apply/handoff/pack"
              className="fl-doc"
              style={{ textDecoration: "none", color: "inherit" }}
              data-testid="open-pack"
            >
              <span className="fl-doc__icon" aria-hidden="true">
                <ClipboardList />
              </span>
              <div className="fl-doc__text">
                <strong>{t("packTitle")}</strong>
                <small>{t("packLine")}</small>
              </div>
              <ArrowUpRight size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
            </Link>
          </div>
        </div>
      </section>

      {/* 3. Dynamic Outage Fallback (ReceiptRoll Form 1A + On-Device Spec Verifier) */}
      {down ? (
        <div data-testid="sarathi-offline-prep-kit" className="fl-grid" style={{ gap: "18px" }}>
          {/* Official Pre-filled CMV Form 1 / 1A fed out of ReceiptRoll */}
          <div data-testid="offline-form1a-sheet">
            <ReceiptRoll>
              <div className="fx-receipt__head">
                <span className="mj-caption">{t("offlineStep1Badge")}</span>
                <h2 id="ho-offline-step1" className="mj-card__title" style={{ margin: 0 }}>
                  {t("offlineForm1aTitle")}
                </h2>
                <span className="fl-stamp">✓ {t("stampPrefilled")}</span>
              </div>

              <dl className="fl-kv">
                <div>
                  <dt>{t("offlineFieldApplicant")}</dt>
                  <dd>{String(s.vault["full_name"] || "Kabir Sharma")}</dd>
                </div>
                <div>
                  <dt>{t("offlineFieldGuardian")}</dt>
                  <dd>{String(s.vault["relation_name"] || "Rajesh Sharma")}</dd>
                </div>
                <div>
                  <dt>{t("offlineFieldRto")}</dt>
                  <dd className="mj-num">
                    {String(s.answers["rto_office"] || `${stateCode}-02 (RTO Jammu)`)}
                  </dd>
                </div>
                <div>
                  <dt>{t("offlineFieldBlood")}</dt>
                  <dd className="mj-num">
                    {String(s.answers["blood_group"] || "B+")} · {classesLabel}
                  </dd>
                </div>
                <div>
                  <dt>{t("offlineFieldDeclaration")}</dt>
                  <dd>{s.ctx.form1aNeeded ? t("offlineForm1aDoctor") : t("offlineForm1Self")}</dd>
                </div>
              </dl>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  alignItems: "center",
                  gap: "16px",
                  padding: "12px 14px",
                  borderRadius: "var(--md-r-lg)",
                  background: "var(--md-surface-2)",
                  boxShadow: "inset 0 0 0 1px var(--md-hairline)",
                }}
              >
                <PseudoQr seed={`${caseId}:form1a`} label={t("offlineForm1aTitle")} />
                <p className="mj-caption" style={{ margin: 0, lineHeight: 1.5 }}>
                  {t("offlineForm1aSub")}
                </p>
              </div>

              <div className="fl-noprint">
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  data-testid="offline-form1a-btn"
                  onPress={() => {
                    if (typeof window !== "undefined") window.print();
                  }}
                >
                  <Printer size={16} aria-hidden="true" />
                  {t("offlineForm1aPrint")}
                </Button>
              </div>
            </ReceiptRoll>
          </div>

          {/* On-Device Photo & Offline Sync Shell */}
          <section
            className="fl-shell"
            aria-labelledby="ho-offline-step2"
            data-testid="offline-photo-spec-panel"
          >
            <div className="fl-shell__bar fl-shell__bar--bank">
              <span className="fl-shell__ident">
                <span className="fl-emblem" aria-hidden="true">
                  <Camera size={20} />
                </span>
                <span className="fl-shell__brand">
                  <strong id="ho-offline-step2">{t("offlinePhotoTitle")}</strong>
                  <span>{t("offlineStep2Badge")}</span>
                </span>
              </span>
              <span className="fl-stamp">{t("stampOffline")}</span>
            </div>

            <div className="fl-shell__body" style={{ gap: "16px", padding: "20px" }}>
              <p className="mj-caption" style={{ margin: 0, lineHeight: 1.5 }}>
                {t("offlineKitSub")}
              </p>

              <div className="fl-grid" style={{ gap: "10px" }}>
                <div className="fl-doc">
                  <span className="fl-doc__icon" aria-hidden="true">
                    <Camera />
                  </span>
                  <div className="fl-doc__text">
                    <strong>{t("offlinePhotoSpec1")}</strong>
                    <small>{t("offlinePhotoSpec2")}</small>
                  </div>
                  <span className="fl-stamp">✓ {t("stampReady")}</span>
                </div>

                <div className="fl-doc">
                  <span className="fl-doc__icon" aria-hidden="true">
                    <FileText />
                  </span>
                  <div className="fl-doc__text">
                    <strong>{t("savedTitle")}</strong>
                    <small>{t("savedBody")}</small>
                  </div>
                  <span className="fl-stamp fl-stamp--warn">{t("stampQueued")}</span>
                </div>
              </div>

              <Link
                href="/apply/documents"
                className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
                data-testid="offline-photo-spec-btn"
              >
                <Camera size={16} aria-hidden="true" />
                {t("offlineFixerLink")}
              </Link>
            </div>
          </section>
        </div>
      ) : (
        <section className="fl-shell" aria-labelledby="ho-online-steps">
          <div className="fl-shell__bar fl-shell__bar--bank">
            <span className="fl-shell__ident">
              <span className="fl-emblem" aria-hidden="true">
                <CheckCircle2 size={20} />
              </span>
              <span className="fl-shell__brand">
                <strong id="ho-online-steps">{t("stepsLabel")}</strong>
                <span>{t("tipsTitle")}</span>
              </span>
            </span>
            <span className="fl-stamp">✓ {t("stampReady")}</span>
          </div>
          <div className="fl-shell__body" style={{ gap: "16px", padding: "20px" }}>
            <div className="fl-grid" style={{ gap: "10px" }}>
              <div className="fl-doc">
                <span className="fl-doc__icon" aria-hidden="true">
                  <IndianRupee />
                </span>
                <div className="fl-doc__text">
                  <strong>{t("step3", { fee })}</strong>
                  <small>{t("tip2")}</small>
                </div>
                <span className="fl-stamp">{fee}</span>
              </div>
              <div className="fl-doc">
                <span className="fl-doc__icon" aria-hidden="true">
                  <FileText />
                </span>
                <div className="fl-doc__text">
                  <strong>{t("step4")}</strong>
                  <small>{t("tip4")}</small>
                </div>
                <span className="fl-stamp">LL Form 3</span>
              </div>
            </div>
            {DEMO_TENANT ? (
              <p className="mj-caption" style={{ margin: 0 }}>
                <Link href="/apply/handoff/ekyc" className="md-link">
                  {t("seeEkyc")}
                </Link>
              </p>
            ) : null}
          </div>
        </section>
      )}

      <p className="mj-caption mj-muted" style={{ margin: 0 }}>
        {t("boundary")}
      </p>

      {/* 4. Primary Sticky CTA: Continue Inside Reimagined Margdarshak Portal */}
      <div className="mj-sticky mj-actions">
        <Link
          href="/pay?for=ll"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          data-testid="handoff-pay-inapp"
        >
          <IndianRupee size={18} aria-hidden="true" />
          {tp("payNow", { amount: fee })}
        </Link>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: online && !down ? "repeat(auto-fit, minmax(180px, 1fr))" : "1fr",
            gap: "10px",
          }}
        >
          <Link
            href="/apply/handoff/return"
            className={buttonClassName({ variant: "secondary", size: "md", fullWidth: true })}
            data-testid="back-from-sarathi"
          >
            {t("back")}
          </Link>
          {online && !down ? (
            <a
              href={SARATHI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName({ variant: "ghost", size: "md", fullWidth: true })}
              onClick={() => void opened()}
              data-testid="open-sarathi"
            >
              {t("open")}
              <ArrowUpRight size={15} aria-hidden="true" />
              <span className="md-sr-only"> {tx("externalNewTab")}</span>
            </a>
          ) : null}
        </div>
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

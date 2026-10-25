"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { Check, IndianRupee, Landmark, Lock, Printer, Smartphone } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ReceiptRoll, TollDrive } from "@/components/fx/moments";
import { useFmt } from "@/components/journey/rule-source";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";
import { recordScreen } from "@/lib/journey/trial-log";
import { NoFlowCase, PseudoQr, SimRibbon } from "./bits";
import { type PayFor, payLines, refFor, useFlow } from "./flow-case";

const BANKS = [
  "State Bank of India",
  "Punjab National Bank",
  "Bank of Baroda",
  "Canara Bank",
  "Jammu & Kashmir Bank",
  "HDFC Bank",
  "ICICI Bank",
];

const PAID_LL_STATES = new Set([
  "LL_TEST",
  "BRIDGE",
  "DL_BOOKABLE",
  "TEST_BOOKED",
  "TEST_FAILED",
  "AWAITING_APPROVAL",
  "DL_ISSUED",
  "DL_HOLDER",
]);

type Step = "choose" | "bank" | "processing" | "done";

const BACK: Record<PayFor, string> = {
  ll: "/apply/check",
  dl: "/dl/apply",
  retest: "/dl/retest",
  llretest: "/test/ll",
};
const NEXT: Record<PayFor, string> = {
  ll: "/test/ll",
  dl: "/dl/slot",
  retest: "/dl/slot?retest=1",
  llretest: "/test/ll",
};
const KINDS: readonly PayFor[] = ["ll", "dl", "retest", "llretest"];
/** The case flag each fee sets once paid (the LL fee moves the journey instead). */
const PAID_FLAG: Record<Exclude<PayFor, "ll">, string> = {
  dl: "dl_fee_paid",
  retest: "retest_fee_paid",
  llretest: "ll_retest_paid",
};

/**
 * Simulated state e-payment gateway (MD-041 shape, EC-09). Amounts are the rule-pack fee lines in
 * paise; the "payment" records one journey event (LL) or one case flag (DL, retest). In production
 * this page is the state's own gateway reached from Sarathi; Margdarshak never holds the money.
 */
export function PaymentGateway() {
  const t = useTranslations("flow.pay");
  const tf = useTranslations("flow");
  const tc = useTranslations("common");
  const rt = useRuleText();
  const { inr } = useFmt();
  const q = useSearchParams();
  const kind: PayFor = KINDS.find((k) => k === q.get("for")) ?? "ll";
  const s = useFlow();
  const [method, setMethod] = useState<"upi" | "nb">("upi");
  const [bank, setBank] = useState(BANKS[0] ?? "");
  const [step, setStep] = useState<Step>("choose");
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    recordScreen(`pay.${kind}`);
  }, [kind]);

  const lines = useMemo(() => payLines(s.plan, kind), [s.plan, kind]);
  const total = lines.reduce((n, l) => n + l.amount, 0);
  const caseId = s.active?.caseId ?? "none";
  const appNo = s.vault["application_number"] || refFor(`${caseId}:app`, 10);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan) return <NoFlowCase />;

  const state = s.plan.state;
  const stateName = tc(`state.${state}` as "state.JK");
  const alreadyPaid =
    step !== "done" &&
    (kind === "ll"
      ? PAID_LL_STATES.has(s.caseData?.state ?? "")
      : s.answers[PAID_FLAG[kind]] === "yes");

  const complete = async () => {
    setStep("processing");
    setCleared(false);
    await new Promise((r) => setTimeout(r, 1800));
    if (kind === "ll") {
      await s.saveVault({ application_number: appNo });
      await s.save({ ll_fee_paid: "yes" });
      await s.act("payment_confirmed", { receipt_number: refFor(`${caseId}:grn:ll`, 10) });
    } else {
      await s.save({ [PAID_FLAG[kind]]: "yes" });
    }
    setPaidAt(new Date().toISOString());
    setCleared(true);
    await new Promise((r) => setTimeout(r, 1500));
    setStep("done");
  };

  const amount = inr(total);
  const txn = `MDP${refFor(`${caseId}:${kind}:txn`, 12)}`;
  const bankRef = refFor(`${caseId}:${kind}:bank`, 12);
  const grn = `${state}${refFor(`${caseId}:grn:${kind}`, 10)}`;

  return (
    <div className="mj-screen" data-screen={`SCR-PAY-${kind.toUpperCase()}`}>
      {step === "choose" ? <BackLink href={BACK[kind]}>{tf("back")}</BackLink> : null}
      <SimRibbon text={t("ribbon")} />
      <div className="fl-shell">
        <div
          className={`fl-shell__bar ${step === "bank" ? "fl-shell__bar--bank" : "fl-shell__bar--pay"}`}
        >
          <span className="mj-chips" style={{ gap: 10 }}>
            <span className="fl-emblem" aria-hidden="true">
              {step === "bank" ? <Landmark size={20} /> : <IndianRupee size={20} />}
            </span>
            <span className="fl-shell__brand">
              <strong>{step === "bank" ? t("bankPage", { bank }) : t("gateway")}</strong>
              <span>{t("merchant", { state: stateName })}</span>
            </span>
          </span>
          <span className="fl-shell__lock">
            <Lock aria-hidden="true" />
            TLS
          </span>
        </div>

        <div className="fl-shell__body" aria-live="polite">
          {alreadyPaid ? (
            <>
              <p className="mj-h2">{t("already")}</p>
              <Link
                href={NEXT[kind]}
                className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
              >
                {t(`next.${kind}`)}
              </Link>
            </>
          ) : null}

          {!alreadyPaid && (step === "choose" || step === "bank") ? (
            <>
              <dl className="fl-kv">
                <div>
                  <dt>{t(`for.${kind}`)}</dt>
                  <dd className="mj-num">{stateName}</dd>
                </div>
                <div>
                  <dt>{t("appNo")}</dt>
                  <dd className="mj-num">{appNo}</dd>
                </div>
              </dl>
              <section aria-labelledby="pay-sum" className="fl-grid">
                <h1 id="pay-sum" className="mj-card__title">
                  {t("summary")}
                </h1>
                <dl className="fl-kv" data-testid="pay-lines">
                  {lines.map((l) => (
                    <div key={l.id}>
                      <dt>
                        {rt(l.labelKey)}
                        {l.qty > 1 ? ` × ${l.qty}` : ""}
                      </dt>
                      <dd className="mj-num">{inr(l.amount)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="fl-total">
                  <span>{t("total")}</span>
                  <span className="mj-num" data-testid="pay-total">
                    {amount}
                  </span>
                </p>
                <p className="mj-caption">{t("fees")}</p>
              </section>
            </>
          ) : null}

          {!alreadyPaid && step === "choose" ? (
            <>
              <fieldset className="fl-grid" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="mj-card__title" style={{ marginBottom: 8 }}>
                  {t("method")}
                </legend>
                <div className="fl-tabs">
                  <button
                    type="button"
                    aria-pressed={method === "upi"}
                    className="fl-opt"
                    onClick={() => setMethod("upi")}
                  >
                    <strong>
                      <Smartphone aria-hidden="true" size={18} style={{ verticalAlign: "-3px" }} />{" "}
                      {t("upi")}
                    </strong>
                    <small>{t("upiLine")}</small>
                  </button>
                  <button
                    type="button"
                    aria-pressed={method === "nb"}
                    className="fl-opt"
                    onClick={() => setMethod("nb")}
                  >
                    <strong>
                      <Landmark aria-hidden="true" size={18} style={{ verticalAlign: "-3px" }} />{" "}
                      {t("netbanking")}
                    </strong>
                    <small>{t("netbankingLine")}</small>
                  </button>
                </div>
              </fieldset>
              {method === "upi" ? (
                <div className="fl-grid" style={{ justifyItems: "center", textAlign: "center" }}>
                  <PseudoQr seed={`${caseId}:${kind}:upi`} label={t("scan", { amount })} />
                  <p className="mj-caption">{t("scan", { amount })}</p>
                  <p className="mj-caption mj-num">{t("vpa", { state: state.toLowerCase() })}</p>
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onPress={() => void complete()}
                    data-testid="pay-upi"
                  >
                    <Check aria-hidden="true" />
                    {t("approveUpi")}
                  </Button>
                </div>
              ) : (
                <div className="fl-grid">
                  <label className="mj-card__title" htmlFor="pay-bank">
                    {t("chooseBank")}
                  </label>
                  <select
                    id="pay-bank"
                    className="ml-input"
                    style={{ minHeight: 48, fontSize: "1rem" }}
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                  >
                    {BANKS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                  <Button variant="primary" size="lg" fullWidth onPress={() => setStep("bank")}>
                    {t("toBank")}
                  </Button>
                </div>
              )}
              <p className="mj-caption">
                {t("pendingTip")}{" "}
                <Link href="/apply/payment-pending" className="md-link">
                  {t("pendingLink")}
                </Link>
              </p>
            </>
          ) : null}

          {!alreadyPaid && step === "bank" ? (
            <div className="mj-actions">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onPress={() => void complete()}
                data-testid="pay-bank-approve"
              >
                {t("bankApprove", { amount })}
              </Button>
              <Button variant="secondary" size="lg" fullWidth onPress={() => setStep("choose")}>
                {t("bankCancel")}
              </Button>
            </div>
          ) : null}

          {step === "processing" ? (
            <div className="fl-success" role="status">
              <TollDrive done={cleared} />
              <p className="mj-h2">{cleared ? t("successTitle") : t("processing")}</p>
              <p className="mj-caption">{cleared ? amount : t("dontBack")}</p>
            </div>
          ) : null}

          {step === "done" ? (
            <>
              <div className="fl-success" role="status">
                <span className="fl-success__tick">
                  <Check aria-hidden="true" />
                </span>
                <h1 className="mj-h2">{t("successTitle")}</h1>
                <p className="mj-muted">{t("successSub")}</p>
              </div>
              <ReceiptRoll>
                <div className="fx-receipt__head">
                  <h2 id="pay-rcpt" className="mj-card__title">
                    {t("receipt")}
                  </h2>
                  <span className="fl-total" style={{ border: 0, padding: 0 }}>
                    <span className="mj-num">{amount}</span>
                  </span>
                  <span className="fl-stamp">✓ {t("statusOk")}</span>
                </div>
                <dl className="fl-kv" data-testid="pay-receipt">
                  <div>
                    <dt>{t(`for.${kind}`)}</dt>
                    <dd className="mj-num">{amount}</dd>
                  </div>
                  <div>
                    <dt>{t("appNo")}</dt>
                    <dd className="mj-num">{appNo}</dd>
                  </div>
                  <div>
                    <dt>{t("txn")}</dt>
                    <dd className="mj-num">{txn}</dd>
                  </div>
                  <div>
                    <dt>{t("bankRef")}</dt>
                    <dd className="mj-num">{bankRef}</dd>
                  </div>
                  <div>
                    <dt>{t("grn")}</dt>
                    <dd className="mj-num">{grn}</dd>
                  </div>
                  <div>
                    <dt>{t("paidOn")}</dt>
                    <dd className="mj-num">
                      {paidAt
                        ? new Date(paidAt).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("status")}</dt>
                    <dd style={{ color: "var(--md-success)" }}>✓ {t("statusOk")}</dd>
                  </div>
                </dl>
                <Button
                  variant="secondary"
                  size="lg"
                  className="fl-noprint"
                  onPress={() => window.print()}
                >
                  <Printer aria-hidden="true" />
                  {t("print")}
                </Button>
              </ReceiptRoll>
            </>
          ) : null}
        </div>
      </div>
      {step === "done" ? (
        <div className="mj-sticky mj-actions fl-noprint">
          <Link
            href={NEXT[kind]}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="pay-next"
          >
            {t(`next.${kind}`)}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

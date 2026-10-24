"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useFmt } from "@/components/journey/rule-source";
import { Link } from "@/i18n/navigation";
import { cacheCase } from "@/lib/case/case-store";
import type { CaseSession } from "@/lib/case/use-case-session";
import { API_MODE, getCase, startPayment } from "@/lib/journey/api";
import { paymentReturn, paymentStatus, type ReturnHint } from "@/lib/journey/payment";
import { track } from "@/lib/journey/track";

/**
 * Pay the LL-stage fee on the state's gateway (API-19, D-07, EC-09). Margdarshak never collects the
 * fee: the API issues a redirect to the gateway (in the demo, the API's clearly labelled simulated
 * gateway), the gateway's signed callback (API-24) moves the case, and the page comes back here.
 * Paid or pending is read from the server case, never from the URL. A payment still pending blocks
 * a second one (409 PAYMENT_PENDING): we say so kindly and point to the pending guidance.
 *
 * Shown only for a case that lives on the server (real API); mock mode and device-only cases keep
 * the Mode A path (pay on Sarathi).
 */
export function PayOnline({ s }: { s: CaseSession }) {
  const t = useTranslations("payOnline");
  const locale = useLocale();
  const { inr } = useFmt();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<ReturnHint | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<"pending409" | "stale" | "unavailable" | null>(null);
  const caseId = s.active && !s.active.local ? s.active.caseId : null;
  const quoteId = s.caseData?.fees?.quote_id ?? null;

  // Back from the gateway: re-read the case (the signed callback has already moved it).
  useEffect(() => {
    const back = paymentReturn(window.location.search);
    if (!back || !caseId) return;
    setHint(back.hint);
    setChecking(true);
    void getCase(caseId)
      .then((r) => cacheCase(r.data))
      .catch(() => undefined)
      .finally(() => setChecking(false));
    if (back.hint === "pending") track("payment_pending_reported");
  }, [caseId]);

  if (API_MODE !== "real" || !caseId || !quoteId) return null;
  const status = paymentStatus(s.caseData);
  const amount = s.plan?.fees ? inr(s.plan.fees.ll_stage_paise) : "";

  const pay = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await startPayment(caseId, quoteId, `/${locale}/apply/fee`, "ll");
      if (r.kind === "redirect") {
        window.location.assign(r.intent.redirect_url);
        return;
      }
      if (r.kind === "pending") {
        setProblem("pending409");
        await s.refresh();
      } else setProblem(r.kind);
    } catch {
      setProblem("unavailable");
    }
    setBusy(false);
  };

  return (
    <section className="mj-card" aria-labelledby="pay-online" data-testid="pay-online">
      <h2 id="pay-online" className="mj-h2">
        {t("title")}
      </h2>
      {checking ? (
        <p role="status" className="mj-caption">
          {t("checking")}
        </p>
      ) : null}
      {status === "paid" ? (
        <Banner tone="success" title={t("paidTitle")} role="status">
          <span data-testid="payment-paid">{t("paidBody")}</span>{" "}
          <Link href="/apply/application-number" className="md-link">
            {t("paidNext")}
          </Link>
        </Banner>
      ) : null}
      {status === "pending" ? (
        <Banner tone="caution" title={t("pendingTitle")} role="status">
          <span data-testid="payment-pending">{t("pendingBody")}</span>{" "}
          <Link href="/apply/payment-pending" className="md-link">
            {t("pendingNext")}
          </Link>
        </Banner>
      ) : null}
      {status === "none" && hint === "failed" && !checking ? (
        <Banner tone="info" title={t("failedTitle")} role="status">
          <span data-testid="payment-failed">{t("failedBody")}</span>
        </Banner>
      ) : null}
      {problem === "pending409" ? (
        <Banner tone="caution" title={t("pendingTitle")} role="alert">
          <span data-testid="payment-409">{t("pending409")}</span>{" "}
          <Link href="/apply/payment-pending" className="md-link">
            {t("pendingNext")}
          </Link>
        </Banner>
      ) : null}
      {problem === "stale" ? (
        <Banner tone="info" title={t("staleTitle")} role="alert">
          {t("staleBody")}
        </Banner>
      ) : null}
      {problem === "unavailable" ? (
        <Banner tone="offline" title={t("unavailableTitle")} role="alert">
          {t("unavailableBody")}
        </Banner>
      ) : null}
      {status === "none" ? (
        <>
          <p>{t("body", { amount })}</p>
          <Button
            variant="secondary"
            size="lg"
            isPending={busy}
            onPress={() => void pay()}
            data-testid="pay-intent"
          >
            {t("cta", { amount })}
          </Button>
          <p className="mj-caption">{t("never")}</p>
        </>
      ) : null}
      {status === "paid" ? (
        <Link
          href="/apply/application-number"
          className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
        >
          {t("paidNext")}
        </Link>
      ) : null}
    </section>
  );
}

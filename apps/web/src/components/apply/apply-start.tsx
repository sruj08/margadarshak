"use client";

import { Disclosure } from "@heroui/react";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { Fingerprint } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink } from "@/components/journey/status";
import { classNames } from "@/components/plan/plan-card";
import { Link, useRouter } from "@/i18n/navigation";
import { cacheCase, getActiveCase, setActiveCase, setCaseFacts } from "@/lib/case/case-store";
import { applyPrefill } from "@/lib/journey/aadhaar-prefill";
import { ApiError, getCase, myLicences, patchCase, postEvent, startCase } from "@/lib/journey/api";
import { toCasePath, type VehicleClassCode } from "@/lib/journey/api-types";
import { chosenPath, type PlanRecord, toCaseFacts } from "@/lib/journey/plan-model";
import { getPlan, latestPlan } from "@/lib/journey/plan-store";
import { track } from "@/lib/journey/track";
import { recordScreen } from "@/lib/journey/trial-log";

/**
 * Save your case (SCR-018, MD-109 client side). Turns the plan into a case without forcing an
 * account: an anonymous device session, every answer autosaved. A learner under 18 starts in family
 * mode inside the parent's account (D-13 revised): the next screen asks who it is for and records
 * the parent's consent.
 */
export function ApplyStart() {
  const t = useTranslations("applyStart");
  const tf = useTranslations("flow.digilocker");
  const tc = useTranslations("common");
  const rt = useRuleText();
  const router = useRouter();
  const [rec, setRec] = useState<PlanRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("plan");
    setRec(getPlan(id) ?? latestPlan());
    recordScreen("apply.start");
  }, []);

  if (rec === undefined) return <div className="mj-screen" aria-busy="true" />;
  if (rec === null) {
    return (
      <div className="mj-screen" data-screen="SCR-018">
        <EmptyState
          as="h1"
          title={t("noPlanTitle")}
          line={t("noPlanLine")}
          action={
            <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {t("makePlan")}
            </Link>
          }
        />
      </div>
    );
  }

  const plan = rec.plan;
  const classes = (plan.bundles[0]?.classes ?? plan.requested_classes) as VehicleClassCode[];
  const path = chosenPath(plan, rec.answers);
  const existing = getActiveCase();

  const holdsLl = rec.answers.intent === "have_ll" && !!rec.answers.llIssuedOn;
  const canConnect =
    !holdsLl &&
    !rec.answers.aadhaarLinked &&
    !plan.family_mode_required &&
    path?.path_id !== "non_aadhaar";

  const start = async (next = "/apply/q/for_whom") => {
    setBusy(true);
    setError(false);
    try {
      const res = await startCase({
        ...(rec.serverPlanId ? { plan_id: rec.serverPlanId } : {}),
        state: plan.state,
        classes,
        path: toCasePath(path?.path_id ?? "aadhaar_contactless"),
        for_family_member: plan.family_mode_required,
        facts: toCaseFacts(rec.answers),
        answers: {
          ...(rec.answers.aadhaar ? { aadhaar_address_match: rec.answers.aadhaar } : {}),
        },
      });
      cacheCase(res.data);
      setCaseFacts(res.data.case_id, rec.answers);
      setActiveCase({
        caseId: res.data.case_id,
        planId: rec.id,
        memberId: null,
        memberLabel: null,
        minor: plan.family_mode_required,
        persona: null,
        local: res.local,
      });
      const caseId = res.data.case_id;
      // Details fetched from Aadhaar while planning move into this case's on-device vault.
      if (await applyPrefill(caseId))
        await patchCase(caseId, { answers: { digilocker_prefill: "yes" } }, res.data.version).catch(
          () => null,
        );
      // EC-22: an LL already held is recorded with its real issue date; the DL steps follow.
      if (holdsLl && rec.answers.llIssuedOn) {
        await postEvent(caseId, {
          type: "ll_issued",
          occurred_on: rec.answers.llIssuedOn,
          payload: { classes },
        }).catch(() => null);
        const fresh = await getCase(caseId).catch(() => null);
        if (fresh) cacheCase(fresh.data);
        router.push("/dl/apply");
        return;
      }
      if (!plan.family_mode_required)
        track("application_started", {
          path: path?.path_id === "non_aadhaar" ? "non_aadhaar" : "aadhaar",
        });
      router.push(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === "CASE_EXISTS") {
        if (await openExistingCase(rec.id, plan.family_mode_required)) {
          router.push("/apply");
          return;
        }
        setBusy(false);
        setConflict(true);
        return;
      }
      setBusy(false);
      setError(true);
    }
  };

  return (
    <div className="mj-screen" data-screen="SCR-018">
      <BackLink href={`/plan/card?id=${encodeURIComponent(rec.id)}`}>{t("backToPlan")}</BackLink>
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <p className="mj-eyebrow">{classNames(plan, rt)}</p>
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      {existing ? (
        <Banner tone="info" title={t("existingTitle")}>
          {t("existingBody")}{" "}
          <Link href="/apply" className="md-link">
            {t("existingLink")}
          </Link>
        </Banner>
      ) : null}
      {plan.family_mode_required ? (
        <Banner tone="info" title={t("familyTitle")}>
          {t("familyBody")}
        </Banner>
      ) : null}
      <ul className="mj-ticks">
        {(["promise1", "promise2", "promise3"] as const).map((k) => (
          <li key={k}>
            <StatusGlyph kind="done" size={20} />
            <span>{t(k)}</span>
          </li>
        ))}
      </ul>
      <Disclosure className="md-why">
        <Disclosure.Heading className="md-why__heading">
          <Disclosure.Trigger className="md-why__trigger">
            <StatusGlyph kind="info" size={20} />
            <span>{t("storeTitle")}</span>
            <Disclosure.Indicator className="md-why__indicator" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="md-why__body">
            <p>{t("storeServer")}</p>
            <p>{t("storePhone")}</p>
            <p>{t("storeNever")}</p>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
      {conflict ? (
        <Banner tone="info" title={t("conflictTitle")}>
          {t("conflictBody")}{" "}
          <Link href="/licence" className="md-link">
            {t("conflictLink")}
          </Link>
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" title={tc("somethingWrong")}>
          {tc("safeHere")}
        </Banner>
      ) : null}
      <div className="mj-actions">
        {canConnect ? (
          <Button
            variant="primary"
            size="lg"
            isPending={busy}
            onPress={() => void start("/apply/digilocker")}
            data-testid="start-connect"
          >
            <Fingerprint aria-hidden="true" />
            {tf("startConnect")}
          </Button>
        ) : null}
        <Button
          variant={canConnect ? "secondary" : "primary"}
          size="lg"
          isPending={busy}
          onPress={() => void start()}
          data-testid="start-case"
        >
          {holdsLl ? tf("startDl") : canConnect ? tf("startSelf") : t("cta")}
        </Button>
      </div>
    </div>
  );
}

/**
 * 409 CASE_EXISTS: an open case already covers one of these classes on this account (one open case
 * per class, server rule). Make that case the active one instead of starting a second application.
 * Returns false when there isn't exactly one matching open case.
 */
async function openExistingCase(planId: string, forFamily: boolean): Promise<boolean> {
  const mine = await myLicences();
  const open = (mine?.items ?? []).filter((c) => !!c.for_family_member === forFamily);
  const only = open.length === 1 ? open[0] : undefined;
  if (!only) return false;
  const fresh = await getCase(only.case_id).catch(() => null);
  if (!fresh) return false;
  cacheCase(fresh.data);
  setActiveCase({
    caseId: fresh.data.case_id,
    planId,
    memberId: null,
    memberLabel: null,
    minor: forFamily,
    persona: null,
    local: false,
  });
  return true;
}

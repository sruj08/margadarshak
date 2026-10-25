"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { FileText, IdCard, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConnectFlow, IdentityCard } from "@/components/fx/moments";
import { useFmt } from "@/components/journey/rule-source";
import { BackLink } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";
import { recordScreen } from "@/lib/journey/trial-log";
import { NoFlowCase, SimRibbon } from "./bits";
import { DigiLockerConsentCard, DigiLockerDone, DigiLockerWindow } from "./digilocker-window";
import { useFlow } from "./flow-case";

type Step = "signin" | "consent" | "fetching" | "done" | "denied";

const PATH: Record<Step, string> = {
  signin: "/signin",
  consent: "/oauth2/authorize",
  fetching: "/oauth2/callback",
  done: "/oauth2/callback",
  denied: "/oauth2/authorize",
};

/**
 * Simulated DigiLocker pull (F-07 autofill, D-07). The shape of the real consent flow (sign in,
 * consent with purpose and validity, fetch) with a synthetic account: there is no input for an
 * Aadhaar number, VID or OTP. Fetched values go only to the encrypted on-device vault, never to the
 * server or the case (the case gets one flag, `digilocker_prefill`).
 */
export function DigiLockerConsent() {
  const t = useTranslations("flow.digilocker");
  const tc = useTranslations("common");
  const { date } = useFmt();
  const s = useFlow();
  const [step, setStep] = useState<Step>("signin");

  useEffect(() => {
    recordScreen("apply.digilocker");
  }, []);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active) return <NoFlowCase />;

  const stateName = s.plan ? tc(`state.${s.plan.state}` as "state.JK") : "";
  const dobIso = s.facts?.age.kind === "dob" ? s.facts.age.dob : "2007-06-15";
  const profile = {
    full_name: t("accountName"),
    relative_name: "Rajesh Sharma",
    home: `House 12, Sector 4, ${stateName}`,
    dob: date(dobIso, "long"),
  };

  const allow = async () => {
    setStep("fetching");
    await s.saveVault(profile);
    await s.save({ digilocker_prefill: "yes" });
  };

  return (
    <div className="mj-screen" data-screen="SCR-DL-PULL">
      <BackLink href="/apply">{tc("back")}</BackLink>
      <SimRibbon text={t("ribbon")} />
      <DigiLockerWindow path={PATH[step]}>
        {step === "signin" ? (
          <>
            <div className="dlw__req">
              <h1 className="dlw__title">{t("signinTitle")}</h1>
              <p className="dlw__purpose">{t("signinSub")}</p>
            </div>
            <div className="dlw__account">
              <span className="dlw__avatar" aria-hidden="true">
                {t("accountInitials")}
              </span>
              <span className="dlw__who">
                <strong>
                  {t("accountName")} <span className="dlw__tag">{t("account")}</span>
                </strong>
                <small>{t("accountLine")}</small>
              </span>
            </div>
            <p className="dlw__note">{t("never")}</p>
            <Button variant="primary" size="lg" fullWidth onPress={() => setStep("consent")}>
              {t("continue")}
            </Button>
          </>
        ) : null}

        {step === "consent" ? (
          <DigiLockerConsentCard
            title={t("consentTitle")}
            purpose={t("consentPurpose")}
            docs={[
              {
                icon: <IdCard />,
                label: t("docAadhaarShort"),
                detail: `${t("docAadhaarFields")} · ${t("docAadhaarMask")}`,
                required: true,
              },
              {
                icon: <FileText />,
                label: t("docMarks"),
                detail: t("docOptional"),
                required: false,
              },
            ]}
            validity={t("consentValidity")}
            onAllow={() => void allow()}
            onDeny={() => setStep("denied")}
          />
        ) : null}

        {step === "fetching" ? (
          <>
            <h1 className="dlw__title">{t("connectTitle")}</h1>
            <ConnectFlow
              labels={{ app: t("nodeApp"), locker: t("brand"), aadhaar: t("nodeAadhaar") }}
              steps={[t("s1"), t("s2"), t("s3"), t("s4")]}
              onDone={() => setStep("done")}
            />
          </>
        ) : null}

        {step === "done" ? (
          <>
            <DigiLockerDone title={t("doneTitle")} sub={t("doneSub")} />
            <IdentityCard
              f={{
                name: profile.full_name,
                nameHi: t("accountNameHi"),
                dob: dobIso.split("-").reverse().join("-"),
                gender: t("idGenderValue"),
                last4: t("docAadhaarMask").slice(-4),
              }}
              labels={{
                band: t("idBand"),
                bandHi: t("idBandHi"),
                seal: t("idSeal"),
                dob: t("idDob"),
                gender: t("idGender"),
                footer: t("idFooter"),
              }}
            />
            <dl className="fl-kv">
              <div>
                <dt>{t("fRelative")}</dt>
                <dd>{profile.relative_name}</dd>
              </div>
              <div>
                <dt>{t("fAddress")}</dt>
                <dd>{profile.home}</dd>
              </div>
              <div>
                <dt>{t("fPhoto")}</dt>
                <dd>{t("fPhotoValue")}</dd>
              </div>
            </dl>
            <p className="dlw__note">
              <Lock aria-hidden="true" style={{ width: 13, height: 13, verticalAlign: "-2px" }} />{" "}
              {t("kept")}
            </p>
          </>
        ) : null}

        {step === "denied" ? <p className="dlw__purpose">{t("denied")}</p> : null}
      </DigiLockerWindow>
      {step === "done" || step === "denied" ? (
        <div className="mj-sticky mj-actions">
          <Link
            href="/apply"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="digilocker-next"
          >
            {t("next")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

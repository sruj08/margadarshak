"use client";

import "./flow.css";
import { Button } from "@margdarshak/ui/components/button";
import { ArrowLeftRight, Check, Lock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { DigiLockerMark } from "@/components/fx/marks";

/**
 * The simulated DigiLocker window, shared by the plan wizard and the application: an address bar,
 * the DigiLocker header and a body. Carries its own stylesheet so it looks the same on every route.
 */
export function DigiLockerWindow({ path, children }: { path: string; children: ReactNode }) {
  const t = useTranslations("flow.digilocker");
  return (
    <div className="dlw" aria-live="polite">
      <div className="dlw__url">
        <Lock aria-hidden="true" className="dlw__lock" />
        <span className="dlw__host">
          digilocker.gov.in<span className="dlw__path">{path}</span>
        </span>
        <span className="dlw__sim">{t("simChip")}</span>
      </div>
      <div className="dlw__head">
        <DigiLockerMark size={36} />
        <span className="dlw__brand">
          <strong>
            Digi<span>Locker</span>
          </strong>
          <small>{t("tagline")}</small>
        </span>
      </div>
      <div className="dlw__body">{children}</div>
      <div className="dlw__foot">
        <ShieldCheck aria-hidden="true" />
        {t("secure")}
      </div>
    </div>
  );
}

export interface ConsentDoc {
  icon: ReactNode;
  label: string;
  detail: string;
  required: boolean;
}

/** OAuth-style consent: who is asking, why, which account, which documents, for how long. */
export function DigiLockerConsentCard({
  title,
  titleId,
  purpose,
  docs,
  validity,
  onAllow,
  onDeny,
  allowTestId,
}: {
  title: string;
  titleId?: string;
  purpose: string;
  docs: ConsentDoc[];
  validity: string;
  onAllow: () => void;
  onDeny: () => void;
  allowTestId?: string;
}) {
  const t = useTranslations("flow.digilocker");
  return (
    <>
      <div className="dlw__req">
        <span className="dlw__apps" aria-hidden="true">
          <span className="dlw__app">
            <img src="/brand/margdarshak-mark-light.svg" alt="" width={30} height={30} />
          </span>
          <ArrowLeftRight className="dlw__swap" />
          <span className="dlw__app dlw__app--dl">
            <DigiLockerMark size={44} />
          </span>
        </span>
        <h1 className="dlw__title" id={titleId} tabIndex={titleId ? -1 : undefined}>
          {title}
        </h1>
        <p className="dlw__purpose">{purpose}</p>
      </div>

      <div className="dlw__account">
        <span className="dlw__avatar" aria-hidden="true">
          {t("accountInitials")}
        </span>
        <span className="dlw__who">
          <small>{t("signedInAs")}</small>
          <strong>
            {t("accountName")} <span className="dlw__tag">{t("account")}</span>
          </strong>
          <small>{t("accountLine")}</small>
        </span>
      </div>

      <div className="dlw__docs">
        <p className="dlw__label">{t("docsLabel")}</p>
        <ul>
          {docs.map((d) => (
            <li key={d.label} data-required={d.required ? "true" : "false"}>
              <span className="dlw__tick" aria-hidden="true">
                {d.required ? <Check size={14} strokeWidth={3} /> : null}
              </span>
              <span className="dlw__doc-icon">{d.icon}</span>
              <span className="dlw__doc-text">
                {d.label}
                <small>{d.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="dlw__note">{validity}</p>
      <p className="dlw__note">{t("never")}</p>

      <div className="dlw__actions">
        <Button variant="primary" size="lg" fullWidth onPress={onAllow} data-testid={allowTestId}>
          <ShieldCheck aria-hidden="true" />
          {t("allow")}
        </Button>
        <Button variant="secondary" size="lg" fullWidth onPress={onDeny}>
          {t("deny")}
        </Button>
      </div>
    </>
  );
}

/** The "details are in" header with a tick, used after the fetch. */
export function DigiLockerDone({
  title,
  sub,
  titleId,
}: {
  title: string;
  sub: string;
  titleId?: string;
}) {
  return (
    <div className="dlw__done">
      <span className="dlw__done-tick" aria-hidden="true">
        <Check size={18} strokeWidth={3} />
      </span>
      <span>
        <h1 className="dlw__title" id={titleId} tabIndex={titleId ? -1 : undefined}>
          {title}
        </h1>
        <p className="dlw__purpose">{sub}</p>
      </span>
    </div>
  );
}

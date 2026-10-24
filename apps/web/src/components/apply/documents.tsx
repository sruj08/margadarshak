"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";
import { useCaseSession } from "@/lib/case/use-case-session";
import { recordScreen } from "@/lib/journey/trial-log";

/**
 * Documents checklist (SCR-034): exactly what this case needs, from the rule pack, with what
 * counts. Photo and signature are fixed on this phone; on the Aadhaar path Sarathi uses the Aadhaar
 * photo, so only the signature is needed.
 */
export function Documents() {
  const t = useTranslations("documents");
  const ta = useTranslations("apply");
  const rt = useRuleText();
  const s = useCaseSession();

  useEffect(() => {
    recordScreen("apply.documents");
  }, []);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan) {
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
  const nonAadhaar = s.ctx.path === "non_aadhaar";
  const docs = s.plan.documents.filter(
    (d) => d.stage === "LL" && d.doc_id !== "photo_and_signature",
  );
  const sig = s.docs.signature;
  const photo = s.docs.photo;
  const next = !sig ? "/apply/signature" : nonAadhaar && !photo ? "/apply/photo" : "/apply";

  return (
    <div className="mj-screen" data-screen="SCR-034">
      <BackLink href="/apply">{ta("backToTasks")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{nonAadhaar ? t("subNonAadhaar") : t("subAadhaar")}</p>
      </header>

      <section className="mj-card" aria-labelledby="doc-fix">
        <h2 id="doc-fix" className="mj-card__title">
          {t("fixTitle")}
        </h2>
        <ul className="mj-coming">
          <li>
            <span className="mj-chips">
              <StatusGlyph kind={sig ? "done" : "now"} size={20} />
              <span>
                <strong>{t("signature")}</strong>
                <span className="mj-caption" style={{ display: "block" }}>
                  {sig === "paper"
                    ? t("signaturePaper")
                    : sig
                      ? t("readyOnPhone")
                      : t("signatureHint")}
                </span>
              </span>
            </span>
            <Link href="/apply/signature" className="md-link" data-testid="fix-signature">
              {sig ? t("redo") : t("fixNow")}
            </Link>
          </li>
          {nonAadhaar ? (
            <li>
              <span className="mj-chips">
                <StatusGlyph kind={photo ? "done" : "now"} size={20} />
                <span>
                  <strong>{t("photo")}</strong>
                  <span className="mj-caption" style={{ display: "block" }}>
                    {photo ? t("readyOnPhone") : t("photoHint")}
                  </span>
                </span>
              </span>
              <Link href="/apply/photo" className="md-link" data-testid="fix-photo">
                {photo ? t("redo") : t("fixNow")}
              </Link>
            </li>
          ) : (
            <li>
              <span className="mj-chips">
                <StatusGlyph kind="done" size={20} />
                <span>
                  <strong>{t("photo")}</strong>
                  <span className="mj-caption" style={{ display: "block" }}>
                    {t("photoAadhaar")}
                  </span>
                </span>
              </span>
            </li>
          )}
        </ul>
      </section>

      <section className="mj-card" aria-labelledby="doc-carry">
        <h2 id="doc-carry" className="mj-card__title">
          {t("carryTitle")}
        </h2>
        <ul className="mj-ticks">
          {docs.map((d) => (
            <li key={d.doc_id}>
              <StatusGlyph kind={d.required ? "now" : "later"} size={20} />
              <span>
                {rt(d.text_key)}
                {!d.required ? <span className="mj-caption"> · {t("maybe")}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mj-muted">{t("uploadRules")}</p>

      <div className="mj-sticky mj-actions">
        <Link
          href={next}
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {next === "/apply" ? t("done") : t("fixNext")}
        </Link>
      </div>
    </div>
  );
}

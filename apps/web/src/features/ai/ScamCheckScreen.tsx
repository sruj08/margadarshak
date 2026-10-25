"use client";

import "./coach.css";
import { Label, TextArea } from "@heroui/react";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { redact } from "@/lib/redact/redact";
import { type AiFailure, aiFailure, checkScam, type ScamVerdict } from "./api";

/**
 * Scam checker (F-33, API-43). Rules on the server decide the verdict and the red flags; the
 * flags are worded here from fixed copy, and the AI explanation (labelled) only adds a plain
 * reading of them in the UI language. The verdict is never "safe" or "genuine" (D-19). Long
 * numbers are hidden on the phone before anything is sent (EC-20).
 */
export function ScamCheckScreen() {
  const t = useTranslations("ai.scam");
  const tc = useTranslations("ai.coachTurn");
  const lang = useLocale() === "hi" ? "hi" : "en";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [res, setRes] = useState<ScamVerdict | null>(null);
  const [failed, setFailed] = useState<AiFailure | null>(null);

  const check = async () => {
    const clean = redact(text).text.trim();
    if (!clean) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    setBusy(true);
    setFailed(null);
    const r = await checkScam(clean);
    setBusy(false);
    if (r.ok) setRes(r.data);
    else setFailed(aiFailure(r));
  };

  if (res)
    return (
      <div className="md-page md-stack" data-testid="scam-screen">
        <h1 className="md-h1">{t("title")}</h1>
        <div data-testid="scam-verdict" data-verdict={res.verdict}>
          <Banner tone="caution" title={t(`verdict.${res.verdict}`)} role="status">
            {t("guidance")}
          </Banner>
        </div>
        {res.red_flags.length > 0 ? (
          <section className="md-stack" aria-labelledby="scam-flags">
            <h2 id="scam-flags" className="md-h3">
              {t("flagsTitle")}
            </h2>
            <ul className="md-coach__list" data-testid="scam-flags">
              {res.red_flags.map((f) => (
                <li key={f}>▲ {t(`flags.${f}`)}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p>{t("noFlags")}</p>
        )}
        {res.domain_checks && res.domain_checks.length > 0 ? (
          <section className="md-stack" aria-labelledby="scam-domains">
            <h2 id="scam-domains" className="md-h3">
              {t("domains")}
            </h2>
            <ul className="md-coach__list">
              {res.domain_checks.map((d) => (
                <li key={d.host}>
                  <code>{d.host}</code>: {d.allowlisted ? t("onList") : t("offList")}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {/* The template text is English only: show it in English; the AI text follows the UI language. */}
        {res.explanation && (res.explanation_source === "ai" || lang === "en") ? (
          <section
            className="md-coach"
            data-state={res.explanation_source === "ai" ? "ai" : "fallback"}
            data-testid="scam-explanation"
          >
            <p className="md-coach__chip">
              {res.explanation_source === "ai" ? t("explainAi") : t("explainRules")}
            </p>
            <p lang={res.explanation_source === "ai" ? lang : "en"}>{res.explanation}</p>
          </section>
        ) : null}
        <p className="md-coach__small">{t("limit")}</p>
        <Button
          variant="secondary"
          onPress={() => {
            setRes(null);
            setText("");
          }}
        >
          {t("another")}
        </Button>
      </div>
    );

  return (
    <div className="md-page md-stack" data-testid="scam-screen">
      <h1 className="md-h1">{t("title")}</h1>
      <p>{t("intro")}</p>
      <form
        className="md-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <Label htmlFor="scam-text" className="md-field__label">
          {t("label")}
        </Label>
        <TextArea
          id="scam-text"
          className="mj-input"
          rows={6}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="scam-privacy"
          aria-invalid={empty ? true : undefined}
          data-testid="scam-text"
        />
        <p id="scam-privacy" className="md-coach__small">
          {t("privacy")}
        </p>
        {empty ? (
          <p role="alert" className="md-coach__small">
            {t("empty")}
          </p>
        ) : null}
        <Button variant="primary" type="submit" isDisabled={busy} data-testid="scam-check">
          {busy ? t("working") : t("check")}
        </Button>
      </form>
      {failed ? (
        <Banner tone="caution" title={t("failed")} role="status">
          {failed === "signin" ? (
            <Link href="/signin" className="md-link">
              {tc("signin")}
            </Link>
          ) : null}
        </Banner>
      ) : null}
    </div>
  );
}

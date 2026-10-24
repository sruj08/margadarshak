"use client";

import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { declareKhudLicence, isOffline } from "@/features/learn/api";
import { Link } from "@/i18n/navigation";

/**
 * Khud Licence declaration (UI_SPEC_LEARN_GAMES §7.2, API-44). A plain yes/no in the user's language
 * (no trick question, nothing pre-selected), then the DL issue month and year (no DL number). The
 * badge always reads "self-declared". "No" gets a neutral thank-you, never shaming copy.
 */
export function KhudLicence() {
  const t = useTranslations("me.khud");
  const format = useFormatter();
  const id = useId();
  const [step, setStep] = useState<"ask" | "date" | "done" | "no">("ask");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [first, setFirst] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 30 }, (_, i) => thisYear - i);

  const submit = async () => {
    setError(null);
    if (!month || !year) {
      setError(t("needDate"));
      return;
    }
    try {
      await declareKhudLicence({
        dl_issued_on: `${year}-${month.padStart(2, "0")}-01`,
        no_agent_used: true,
        ...(first === null ? {} : { first_attempt_pass: first }),
      });
      setStep("done");
    } catch (e) {
      setError(isOffline(e) ? t("offline") : t("error"));
    }
  };

  if (step === "no" || step === "done")
    return (
      <div className="ml-card" role="status" data-testid="khud-result">
        <p className="md-h3">{step === "no" ? t("noThanks") : t("saved")}</p>
        <Link href="/learn/me" className="md-link">
          {t("back")}
        </Link>
      </div>
    );

  if (step === "ask")
    return (
      <fieldset className="md-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="md-h3">{t("question")}</legend>
        <div className="ml-actions">
          <button
            type="button"
            className={buttonClassName({ size: "lg", fullWidth: true })}
            onClick={() => setStep("date")}
          >
            {t("yes")}
          </button>
          <button
            type="button"
            className={buttonClassName({ size: "lg", fullWidth: true })}
            onClick={() => {
              void declareKhudLicence({ no: true });
              setStep("no");
            }}
          >
            {t("no")}
          </button>
        </div>
        <p className="ml-small">{t("note")}</p>
      </fieldset>
    );

  return (
    <div className="md-stack">
      <fieldset className="ml-card" style={{ border: 0 }}>
        <legend className="md-h3">{t("when")}</legend>
        <label htmlFor={`${id}-m`}>{t("month")}</label>
        <select
          id={`${id}-m`}
          className="ml-input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="">{t("choose")}</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={String(i + 1)}>
              {format.dateTime(new Date(2026, i, 1), { month: "long" })}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-y`}>{t("year")}</label>
        <select
          id={`${id}-y`}
          className="ml-input"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value="">{t("choose")}</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </fieldset>
      <fieldset className="ml-card ml-q" style={{ border: 0 }}>
        <legend className="md-h3">{t("firstQ")}</legend>
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className="ml-opt">
            <input
              type="radio"
              name={`${id}-first`}
              checked={first === (v === "yes")}
              onChange={() => setFirst(v === "yes")}
            />
            <span>{t(v === "yes" ? "firstYes" : "firstNo")}</span>
          </label>
        ))}
      </fieldset>
      {error ? (
        <p className="ml-feedback" data-tone="warn" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        onClick={() => void submit()}
      >
        {t("submit")}
      </button>
    </div>
  );
}

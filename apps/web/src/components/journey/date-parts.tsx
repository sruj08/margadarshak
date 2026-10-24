"use client";

import { useId } from "react";

/**
 * GOV.UK-style date input: Day · Month · Year as three numeric boxes (no picker for a date of
 * birth; numeric keyboard; works with autofill `bday-*`). `yearOnly` shows just the year (EC-01).
 */
export interface DateValue {
  d: string;
  m: string;
  y: string;
}

export const EMPTY_DATE: DateValue = { d: "", m: "", y: "" };

export function toIso(v: DateValue): string | null {
  if (!/^\d{1,2}$/.test(v.d) || !/^\d{1,2}$/.test(v.m) || !/^\d{4}$/.test(v.y)) return null;
  const d = Number(v.d);
  const m = Number(v.m);
  const y = Number(v.y);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function fromIso(iso: string | null | undefined): DateValue {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? { y: m[1] as string, m: String(Number(m[2])), d: String(Number(m[3])) } : EMPTY_DATE;
}

export function DateParts({
  legend,
  hint,
  value,
  onChange,
  yearOnly = false,
  labels,
  error,
  idPrefix,
}: {
  legend: string;
  hint?: string;
  value: DateValue;
  onChange: (v: DateValue) => void;
  yearOnly?: boolean;
  labels: { day: string; month: string; year: string };
  error?: string | null;
  idPrefix?: string;
}) {
  const auto = useId();
  const id = idPrefix ?? auto;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const described =
    [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  const box = (key: keyof DateValue, label: string, width: string, max: number, ac: string) => (
    <div className="mj-input-group" style={{ width }}>
      <label htmlFor={`${id}-${key}`} className="md-field__label">
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        className="mj-input mj-num"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={ac}
        maxLength={max}
        value={value[key]}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        onChange={(e) =>
          onChange({ ...value, [key]: e.target.value.replace(/\D/g, "").slice(0, max) })
        }
      />
    </div>
  );
  return (
    <fieldset className="mj-input-group" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="md-field__label" style={{ marginBottom: 6 }}>
        {legend}
      </legend>
      {hint ? (
        <p id={hintId} className="md-field__hint" style={{ marginBottom: 6 }}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="mj-error">
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {yearOnly ? null : box("d", labels.day, "4.5rem", 2, "bday-day")}
        {yearOnly ? null : box("m", labels.month, "4.5rem", 2, "bday-month")}
        {box("y", labels.year, "6.5rem", 4, "bday-year")}
      </div>
    </fieldset>
  );
}

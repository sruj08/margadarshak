/**
 * Locale formatting (LOCALIZATION §7). Money arrives as integer paise (fees.json, D-06) and is shown
 * with Indian grouping (1,72,890) and the ₹ sign produced by Intl, never typed into copy.
 */

export type UiLocale = "en" | "hi";

export const INTL_LOCALE: Record<UiLocale, string> = { en: "en-IN", hi: "hi-IN" };
export const IST = "Asia/Kolkata";

export function intlLocale(locale: string): string {
  return locale === "hi" ? INTL_LOCALE.hi : INTL_LOCALE.en;
}

/** Integer paise -> rupees as a number (exact for whole rupees; keeps paise when present). */
export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) throw new TypeError(`amount must be integer paise, got ${paise}`);
  return paise / 100;
}

/** "₹700", "₹1,150", "₹1,35,000"; shows paise only when the amount has them ("₹12.50"). */
export function formatInr(paise: number, locale: string): string {
  const rupees = paiseToRupees(paise);
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(rupees);
}

/** Spoken form for screen readers: "700 rupees" / "700 रुपये". */
export function spokenInr(paise: number, locale: string): string {
  const rupees = paiseToRupees(paise);
  const n = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(rupees);
  return locale === "hi" ? `${n} रुपये` : `${n} rupees`;
}

/** Indian digit grouping without currency: 172890 -> "1,72,890". */
export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(n);
}

/** ISO calendar date (YYYY-MM-DD, already an IST date) -> "23 Oct 2026" / "23 अक्टू॰ 2026". */
export function formatIsoDate(
  isoDate: string,
  locale: string,
  style: "short" | "long" = "short",
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  // Noon UTC keeps the calendar day stable in IST (UTC+5:30).
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    timeZone: IST,
  }).format(d);
}

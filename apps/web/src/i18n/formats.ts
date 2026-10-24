import type { Formats } from "next-intl";

/** Shared ICU formats (LOCALIZATION §4). `inr` gets its ₹ from Intl; amounts are never typed in copy. */
export const formats = {
  number: {
    inr: { style: "currency", currency: "INR", maximumFractionDigits: 0 },
    int: { maximumFractionDigits: 0 },
    seconds1: { maximumFractionDigits: 1, minimumFractionDigits: 1 },
  },
  dateTime: {
    long: { day: "numeric", month: "long", year: "numeric" },
    short: { day: "numeric", month: "short", year: "numeric" },
    time: { hour: "numeric", minute: "2-digit", hour12: true },
  },
} satisfies Formats;

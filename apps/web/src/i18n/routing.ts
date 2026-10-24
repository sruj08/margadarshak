import { defineRouting } from "next-intl/routing";

/** English and Hindi in full (F-50, D-21). Dogri is voice input only and never a UI locale. */
export const routing = defineRouting({
  locales: ["en", "hi"],
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" },
});

export type AppLocale = (typeof routing.locales)[number];

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return value === "en" || value === "hi";
}

import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { type AppLocale, isAppLocale } from "./routing";

/** Awaits the `[locale]` param, 404s on an unknown locale, and enables static rendering for it. */
export async function enterLocale(params: Promise<{ locale: string }>): Promise<AppLocale> {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  setRequestLocale(locale);
  return locale;
}

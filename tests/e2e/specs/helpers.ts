import type { BrowserContext } from "@playwright/test";

export const FOOTER_TEXT = {
  en: "Not affiliated with MoRTH, NIC or any State Transport Department.",
  hi: "MoRTH, NIC या किसी भी राज्य परिवहन विभाग से संबद्ध नहीं।",
} as const;

/** Every P0 route under a locale (MD-005 crawl). Keep in sync with apps/web/src/app/[locale]. */
export const ROUTES = [
  "",
  "/licence",
  "/learn",
  "/help",
  "/plan",
  "/services",
  "/grievance",
  "/accessibility",
  "/privacy",
  "/offline",
  "/language",
  "/welcome",
  "/dev/components",
  "/no-such-page",
] as const;

export const LOCALES = ["en", "hi"] as const;

/** Marks the device as onboarded (language chosen, launch notice seen). */
export async function onboard(context: BrowserContext, baseURL: string, locale = "en") {
  const url = new URL(baseURL);
  await context.addCookies(
    [
      ["md_lang", "1"],
      ["md_welcome", "1"],
      ["NEXT_LOCALE", locale],
    ].map(([name, value]) => ({
      name: name as string,
      value: value as string,
      domain: url.hostname,
      path: "/",
    })),
  );
}

import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { formats } from "./formats";
import { loadMessages } from "./messages";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    // messages/<locale>.json deep-merged with the P2 namespace files (src/i18n/messages.ts).
    messages: await loadMessages(locale),
    // The hackathon server runs in Singapore; every date is rendered in IST (EC-15).
    timeZone: "Asia/Kolkata",
    formats,
  };
});

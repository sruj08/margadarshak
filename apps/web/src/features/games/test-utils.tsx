import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import gamesEn from "../../../messages/en/games.json";
import nazarEn from "../../../messages/en/nazar.json";
import gamesHi from "../../../messages/hi/games.json";
import nazarHi from "../../../messages/hi/nazar.json";

/** Test-only provider with the C namespaces (games, nazar) in one locale. */
export function IntlWrap({
  children,
  locale = "en",
}: {
  children: ReactNode;
  locale?: "en" | "hi";
}) {
  const messages =
    locale === "hi" ? { games: gamesHi, nazar: nazarHi } : { games: gamesEn, nazar: nazarEn };
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Kolkata">
      {children}
    </NextIntlClientProvider>
  );
}

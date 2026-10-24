import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Workshop } from "@/components/dev/workshop";
import { enterLocale } from "@/i18n/page-locale";

export const metadata: Metadata = {
  title: "Component workshop",
  robots: { index: false, follow: false },
};

/**
 * MD-026 component workshop (replaces Storybook for the hackathon): every kit component in its
 * states, in the active locale and theme. Playwright runs axe on this page in en and hi.
 */
export default async function ComponentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations();
  return (
    <div className="md-page md-page--wide" data-screen="DEV-COMPONENTS">
      <Workshop
        locale={locale}
        copy={{
          simulatedChip: t("simulated.chip"),
          simulatedSarathi: t("simulated.detailSarathi"),
          simulatedDigilocker: t("simulated.detailDigilocker"),
          sourceHeading: t("source.heading"),
          sourceConfidence: t("source.confidence"),
          sourceOpen: t("source.openSource"),
          newTab: t("a11y.externalNewTab"),
          offline: t("offline.body"),
          emptyTitle: t("licence.emptyTitle"),
          emptyLine: t("licence.emptyLine"),
          emptyCta: t("licence.emptyCta"),
          statusDone: t("status.done"),
          statusNow: t("status.now"),
          statusLater: t("status.later"),
          close: t("a11y.close"),
          settingsTitle: t("settings.title"),
          clearHint: t("settings.clearHint"),
        }}
      />
    </div>
  );
}

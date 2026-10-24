import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReplayScreen } from "@/features/debrief/ReplayScreen";
import { GameA11yProvider } from "@/features/games/host/a11y-context";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("games");
  return { title: t("replay.title"), robots: { index: false } };
}

/** Replay of one finding's moment (UI_SPEC_LEARN_GAMES §6.3). */
export default async function ReplayPage({
  params,
}: {
  params: Promise<{ locale: string; sid: string; findingId: string }>;
}) {
  await enterLocale(params);
  const { sid, findingId } = await params;
  return (
    <GameA11yProvider>
      <ReplayScreen sid={sid} findingId={findingId} />
    </GameA11yProvider>
  );
}

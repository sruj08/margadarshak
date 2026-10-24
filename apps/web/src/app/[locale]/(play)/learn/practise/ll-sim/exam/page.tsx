import "@/features/games/games.css";
import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ExamPlay } from "@/features/ll-sim/exam-play";
import { allLlFormats } from "@/features/ll-sim/format";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("llSim.exam");
  return { title: t("title"), robots: { index: false } };
}

/**
 * LRN-012 LL exam and practice (full-screen `(play)` shell, UI_SPEC_LEARN_GAMES §3.3). Static HTML
 * with a client island; the game host and the LL module load after mount.
 */
export default async function LlExamPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <Suspense fallback={null}>
      <ExamPlay formats={allLlFormats()} />
    </Suspense>
  );
}

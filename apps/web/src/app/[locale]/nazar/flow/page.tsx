import "@/features/games/games.css";
import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { StudyFlow } from "@/features/study/StudyFlow";
import { enterLocale } from "@/i18n/page-locale";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `/nazar/flow`: the scripted study flow (FIELD_STUDY §4.3). Static HTML with a client island; the
 * game host, the LL module and the Nazar chunk load only when their phase starts.
 */
export default async function NazarStudyFlowPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  return <StudyFlow />;
}

import { notFound } from "next/navigation";
import { RateScreen } from "@/features/curator/steps";
import { enterLocale } from "@/i18n/page-locale";

const CLIP_ID_RE = /^[A-Z]{2,4}-\d{4,6}$/;

/** `/admin/clips/[clipId]/rate`: blind two-rater hazard windows (NAZAR §6, API-55 rateClip). */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; clipId: string }>;
}) {
  await enterLocale(params);
  const { clipId } = await params;
  if (!CLIP_ID_RE.test(clipId)) notFound();
  return <RateScreen clipId={clipId} />;
}

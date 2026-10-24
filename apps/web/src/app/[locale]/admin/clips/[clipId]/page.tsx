import { notFound } from "next/navigation";
import { ClipOverview } from "@/features/curator/ClipScreen";
import { enterLocale } from "@/i18n/page-locale";

const CLIP_ID_RE = /^[A-Z]{2,4}-\d{4,6}$/;

/** `/admin/clips/[clipId]`: the clip's facts, final windows and workflow runs (API-55 getClipAdmin). */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; clipId: string }>;
}) {
  await enterLocale(params);
  const { clipId } = await params;
  if (!CLIP_ID_RE.test(clipId)) notFound();
  return <ClipOverview clipId={clipId} />;
}

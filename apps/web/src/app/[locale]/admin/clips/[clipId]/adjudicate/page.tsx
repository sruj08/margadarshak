import { notFound } from "next/navigation";
import { AdjudicateScreen } from "@/features/curator/steps";
import { enterLocale } from "@/i18n/page-locale";

const CLIP_ID_RE = /^[A-Z]{2,4}-\d{4,6}$/;

/** `/admin/clips/[clipId]/adjudicate`: third-person ruling when raters disagree (API-55 adjudicateClip). */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; clipId: string }>;
}) {
  await enterLocale(params);
  const { clipId } = await params;
  if (!CLIP_ID_RE.test(clipId)) notFound();
  return <AdjudicateScreen clipId={clipId} />;
}

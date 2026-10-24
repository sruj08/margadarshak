import { GenerateClip } from "@/features/curator/GenerateClip";
import { sceneCatalogue } from "@/features/curator/scenes.server";
import { enterLocale } from "@/i18n/page-locale";

/** `/admin/clips/generate`: start the clip_generate workflow for one scene (POST /v1/admin/clips/generate). */
export default async function GenerateClipPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  return <GenerateClip catalogue={sceneCatalogue()} />;
}

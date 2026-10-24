import { Board } from "@/features/curator/Board";
import { enterLocale } from "@/i18n/page-locale";

/** `/admin/clips`: the clip pipeline board (UI_SPEC_LEARN_GAMES §12.1, API-55 listClipsAdmin). */
export default async function ClipsBoardPage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return <Board />;
}

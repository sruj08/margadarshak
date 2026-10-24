import "@/features/games/games.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { StateLoading } from "@/features/games/states";
import { SharePreview } from "@/features/share/SharePreview";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("games");
  return { title: t("share.title"), robots: { index: false } };
}

/** Share card preview (UI_SPEC_LEARN_GAMES §7.5). `?member=fam_…` makes it for a family member. */
export default async function SharePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <Suspense
      fallback={
        <div className="md-page">
          <StateLoading />
        </div>
      }
    >
      <SharePreview />
    </Suspense>
  );
}

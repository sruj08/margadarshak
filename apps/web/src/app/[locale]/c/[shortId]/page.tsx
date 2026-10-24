import "@/features/games/games.css";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fetchShareCard } from "@/features/share/card-data.server";
import { cardLabels, type GamesT } from "@/features/share/card-labels";
import { ShareCardView } from "@/features/share/ShareCardView";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; shortId: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("games");
  const { shortId } = await params;
  const r = await fetchShareCard(shortId);
  const title =
    r.k === "ok" ? t("share.ogTitle", { score: r.card.content.nazar_score }) : t("share.title");
  return {
    title,
    description: t("share.antic"),
    robots: { index: false },
    openGraph: { title, description: t("share.antic") },
  };
}

/**
 * Public share card (UI_SPEC_LEARN_GAMES §7.5, decision D3): our domain only, no install bait, the
 * card's numbers straight from the server's public JSON, and a link to practise. Withdrawn or
 * expired cards answer with a calm empty state. The Open Graph image is ./opengraph-image.tsx.
 */
export default async function ShareCardPage({
  params,
}: {
  params: Promise<{ locale: string; shortId: string }>;
}) {
  await enterLocale(params);
  const { shortId } = await params;
  const t = await getTranslations("games");
  const tn = await getTranslations("nazar");
  const r = await fetchShareCard(shortId);
  return (
    <main id="main" tabIndex={-1} className="md-main">
      <div className="md-page mg-page" data-screen="SHARE-CARD" data-testid="share-card-page">
        {r.k === "ok" ? (
          <>
            <h1 className="md-h1">{t("share.publicTitle")}</h1>
            {r.sample ? (
              <p className="mg-callout" data-testid="share-sample">
                {t("share.sample")}
              </p>
            ) : null}
            <ShareCardView
              content={r.card.content}
              labels={cardLabels(t as unknown as GamesT, r.card.content, {
                showRank: true,
                // Nazar scores are earned on AI-generated scenes (ADR-0013); the card says so.
                aiScenes: tn("ai.shareCard"),
              })}
            />
            <Link
              href="/learn/practise/nazar?mode=practice"
              className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            >
              {t("share.takeTest")}
            </Link>
            <p className="mg-note mg-note--ink">{t("share.publicNote")}</p>
          </>
        ) : (
          <EmptyState
            as="h1"
            title={
              r.k === "gone"
                ? t("share.gone")
                : r.k === "error"
                  ? t("states.errorTitle")
                  : t("share.notFound")
            }
            line={t("share.goneLine")}
            action={
              <Link
                href="/learn/practise/nazar"
                className={buttonClassName({ variant: "primary", size: "lg" })}
              >
                {t("share.takeTest")}
              </Link>
            }
          />
        )}
      </div>
    </main>
  );
}

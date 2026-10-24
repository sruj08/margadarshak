import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { gameSlug, gameTiles } from "@/features/learn/content/curriculum";
import { gameHref } from "@/features/learn/content/routes";
import { LearnNav } from "@/features/learn/ui/learn-nav";
import { LastMocks } from "@/features/ll-sim/last-mocks";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.practise");
  return { title: t("title") };
}

/**
 * LRN-020 Games grid (UI_SPEC_LEARN_GAMES §4.0). Tiles come from `@content/catalogue/games.json`; each
 * links to the game's own route when that route exists in this build, else it says "Coming soon".
 * Server-rendered with no client JS except the LL simulator's last-mock line.
 */
export default async function PractisePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("learnHub.practise");
  const tiles = gameTiles(locale).filter((g) => g.id !== "ll_sim");
  return (
    <div className="md-page md-stack" data-screen="LRN-020">
      <LearnNav active="practise" />
      <h1 className="md-h1">{t("title")}</h1>
      <Link href="/learn/practise/ll-sim" className="ml-card" data-testid="tile-ll_sim">
        <span className="md-h2">{t("llsim")}</span>
        <span>{t("llsimLine")}</span>
        <LastMocks />
      </Link>
      <h2 className="md-h2">{t("games")}</h2>
      <ul className="ml-tiles" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {tiles.map((g) => {
          const href = g.depth === "storyboard" ? null : gameHref(g.id);
          const body = (
            <>
              <span className="font-semibold">{g.title}</span>
              <span className="ml-small">
                {t("trains", { modules: g.modules.slice(0, 3).join(", ") })}
              </span>
              {g.draft ? <span className="ml-chip">{t("draft")}</span> : null}
              {!href ? <span className="ml-chip">{t("soon")}</span> : null}
            </>
          );
          return (
            <li key={g.id} data-testid={`tile-${gameSlug(g.id)}`}>
              {href ? (
                <Link href={href} className="ml-tile">
                  {body}
                </Link>
              ) : (
                <div className="ml-tile" aria-disabled="true">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="ml-small">{t("label")}</p>
    </div>
  );
}

import "@/components/journey/journey.css";
import { VerbTile } from "@margdarshak/ui/components/verb-tile";
import { ArrowRight, FileSearch, GraduationCap, RefreshCw, Scooter } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { HomeBody } from "@/components/home/home-body";
import { TrustLine } from "@/components/home/trust-line";
import { VoiceButton } from "@/components/home/voice-sheet";
import { Link } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: { absolute: `${t("title")} · ${t("tagline")}` } };
}

/**
 * SCR-003 Home, logged-out (F-01, MD-119): one headline, four verbs, the mic (voice arrives in P3;
 * the mic opens an honest sheet with a "tell us" box), one calm trust line and "All services, by
 * who you are" (MD-120). With a case on this device, HomeBody swaps in the stage-aware home
 * (SCR-060, MD-122) driven by the server journey state.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  const t = await getTranslations("home");

  const tiles = [
    {
      href: "/plan",
      title: t("tileFirst"),
      line: t("tileFirstLine"),
      icon: <Scooter strokeWidth={1.75} />,
    },
    {
      href: "/learn",
      title: t("tilePractise"),
      line: t("tilePractiseLine"),
      icon: <GraduationCap strokeWidth={1.75} />,
    },
    {
      href: "/services#holder",
      title: t("tileRenew"),
      line: t("tileRenewLine"),
      icon: <RefreshCw strokeWidth={1.75} />,
    },
    {
      href: "/licence",
      title: t("tileCheck"),
      line: t("tileCheckLine"),
      icon: <FileSearch strokeWidth={1.75} />,
    },
  ] as const;

  return (
    <div className="md-page md-page--wide">
      <HomeBody>
        <div className="md-home" data-screen="SCR-003">
          <section className="md-hero" aria-labelledby="home-h1">
            <div className="md-hero__glow" aria-hidden="true" />
            <h1 id="home-h1" className="md-display">
              {t("h1")}
            </h1>
            <p className="md-hero__sub">{t("sub")}</p>
          </section>

          <ul className="md-tiles" aria-label={t("tilesLabel")} data-testid="verb-tiles">
            {tiles.map((tile, i) => (
              <li key={tile.href} className="md-rise" style={{ "--i": i } as CSSProperties}>
                <VerbTile
                  href={tile.href}
                  title={tile.title}
                  line={tile.line}
                  icon={tile.icon}
                  linkAs={Link}
                />
              </li>
            ))}
          </ul>

          <div>
            <VoiceButton />
            <TrustLine />
            <p className="md-all-services">
              <Link href="/services" className="md-link">
                {t("all")}
                <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
              </Link>
            </p>
          </div>
        </div>
      </HomeBody>
    </div>
  );
}

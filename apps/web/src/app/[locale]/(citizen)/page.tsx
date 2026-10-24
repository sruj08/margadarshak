import "@/components/journey/journey.css";
import { AnimatedContent } from "@margdarshak/ui/components/animated-content";
import { BlurText } from "@margdarshak/ui/components/blur-text";
import { SplitText } from "@margdarshak/ui/components/split-text";
import { VerbTile } from "@margdarshak/ui/components/verb-tile";
import { ArrowRight, FileSearch, GraduationCap, RefreshCw, Scooter } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { AshokaChakra } from "@/components/home/ashoka-chakra";
import { HomeBody } from "@/components/home/home-body";
import { IndianDrivingLicenceCard } from "@/components/home/indian-driving-licence-card";
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
          {/* Reading order: headline, ask, the four verbs, licence card, then the quiet extras. */}
          <section className="md-hero md-home__hero" aria-labelledby="home-h1">
            <div className="md-hero__glow" aria-hidden="true" />
            <AshokaChakra />
            <h1 id="home-h1" className="md-display">
              <SplitText text={t("h1")} delay={45} duration={0.6} splitType="words" />
            </h1>
            <p className="md-hero__sub">
              <BlurText text={t("sub")} delay={35} duration={0.5} />
            </p>
          </section>

          <AnimatedContent delay={0.08} distance={12} duration={0.45} className="md-home__ask">
            <VoiceButton />
          </AnimatedContent>

          <ul
            className="md-tiles md-home__tiles"
            aria-label={t("tilesLabel")}
            data-testid="verb-tiles"
          >
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

          <div className="md-home__card">
            <IndianDrivingLicenceCard />
          </div>

          <AnimatedContent delay={0.12} distance={14} duration={0.5} className="md-home__more">
            <TrustLine />
            <p className="md-all-services">
              <Link href="/services" className="md-link md-all-services__card">
                <span>{t("all")}</span>
                <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
              </Link>
            </p>
          </AnimatedContent>
        </div>
      </HomeBody>
    </div>
  );
}

import "@/features/games/games.css";
import type { Metadata } from "next";
import { SpikeLoader } from "@/features/phaser/spike/SpikeLoader";
import { enterLocale } from "@/i18n/page-locale";

export const metadata: Metadata = {
  title: "Phaser spike",
  robots: { index: false, follow: false },
};

/**
 * MD-229 Phaser low-end spike (ADR-0012): fps, frame times, long tasks and the engine chunk on a
 * scene equivalent to Blind Spot. Dev tool, English only, like the component workshop.
 */
export default async function PhaserSpikePage({ params }: { params: Promise<{ locale: string }> }) {
  await enterLocale(params);
  return (
    <div className="md-page" data-screen="DEV-PHASER-SPIKE">
      <h1 className="md-h1">Phaser 4 low-end spike (MD-229)</h1>
      <SpikeLoader />
    </div>
  );
}

import "@/features/learn/learn.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { STATE_CODES } from "@/features/ll-sim/format";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("llSim");
  return { title: t("title") };
}

/** Lite LL test: choose a state (the format differs by state). */
export default async function LiteLlSimIndex({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("learnHub.lite");
  const ts = await getTranslations("llSim.states");
  return (
    <div className="md-page md-stack">
      <h1 className="md-h1">{t("llTitle")}</h1>
      <ul className="ml-list">
        {STATE_CODES.map((s) => (
          <li key={s}>
            <a href={`/${locale}/lite/learn/ll-sim/${s}`} className="ml-node">
              <span className="ml-node__text">{ts(s)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

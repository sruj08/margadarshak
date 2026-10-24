import "@/features/learn/learn.css";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { allLlFormats, STATE_CODES } from "@/features/ll-sim/format";
import { enterLocale } from "@/i18n/page-locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("learnHub.lite");
  return { title: t("title") };
}

/** LRN-L01 Lite learn (FRONTEND §9, EC-19): links only, server HTML, no client framework. */
export default async function LiteLearnPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  const t = await getTranslations("learnHub.lite");
  const ts = await getTranslations("llSim.states");
  const formats = allLlFormats();
  return (
    <div className="md-page md-stack" data-screen="LRN-L01" data-testid="lite-learn">
      <h1 className="md-h1">{t("title")}</h1>
      <p>{t("intro")}</p>
      <section className="md-stack">
        <h2 className="md-h2">{t("llTitle")}</h2>
        <ul className="ml-list">
          {STATE_CODES.map((s) => (
            <li key={s}>
              <a
                href={`/${locale}/lite/learn/ll-sim/${s}`}
                className="ml-node"
                data-testid={`lite-state-${s}`}
              >
                <span className="ml-node__text">
                  <span className="font-semibold">{ts(s)}</span>
                  <span className="ml-small">
                    {formats[s]?.known
                      ? t("formatKnown", {
                          q: formats[s]?.questions ?? 15,
                          p: formats[s]?.pass_correct ?? 9,
                        })
                      : t("formatUnknown")}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <a
        href={`/${locale}/lite/learn/review`}
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {t("reviewCta")}
      </a>
      <p className="ml-small">{t("practiceOnly")}</p>
    </div>
  );
}

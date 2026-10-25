"use client";

import { Button } from "@margdarshak/ui/components/button";
import { ArrowUpRight, ChevronRight, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { loadPersona } from "@/components/home/persona-switcher";
import { Link } from "@/i18n/navigation";

const CHAPTERS = [
  ["c1", "/language"],
  ["c2", "/plan"],
  ["c3", "/apply"],
  ["c4", "/apply/check"],
  ["c5", "/learn"],
  ["c6", "/test/ll"],
  ["c7", "/test/ll/issued"],
  ["c8", "/dl/apply"],
  ["c9", "/dl/test-day"],
  ["c10", "/dl/issued"],
  ["c11", "/help"],
  ["c12", "/compare"],
] as const;

/** The demo script as a page: one chronological story, each chapter opening the live screen. */
export function DemoStory() {
  const t = useTranslations("flow.demo");
  const [reset, setReset] = useState(false);
  return (
    <div className="mj-screen" data-screen="SCR-DEMO">
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <h1 className="mj-title">{t("title")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      <Button
        variant="secondary"
        size="lg"
        onPress={async () => {
          await loadPersona("kabir_new");
          setReset(true);
        }}
        data-testid="demo-reset"
      >
        <RotateCcw aria-hidden="true" />
        {t("reset")}
      </Button>
      {reset ? (
        <p role="status" className="mj-caption">
          {t("resetDone")}
        </p>
      ) : null}
      <ol className="fl-chapters">
        {CHAPTERS.map(([id, href]) => (
          <li key={id}>
            <Link href={href} className="fl-chapter" data-testid={`demo-${id}`}>
              <span>
                <strong>{t(`chapters.${id}.h`)}</strong>
                <small>{t(`chapters.${id}.b`)}</small>
              </span>
              <ChevronRight aria-hidden="true" />
              <span className="md-sr-only">{t("open")}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

const ROWS = [
  ["links", "https://parivahan.gov.in/"],
  ["answer", "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do"],
  ["save", "https://parivahan.gov.in/en/faq/learners-license-related-services?page=2"],
  ["device", "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do"],
  ["edit", "https://parivahan.gov.in/en/faq/learners-license-related-services?page=3"],
  ["state", "https://parivahan.gov.in/en/faq/learners-license-related-services?page=1"],
  ["bridge", "https://parivahan.gov.in/en/faq/learners-license-related-services?page=1"],
  ["lang", "https://parivahan.gov.in/"],
] as const;

/** Before / after: today's portal against this prototype, each row with its source. */
export function Compare() {
  const t = useTranslations("flow.compare");
  return (
    <div className="mj-screen" data-screen="SCR-COMPARE">
      <header className="mj-head">
        <h1 className="mj-title">{t("title")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      <section className="mj-card" style={{ overflowX: "auto" }}>
        <table className="fl-compare">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">{t("colToday")}</th>
              <th scope="col">{t("colUs")}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([id, src]) => (
              <tr key={id}>
                <th scope="row">
                  {t(`rows.${id}.h`)}
                  <br />
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="md-link mj-caption"
                  >
                    {t("source")} <ArrowUpRight aria-hidden="true" size={12} />
                  </a>
                </th>
                <td>{t(`rows.${id}.today`)}</td>
                <td>✓ {t(`rows.${id}.us`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mj-caption">{t("note")}</p>
    </div>
  );
}

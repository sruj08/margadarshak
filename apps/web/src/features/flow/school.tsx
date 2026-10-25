"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { ArrowUpRight, Bus, Car, GraduationCap, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { BackLink } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";
import { ruleRow } from "@/lib/journey/rules";
import { recordScreen } from "@/lib/journey/trial-log";
import { useFlow } from "./flow-case";

const CASES = [
  { id: "transport", Icon: Bus, rule: "ELIG-TRANSPORT-LMV-PREREQ" },
  { id: "adtc", Icon: GraduationCap, rule: "NTC-ADTC-OPTION" },
  { id: "remedial", Icon: RotateCcw, rule: "PRM-REMEDIAL-AFTER-FAIL" },
  { id: "vehicle", Icon: Car, rule: "DOC-TEST-VEHICLE-PAPERS" },
] as const;

/** "Learning with a driving school?" card for the bridge and DL screens. */
export function SchoolCard() {
  const t = useTranslations("flow.school");
  return (
    <Link
      href="/dl/school"
      className="mj-card mj-card--soft"
      style={{ textDecoration: "none", color: "inherit" }}
      data-testid="school-card"
    >
      <span className="mj-chips">
        <GraduationCap aria-hidden="true" size={20} />
        <strong>{t("cardTitle")}</strong>
      </span>
      <span className="mj-caption">{t("cardLine")}</span>
    </Link>
  );
}

/**
 * Driving schools (F-12, D-05): not compulsory for private classes; the four cases where a school
 * matters, each with the rule row behind it. An accredited-centre (ADTC) choice is saved on the case
 * and changes the DL checklist; the LL stage is unchanged.
 */
export function DrivingSchools() {
  const t = useTranslations("flow.school");
  const tf = useTranslations("flow");
  const s = useFlow();

  useEffect(() => {
    recordScreen("dl.school");
  }, []);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  const adtc = s.answers["route_adtc"] === "yes";

  return (
    <div className="mj-screen" data-screen="SCR-DL-SCHOOL">
      <BackLink href="/">{tf("back")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("title")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>
      <p className="mj-chips">
        <StatusGlyph kind="done" size={20} />
        <strong>{t("notCompulsory")}</strong>
      </p>
      <ul className="fl-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {CASES.map(({ id, Icon, rule }) => {
          const src = ruleRow(rule)?.source;
          return (
            <li key={id} className="fl-doc" style={{ gridTemplateColumns: "40px 1fr" }}>
              <span className="fl-doc__icon">
                <Icon aria-hidden="true" />
              </span>
              <span>
                <strong>{t(`cases.${id}.h`)}</strong>
                <small style={{ fontSize: "0.95rem", color: "var(--md-ink-2)" }}>
                  {t(`cases.${id}.b`)}
                </small>
                {src ? (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="md-link mj-caption"
                  >
                    {t("source")} <ArrowUpRight aria-hidden="true" size={12} />
                  </a>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {s.active ? (
        <section className="mj-card" aria-live="polite">
          {adtc ? <p>{t("chosen")}</p> : null}
          <Button
            variant={adtc ? "secondary" : "primary"}
            size="lg"
            fullWidth
            onPress={() => void s.save({ route_adtc: adtc ? "no" : "yes" })}
            data-testid="school-adtc"
          >
            {adtc ? t("undo") : t("choose")}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

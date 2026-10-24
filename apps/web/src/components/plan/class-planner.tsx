"use client";

import { Checkbox } from "@heroui/react";
import type { Plan } from "@margdarshak/rules";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { RuleSource, useFmt, VerifyChip } from "@/components/journey/rule-source";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink } from "@/components/journey/status";
import { CLASS_PICTURE, VehiclePictogram } from "@/components/journey/vehicle-pictogram";
import { Link, useRouter } from "@/i18n/navigation";
import { computePlan } from "@/lib/journey/api";
import { addDays } from "@/lib/journey/dates";
import { bandOf, type PlanRecord, toEngineInput } from "@/lib/journey/plan-model";
import { savePlan } from "@/lib/journey/plan-store";
import { allClasses, planOnDevice, ruleRow, SOURCES } from "@/lib/journey/rules";
import { recordScreen } from "@/lib/journey/trial-log";
import { usePlanFromUrl } from "./use-plan-record";

/** Per-class fee (each `per: "class"` item once), from fees.json. */
function perClassPaise(): number {
  return SOURCES.fees.items.filter((i) => i.per === "class").reduce((n, i) => n + i.amount, 0);
}

/**
 * Smart class planner (SCR-015, MD-105, F-03, EC-21). Classes added now share one LL and one
 * 30-day wait; the comparison says what "one after the other" would mean in waits and dates. Fees
 * are still per class, so the text never claims a fee saving.
 */
export function ClassPlannerScreen() {
  const { record, status } = usePlanFromUrl();
  const t = useTranslations("planner");
  if (status === "loading")
    return (
      <div className="mj-screen" aria-busy="true" data-screen="SCR-015">
        <Skeleton className="mj-skel-row" />
      </div>
    );
  if (!record)
    return (
      <div className="mj-screen" data-screen="SCR-015">
        <EmptyState
          as="h1"
          title={t("noPlan")}
          action={
            <Link href="/plan" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {t("makePlan")}
            </Link>
          }
        />
      </div>
    );
  return <Planner record={record} />;
}

function Planner({ record }: { record: PlanRecord }) {
  const t = useTranslations("planner");
  const rt = useRuleText();
  const { inr, date } = useFmt();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(record.plan.requested_classes);
  const [preview, setPreview] = useState<Plan>(record.plan);
  const [busy, setBusy] = useState(false);
  const band = bandOf(record.answers.age, record.asOf);
  const minor = band === "16_17" || band === "under_16";

  useEffect(() => {
    recordScreen("plan.classes");
  }, []);

  // Live preview of the comparison with the TS engine (same as the server's).
  useEffect(() => {
    if (selected.length === 0) return;
    const vehicles = selected.map((c) => CLASS_PICTURE[c]).filter((p): p is string => !!p);
    try {
      setPreview(planOnDevice(toEngineInput({ ...record.answers, vehicles }, record.asOf)));
    } catch {
      // keep the last preview
    }
  }, [selected, record]);

  const primary = preview.bundles[0];
  const n = primary?.classes.length ?? 0;
  const together = primary?.earliest_licence ?? null;
  const minWait =
    record.plan.saving?.wait_days_saved && n > 1
      ? record.plan.saving.wait_days_saved / (n - 1)
      : 30;
  const sequential = together && n > 1 ? addDays(together, minWait * (n - 1)) : together;
  const hasLmv = selected.includes("LMV-NT");
  const scNote = ruleRow("NTC-SC-LMV-7500KG");

  const rows = useMemo(() => allClasses(), []);

  const update = async () => {
    setBusy(true);
    const vehicles = selected.map((c) => CLASS_PICTURE[c]).filter((p): p is string => !!p);
    const next = await computePlan({ ...record.answers, vehicles });
    const rec: PlanRecord = { ...next, id: record.id };
    savePlan(rec);
    router.push(`/plan/card?id=${encodeURIComponent(rec.id)}`);
  };

  return (
    <div className="mj-screen" data-screen="SCR-015">
      <BackLink href={`/plan/card?id=${encodeURIComponent(record.id)}`}>{t("backToPlan")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title" id="cp-h1">
          {t("h1")}
        </h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>

      <fieldset className="mj-card" style={{ border: 0, margin: 0 }}>
        <legend className="md-sr-only">{t("h1")}</legend>
        {rows.map((c) => {
          const lockedMinor = minor && c.code !== "MC50CC";
          const res = preview.classes.find((x) => x.class_code === c.code);
          const isOn = selected.includes(c.code);
          return (
            <Checkbox
              key={c.code}
              isSelected={isOn}
              isDisabled={lockedMinor}
              onChange={(v) =>
                setSelected((s) => (v ? [...s, c.code] : s.filter((x) => x !== c.code)))
              }
              className="mj-check"
            >
              <Checkbox.Content className="mj-check-row" style={{ alignItems: "center" }}>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span className="mj-class__pic" aria-hidden="true">
                  <VehiclePictogram picture={CLASS_PICTURE[c.code] ?? "car"} />
                </span>
                <span className="mj-choice__text">
                  <span className="mj-choice__label">
                    {rt(c.nameKey, c.name.en)} <span className="mj-code">{c.code}</span>
                  </span>
                  <span className="mj-choice__desc">
                    {lockedMinor
                      ? t("fromAge", { age: c.minAge })
                      : res && !res.eligible && res.eligible_from
                        ? t("addFrom", { date: date(res.eligible_from, "long") })
                        : t("perClass", { fee: inr(perClassPaise()) })}
                  </span>
                </span>
                {c.contentDepth !== "deep" || !c.verified ? <VerifyChip /> : null}
              </Checkbox.Content>
            </Checkbox>
          );
        })}
      </fieldset>

      {preview.bundles.length > 1 ? (
        <Banner tone="info" title={t("splitTitle")}>
          {t("splitBody", { date: date(preview.bundles[1]?.ll_from ?? record.asOf, "long") })}
        </Banner>
      ) : null}

      {n > 1 && together ? (
        <section className="mj-card" aria-labelledby="cp-compare">
          <h2 id="cp-compare" className="mj-h2">
            {t("compareTitle")}
          </h2>
          <table className="mj-compare" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col" className="md-sr-only">
                  {t("what")}
                </th>
                <th scope="col">{t("together")}</th>
                <th scope="col">{t("sequential")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{t("waits")}</th>
                <td className="mj-num">{t("waitsValue", { n: 1 })}</td>
                <td className="mj-num">{t("waitsValue", { n })}</td>
              </tr>
              <tr>
                <th scope="row">{t("earliest")}</th>
                <td className="mj-num">~ {date(together)}</td>
                <td className="mj-num">~ {sequential ? date(sequential) : ""}</td>
              </tr>
              <tr>
                <th scope="row">{t("fee")}</th>
                <td className="mj-num">{primary ? inr(primary.fees.total_paise) : ""}</td>
                <td>
                  {t("feeTbc")} <VerifyChip />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mj-caption">{t("ifSequential")}</p>
        </section>
      ) : null}

      {hasLmv && scNote ? (
        <div className="mj-card mj-card--well">
          <p>{rt(scNote.textKey, scNote.text?.en)}</p>
          <RuleSource
            prov={{
              source_title: scNote.source.title,
              source_url: scNote.source.url,
              grade: scNote.grade,
              checked_on: scNote.checkedOn,
              confidence: scNote.confidence,
              verified: scNote.verified,
            }}
          />
        </div>
      ) : null}

      <div className="mj-sticky mj-actions">
        <Button
          variant="primary"
          size="lg"
          isDisabled={selected.length === 0}
          isPending={busy}
          onPress={() => void update()}
        >
          {selected.length === 0 ? t("chooseOne") : t("update")}
        </Button>
      </div>
    </div>
  );
}

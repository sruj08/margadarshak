"use client";

import { Disclosure } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { Chip } from "@margdarshak/ui/components/chip";
import { PictureCardGroup, type PictureOption } from "@margdarshak/ui/components/picture-card";
import { ProgressBar } from "@margdarshak/ui/components/progress";
import { QuestionScreen } from "@margdarshak/ui/components/question-screen";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { ArrowLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckRow, ChoiceCards } from "@/components/journey/choices";
import {
  DateParts,
  type DateValue,
  EMPTY_DATE,
  fromIso,
  toIso,
} from "@/components/journey/date-parts";
import { useRuleText } from "@/components/journey/rule-text";
import { CLASS_PICTURE, VehiclePictogram } from "@/components/journey/vehicle-pictogram";
import { useRouter } from "@/i18n/navigation";
import { computePlan, setApiLocale } from "@/lib/journey/api";
import { istToday } from "@/lib/journey/dates";
import {
  type AadhaarAnswer,
  AGE_BANDS,
  type AgeAnswer,
  type AgeBand,
  ageFromDob,
  bandOf,
  type PlanAnswers,
} from "@/lib/journey/plan-model";
import { getPlan, readPlanDraft, savePlan, writePlanDraft } from "@/lib/journey/plan-store";
import {
  allClasses,
  DEFAULT_STATE,
  STATE_CODES,
  type StateCode,
  statePartial,
} from "@/lib/journey/rules";
import { recordScreen } from "@/lib/journey/trial-log";

/**
 * Licence Plan in 3 taps (SCR-010..013, MD-101, F-02). Age (band, full date of birth, or year only
 * for EC-01) → vehicle pictures (every class in classes.json) → state and the Aadhaar-address
 * sub-question (EC-02) → the plan. No login, no phone number; works offline (MD-108).
 */

type Step = 1 | 2 | 3 | 4;

/** The six everyday tiles first; the rest of classes.json behind "More vehicle types". */
const MAIN_PICTURES = ["scooter", "bike_gear", "car", "auto_rickshaw", "truck", "adapted_vehicle"];

export function PlanWizard({ initialStep }: { initialStep?: number }) {
  const t = useTranslations("wizard");
  const tc = useTranslations("common");
  const rt = useRuleText();
  const locale = useLocale();
  const router = useRouter();
  const today = istToday();

  const [step, setStep] = useState<Step>(1);
  const [band, setBand] = useState<AgeBand | null>(null);
  const [dob, setDob] = useState<DateValue>(EMPTY_DATE);
  const [yearOnly, setYearOnly] = useState(false);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [state, setState] = useState<StateCode>(DEFAULT_STATE);
  const [aadhaar, setAadhaar] = useState<AadhaarAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [building, setBuilding] = useState<string[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // Restore the draft (back button, reload, "Change my answers").
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    setApiLocale(locale);
    // The card renders from this phone, so prefetch its route: the plan then works offline (MD-108).
    router.prefetch("/plan/card");
    const params = new URLSearchParams(window.location.search);
    const from = getPlan(params.get("from"));
    const d = from ? { ...from.answers, step: 1 } : readPlanDraft();
    if (d.age?.kind === "band") setBand(d.age.band);
    if (d.age?.kind === "dob") setDob(fromIso(d.age.dob));
    if (d.age?.kind === "year") {
      setYearOnly(true);
      setDob({ d: "", m: "", y: String(d.age.year) });
    }
    if (d.vehicles) setVehicles(d.vehicles);
    if (d.state) setState(d.state);
    if (d.aadhaar !== undefined) setAadhaar(d.aadhaar);
    const s = Number(params.get("step") ?? initialStep ?? d.step ?? 1);
    if (s === 2 || s === 3) setStep(s);
  }, [initialStep, locale, router]);

  const age: AgeAnswer | null = useMemo(() => {
    if (yearOnly && /^\d{4}$/.test(dob.y)) return { kind: "year", year: Number(dob.y) };
    const iso = toIso(dob);
    if (!yearOnly && iso) return { kind: "dob", dob: iso };
    if (band) return { kind: "band", band };
    return null;
  }, [band, dob, yearOnly]);

  const ageBand = age ? bandOf(age, today) : null;
  const minor = ageBand === "16_17" || ageBand === "under_16";
  const ageYears = age?.kind === "dob" ? ageFromDob(age.dob, today) : null;

  useEffect(() => {
    if (!loaded.current) return;
    writePlanDraft({
      ...(age ? { age } : {}),
      vehicles,
      state,
      aadhaar,
      step,
    });
  }, [age, vehicles, state, aadhaar, step]);

  useEffect(() => {
    recordScreen(`plan.step${step}`);
    document.getElementById("plan-q")?.focus();
  }, [step]);

  // Minors can only take the 50 cc class: drop anything else they had picked.
  useEffect(() => {
    if (minor) setVehicles((v) => v.filter((p) => p === "scooter_50cc"));
  }, [minor]);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(s));
    window.history.replaceState(null, "", url);
  };

  const fail = (msg: string) => {
    setError(msg);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const nextFromAge = () => {
    if (!age) {
      const anyDob = dob.d || dob.m || dob.y;
      return fail(anyDob ? t("errDate") : t("errAge"));
    }
    if (age.kind === "dob") {
      const years = ageFromDob(age.dob, today);
      if (age.dob > today || years > 100) return fail(t("errDate"));
    }
    if (age.kind === "year") {
      const y = Number(today.slice(0, 4));
      if (age.year > y || age.year < y - 100) return fail(t("errYear"));
    }
    go(2);
  };

  const nextFromVehicles = () => {
    if (vehicles.length === 0) return fail(t("errVehicle"));
    go(3);
  };

  const build = async () => {
    if (!age) return go(1);
    if (aadhaar === null) return fail(t("errAadhaar"));
    const answers: PlanAnswers = { age, vehicles, state, aadhaar };
    go(4);
    const started = performance.now();
    const lines = [
      t("buildAge"),
      t("buildClasses"),
      t("buildFees", { state: tc(`state.${state}`) }),
      t("buildDates"),
    ];
    setBuilding(lines.slice(0, 1));
    try {
      const rec = await computePlan(answers);
      const ms = performance.now() - started;
      if (ms > 300) {
        for (let i = 2; i <= lines.length; i++) {
          setBuilding(lines.slice(0, i));
          await new Promise((r) => setTimeout(r, 120));
        }
      }
      savePlan(rec);
      writePlanDraft(null);
      router.replace(`/plan/card?id=${encodeURIComponent(rec.id)}`);
    } catch {
      setStep(3);
      fail(t("errBuild"));
    }
  };

  const progress = (n: number) => (
    <ProgressBar label={t("progress", { n, total: 3 })} value={n} max={3} />
  );

  const back = (to: Step | null) =>
    to === null ? (
      <a href={`/${locale}`} className="mj-back">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        <span>{tc("home")}</span>
      </a>
    ) : (
      <button
        type="button"
        className="mj-back"
        style={{ background: "none", border: 0, cursor: "pointer" }}
        onClick={() => go(to)}
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        <span>{tc("back")}</span>
      </button>
    );

  const errorSummary = error ? (
    <div ref={summaryRef} tabIndex={-1} role="alert" className="mj-error-summary">
      <strong>{tc("problem")}</strong>
      <span>{error}</span>
    </div>
  ) : null;

  const primary = (label: string) => (
    <Button variant="primary" size="lg" type="submit">
      {label}
    </Button>
  );

  if (step === 4) {
    return (
      <section className="mj-screen" data-screen="SCR-013" aria-busy="true">
        <h1 className="mj-title" id="plan-q" tabIndex={-1}>
          {t("buildingTitle")}
        </h1>
        <ul className="mj-building" aria-live="polite">
          {building.map((line, i) => (
            <li key={line}>
              <StatusGlyph kind={i === building.length - 1 ? "now" : "done"} size={22} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        {errorSummary}
      </section>
    );
  }

  if (step === 1) {
    return (
      <QuestionScreen
        screenId="SCR-010"
        back={back(null)}
        progress={progress(1)}
        errorSummary={errorSummary}
        question={
          <span id="plan-q" tabIndex={-1}>
            {t("ageTitle")}
          </span>
        }
        hint={t("ageHint")}
        whyWeAsk={{ label: tc("whyWeAsk"), body: t("ageWhy") }}
        onSubmit={(e) => {
          e.preventDefault();
          nextFromAge();
        }}
        primaryAction={primary(tc("next"))}
        autosaveNote={<span>{t("dobStays")}</span>}
      >
        <ChoiceCards
          labelledBy="plan-q"
          value={band}
          onChange={(v) => {
            setBand(v as AgeBand);
            if (dob.d || dob.m || dob.y) {
              setDob(EMPTY_DATE);
              setAnnounce(t("dobCleared"));
            }
          }}
          choices={AGE_BANDS.map((b) => ({ id: b, label: t(`band.${b}`) }))}
        />
        <div className="mj-or" aria-hidden="true">
          {t("or")}
        </div>
        <DateParts
          legend={yearOnly ? t("yearLegend") : t("dobLegend")}
          hint={yearOnly ? t("yearHint") : t("dobHint")}
          value={dob}
          yearOnly={yearOnly}
          labels={{ day: t("day"), month: t("month"), year: t("year") }}
          onChange={(v) => {
            setDob(v);
            if (band && (v.d || v.m || v.y)) {
              setBand(null);
              setAnnounce(t("bandCleared"));
            }
          }}
        />
        <CheckRow
          checked={yearOnly}
          onChange={(v) => {
            setYearOnly(v);
            setBand(null);
          }}
          description={t("yearOnlyDesc")}
        >
          {t("yearOnly")}
        </CheckRow>
        <p className="md-sr-only" aria-live="polite">
          {announce}
        </p>
        <p className="mj-caption">{t("someoneElse")}</p>
      </QuestionScreen>
    );
  }

  if (step === 2) {
    const classes = allClasses();
    const byPicture = new Map<string, (typeof classes)[number]>();
    for (const c of classes) {
      const pic = CLASS_PICTURE[c.code];
      if (pic) byPicture.set(pic, c);
    }
    const option = (pic: string): PictureOption | null => {
      const c = byPicture.get(pic);
      if (!c) return null;
      const name = rt(c.nameKey, c.name.en);
      const min = c.minAge;
      let disabledReason: string | undefined;
      let caption = `${name} · ${c.code}`;
      if (minor && c.code !== "MC50CC") disabledReason = t("fromAge", { age: min });
      else if (ageYears !== null && ageYears < min)
        caption = `${caption} · ${t("fromAge", { age: min })}`;
      else if (ageBand === "18_19" && min >= 20)
        caption = `${caption} · ${t("fromAge", { age: min })}`;
      return {
        id: pic,
        label: t(`pic.${pic}` as "pic.car"),
        caption,
        picture: <VehiclePictogram picture={pic} />,
        ...(disabledReason ? { disabledReason } : {}),
      };
    };
    const main = (minor ? ["scooter_50cc", ...MAIN_PICTURES] : MAIN_PICTURES)
      .map(option)
      .filter((o): o is PictureOption => o !== null);
    const more = Object.values(CLASS_PICTURE)
      .filter((p) => !main.some((m) => m.id === p))
      .map(option)
      .filter((o): o is PictureOption => o !== null);
    const selectedMore = vehicles.filter((v) => more.some((m) => m.id === v)).length;
    return (
      <QuestionScreen
        screenId="SCR-011"
        back={back(1)}
        progress={progress(2)}
        errorSummary={errorSummary}
        question={
          <span id="plan-q" tabIndex={-1}>
            {t("vehicleTitle")}
          </span>
        }
        hint={minor ? t("vehicleMinor") : t("vehicleHint")}
        whyWeAsk={{ label: tc("whyWeAsk"), body: t("vehicleWhy") }}
        onSubmit={(e) => {
          e.preventDefault();
          nextFromVehicles();
        }}
        primaryAction={primary(
          vehicles.length > 0 ? t("nextCount", { n: vehicles.length }) : tc("next"),
        )}
      >
        <div className="mj-pics">
          <PictureCardGroup
            selectionMode="multiple"
            label={<span className="md-sr-only">{t("vehicleTitle")}</span>}
            options={main}
            value={vehicles.filter((v) => main.some((m) => m.id === v))}
            onChange={(v) =>
              setVehicles([...v, ...vehicles.filter((x) => more.some((m) => m.id === x))])
            }
          />
        </div>
        <Disclosure className="md-why" defaultExpanded={selectedMore > 0}>
          <Disclosure.Heading className="md-why__heading">
            <Disclosure.Trigger className="md-why__trigger">
              <StatusGlyph kind="info" size={20} />
              <span>{t("moreVehicles", { n: more.length })}</span>
              <Disclosure.Indicator className="md-why__indicator" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="md-why__body">
              <div className="mj-pics">
                <PictureCardGroup
                  selectionMode="multiple"
                  label={
                    <span className="md-sr-only">{t("moreVehicles", { n: more.length })}</span>
                  }
                  options={more}
                  value={vehicles.filter((v) => more.some((m) => m.id === v))}
                  onChange={(v) =>
                    setVehicles([...vehicles.filter((x) => main.some((m) => m.id === x)), ...v])
                  }
                />
              </div>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
        <Disclosure className="md-why">
          <Disclosure.Heading className="md-why__heading">
            <Disclosure.Trigger className="md-why__trigger">
              <StatusGlyph kind="info" size={20} />
              <span>{t("scooterVsBike")}</span>
              <Disclosure.Indicator className="md-why__indicator" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="md-why__body">{t("scooterVsBikeBody")}</Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
        <p className="md-sr-only" aria-live="polite">
          {t("selectedCount", { n: vehicles.length })}
        </p>
      </QuestionScreen>
    );
  }

  return (
    <QuestionScreen
      screenId="SCR-012"
      back={back(2)}
      progress={progress(3)}
      errorSummary={errorSummary}
      question={
        <span id="plan-q" tabIndex={-1}>
          {t("stateTitle")}
        </span>
      }
      whyWeAsk={{ label: tc("whyWeAsk"), body: t("stateWhy") }}
      onSubmit={(e) => {
        e.preventDefault();
        void build();
      }}
      primaryAction={primary(t("showPlan"))}
    >
      <ChoiceCards
        labelledBy="plan-q"
        value={state}
        onChange={(v) => setState(v as StateCode)}
        choices={STATE_CODES.map((code) => ({
          id: code,
          label: tc(`state.${code}`),
          aside: statePartial(code) ? (
            <Chip tone="caution" glyph={false}>
              {t("partialRules")}
            </Chip>
          ) : (
            <Chip tone="success" glyph={false}>
              {t("fullRules")}
            </Chip>
          ),
        }))}
      />
      <p className="mj-caption">{t("otherStates")}</p>
      <h2 className="mj-h2" id="plan-aadhaar">
        {t("aadhaarTitle")}
      </h2>
      <ChoiceCards
        labelledBy="plan-aadhaar"
        value={aadhaar}
        onChange={(v) => setAadhaar(v as AadhaarAnswer)}
        choices={[
          { id: "yes", label: t("aadhaarYes") },
          { id: "no", label: t("aadhaarNo"), description: t("aadhaarNoDesc") },
          { id: "none", label: t("aadhaarNone"), description: t("aadhaarNoneDesc") },
        ]}
      />
    </QuestionScreen>
  );
}

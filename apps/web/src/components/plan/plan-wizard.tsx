"use client";

import { Disclosure } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { Chip } from "@margdarshak/ui/components/chip";
import { PictureCardGroup, type PictureOption } from "@margdarshak/ui/components/picture-card";
import { ProgressBar } from "@margdarshak/ui/components/progress";
import { QuestionScreen } from "@margdarshak/ui/components/question-screen";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { ArrowLeft, ArrowUpRight, IdCard } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectFlow, IdentityCard } from "@/components/fx/moments";
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
import {
  DigiLockerConsentCard,
  DigiLockerDone,
  DigiLockerWindow,
} from "@/features/flow/digilocker-window";
import { Link, useRouter } from "@/i18n/navigation";
import { writePrefill } from "@/lib/journey/aadhaar-prefill";
import { computePlan, setApiLocale } from "@/lib/journey/api";
import { addMonths, istToday } from "@/lib/journey/dates";
import {
  type AadhaarAnswer,
  AGE_BANDS,
  type AgeAnswer,
  type AgeBand,
  ageFromDob,
  bandOf,
  type PlanAnswers,
  type PlanIntent,
} from "@/lib/journey/plan-model";
import { getPlan, readPlanDraft, savePlan, writePlanDraft } from "@/lib/journey/plan-store";
import { allClasses, DEFAULT_STATE, type StateCode, statePartial } from "@/lib/journey/rules";
import { recordScreen } from "@/lib/journey/trial-log";
import { StatePicker } from "./state-picker";

/**
 * Licence plan, in the order Sarathi and mParivahan use and only asking what the government does
 * not already know (F-02, MD-101): what you need → state → connect Aadhaar (date of birth and
 * address come from it) → what you will drive → (an LL already held: its date, EC-22) → the plan.
 * Age is asked only when Aadhaar is not connected (no Aadhaar, address elsewhere, or "type it").
 * No login; works offline (MD-108).
 */

type Step = "need" | "state" | "aadhaar" | "connect" | "age" | "vehicle" | "ll" | "build";
type AadhaarMode = "connect" | AadhaarAnswer;

const STEP_SCREEN: Record<Step, string> = {
  need: "SCR-009",
  state: "SCR-012",
  aadhaar: "SCR-012A",
  connect: "SCR-012B",
  age: "SCR-010",
  vehicle: "SCR-011",
  ll: "SCR-011B",
  build: "SCR-013",
};

/** The six everyday tiles first; the rest of classes.json behind "More vehicle types". */
const MAIN_PICTURES = ["scooter", "bike_gear", "car", "auto_rickshaw", "truck", "adapted_vehicle"];

/** The synthetic DigiLocker demo account (never a real person; D-07). */
const DEMO_DOB = "2007-06-15";

export function PlanWizard(_props: { initialStep?: number }) {
  const t = useTranslations("wizard");
  const tw = useTranslations("flow.wizard");
  const td = useTranslations("flow.digilocker");
  const tc = useTranslations("common");
  const rt = useRuleText();
  const locale = useLocale();
  const router = useRouter();
  const today = istToday();

  const [step, setStep] = useState<Step>("need");
  const [intent, setIntent] = useState<PlanIntent | null>(null);
  const [band, setBand] = useState<AgeBand | null>(null);
  const [dob, setDob] = useState<DateValue>(EMPTY_DATE);
  const [yearOnly, setYearOnly] = useState(false);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [state, setState] = useState<StateCode>(DEFAULT_STATE);
  const [mode, setMode] = useState<AadhaarMode | null>(null);
  const [linked, setLinked] = useState(false);
  const [connectPhase, setConnectPhase] = useState<"consent" | "fetching" | "done">("consent");
  const [llDate, setLlDate] = useState<DateValue>(EMPTY_DATE);
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
    router.prefetch("/plan/card");
    const params = new URLSearchParams(window.location.search);
    const from = getPlan(params.get("from"));
    const d = from ? { ...from.answers, step: "need" } : readPlanDraft();
    if (d.intent) setIntent(d.intent);
    if (d.age?.kind === "band") setBand(d.age.band);
    if (d.age?.kind === "dob") setDob(fromIso(d.age.dob));
    if (d.age?.kind === "year") {
      setYearOnly(true);
      setDob({ d: "", m: "", y: String(d.age.year) });
    }
    if (d.vehicles) setVehicles(d.vehicles);
    if (d.state) setState(d.state);
    if (d.aadhaarLinked) {
      setLinked(true);
      setMode("connect");
      setConnectPhase("done");
    } else if (d.aadhaar !== undefined && d.aadhaar !== null) setMode(d.aadhaar);
    if (d.llIssuedOn) setLlDate(fromIso(d.llIssuedOn));
    const s = params.get("step") ?? d.step;
    if (typeof s === "string" && s in STEP_SCREEN && s !== "build" && s !== "connect")
      setStep(s as Step);
  }, [locale, router]);

  const age: AgeAnswer | null = useMemo(() => {
    if (yearOnly && /^\d{4}$/.test(dob.y)) return { kind: "year", year: Number(dob.y) };
    const iso = toIso(dob);
    if (!yearOnly && iso) return { kind: "dob", dob: iso };
    if (band) return { kind: "band", band };
    return null;
  }, [band, dob, yearOnly]);

  const aadhaar: AadhaarAnswer | null = mode === "connect" ? (linked ? "yes" : null) : mode;
  const ageBand = age ? bandOf(age, today) : null;
  const minor = ageBand === "16_17" || ageBand === "under_16";
  const ageYears = age?.kind === "dob" ? ageFromDob(age.dob, today) : null;
  const llIso = toIso(llDate);

  useEffect(() => {
    if (!loaded.current) return;
    writePlanDraft({
      ...(intent ? { intent } : {}),
      ...(age ? { age } : {}),
      vehicles,
      state,
      aadhaar,
      aadhaarLinked: linked,
      llIssuedOn: llIso,
      step,
    });
  }, [intent, age, vehicles, state, aadhaar, linked, llIso, step]);

  useEffect(() => {
    recordScreen(`plan.${step}`);
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
    url.searchParams.set("step", s);
    window.history.replaceState(null, "", url);
  };

  const fail = (msg: string) => {
    setError(msg);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const flowSteps: Step[] = [
    "need",
    "state",
    "aadhaar",
    ...(linked ? [] : (["age"] as Step[])),
    "vehicle",
    ...(intent === "have_ll" ? (["ll"] as Step[]) : []),
  ];
  const position = (s: Step) => Math.max(1, flowSteps.indexOf(s === "connect" ? "aadhaar" : s) + 1);
  const progress = (s: Step) => (
    <ProgressBar
      label={t("progress", { n: position(s), total: flowSteps.length })}
      value={position(s)}
      max={flowSteps.length}
    />
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

  const afterVehicle = () => (intent === "have_ll" ? go("ll") : void build());

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
    go("vehicle");
  };

  const build = async () => {
    if (!intent) return go("need");
    if (aadhaar === null) return go("aadhaar");
    if (!age) return go(linked ? "aadhaar" : "age");
    if (vehicles.length === 0) return go("vehicle");
    const answers: PlanAnswers = {
      intent,
      age,
      vehicles,
      state,
      aadhaar,
      aadhaarLinked: linked,
      ...(intent === "have_ll" && llIso ? { llIssuedOn: llIso } : {}),
    };
    go("build");
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
      setStep("vehicle");
      fail(t("errBuild"));
    }
  };

  const stateName = tc(`state.${state}`);
  const profile = {
    full_name: td("accountName"),
    relative_name: "Rajesh Sharma",
    home: `House 12, Sector 4, ${stateName}`,
    dob: DEMO_DOB.split("-").reverse().join("-"),
  };

  const allow = () => {
    setConnectPhase("fetching");
  };
  const fetched = () => {
    setDob(fromIso(DEMO_DOB));
    setBand(null);
    setYearOnly(false);
    setLinked(true);
    writePrefill(profile);
    setConnectPhase("done");
  };

  /* ---------------------------------- build ---------------------------------- */
  if (step === "build") {
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

  /* ---------------------------------- 1 need ---------------------------------- */
  if (step === "need") {
    return (
      <QuestionScreen
        screenId={STEP_SCREEN.need}
        back={back(null)}
        progress={progress("need")}
        errorSummary={errorSummary}
        question={
          <span id="plan-q" tabIndex={-1}>
            {tw("needTitle")}
          </span>
        }
        hint={tw("needHint")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!intent) return fail(tw("errNeed"));
          go("state");
        }}
        primaryAction={primary(tc("next"))}
      >
        <ChoiceCards
          labelledBy="plan-q"
          value={intent}
          onChange={(v) => setIntent(v as PlanIntent)}
          choices={[
            { id: "first", label: tw("needFirst"), description: tw("needFirstDesc") },
            { id: "have_ll", label: tw("needHaveLl"), description: tw("needHaveLlDesc") },
          ]}
        />
        <div className="md-need-links">
          <Link href="/services#holder" className="md-link">
            {tw("needRenew")} <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
          <Link href="/licence" className="md-link">
            {tw("needStatus")} <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </div>
      </QuestionScreen>
    );
  }

  /* ---------------------------------- 2 state ---------------------------------- */
  if (step === "state") {
    return (
      <QuestionScreen
        screenId={STEP_SCREEN.state}
        back={back("need")}
        progress={progress("state")}
        errorSummary={errorSummary}
        question={
          <span id="plan-q" tabIndex={-1}>
            {t("stateTitle")}
          </span>
        }
        whyWeAsk={{ label: tc("whyWeAsk"), body: t("stateWhy") }}
        onSubmit={(e) => {
          e.preventDefault();
          go("aadhaar");
        }}
        primaryAction={primary(tc("next"))}
      >
        <div className="md-statepick-wrap">
          <StatePicker value={state} onChange={setState} labelledBy="plan-q" />
          <span className="mj-chips">
            {statePartial(state) ? (
              <Chip tone="caution" glyph={false}>
                {t("partialRules")}
              </Chip>
            ) : (
              <Chip tone="success" glyph={false}>
                {t("fullRules")}
              </Chip>
            )}
          </span>
        </div>
        <p className="mj-caption">{t("otherStates")}</p>
      </QuestionScreen>
    );
  }

  /* ---------------------------------- 3 aadhaar ---------------------------------- */
  if (step === "aadhaar") {
    return (
      <QuestionScreen
        screenId={STEP_SCREEN.aadhaar}
        back={back("state")}
        progress={progress("aadhaar")}
        errorSummary={errorSummary}
        question={
          <span id="plan-q" tabIndex={-1}>
            {tw("aadhaarTitle")}
          </span>
        }
        hint={tw("aadhaarHint")}
        whyWeAsk={{ label: tc("whyWeAsk"), body: tw("aadhaarWhy") }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!mode) return fail(t("errAadhaar"));
          if (mode === "connect") return linked ? go("vehicle") : go("connect");
          setLinked(false);
          writePrefill(null);
          go("age");
        }}
        primaryAction={primary(mode === "connect" && !linked ? tw("connectCta") : tc("next"))}
      >
        <ChoiceCards
          labelledBy="plan-q"
          value={mode}
          onChange={(v) => setMode(v as AadhaarMode)}
          choices={[
            {
              id: "connect",
              label: linked ? tw("connected") : tw("connect"),
              description: linked ? tw("connectedDesc") : tw("connectDesc"),
            },
            {
              id: "yes",
              label: tw("typeAge"),
              description: tw("typeAgeDesc", { state: stateName }),
            },
            { id: "no", label: t("aadhaarNo"), description: t("aadhaarNoDesc") },
            { id: "none", label: t("aadhaarNone"), description: t("aadhaarNoneDesc") },
          ]}
        />
      </QuestionScreen>
    );
  }

  /* ---------------------------------- 3b connect ---------------------------------- */
  if (step === "connect") {
    return (
      <section className="mj-screen" data-screen={STEP_SCREEN.connect}>
        {back("aadhaar")}
        {progress("connect")}
        <DigiLockerWindow
          path={connectPhase === "consent" ? "/oauth2/authorize" : "/oauth2/callback"}
        >
          {connectPhase === "consent" ? (
            <DigiLockerConsentCard
              title={td("consentTitle")}
              titleId="plan-q"
              purpose={tw("connectPurpose")}
              docs={[
                {
                  icon: <IdCard />,
                  label: td("docAadhaarShort"),
                  detail: `${td("docAadhaarFields")} · ${td("docAadhaarMask")}`,
                  required: true,
                },
              ]}
              validity={td("consentValidity")}
              onAllow={allow}
              onDeny={() => go("aadhaar")}
              allowTestId="plan-allow"
            />
          ) : null}
          {connectPhase === "fetching" ? (
            <>
              <h1 className="dlw__title" id="plan-q" tabIndex={-1}>
                {td("connectTitle")}
              </h1>
              <ConnectFlow
                labels={{ app: td("nodeApp"), locker: td("brand"), aadhaar: td("nodeAadhaar") }}
                steps={[td("s1"), td("s2"), td("s3"), td("s4")]}
                onDone={fetched}
              />
            </>
          ) : null}
          {connectPhase === "done" ? (
            <>
              <DigiLockerDone
                title={tw("fetchedTitle")}
                sub={tw("fetchedLine", { state: stateName })}
                titleId="plan-q"
              />
              <IdentityCard
                f={{
                  name: profile.full_name,
                  nameHi: td("accountNameHi"),
                  dob: profile.dob,
                  gender: td("idGenderValue"),
                  last4: td("docAadhaarMask").slice(-4),
                }}
                labels={{
                  band: td("idBand"),
                  bandHi: td("idBandHi"),
                  seal: td("idSeal"),
                  dob: td("idDob"),
                  gender: td("idGender"),
                  footer: td("idFooter"),
                }}
              />
              <p className="dlw__note">{td("kept")}</p>
            </>
          ) : null}
        </DigiLockerWindow>
        {connectPhase === "done" ? (
          <div className="mj-sticky mj-actions">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onPress={() => go("vehicle")}
              data-testid="plan-connected-next"
            >
              {tc("next")}
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  /* ---------------------------------- 4 age (no Aadhaar link) ---------------------------------- */
  if (step === "age") {
    return (
      <QuestionScreen
        screenId={STEP_SCREEN.age}
        back={back("aadhaar")}
        progress={progress("age")}
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

  /* ---------------------------------- 6 LL already held ---------------------------------- */
  if (step === "ll") {
    return (
      <QuestionScreen
        screenId={STEP_SCREEN.ll}
        back={back("vehicle")}
        progress={progress("ll")}
        errorSummary={errorSummary}
        question={
          <span id="plan-q" tabIndex={-1}>
            {tw("llTitle")}
          </span>
        }
        hint={tw("llHint")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!llIso || llIso > today) return fail(tw("errLl"));
          if (addMonths(llIso, 6) < today) return fail(tw("errLlExpired"));
          void build();
        }}
        primaryAction={primary(t("showPlan"))}
      >
        <DateParts
          legend={tw("llLegend")}
          hint={t("dobHint")}
          value={llDate}
          labels={{ day: t("day"), month: t("month"), year: t("year") }}
          onChange={setLlDate}
        />
      </QuestionScreen>
    );
  }

  /* ---------------------------------- 5 vehicle ---------------------------------- */
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
  const lastStep = intent !== "have_ll";
  return (
    <QuestionScreen
      screenId={STEP_SCREEN.vehicle}
      back={back(linked ? "aadhaar" : "age")}
      progress={progress("vehicle")}
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
        if (vehicles.length === 0) return fail(t("errVehicle"));
        afterVehicle();
      }}
      primaryAction={primary(
        lastStep
          ? t("showPlan")
          : vehicles.length > 0
            ? t("nextCount", { n: vehicles.length })
            : tc("next"),
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
                label={<span className="md-sr-only">{t("moreVehicles", { n: more.length })}</span>}
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

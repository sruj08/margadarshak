"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { Award, BadgeCheck, FileCheck2, Pause, Play, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { IndianDrivingLicenceCard } from "@/components/home/indian-driving-licence-card";
import { useFmt } from "@/components/journey/rule-source";
import { BackLink } from "@/components/journey/status";
import { Link, useRouter } from "@/i18n/navigation";
import { API_MODE, DEMO_TENANT } from "@/lib/journey/api";
import { addDays, daysBetween, istToday } from "@/lib/journey/dates";
import { recordScreen } from "@/lib/journey/trial-log";
import { DemoSkip, NoFlowCase, PseudoQr, SimRibbon } from "./bits";
import { licenceNumber, paramNumber, payLines, refFor, useFlow } from "./flow-case";
import { SchoolCard } from "./school";

const PRE_LL = new Set(["PLAN", "LL_APPLYING", "HANDED_OFF", "PAYMENT_PENDING", "LL_TEST"]);
const TWO_WHEELER = new Set(["MC50CC", "MCWOG", "MCWG"]);
const REASONS = ["balance", "line", "signal", "mirror", "stall", "parking"] as const;

function useStateName(code: string | undefined) {
  const tc = useTranslations("common");
  return code ? tc(`state.${code}` as "state.JK") : "";
}

/** S5: DL application, prefilled from the LL; fee (DL stage of fees.json); then the slot. */
export function DlApply() {
  const t = useTranslations("flow.dl");
  const tf = useTranslations("flow");
  const ts = useTranslations("flow.school");
  const { inr, date } = useFmt();
  const router = useRouter();
  const s = useFlow();
  const stateName = useStateName(s.plan?.state);
  const c = s.caseData;
  const st = c?.state ?? "PLAN";
  useEffect(() => {
    recordScreen("dl.apply");
  }, []);
  useEffect(() => {
    if (st === "TEST_BOOKED") router.replace("/dl/test-day");
    else if (st === "TEST_FAILED") router.replace("/dl/retest");
    else if (st === "AWAITING_APPROVAL" || st === "DL_ISSUED" || st === "DL_HOLDER")
      router.replace("/dl/issued");
  }, [st, router]);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan) return <NoFlowCase />;
  if (PRE_LL.has(st))
    return (
      <div className="mj-screen">
        <BackLink href="/">{tf("back")}</BackLink>
        <h1 className="mj-title">{t("applyTitle")}</h1>
        <Link
          href="/test/ll"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {tf("pay.next.ll")}
        </Link>
      </div>
    );
  const today = istToday();
  const unlock = c?.key_dates?.["dl_test_unlock"] ?? null;
  const early = unlock ? daysBetween(today, unlock) : 0;
  const lines = payLines(s.plan, "dl");
  const total = lines.reduce((n, l) => n + l.amount, 0);
  const paid = s.answers["dl_fee_paid"] === "yes";
  const classes = c?.classes.map((x) => x.class_code) ?? [];
  const twoWheeler = classes.some((x) => TWO_WHEELER.has(x));
  const llNo = s.vault["ll_number"] || (c?.ll?.number_last4 ? `•••• ${c.ll.number_last4}` : "");

  return (
    <div className="mj-screen" data-screen="SCR-DL-APPLY">
      <BackLink href="/">{tf("back")}</BackLink>
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <h1 className="mj-title">{t("applyTitle")}</h1>
        <p className="mj-sub">{t("applySub")}</p>
      </header>

      {early > 0 && unlock ? (
        <section className="mj-card mj-card--soft" aria-labelledby="dl-early">
          <h2 id="dl-early" className="mj-h2">
            {t("notYet", { date: date(unlock, "long") })}
          </h2>
          <p>{t("notYetLine", { n: early })}</p>
          <Link
            href="/dl/track"
            className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
          >
            {t("trackTitle")}
          </Link>
        </section>
      ) : null}

      {c?.ll ? (
        <section className="mj-card" aria-labelledby="dl-ll">
          <h2 id="dl-ll" className="mj-card__title">
            {t("ll")}
          </h2>
          <div className="fl-doc">
            <span className="fl-doc__icon">
              <FileCheck2 aria-hidden="true" />
            </span>
            <span>
              <strong>{stateName}</strong>
              <small className="mj-num">
                {t("llLine", { number: llNo, date: date(c.ll.expires_on, "long") })}
              </small>
            </span>
            <StatusGlyph kind="done" size={20} />
          </div>
        </section>
      ) : null}

      <section className="mj-card" aria-labelledby="dl-docs">
        <h2 id="dl-docs" className="mj-card__title">
          {t("docsTitle")}
        </h2>
        <ul className="mj-ticks">
          <li>
            <StatusGlyph kind="done" size={20} />
            <span>{t("docLl")}</span>
          </li>
          <li>
            <StatusGlyph kind="info" size={20} />
            <span>{t("docId")}</span>
          </li>
          {s.ctx.form1aNeeded ? (
            <li>
              <StatusGlyph kind="info" size={20} />
              <span>{t("doc1a")}</span>
            </li>
          ) : null}
          <li>
            <StatusGlyph kind="info" size={20} />
            <span>{t("docVehicle")}</span>
          </li>
          {twoWheeler ? (
            <li>
              <StatusGlyph kind="info" size={20} />
              <span>{t("docHelmet")}</span>
            </li>
          ) : null}
          {s.answers["route_adtc"] === "yes" ? (
            <li data-testid="doc-adtc">
              <StatusGlyph kind="info" size={20} />
              <span>{ts("docAdtc")}</span>
            </li>
          ) : null}
        </ul>
      </section>

      <SchoolCard />

      <section className="mj-card" aria-labelledby="dl-fee">
        <h2 id="dl-fee" className="mj-card__title">
          {t("feeTitle")}
        </h2>
        <p className="mj-big-fee mj-num" data-testid="dl-fee">
          {inr(total)}
        </p>
        <p className="mj-caption">{t("feeNote")}</p>
      </section>

      {early > 0 ? (
        <DemoSkip
          days={early}
          onSkip={async () => {
            await s.skip(early);
          }}
        />
      ) : null}
      <div className="mj-sticky mj-actions">
        <Link
          href={paid ? "/dl/slot" : "/pay?for=dl"}
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          data-testid="dl-continue"
        >
          {paid ? t("toSlot") : t("pay", { amount: inr(total) })}
        </Link>
      </div>
    </div>
  );
}

/** S6: appointment slip, what to bring, the evening-before message, and the (simulated) result. */
export function TestDay() {
  const t = useTranslations("flow.dl");
  const tf = useTranslations("flow");
  const { date } = useFmt();
  const router = useRouter();
  const s = useFlow();
  const [result, setResult] = useState<"pass" | "fail" | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);

  useEffect(() => {
    recordScreen("dl.test_day");
  }, []);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan) return <NoFlowCase />;
  const c = s.caseData;
  const slot = c?.key_dates?.["slot_date"] ?? null;
  if (!slot || c?.state !== "TEST_BOOKED")
    return (
      <div className="mj-screen">
        <BackLink href="/">{tf("back")}</BackLink>
        <h1 className="mj-title">{t("slipTitle")}</h1>
        <Link
          href="/dl/apply"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("toSlot")}
        </Link>
      </div>
    );

  const today = istToday();
  const untilTest = daysBetween(today, slot);
  const time = String(s.answers["slot_time"] ?? "09:30");
  const office = String(s.answers["slot_office"] ?? "RTO");
  const classes = c.classes.map((x) => x.class_code);
  const twoWheeler = classes.some((x) => TWO_WHEELER.has(x));
  const appNo = s.vault["application_number"] || refFor(`${c.case_id}:app`, 10);

  const testOn = [slot, today].sort()[0] ?? today;
  const record = async () => {
    if (result === "pass") {
      const ok = await s.act("test_passed", { test: "dl" }, testOn);
      if (ok) router.push("/dl/issued");
    } else if (result === "fail") {
      const on = testOn;
      const ok = await s.act("test_failed", { test: "dl", reason_codes: reasons }, on);
      if (!ok) return;
      await s.save({ last_fail_on: on, fail_reasons: reasons.join(",") });
      router.push("/dl/retest");
    }
  };

  return (
    <div className="mj-screen" data-screen="SCR-DL-TESTDAY">
      <BackLink href="/">{tf("back")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("slipTitle")}</h1>
        <p className="mj-sub">{t("slipSub")}</p>
      </header>

      <article className="fl-cert" data-testid="slot-slip">
        <div className="fl-cert__head">
          <span className="fl-cert__title">{t("slipTitle")}</span>
          <span className="fl-stamp">✓ {t("booked")}</span>
        </div>
        <div className="fl-cert__grid">
          <dl className="fl-kv">
            <div>
              <dt>{t("when")}</dt>
              <dd className="mj-num">
                {date(slot, "long")} · {time}
              </dd>
            </div>
            <div>
              <dt>{t("where")}</dt>
              <dd>{office}</dd>
            </div>
            <div>
              <dt>{tf("pay.appNo")}</dt>
              <dd className="mj-num">{appNo}</dd>
            </div>
          </dl>
          <PseudoQr seed={`${c.case_id}:slip:${slot}`} label={t("slipQr")} />
        </div>
      </article>

      <section className="mj-card" aria-labelledby="td-bring">
        <h2 id="td-bring" className="mj-card__title">
          {t("bring")}
        </h2>
        <ul className="mj-ticks">
          <li>
            <StatusGlyph kind="info" size={20} />
            <span>{t("docLl")}</span>
          </li>
          <li>
            <StatusGlyph kind="info" size={20} />
            <span>{t("docId")}</span>
          </li>
          {s.ctx.form1aNeeded ? (
            <li>
              <StatusGlyph kind="info" size={20} />
              <span>{t("doc1a")}</span>
            </li>
          ) : null}
          <li>
            <StatusGlyph kind="info" size={20} />
            <span>{t("docVehicle")}</span>
          </li>
          {twoWheeler ? (
            <li>
              <StatusGlyph kind="info" size={20} />
              <span>{t("docHelmet")}</span>
            </li>
          ) : null}
        </ul>
      </section>

      <section className="mj-card mj-card--well" aria-labelledby="td-eve">
        <h2 id="td-eve" className="mj-card__title">
          {t("eveTitle")}
        </h2>
        <p className="fl-wa">
          {t("eveMsg", { time, office })}
          <small>{t("eveChannel")}</small>
        </p>
      </section>

      <Link
        href="/dl/track"
        className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
      >
        {t("trackTitle")}
      </Link>

      {untilTest > 0 && API_MODE === "mock" && DEMO_TENANT ? (
        <DemoSkip
          days={untilTest}
          label={t("toTestDay")}
          onSkip={async () => {
            await s.skip(untilTest);
          }}
        />
      ) : (
        <section className="mj-card" aria-labelledby="td-rto">
          <h2 id="td-rto" className="mj-h2">
            {t("atRto")}
          </h2>
          <p className="mj-caption">{t("atRtoLine")}</p>
          <div className="fl-tabs">
            <button
              type="button"
              aria-pressed={result === "pass"}
              className="fl-opt"
              onClick={() => setResult("pass")}
              data-testid="result-pass"
            >
              <strong>✓ {t("passed")}</strong>
            </button>
            <button
              type="button"
              aria-pressed={result === "fail"}
              className="fl-opt"
              onClick={() => setResult("fail")}
              data-testid="result-fail"
            >
              <strong>↺ {t("notPassed")}</strong>
            </button>
          </div>
          {result === "fail" ? (
            <fieldset className="fl-grid" style={{ border: 0, padding: 0 }}>
              <legend className="mj-card__title">{t("reasonsTitle")}</legend>
              {REASONS.map((r) => (
                <label
                  key={r}
                  className="mj-check-row"
                  style={{ display: "flex", gap: 10, alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={reasons.includes(r)}
                    onChange={(e) =>
                      setReasons((v) => (e.target.checked ? [...v, r] : v.filter((x) => x !== r)))
                    }
                  />
                  <span>{t(`reason.${r}`)}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {s.error ? <p className="mj-error">{tf("error")}</p> : null}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            isDisabled={!result || s.busy}
            onPress={() => void record()}
            data-testid="result-record"
          >
            {t("record")}
          </Button>
          <SimRibbon />
        </section>
      )}
    </div>
  );
}

/** Track explainer (F-12): the test layout animated, step by step, plus why people don't pass. */
export function TrackExplainer() {
  const t = useTranslations("flow.dl");
  const tf = useTranslations("flow");
  const s = useFlow();
  const stateName = useStateName(s.plan?.state);
  const classes = s.caseData?.classes.map((x) => x.class_code) ?? s.plan?.requested_classes ?? [];
  const [kind, setKind] = useState<"tw" | "lmv">(
    classes.length > 0 && !classes.some((x) => TWO_WHEELER.has(x)) ? "lmv" : "tw",
  );
  const [playing, setPlaying] = useState(false);
  const [stepI, setStepI] = useState(0);
  const reduce = useRef(false);

  useEffect(() => {
    recordScreen("dl.track");
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setStepI((i) => (i + 1) % 4), 2200);
    return () => clearInterval(h);
  }, [playing]);

  const dlTest = s.plan?.dl_test;
  const path =
    kind === "tw"
      ? "M 70 120 C 70 50, 180 50, 180 120 C 180 190, 290 190, 290 120 C 290 50, 180 50, 180 120 C 180 190, 70 190, 70 120 Z"
      : "M 50 210 L 50 130 C 50 70, 140 70, 140 130 L 140 150 C 140 205, 230 205, 230 150 L 230 60 L 300 60";
  const steps = (["s1", "s2", "s3", "s4"] as const).map((k) => t(`${kind}.${k}`));
  const marks =
    kind === "tw"
      ? [
          [70, 120],
          [125, 62],
          [235, 178],
          [290, 120],
        ]
      : [
          [50, 200],
          [95, 80],
          [300, 60],
          [230, 110],
        ];

  return (
    <div className="mj-screen" data-screen="SCR-DL-TRACK">
      <BackLink href="/">{tf("back")}</BackLink>
      <header className="mj-head">
        <h1 className="mj-title">{t("trackTitle")}</h1>
        <p className="mj-sub">{t("trackSub")}</p>
        {s.plan ? (
          <p className="mj-caption">
            {dlTest?.known && dlTest.tracks[0]
              ? t("trackState", { state: stateName, detail: dlTest.tracks[0] })
              : t("trackUnknown")}
          </p>
        ) : null}
      </header>

      <div className="fl-tabs">
        {(["tw", "lmv"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            className="fl-opt"
            onClick={() => {
              setKind(k);
              setStepI(0);
            }}
          >
            <strong>{k === "tw" ? t("twoWheeler") : t("car")}</strong>
          </button>
        ))}
      </div>

      <svg className="fl-track" viewBox="0 0 360 240" role="img" aria-label={steps.join(" ")}>
        <path d={path} fill="none" stroke="#f5c542" strokeWidth="44" strokeLinejoin="round" />
        <path d={path} fill="none" stroke="#566072" strokeWidth="36" strokeLinejoin="round" />
        <path d={path} className="fl-track__lane" />
        {kind === "lmv" ? (
          <>
            <rect
              x="268"
              y="96"
              width="56"
              height="34"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
            <text x="276" y="148" className="fl-track__mark">
              P
            </text>
          </>
        ) : null}
        {marks.map(([x, y], i) => (
          <g key={`${x}-${y}`} opacity={i === stepI ? 1 : 0.55}>
            <circle
              cx={x}
              cy={y}
              r="11"
              fill={i === stepI ? "#ff9933" : "#1f2937"}
              stroke="#fff"
              strokeWidth="2"
            />
            <text x={(x ?? 0) - 4} y={(y ?? 0) + 4} className="fl-track__mark">
              {i + 1}
            </text>
          </g>
        ))}
        <circle r="9" className="fl-track__vehicle">
          {playing && !reduce.current ? (
            <animateMotion dur="8.8s" repeatCount="indefinite" path={path} />
          ) : null}
        </circle>
      </svg>

      <Button
        variant="secondary"
        size="lg"
        onPress={() => setPlaying((p) => !p)}
        data-testid="track-play"
      >
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        {playing ? t("pause") : t("play")}
      </Button>

      <ol className="fl-steps" aria-live="polite">
        {steps.map((st, i) => (
          <li key={st} aria-current={i === stepI ? "step" : undefined}>
            <span>{st}</span>
          </li>
        ))}
      </ol>

      <section className="mj-card" aria-labelledby="tr-fails">
        <h2 id="tr-fails" className="mj-card__title">
          {t("failsTitle")}
        </h2>
        <ul className="mj-ticks">
          {(["fail1", "fail2", "fail3", "fail4"] as const).map((k) => (
            <li key={k}>
              <StatusGlyph kind="info" size={20} />
              <span>{t(k)}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link
        href="/learn/practise"
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {tf("ll.toPractise")}
      </Link>
    </div>
  );
}

/** S6F: calm retest plan with the rule-pack gap, drills from the reasons, retest fee, new slot. */
export function Retest() {
  const t = useTranslations("flow.dl");
  const tf = useTranslations("flow");
  const { date } = useFmt();
  const s = useFlow();

  useEffect(() => {
    recordScreen("dl.retest");
  }, []);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan) return <NoFlowCase />;
  const gap = paramNumber(s.plan, "PRM-RETEST-GAP-DAYS", 7);
  const lastFail =
    typeof s.answers["last_fail_on"] === "string"
      ? (s.answers["last_fail_on"] as string)
      : istToday();
  const from = addDays(lastFail, gap);
  const reasons = String(s.answers["fail_reasons"] ?? "")
    .split(",")
    .filter((r): r is (typeof REASONS)[number] => (REASONS as readonly string[]).includes(r));
  const paid = s.answers["retest_fee_paid"] === "yes";

  return (
    <div className="mj-screen" data-screen="SCR-DL-RETEST">
      <BackLink href="/">{tf("back")}</BackLink>
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <h1 className="mj-title">{t("retestTitle")}</h1>
        <p className="mj-sub">{t("retestSub", { date: date(from, "long") })}</p>
        <p className="mj-caption">{t("retestGap", { days: gap })}</p>
      </header>
      <section className="mj-card" aria-labelledby="rt-drills">
        <h2 id="rt-drills" className="mj-card__title">
          {t("drills")}
        </h2>
        <ul className="mj-ticks">
          {(reasons.length > 0 ? reasons : (["mirror", "signal"] as const)).map((r) => (
            <li key={r}>
              <StatusGlyph kind="info" size={20} />
              <span>{t(`reason.${r}`)}</span>
            </li>
          ))}
        </ul>
        <Link
          href="/dl/track"
          className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
        >
          {t("trackTitle")}
        </Link>
      </section>
      {paramNumber(s.plan, "PRM-REMEDIAL-AFTER-FAIL", 1) ? (
        <p className="mj-card mj-card--well">{t("remedial")}</p>
      ) : null}
      <SchoolCard />
      <div className="mj-sticky mj-actions">
        <Link
          href={paid ? "/dl/slot?retest=1" : "/pay?for=retest"}
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
          data-testid="retest-continue"
        >
          {paid ? tf("pay.next.retest") : t("payRetest")}
        </Link>
      </div>
    </div>
  );
}

/** S7 → S8: approval, the DL card, DigiLocker pointer, card by post, the "without an agent" close. */
export function DlIssued() {
  const t = useTranslations("flow.dl");
  const tc = useTranslations("common");
  const { date } = useFmt();
  const s = useFlow();
  const approving = useRef(false);

  useEffect(() => {
    recordScreen("dl.issued");
  }, []);

  const c = s.caseData;
  const plan = s.plan;
  const caseId = c?.case_id ?? "";
  const number = plan ? licenceNumber(plan.state, `${caseId}:dl`, istToday().slice(0, 4)) : "";

  const approve = async () => {
    if (approving.current) return;
    approving.current = true;
    await s.saveVault({ dl_number: number });
    await s.act("approved", { number_last4: number.slice(-4) });
  };

  useEffect(() => {
    if (!DEMO_TENANT || c?.state !== "AWAITING_APPROVAL") return;
    const h = setTimeout(() => void approve(), 1800);
    return () => clearTimeout(h);
  });

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !plan) return <NoFlowCase />;
  const st = c?.state ?? "PLAN";
  const stateName = tc(`state.${plan.state}` as "state.JK");

  if (st === "AWAITING_APPROVAL")
    return (
      <div className="mj-screen" data-screen="SCR-DL-APPROVAL">
        <div className="fl-success" role="status" style={{ paddingTop: 40 }}>
          <span className="fl-spin" aria-hidden="true" />
          <p className="mj-h2">{t("approving")}</p>
        </div>
        <Button variant="secondary" size="lg" onPress={() => void approve()}>
          {t("approve")}
        </Button>
        <SimRibbon />
      </div>
    );
  if (st !== "DL_ISSUED" && st !== "DL_HOLDER")
    return (
      <div className="mj-screen">
        <h1 className="mj-title">{t("applyTitle")}</h1>
        <Link
          href="/dl/apply"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("applyTitle")}
        </Link>
      </div>
    );

  const dl = c?.dl;
  const dlNo = s.vault["dl_number"] || number;
  const holder = st === "DL_HOLDER";
  const covs = dl?.classes ?? c?.classes.map((x) => x.class_code) ?? [];

  return (
    <div className="mj-screen" data-screen="SCR-DL-ISSUED">
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <div className="fl-success">
          <span className="fl-success__tick">
            <BadgeCheck aria-hidden="true" />
          </span>
        </div>
        <h1 className="mj-title" style={{ textAlign: "center" }}>
          {t("issuedTitle")}
        </h1>
        <p className="mj-sub" style={{ textAlign: "center", justifySelf: "center" }}>
          {t("issuedSub")}
        </p>
      </header>

      <IndianDrivingLicenceCard
        {...(s.vault["full_name"] ? { holderName: s.vault["full_name"] } : {})}
        {...(s.vault["relative_name"] ? { guardianName: s.vault["relative_name"] } : {})}
        {...(s.vault["home"] ? { addressLine: s.vault["home"] } : {})}
        {...(s.vault["dob"] ? { dob: s.vault["dob"] } : {})}
        dlNumber={dlNo}
        {...(dl?.issued_on ? { doi: date(dl.issued_on) } : {})}
        {...(dl?.valid_to_non_transport ? { validTill: date(dl.valid_to_non_transport) } : {})}
        covCodes={covs}
        issuingAuthority={`RTO · ${stateName}`}
      />

      <section className="mj-card mj-card--soft" aria-labelledby="dl-dg">
        <h2 id="dl-dg" className="mj-card__title">
          {t("inDigilocker")}
        </h2>
        <div className="fl-doc">
          <span className="fl-doc__icon">
            <FileCheck2 aria-hidden="true" />
          </span>
          <span>{t("inDigilockerLine", { number: dlNo })}</span>
          <StatusGlyph kind="done" size={20} />
        </div>
      </section>

      <section className="mj-card" aria-labelledby="dl-post">
        <h2 id="dl-post" className="mj-card__title">
          <Truck aria-hidden="true" size={16} style={{ verticalAlign: "-3px" }} /> {t("post")}
        </h2>
        <ul className="mj-ticks">
          <li>
            <StatusGlyph kind="done" size={20} />
            <span>{t("postSteps.printed")}</span>
          </li>
          <li>
            <StatusGlyph kind={holder ? "done" : "now"} size={20} />
            <span>{t("postSteps.dispatched")}</span>
          </li>
          <li>
            <StatusGlyph kind={holder ? "done" : "later"} size={20} />
            <span>{t("postSteps.delivered")}</span>
          </li>
        </ul>
        {holder ? null : (
          <Button
            variant="secondary"
            size="lg"
            isDisabled={s.busy}
            onPress={() => void s.act("card_received")}
            data-testid="card-received"
          >
            {t("received")}
          </Button>
        )}
      </section>
      <SimRibbon />

      <section className="mj-card" aria-labelledby="dl-done" style={{ textAlign: "center" }}>
        <Award
          aria-hidden="true"
          size={40}
          style={{ justifySelf: "center", color: "var(--md-primary)" }}
        />
        <h2 id="dl-done" className="mj-h2">
          {t("done")}
        </h2>
        <p className="mj-muted">{t("doneLine")}</p>
      </section>
      <div className="mj-actions">
        <Link
          href="/learn/me/badges/khud-licence"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("badge")}
        </Link>
        <Link
          href="/"
          className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
        >
          {t("home")}
        </Link>
      </div>
    </div>
  );
}

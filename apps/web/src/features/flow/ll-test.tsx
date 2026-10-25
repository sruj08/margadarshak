"use client";

import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { ProgressBar } from "@margdarshak/ui/components/progress";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { BadgeCheck, Gauge, HardHat, PhoneOff, ScanFace, Signpost } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Tilt3D } from "@/components/fx/moments";
import { useFmt } from "@/components/journey/rule-source";
import { useRuleText } from "@/components/journey/rule-text";
import { BackLink } from "@/components/journey/status";
import { Link, useRouter } from "@/i18n/navigation";
import { addDays, daysBetween, istToday } from "@/lib/journey/dates";
import { recordScreen } from "@/lib/journey/trial-log";
import { DemoSkip, NoFlowCase, PseudoQr, SimRibbon } from "./bits";
import { licenceNumber, paramNumber, useFlow } from "./flow-case";
import { SchoolCard } from "./school";

const BEFORE_PAYMENT = new Set(["PLAN", "LL_APPLYING", "HANDED_OFF", "PAYMENT_PENDING"]);
const AFTER_LL = new Set([
  "BRIDGE",
  "DL_BOOKABLE",
  "TEST_BOOKED",
  "TEST_FAILED",
  "AWAITING_APPROVAL",
  "DL_ISSUED",
  "DL_HOLDER",
  "LL_EXPIRED",
  "RENEWAL_DUE",
]);

const CARDS = [
  { id: "helmet", Icon: HardHat },
  { id: "speed", Icon: Gauge },
  { id: "junction", Icon: Signpost },
  { id: "drink", Icon: PhoneOff },
] as const;

/**
 * The LL test, guided (F-04, F-05): the mandatory road-safety tutorial (CMVR r.11), the checklist
 * Sarathi shows before a home test (face check, SMS password, no going back), then the test screen
 * in the state's own format from the rule pack. The result screen issues the LL on a pass.
 */
export function LlTestGate() {
  const t = useTranslations("flow.ll");
  const tf = useTranslations("flow");
  const tc = useTranslations("common");
  const { date } = useFmt();
  const s = useFlow();
  const [step, setStep] = useState(0);
  const [card, setCard] = useState(0);
  const [face, setFace] = useState<"idle" | "checking" | "ok">("idle");

  useEffect(() => {
    recordScreen("test.ll");
  }, []);
  useEffect(() => {
    if (s.answers["tutorial_done"] === "yes") setStep((v) => Math.max(v, 1));
  }, [s.answers]);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan) return <NoFlowCase />;

  const state = s.caseData?.state ?? "PLAN";
  const plan = s.plan;
  const stateName = tc(`state.${plan.state}` as "state.JK");
  const ll = plan.ll_test;
  const tutorialDays = paramNumber(plan, "PRM-TUTORIAL-DAYS", 7);

  if (BEFORE_PAYMENT.has(state) && s.answers["ll_fee_paid"] !== "yes") {
    return (
      <div className="mj-screen">
        <BackLink href="/">{tf("back")}</BackLink>
        <header className="mj-head">
          <h1 className="mj-title">{t("title")}</h1>
          <p className="mj-sub">{t("format", { q: ll.questions, p: ll.pass_correct })}</p>
        </header>
        <Link
          href="/pay?for=ll"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {tf("pay.next.ll")}
        </Link>
      </div>
    );
  }
  if (AFTER_LL.has(state)) {
    return (
      <div className="mj-screen">
        <header className="mj-head">
          <h1 className="mj-title">{t("issuedTitle")}</h1>
        </header>
        <Link
          href="/test/ll/issued"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("issuedTitle")}
        </Link>
      </div>
    );
  }

  const retakeFrom = llRetakeFrom(s, plan);
  const retaking = retakeFrom !== null && s.answers["ll_retest_paid"] !== "used";
  if (
    retakeFrom !== null &&
    s.answers["ll_retest_paid"] !== "yes" &&
    s.answers["ll_retest_paid"] !== "used"
  ) {
    const wait = daysBetween(istToday(), retakeFrom);
    return (
      <div className="mj-screen" data-screen="SCR-LL-RETAKE">
        <BackLink href="/">{tf("back")}</BackLink>
        <header className="mj-head">
          <h1 className="mj-title">{t("retakeTitle")}</h1>
          <p className="mj-sub">{t("retakeFrom", { date: date(retakeFrom, "long") })}</p>
        </header>
        <Link
          href="/learn/review"
          className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
        >
          {t("practiseFirst")}
        </Link>
        {wait > 0 ? (
          <DemoSkip
            days={wait}
            onSkip={async () => {
              await s.save({ ll_fail_on: addDays(String(s.answers["ll_fail_on"]), -wait) });
            }}
          />
        ) : (
          <div className="mj-sticky mj-actions">
            <Link
              href="/pay?for=llretest"
              className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
              data-testid="ll-retest-pay"
            >
              {t("payRetest")}
            </Link>
          </div>
        )}
      </div>
    );
  }

  const steps = [t("steps.tutorial"), t("steps.ready"), t("steps.test")];
  const current = CARDS[card] ?? CARDS[0];
  const examHref = `/learn/practise/ll-sim/exam?mode=mock&state=${plan.state}&real=1`;

  return (
    <div className="mj-screen" data-screen="SCR-LL-TEST">
      <BackLink href="/">{tf("back")}</BackLink>
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <p className="mj-eyebrow">{tf("stepOf", { i: step + 1, n: steps.length })}</p>
        <h1 className="mj-title">{t("title")}</h1>
        <p className="mj-sub">
          {ll.online_available
            ? t("subOnline", { state: stateName })
            : t("subRto", { state: stateName })}
        </p>
        <p className="mj-chips">
          <span className="mj-num">{t("format", { q: ll.questions, p: ll.pass_correct })}</span>
        </p>
      </header>
      <ProgressBar value={((step + 1) / steps.length) * 100} label={steps[step] ?? ""} />

      {step === 0 ? (
        <section className="mj-card" aria-labelledby="tut-h">
          <h2 id="tut-h" className="mj-h2">
            {t("tutorialTitle")}
          </h2>
          <p className="mj-caption">{t("tutorialWhy", { days: tutorialDays })}</p>
          <div className="fl-doc" style={{ gridTemplateColumns: "56px 1fr" }} aria-live="polite">
            <span className="fl-doc__icon" style={{ width: 56, height: 56 }}>
              <current.Icon aria-hidden="true" />
            </span>
            <span>
              <strong>{t(`card.${current.id}.h`)}</strong>
              <small style={{ fontSize: "0.95rem", color: "var(--md-ink-2)" }}>
                {t(`card.${current.id}.b`)}
              </small>
            </span>
          </div>
          <p className="mj-caption mj-num">
            {card + 1} / {CARDS.length}
          </p>
          {card < CARDS.length - 1 ? (
            <Button variant="primary" size="lg" fullWidth onPress={() => setCard(card + 1)}>
              {t("next")}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              data-testid="tutorial-done"
              onPress={() => {
                void s.save({ tutorial_done: "yes" });
                setStep(1);
              }}
            >
              {t("doneTutorial")}
            </Button>
          )}
        </section>
      ) : null}

      {step >= 1 ? (
        <section className="mj-card" aria-labelledby="ready-h">
          <h2 id="ready-h" className="mj-h2">
            {t("readyTitle")}
          </h2>
          <ul className="mj-ticks">
            {(["ready1", "ready2", "ready3"] as const).map((k) => (
              <li key={k}>
                <StatusGlyph kind="info" size={20} />
                <span>{t(k)}</span>
              </li>
            ))}
            <li>
              <StatusGlyph kind="danger" size={20} />
              <span>
                <strong>{t("ready4")}</strong>
              </span>
            </li>
          </ul>
          {ll.online_available ? (
            <div className="fl-doc" aria-live="polite">
              <span className="fl-doc__icon">
                <ScanFace aria-hidden="true" />
              </span>
              <span>
                <strong>{t("face")}</strong>
                {face === "ok" ? <small>{t("faceOk")}</small> : null}
              </span>
              {face === "ok" ? (
                <StatusGlyph kind="done" size={22} />
              ) : (
                <Button
                  variant="secondary"
                  size="md"
                  isDisabled={face === "checking"}
                  onPress={() => {
                    setFace("checking");
                    setTimeout(() => setFace("ok"), 1200);
                  }}
                >
                  {face === "checking" ? "…" : t("face")}
                </Button>
              )}
            </div>
          ) : null}
          <SimRibbon />
        </section>
      ) : null}

      {step >= 1 ? (
        <div className="mj-sticky mj-actions">
          <Link
            href={examHref}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="ll-start"
            aria-disabled={ll.online_available && face !== "ok"}
            onClick={(e) => {
              if (ll.online_available && face !== "ok") e.preventDefault();
              else if (retaking) void s.save({ ll_retest_paid: "used" });
            }}
          >
            {t("start")}
          </Link>
          <Link href="/learn" className="md-link" style={{ textAlign: "center" }}>
            {t("practiseFirst")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** When an LL retake opens: the fail date plus the state's gap (PRM-LL-RETEST-GAP-DAYS). */
export function llRetakeFrom(
  s: { answers: Record<string, unknown> },
  plan: Parameters<typeof paramNumber>[0],
) {
  const failed = s.answers["ll_fail_on"];
  if (typeof failed !== "string") return null;
  return addDays(failed, paramNumber(plan, "PRM-LL-RETEST-GAP-DAYS", 1));
}

/**
 * The real-test outcome under the score (F-05): a pass leads to the LL; a fail is recorded once
 * (API-15 `ll_test_failed`, the case stays at LL_TEST) and leads to the retake after the state's gap
 * and the retest fee (FEE-LL-RETEST).
 */
export function LlAttemptPanel({ passed, sid }: { passed: boolean; sid: string }) {
  const t = useTranslations("flow.ll");
  const { date } = useFmt();
  const s = useFlow();
  const recorded = useRef(false);

  useEffect(() => {
    if (passed || !s.ready || !s.active || recorded.current) return;
    if (s.answers["ll_fail_sid"] === sid) return;
    recorded.current = true;
    void (async () => {
      await s.act("ll_test_failed", { test: "ll" });
      await s.save({ ll_fail_on: istToday(), ll_fail_sid: sid, ll_retest_paid: "no" });
    })();
  }, [passed, s, sid]);

  const from =
    llRetakeFrom(s, s.plan) ??
    addDays(istToday(), paramNumber(s.plan, "PRM-LL-RETEST-GAP-DAYS", 1));
  return (
    <section className="ml-card" aria-labelledby="ll-real-test-h" data-testid="ll-real-test">
      {passed ? (
        <h2 id="ll-real-test-h" className="md-h2">
          {t("passTitle")}
        </h2>
      ) : (
        <p id="ll-real-test-h">{t("retakeFrom", { date: date(from, "long") })}</p>
      )}
      <Link
        href={passed ? "/test/ll/issued" : "/test/ll"}
        className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        data-testid="ll-real-test-next"
      >
        {passed ? t("passCta") : t("retake")}
      </Link>
    </section>
  );
}

/** LL issued (S3 → S4): records `ll_issued`, shows the learner's licence, and opens the 30-day bridge. */
export function LlIssued() {
  const t = useTranslations("flow.ll");
  const tc = useTranslations("common");
  const rt = useRuleText();
  const { date } = useFmt();
  const router = useRouter();
  const s = useFlow();
  const issuing = useRef(false);
  const [issued, setIssued] = useState(false);

  const caseId = s.active?.caseId ?? "";
  const state = s.caseData?.state;
  const plan = s.plan;
  const eligible = plan?.classes.filter((c) => c.eligible) ?? [];
  const number = plan ? licenceNumber(plan.state, `${caseId}:ll`, istToday().slice(0, 4)) : "";

  useEffect(() => {
    recordScreen("test.ll.issued");
  }, []);

  useEffect(() => {
    if (!s.ready || !plan || !state || issuing.current) return;
    if (state === "LL_TEST" || BEFORE_PAYMENT.has(state)) {
      issuing.current = true;
      void (async () => {
        await s.saveVault({ ll_number: number });
        const ok = await s.act("ll_issued", {
          classes: eligible.map((c) => c.class_code) as never,
          number_last4: number.slice(-4),
        });
        setIssued(ok);
      })();
    } else setIssued(true);
  }, [s, plan, state, number, eligible]);

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !plan) return <NoFlowCase />;

  const c = s.caseData;
  const ll = c?.ll;
  const unlock = c?.key_dates?.["dl_test_unlock"] ?? null;
  const today = istToday();
  const waitDays = paramNumber(plan, "PRM-MIN-WAIT-DAYS", 30);
  const stateName = tc(`state.${plan.state}` as "state.JK");
  const dob = s.vault["dob"] || (s.facts?.age.kind === "dob" ? date(s.facts.age.dob, "long") : "");
  const llNo = s.vault["ll_number"] || number;

  if (!issued || !ll) return <Skeleton className="mj-skel-row" />;

  return (
    <div className="mj-screen" data-screen="SCR-LL-ISSUED">
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

      <Tilt3D className="fl-cert-tilt">
        <article className="fl-cert" aria-label={t("form")} data-testid="ll-cert">
          <div className="fl-cert__head">
            <span>
              <span className="fl-cert__title">{t("form")}</span>
              <br />
              <span className="mj-caption">{t("authorityValue", { state: stateName })}</span>
            </span>
            <span className="fl-stamp">✓ LL</span>
          </div>
          <div className="fl-cert__grid">
            <dl className="fl-kv">
              <div>
                <dt>{t("number")}</dt>
                <dd className="mj-num">{llNo}</dd>
              </div>
              {s.vault["full_name"] ? (
                <div>
                  <dt>{t("name")}</dt>
                  <dd>{s.vault["full_name"]}</dd>
                </div>
              ) : null}
              {dob ? (
                <div>
                  <dt>{t("dob")}</dt>
                  <dd>{dob}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t("classes")}</dt>
                <dd>{eligible.map((x) => rt(x.name_key)).join(", ") || ll.classes.join(", ")}</dd>
              </div>
              <div>
                <dt>{t("validFrom")}</dt>
                <dd className="mj-num">{date(ll.issued_on, "long")}</dd>
              </div>
              <div>
                <dt>{t("validTo")}</dt>
                <dd className="mj-num">{date(ll.expires_on, "long")}</dd>
              </div>
            </dl>
            <PseudoQr seed={`${caseId}:llqr`} label={t("qr")} />
          </div>
        </article>
      </Tilt3D>
      <SimRibbon />

      {unlock ? (
        <section className="mj-card mj-card--soft" aria-labelledby="unlock-h">
          <h2 id="unlock-h" className="mj-h2">
            {t("unlockTitle", { date: date(unlock, "long") })}
          </h2>
          <p>{t("unlockLine", { days: waitDays })}</p>
        </section>
      ) : null}

      <SchoolCard />

      <div className="mj-actions">
        <Link
          href="/learn"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {t("toPractise")}
        </Link>
        <Link
          href="/dl/track"
          className={buttonClassName({ variant: "secondary", size: "lg", fullWidth: true })}
        >
          {t("toTrack")}
        </Link>
      </div>

      {unlock ? (
        <DemoSkip
          days={Math.max(0, daysBetween(today, unlock))}
          onSkip={async () => {
            await s.skip(Math.max(0, daysBetween(today, unlock)));
            router.push("/");
          }}
        />
      ) : null}
    </div>
  );
}

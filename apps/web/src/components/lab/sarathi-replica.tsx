"use client";

import { feeQuote } from "@margdarshak/rules";
import { formatInr } from "@margdarshak/ui/lib/format";
import { useLocale, useTranslations } from "next-intl";
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { recordLabTrial } from "@/lib/journey/api";
import { packs } from "@/lib/journey/rules";
import {
  allTrials,
  download,
  endTrial,
  logEvent,
  startTrial,
  type Trial,
  toCsv,
  trialSummary,
} from "@/lib/journey/trial-log";
import { containsIdentityNumber } from "@/lib/redact/redact";
import { PublicStats } from "./public-stats";
import {
  applicationNumber,
  captcha,
  LAB_CATEGORIES,
  LAB_COUNTRIES,
  LAB_COVS,
  LAB_MENU,
  LAB_RTOS,
  LAB_STAGES_JK,
  LAB_STATES,
  ROLE_CARDS,
} from "./replica-data";

type Screen =
  | "state"
  | "home"
  | "stages"
  | "form"
  | "auth"
  | "otp"
  | "mobile"
  | "details"
  | "body"
  | "ack"
  | "upload"
  | "photo"
  | "fee"
  | "gateway"
  | "verify"
  | "done";

const COV_TO_CLASS: Record<string, string> = {
  "MC 50CC": "MC50CC",
  MCWOG: "MCWOG",
  MCWG: "MCWG",
  LMV: "LMV-NT",
  "LMV-TR": "LMV-TR",
  "E-RICKSHAW": "E-RICKSHAW",
  "E-CART": "E-CART",
  MGV: "MGV",
  HGMV: "HGMV",
  HPMV: "HPMV",
};

/**
 * Journey-test lab replica (MD-139, F-57, FIELD_STUDY §3.2): an unbranded research copy of the
 * observed Sarathi LL sequence (A1-A13) for the paired journey test. No emblem, no logos, a red
 * banner on every screen, synthetic role cards only. Nothing typed here is stored or sent: the log
 * keeps screens, timings, errors and selections (MD-140), never the values typed.
 */
export function SarathiReplica({ labToken }: { labToken?: string } = {}) {
  const t = useTranslations("lab");
  const locale = useLocale();
  const [trial, setTrial] = useState<Trial | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [screen, setScreen] = useState<Screen>("state");
  const [pid, setPid] = useState("P-001");
  const [cell, setCell] = useState("A-first X/Y");
  const [order, setOrder] = useState<1 | 2>(1);
  const [card, setCard] = useState<"X" | "Y">("X");
  const [blockersFound, setBlockersFound] = useState(0);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => setTrials(allTrials()), []);

  const refresh = () => setTrials(allTrials());

  const start = (system: "sarathi_lab" | "margdarshak") => {
    const tr = startTrial({ pid, cell, order, system, case: card });
    setTrial(tr);
    refresh();
    if (system === "margdarshak") {
      window.location.assign(`/${locale}`);
      return;
    }
    setScreen("state");
    logEvent("screen", "A0.state", undefined, tr.trial_id);
  };

  const finish = (completed: boolean, classCorrect: boolean | null) => {
    if (!trial) return;
    endTrial(trial.trial_id, {
      completed,
      class_correct: classCorrect,
      blockers_found: blockersFound,
    });
    setTrial(null);
    refresh();
  };

  const finishOther = (tr: Trial) => {
    endTrial(tr.trial_id, { completed: true, blockers_found: blockersFound });
    refresh();
  };

  const sendAll = async () => {
    let ok = 0;
    for (const tr of allTrials().filter((x) => x.end_ts)) {
      try {
        const sum = trialSummary(tr);
        await recordLabTrial(
          {
            participant_code: tr.pid,
            arm: tr.system === "sarathi_lab" ? "portal_replica" : "margdarshak",
            task_id: "start_ll_application",
            started_at: tr.start_ts,
            ended_at: tr.end_ts ?? tr.start_ts,
            errors: sum.errors_validation,
            completed: tr.completed,
            screens_visited: Math.min(500, sum.screens_visited),
            back_navigations: Math.min(500, sum.backtracks),
            validation_errors: Math.min(500, sum.errors_validation),
            consent_id: `field_study:${tr.pid}`,
          },
          labToken ? { labToken } : {},
        );
        ok++;
      } catch {
        // kept locally; export the CSV instead
      }
    }
    setSent(t("sent", { n: ok }));
  };

  return (
    <div>
      <section className="mj-lab-log" aria-labelledby="lab-setup" lang={locale}>
        <h2 id="lab-setup" style={{ fontWeight: 700, marginBottom: 8 }}>
          {t("setupTitle")}
        </h2>
        <p style={{ marginBottom: 8 }}>{t("setupBody")}</p>
        <div className="mj-lab" style={{ background: "transparent" }}>
          <div className="mj-lab-row">
            <label>
              {t("pid")}
              <input
                type="text"
                value={pid}
                onChange={(e) => setPid(e.target.value.toUpperCase())}
                pattern="P-\d{3}"
              />
            </label>
            <label>
              {t("cell")}
              <select value={cell} onChange={(e) => setCell(e.target.value)}>
                {["A-first X/Y", "A-first Y/X", "B-first X/Y", "B-first Y/X"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              {t("order")}
              <select value={order} onChange={(e) => setOrder(Number(e.target.value) as 1 | 2)}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            <label>
              {t("card")}
              <select value={card} onChange={(e) => setCard(e.target.value as "X" | "Y")}>
                <option value="X">{t("cardX")}</option>
                <option value="Y">{t("cardY")}</option>
              </select>
            </label>
          </div>
          <div className="mj-lab-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="mj-lab-primary"
              disabled={!!trial}
              onClick={() => start("sarathi_lab")}
              data-testid="lab-start"
            >
              {t("startReplica")}
            </button>
            <button type="button" disabled={!!trial} onClick={() => start("margdarshak")}>
              {t("startMargdarshak")}
            </button>
          </div>
          <p style={{ marginTop: 8 }}>
            {t("roleCardNote", {
              aadhaar: ROLE_CARDS[card].aadhaar,
              mobile: ROLE_CARDS[card].mobile,
            })}
          </p>
        </div>
      </section>

      {trial ? (
        <div className="mj-lab" lang="en" data-testid="replica" style={{ marginTop: 12 }}>
          <Replica
            screen={screen}
            card={card}
            go={(s) => {
              setScreen(s);
              logEvent("screen", s, undefined, trial.trial_id);
            }}
            log={(type, id, value) => logEvent(type, id, value, trial.trial_id)}
            onDone={(classCorrect) => finish(true, classCorrect)}
          />
          <div className="mj-lab-log" lang={locale}>
            <label>
              {t("blockersFound")}
              <select
                value={blockersFound}
                onChange={(e) => setBlockersFound(Number(e.target.value))}
              >
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            <div className="mj-lab-row" style={{ marginTop: 8 }}>
              <button type="button" onClick={() => finish(false, null)} data-testid="lab-stop">
                {t("stopCap")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="mj-lab-log" aria-labelledby="lab-log" lang={locale} data-testid="lab-log">
        <h2 id="lab-log" style={{ fontWeight: 700, marginBottom: 8 }}>
          {t("logTitle", { n: trials.length })}
        </h2>
        <div className="mj-lab" style={{ background: "transparent" }}>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable table region must be keyboard reachable */}
          <section style={{ overflowX: "auto" }} tabIndex={0} aria-labelledby="lab-log">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("pid")}</th>
                  <th scope="col">{t("system")}</th>
                  <th scope="col">{t("card")}</th>
                  <th scope="col">{t("time")}</th>
                  <th scope="col">{t("screens")}</th>
                  <th scope="col">{t("errors")}</th>
                  <th scope="col">{t("backs")}</th>
                  <th scope="col">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((tr) => {
                  const s = trialSummary(tr);
                  return (
                    <tr key={tr.trial_id}>
                      <td>{tr.pid}</td>
                      <td>{tr.system}</td>
                      <td>{tr.case}</td>
                      <td>{s.time_s ?? "…"}</td>
                      <td>{s.screens_visited}</td>
                      <td>{s.errors_validation}</td>
                      <td>{s.backtracks}</td>
                      <td>
                        {tr.end_ts ? (
                          tr.completed ? (
                            t("completed")
                          ) : (
                            t("stopped")
                          )
                        ) : tr.system === "margdarshak" ? (
                          <button type="button" onClick={() => finishOther(tr)}>
                            {t("endMargdarshak")}
                          </button>
                        ) : (
                          t("running")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <div className="mj-lab-row" style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => download("journey_sessions.csv", toCsv(allTrials()), "text/csv")}
              data-testid="lab-csv"
            >
              {t("csv")}
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  "journey_sessions.json",
                  JSON.stringify(allTrials(), null, 2),
                  "application/json",
                )
              }
              data-testid="lab-json"
            >
              {t("json")}
            </button>
            <button type="button" onClick={() => void sendAll()} data-testid="lab-send">
              {t("send")}
            </button>
          </div>
          {sent ? <p role="status">{sent}</p> : null}
        </div>
      </section>
      <PublicStats variant="lab" />
    </div>
  );
}

type Log = (
  type: "error" | "select" | "back" | "typed" | "note",
  id: string,
  value?: string,
) => void;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mj-lab-panel">
      <h2>{title}</h2>
      <div className="mj-lab-body">{children}</div>
    </div>
  );
}

function Captcha({
  id,
  value,
  onChange,
  code,
  onRefresh,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  code: string;
  onRefresh: () => void;
}) {
  return (
    <div className="mj-lab-row">
      <span className="mj-lab-captcha" aria-hidden="true">
        {code}
      </span>
      <button type="button" onClick={onRefresh}>
        Refresh
      </button>
      <label>
        Enter Captcha
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={6}
          autoComplete="off"
        />
      </label>
    </div>
  );
}

function useCaptcha() {
  const [code, setCode] = useState(captcha);
  const [value, setValue] = useState("");
  return { code, value, setValue, refresh: () => setCode(captcha()), ok: () => value === code };
}

/** dd-MM-yyyy typed, paste blocked (as observed). */
function DobInput({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <label>
      Date of Birth (dd-MM-yyyy)
      <input
        id={id}
        type="text"
        value={value}
        maxLength={10}
        autoComplete="off"
        onPaste={(e) => e.preventDefault()}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value.replace(/[^\d-]/g, ""))
        }
      />
    </label>
  );
}

function Replica({
  screen,
  card,
  go,
  log,
  onDone,
}: {
  screen: Screen;
  card: "X" | "Y";
  go: (s: Screen) => void;
  log: Log;
  onDone: (classCorrect: boolean) => void;
}) {
  const role = ROLE_CARDS[card];
  const [state, setState] = useState("");
  const [modal, setModal] = useState(true);
  const [category, setCategory] = useState("");
  const [holds, setHolds] = useState("");
  const [country, setCountry] = useState("");
  const [rto, setRto] = useState("");
  const [auth, setAuth] = useState("");
  const [idNo, setIdNo] = useState("");
  const [otpShown, setOtpShown] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpCode] = useState(() => String(100000 + Math.floor(Math.random() * 900000)));
  const [consents, setConsents] = useState([false, false, false]);
  const [mobile, setMobile] = useState("");
  const [covs, setCovs] = useState<string[]>([]);
  const [appNo] = useState(applicationNumber);
  const [typedApp, setTypedApp] = useState("");
  const [dob, setDob] = useState("");
  const [fee, setFee] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cap = useCaptcha();
  const cap2 = useCaptcha();
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const fail = (msg: string, id: string) => {
    setError(msg);
    log("error", id, msg);
  };
  const next = (s: Screen) => {
    setError(null);
    cap.setValue("");
    cap.refresh();
    go(s);
  };

  const err = error ? (
    <p className="mj-lab-err" role="alert">
      {error}
    </p>
  ) : null;

  switch (screen) {
    case "state":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Sarathi: state selection (replica)</div>
          <Panel title="Select State">
            <label>
              State Name
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  log("select", "A0.state", e.target.value);
                  if (e.target.value) next("home");
                }}
              >
                <option value="">---Select State Name---</option>
                {LAB_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </Panel>
        </div>
      );
    case "home":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">
            Transport Department: {state || "Jammu and Kashmir"} (replica)
          </div>
          <p className="mj-lab-err" style={{ marginTop: 6 }}>
            Click here for the Advisory regarding the validity of Licences during the disruption of
            services
          </p>
          {modal ? (
            <div className="mj-lab-panel" role="dialog" aria-label="Contactless/Faceless Services">
              <h2>Contactless/Faceless Services</h2>
              <div className="mj-lab-body">
                <button type="button" className="mj-lab-primary" onClick={() => next("stages")}>
                  ISSUE OF LEARNERS LICENCE
                </button>
                <button type="button" onClick={() => setModal(false)}>
                  Close
                </button>
              </div>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {LAB_MENU.map((g) => (
              <Panel key={g.group} title={g.group}>
                <div className="mj-lab-row">
                  {g.links.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() =>
                        l === "Apply for Learner Licence"
                          ? next("stages")
                          : fail(
                              "This replica covers only the learner's licence application.",
                              `A1.menu.${l}`,
                            )
                      }
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
          {err}
          <p style={{ marginTop: 8 }}>
            Best viewed in Google Chrome. Recommended screen resolution: 1366 * 768 or higher.
          </p>
        </div>
      );
    case "stages":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">New LL Stage Details</div>
          <Panel title="Instructions for Application Submission">
            <ol style={{ paddingInlineStart: 20 }}>
              {LAB_STAGES_JK.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p>Applicant with Aadhaar: only Signature need to be uploaded.</p>
            <div className="mj-lab-row">
              <button type="button" className="mj-lab-primary" onClick={() => next("form")}>
                Continue
              </button>
              <button
                type="button"
                onClick={() => {
                  log("back", "A2.home");
                  next("home");
                }}
              >
                Home
              </button>
            </div>
          </Panel>
        </div>
      );
    case "form":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">
            New Licence: Application for Learner&apos;s Licence (LL)
          </div>
          <Panel title="Applicant details">
            <label>
              Select Category if required
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  log("select", "A3.category", e.target.value);
                }}
              >
                <option value="">--Select--</option>
                {LAB_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <fieldset style={{ border: 0, padding: 0 }}>
              <legend style={{ fontWeight: 700 }}>Licence held</legend>
              {[
                "Applicant does not hold any Driving/Learner licence issued in India",
                "Applicant holds Driving Licence",
                "Applicant holds Learner Licence",
              ].map((h) => (
                <label key={h} className="mj-lab-radio">
                  <input
                    type="radio"
                    name="holds"
                    checked={holds === h}
                    onChange={() => {
                      setHolds(h);
                      log("select", "A3.holds", h);
                    }}
                  />
                  {h}
                </label>
              ))}
            </fieldset>
            <label>
              Country of Birth
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  log("select", "A3.country", e.target.value);
                }}
              >
                <option value="">--Select--</option>
                {LAB_COUNTRIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Please Select Rto Office to display camps/Sewa kendras
              <select
                value={rto}
                onChange={(e) => {
                  setRto(e.target.value);
                  log("select", "A3.rto", e.target.value);
                }}
              >
                <option value="">--Select--</option>
                {LAB_RTOS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            {rto ? (
              <table>
                <caption style={{ textAlign: "start", fontWeight: 700 }}>
                  Available Camp Masters
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Select</th>
                    <th scope="col">Camp / Licence Processing Centre</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input type="checkbox" aria-label={`${rto} office counter`} />
                    </td>
                    <td>{rto} office counter</td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            <Captcha
              id="cap-a3"
              value={cap.value}
              onChange={cap.setValue}
              code={cap.code}
              onRefresh={cap.refresh}
            />
            {err}
            <div className="mj-lab-row">
              <button
                type="button"
                className="mj-lab-primary"
                onClick={() => {
                  if (!category || !holds || !country || !rto)
                    return fail("Please fill all mandatory fields.", "A3.validation");
                  if (!cap.ok()) return fail("Invalid Captcha.", "A3.captcha");
                  next("auth");
                }}
              >
                Submit
              </button>
              <button
                type="button"
                onClick={() => {
                  cap.setValue("");
                  cap.refresh();
                }}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => {
                  log("back", "A3.cancel");
                  next("stages");
                }}
              >
                Cancel
              </button>
            </div>
          </Panel>
        </div>
      );
    case "auth":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Authentication With E-KYC / With Non E-kyc</div>
          <Panel title="Choose authentication">
            {[
              "Submit via Aadhaar Authentication",
              "Submit Using Sarathi Mobile Authentication",
            ].map((a) => (
              <label key={a} className="mj-lab-radio">
                <input
                  type="radio"
                  name="auth"
                  checked={auth === a}
                  onChange={() => {
                    setAuth(a);
                    log("select", "A4.auth", a);
                  }}
                />
                {a}
              </label>
            ))}
            {err}
            <div className="mj-lab-row">
              <button
                type="button"
                className="mj-lab-primary"
                onClick={() =>
                  auth
                    ? next(auth.includes("Aadhaar") ? "otp" : "mobile")
                    : fail("Select an authentication method.", "A4.validation")
                }
              >
                Proceed
              </button>
              <button
                type="button"
                onClick={() => {
                  log("back", "A4.cancel");
                  next("form");
                }}
              >
                Cancel &amp; use alternate method for authentication
              </button>
            </div>
          </Panel>
        </div>
      );
    case "otp":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">
            Aadhaar authentication (replica: role card number only)
          </div>
          <Panel title="Aadhaar Number / Virtual ID">
            <label>
              Aadhaar Number (role card only)
              <input
                type="password"
                value={idNo}
                maxLength={12}
                autoComplete="off"
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  if (containsIdentityNumber(v)) {
                    setIdNo("");
                    fail(
                      "Use only the number printed on your role card.",
                      "A5a.real_number_blocked",
                    );
                    return;
                  }
                  setIdNo(v);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                if (idNo !== role.aadhaar) return fail("Invalid Aadhaar Number.", "A5a.aadhaar");
                setError(null);
                timer.current = window.setTimeout(() => setOtpShown(true), 10_000);
                log("note", "A5a.otp_requested");
              }}
            >
              Generate OTP
            </button>
            {otpShown ? (
              <p className="mj-lab-log" role="status">
                Simulated SMS: your OTP is {otpCode}
              </p>
            ) : null}
            <label>
              Enter OTP
              <input
                type="password"
                value={otp}
                maxLength={6}
                autoComplete="off"
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            {[
              "I consent to Aadhaar authentication.",
              "My Aadhaar data is used only for this purpose.",
              "My details will be kept confidential.",
            ].map((c, i) => (
              <label key={c} className="mj-lab-radio">
                <input
                  type="checkbox"
                  checked={consents[i] ?? false}
                  onChange={(e) =>
                    setConsents((x) => x.map((v, j) => (j === i ? e.target.checked : v)))
                  }
                />
                {c}
              </label>
            ))}
            <p>
              Aadhaar holder should have registered mobile number updated against their Aadhaar.
            </p>
            {err}
            <div className="mj-lab-row">
              <button
                type="button"
                className="mj-lab-primary"
                onClick={() => {
                  if (!otpShown || otp !== otpCode) return fail("Invalid OTP.", "A5a.otp");
                  if (consents.some((c) => !c))
                    return fail("Please accept all declarations.", "A5a.consent");
                  setIdNo("");
                  next("details");
                }}
              >
                Authenticate
              </button>
              <button
                type="button"
                onClick={() => {
                  log("back", "A5a.cancel");
                  next("auth");
                }}
              >
                Cancel
              </button>
            </div>
          </Panel>
        </div>
      );
    case "mobile":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Sarathi Mobile Authentication (replica)</div>
          <Panel title="Mobile authentication">
            <label>
              Mobile Number (role card only)
              <input
                type="text"
                value={mobile}
                maxLength={10}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <Captcha
              id="cap-m1"
              value={cap.value}
              onChange={cap.setValue}
              code={cap.code}
              onRefresh={cap.refresh}
            />
            <button
              type="button"
              onClick={() => {
                if (mobile !== role.mobile) return fail("Invalid Mobile Number.", "A5c.mobile");
                if (!cap.ok()) return fail("Invalid Captcha.", "A5c.captcha1");
                setError(null);
                timer.current = window.setTimeout(() => setOtpShown(true), 10_000);
              }}
            >
              Generate OTP
            </button>
            {otpShown ? (
              <p className="mj-lab-log" role="status">
                Simulated SMS: your OTP is {otpCode}
              </p>
            ) : null}
            <label>
              Enter OTP
              <input
                type="password"
                value={otp}
                maxLength={6}
                autoComplete="off"
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <Captcha
              id="cap-m2"
              value={cap2.value}
              onChange={cap2.setValue}
              code={cap2.code}
              onRefresh={cap2.refresh}
            />
            <label className="mj-lab-radio">
              <input
                type="checkbox"
                checked={consents[0] ?? false}
                onChange={(e) => setConsents([e.target.checked, true, true])}
              />
              I agree to the use of my mobile number to furnish the status updates of the
              application.
            </label>
            {err}
            <div className="mj-lab-row">
              <button
                type="button"
                className="mj-lab-primary"
                onClick={() => {
                  if (!otpShown || otp !== otpCode) return fail("Invalid OTP.", "A5c.otp");
                  if (!cap2.ok()) return fail("Invalid Captcha.", "A5c.captcha2");
                  if (!consents[0]) return fail("Please accept the declaration.", "A5c.consent");
                  next("body");
                }}
              >
                Submit OTP
              </button>
              <button
                type="button"
                onClick={() => {
                  log("back", "A5c.cancel");
                  next("auth");
                }}
              >
                Cancel
              </button>
            </div>
          </Panel>
        </div>
      );
    case "details":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">
            Applicant details (from Aadhaar, read-only, synthetic)
          </div>
          <Panel title="Applicant Details">
            <table>
              <tbody>
                <tr>
                  <th scope="row">Applicant Name</th>
                  <td>{role.name}</td>
                </tr>
                <tr>
                  <th scope="row">Date Of Birth</th>
                  <td>{role.dob}</td>
                </tr>
                <tr>
                  <th scope="row">Relation Name</th>
                  <td>{role.relation || " "}</td>
                </tr>
                <tr>
                  <th scope="row">Address</th>
                  <td>{role.address}</td>
                </tr>
              </tbody>
            </table>
            <button type="button" className="mj-lab-primary" onClick={() => next("body")}>
              Proceed
            </button>
          </Panel>
        </div>
      );
    case "body":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Application form</div>
          <Panel title="Class of Vehicle">
            <fieldset style={{ border: 0, padding: 0 }}>
              <legend style={{ fontWeight: 700 }}>Select COV</legend>
              <div className="mj-lab-row">
                {LAB_COVS.map((c) => (
                  <label key={c} className="mj-lab-radio">
                    <input
                      type="checkbox"
                      checked={covs.includes(c)}
                      onChange={(e) => {
                        setCovs((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)));
                        log("select", "A6.cov", c);
                      }}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Nearest RTO
              <select value={rto} onChange={(e) => setRto(e.target.value)}>
                {LAB_RTOS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <fieldset style={{ border: 0, padding: 0 }}>
              <legend style={{ fontWeight: 700 }}>
                Self-declaration (Form 1): exact items not observed; replica wording
              </legend>
              {[
                "I am not suffering from epilepsy or fits.",
                "I can see clearly at a distance.",
                "I am fit to drive.",
              ].map((d) => (
                <label key={d} className="mj-lab-radio">
                  <input type="checkbox" defaultChecked={false} />
                  {d}
                </label>
              ))}
            </fieldset>
            {err}
            <button
              type="button"
              className="mj-lab-primary"
              onClick={() =>
                covs.length === 0
                  ? fail("Select at least one Class of Vehicle.", "A6.cov")
                  : next("ack")
              }
            >
              Submit
            </button>
          </Panel>
        </div>
      );
    case "ack":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Acknowledgement</div>
          <Panel title="Application submitted">
            <p>
              Your Application Number is <strong data-testid="lab-app-no">{appNo}</strong>. Note it
              for all further steps.
            </p>
            <div className="mj-lab-row">
              <button type="button" onClick={() => window.print()}>
                Print
              </button>
              <button type="button" className="mj-lab-primary" onClick={() => next("upload")}>
                Next: Upload Documents
              </button>
            </div>
          </Panel>
        </div>
      );
    case "upload":
    case "photo":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">
            {screen === "upload" ? "Upload Documents" : "Upload Photo and Signature"}
          </div>
          <Panel title="Enter details">
            <label>
              Application Number
              <input
                type="text"
                value={typedApp}
                maxLength={screen === "upload" ? 10 : 16}
                autoComplete="off"
                onChange={(e) => setTypedApp(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <DobInput id={`dob-${screen}`} value={dob} onChange={setDob} />
            <Captcha
              id={`cap-${screen}`}
              value={cap.value}
              onChange={cap.setValue}
              code={cap.code}
              onRefresh={cap.refresh}
            />
            <p>
              Files: jpeg/jpg/pdf, maximum 300 KB. File name must not contain spaces or special
              characters.
            </p>
            {err}
            <button
              type="button"
              className="mj-lab-primary"
              onClick={() => {
                if (typedApp !== appNo)
                  return fail("Invalid Application Number.", `${screen}.app_no`);
                if (dob !== role.dob) return fail("Date of Birth does not match.", `${screen}.dob`);
                if (!cap.ok()) return fail("Invalid Captcha.", `${screen}.captcha`);
                setTypedApp("");
                setDob("");
                next(screen === "upload" ? "photo" : "fee");
              }}
            >
              {screen === "upload" ? "Submit" : "Proceed"}
            </button>
          </Panel>
        </div>
      );
    case "fee":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">EPAYMENT: APPLICATION FEE</div>
          <Panel title="Fee payment">
            <ol style={{ paddingInlineStart: 20 }}>
              <li>Select Application Fee.</li>
              <li>Enter the Application Number and Date of Birth.</li>
              <li>Click on &quot;Click Here to Calculate Fee&quot;.</li>
              <li>Verify, select Bank/Gateway, enter the code and Proceed.</li>
            </ol>
            <label>
              Application Number
              <input
                type="text"
                value={typedApp}
                maxLength={10}
                autoComplete="off"
                onChange={(e) => setTypedApp(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <DobInput id="dob-fee" value={dob} onChange={setDob} />
            <button
              type="button"
              onClick={() => {
                if (typedApp !== appNo || dob !== role.dob)
                  return fail("Invalid Application Number or Date of Birth.", "A12.lookup");
                const c = packs().get("JK");
                const codes = covs.map((x) => COV_TO_CLASS[x]).filter((x): x is string => !!x);
                setFee(c ? feeQuote(c, codes).ll_stage_paise : null);
                setError(null);
              }}
            >
              Click Here to Calculate Fee
            </button>
            {fee !== null ? <p>Total Amount: {formatInr(fee, "en")}</p> : null}
            {fee !== null ? (
              <Captcha
                id="cap-fee"
                value={cap.value}
                onChange={cap.setValue}
                code={cap.code}
                onRefresh={cap.refresh}
              />
            ) : null}
            {err}
            <button
              type="button"
              className="mj-lab-primary"
              disabled={fee === null}
              onClick={() => (cap.ok() ? next("gateway") : fail("Invalid Captcha.", "A12.captcha"))}
            >
              Proceed
            </button>
          </Panel>
        </div>
      );
    case "gateway":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Payment gateway (simulated, no money moves)</div>
          <Panel title="Simulated payment">
            <p>This replica does not take payments. Choose an outcome.</p>
            <div className="mj-lab-row">
              <button
                type="button"
                className="mj-lab-primary"
                onClick={() => {
                  log("note", "A12.paid");
                  next("verify");
                }}
              >
                Payment successful (simulated)
              </button>
            </div>
          </Panel>
        </div>
      );
    case "verify":
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Verify Payment Status</div>
          <Panel title="Verify">
            <label>
              Application No.
              <input
                type="text"
                value={typedApp}
                maxLength={10}
                autoComplete="off"
                onChange={(e) => setTypedApp(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <DobInput id="dob-verify" value={dob} onChange={setDob} />
            <label>
              Name of the RTO
              <input type="text" defaultValue="" autoComplete="off" />
            </label>
            <Captcha
              id="cap-verify"
              value={cap.value}
              onChange={cap.setValue}
              code={cap.code}
              onRefresh={cap.refresh}
            />
            {err}
            <button
              type="button"
              className="mj-lab-primary"
              onClick={() => {
                if (typedApp !== appNo || dob !== role.dob)
                  return fail("Record not found.", "A13.lookup");
                if (!cap.ok()) return fail("Invalid Captcha.", "A13.captcha");
                next("done");
              }}
            >
              Verify
            </button>
          </Panel>
        </div>
      );
    case "done": {
      const expected = [...role.expectedCov].sort().join(",");
      const chosen = [...covs].sort().join(",");
      return (
        <div className="mj-lab-frame">
          <div className="mj-lab-header">Payment verified</div>
          <Panel title="Done">
            <p>The replica task is complete.</p>
            <button
              type="button"
              className="mj-lab-primary"
              onClick={() => onDone(expected === chosen)}
              data-testid="lab-finish"
            >
              End trial
            </button>
          </Panel>
        </div>
      );
    }
  }
}

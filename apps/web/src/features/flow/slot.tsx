"use client";

import "./flow.css";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { Skeleton } from "@margdarshak/ui/components/skeleton";
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  Smartphone,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useFmt } from "@/components/journey/rule-source";
import { BackLink } from "@/components/journey/status";
import { Link } from "@/i18n/navigation";
import { addDays, istToday } from "@/lib/journey/dates";
import { recordScreen } from "@/lib/journey/trial-log";
import { NoFlowCase, SimRibbon } from "./bits";
import { officesFor, paramNumber, refFor, type TestOffice, useFlow } from "./flow-case";

/*
 * Simulated Sarathi DL-test slot booking (S5 → S6). Same order as the real service: find the
 * application, pick a test centre and a day from an availability calendar, pick a time against the
 * track's quota, confirm, get an acknowledgement. Availability is synthetic and deterministic (the
 * same case always sees the same calendar). No OTP is ever asked for (D-07); nothing is booked
 * anywhere (D-08).
 */

const STEPS = ["app", "date", "time", "review"] as const;
type Step = (typeof STEPS)[number] | "done";

/** Test slots a track runs in a day, and how many candidates each slot takes. */
const SLOTS = {
  morning: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"],
  afternoon: ["14:00", "14:30", "15:00", "15:30"],
} as const;
const QUOTA = 6;
/** How far ahead Sarathi opens the calendar. */
const WINDOW_DAYS = 60;

/** Fixed gazetted holidays shown on the demo calendar (closed for tests). */
const HOLIDAYS: Record<string, string> = {
  "2026-11-08": "Diwali",
  "2026-11-24": "Guru Nanak Jayanti",
  "2026-12-25": "Christmas",
  "2027-01-01": "New Year",
  "2027-01-26": "Republic Day",
  "2027-03-04": "Holi",
};

type DayKind = "out" | "holiday" | "full" | "few" | "open";

function weekday(iso: string): number {
  return new Date(`${iso}T06:30:00Z`).getUTCDay();
}

/** Second and fourth Saturdays are closed at most RTOs. */
function closedSaturday(iso: string): boolean {
  if (weekday(iso) !== 6) return false;
  const n = Math.ceil(Number(iso.slice(8, 10)) / 7);
  return n === 2 || n === 4;
}

/**
 * Seats left in one slot. Skewed low like a real RTO (many slots already taken), and the first
 * week is busier because the nearest dates fill first.
 */
function seatsLeft(office: string, day: string, time: string, from: string): number {
  const roll = Number(refFor(`${office}:${day}:${time}`, 2)) % 10;
  const base = roll < 4 ? 0 : roll < 9 ? roll - 3 : QUOTA;
  const soon = day < addDays(from, 7);
  return soon ? Math.floor(base / 2) : base;
}

function daySeats(office: string, day: string, from: string): number {
  return [...SLOTS.morning, ...SLOTS.afternoon].reduce(
    (n, tm) => n + seatsLeft(office, day, tm, from),
    0,
  );
}

function dayKind(office: string, day: string, from: string, until: string): DayKind {
  if (day < from || day > until) return "out";
  if (weekday(day) === 0 || closedSaturday(day) || HOLIDAYS[day]) return "holiday";
  const n = daySeats(office, day, from);
  if (n === 0) return "full";
  return n <= 8 ? "few" : "open";
}

/** Month grid (Monday first) for the month of `iso`, padded with nulls. */
function monthGrid(iso: string): Array<string | null> {
  const first = `${iso.slice(0, 7)}-01`;
  const lead = (weekday(first) + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function shiftMonth(iso: string, by: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + by;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

function minus30(tm: string): string {
  const [h = 0, m = 0] = tm.split(":").map(Number);
  const total = h * 60 + m - 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const latest = (...d: Array<string | null | undefined>) =>
  d
    .filter((x): x is string => !!x)
    .sort()
    .at(-1) ?? "";

export function SlotBooking() {
  const t = useTranslations("flow.dl");
  const ts = useTranslations("flow.dl.book");
  const tf = useTranslations("flow");
  const tc = useTranslations("common");
  const tdl = useTranslations("flow.digilocker");
  const { date } = useFmt();
  const q = useSearchParams();
  const retest = q.get("retest") === "1";
  const s = useFlow();
  const stateName = s.plan?.state ? tc(`state.${s.plan.state}` as "state.JK") : "";
  const offices = useMemo(() => officesFor(s.plan, stateName), [s.plan, stateName]);
  const [step, setStep] = useState<Step>("app");
  const [office, setOffice] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [month, setMonth] = useState("");
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    recordScreen("dl.slot");
  }, []);
  useEffect(() => {
    if (offices[0] && !offices.some((o) => o.id === office)) setOffice(offices[0].id);
  }, [office, offices]);

  const c = s.caseData;
  const today = istToday();
  const gap = paramNumber(s.plan, "PRM-RETEST-GAP-DAYS", 7);
  const lastFail =
    typeof s.answers["last_fail_on"] === "string" ? (s.answers["last_fail_on"] as string) : null;
  const earliest = latest(
    addDays(today, 1),
    c?.key_dates?.["dl_test_unlock"],
    retest && lastFail ? addDays(lastFail, gap) : null,
  );
  const expiry = c?.ll?.expires_on ?? null;
  const horizon = addDays(earliest, WINDOW_DAYS);
  const until = expiry && expiry < horizon ? expiry : horizon;
  const firstOpen = useMemo(() => {
    for (let d = earliest; d <= until; d = addDays(d, 1)) {
      const k = dayKind(office, d, earliest, until);
      if (k === "open" || k === "few") return d;
    }
    return earliest;
  }, [office, earliest, until]);
  const shownMonth = month || firstOpen;

  if (!s.ready) return <Skeleton className="mj-skel-row" />;
  if (!s.active || !s.plan || !c) return <NoFlowCase />;
  const feeOk = retest
    ? s.answers["retest_fee_paid"] === "yes"
    : s.answers["dl_fee_paid"] === "yes";
  if (!feeOk && step !== "done")
    return (
      <div className="mj-screen">
        <BackLink href={retest ? "/dl/retest" : "/dl/apply"}>{tf("back")}</BackLink>
        <h1 className="mj-title">{t("slotTitle")}</h1>
        <p className="mj-sub">{ts("feeFirst")}</p>
        <Link
          href={retest ? "/pay?for=retest" : "/pay?for=dl"}
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {retest ? t("payRetest") : t("pay", { amount: "" }).trim()}
        </Link>
      </div>
    );

  const chosen = offices.find((o) => o.id === office);
  const appNo = s.vault["application_number"] || refFor(`${c.case_id}:app`, 10);
  const llNo = s.vault["ll_number"] || (c.ll?.number_last4 ? `•••• ${c.ll.number_last4}` : "—");
  const name = s.vault["full_name"] || tdl("accountName");
  const dob = s.facts?.age.kind === "dob" ? date(s.facts.age.dob, "long") : "—";
  const classes = c.classes.map((x) => x.class_code).join(", ");
  const bookingNo = `DLS${refFor(`${c.case_id}:${office}:${day}:${time}`, 9)}`;
  const stepIndex = step === "done" ? STEPS.length : STEPS.indexOf(step);
  const prevStep: Step = STEPS[Math.max(0, stepIndex - 1)] ?? "app";

  const confirm = async () => {
    if (!chosen || !day || !time) return;
    const ok = await s.act("slot_booked", { slot_date: day, office_id: chosen.id, test: "dl" });
    if (!ok) return;
    await s.save({
      slot_time: time,
      slot_office: chosen.name,
      slot_notify: notify ? "yes" : "no",
      slot_booking_no: bookingNo,
      ...(retest ? { retest_fee_paid: "used" } : {}),
    });
    setStep("done");
  };

  return (
    <div className="mj-screen" data-screen="SCR-DL-SLOT">
      {step === "app" || step === "done" ? (
        <BackLink href={retest ? "/dl/retest" : "/dl/apply"}>{tf("back")}</BackLink>
      ) : (
        <button type="button" className="md-link sb-back" onClick={() => setStep(prevStep)}>
          <ChevronLeft aria-hidden="true" size={18} />
          {tf("back")}
        </button>
      )}
      <SimRibbon text={ts("ribbon")} />

      <div className="fl-shell sb">
        <div className="fl-shell__bar fl-shell__bar--sarathi">
          <span className="fl-shell__ident">
            <span className="fl-emblem" aria-hidden="true">
              <CalendarCheck size={20} />
            </span>
            <span className="fl-shell__brand">
              <strong>{ts("portal")}</strong>
              <span>{ts("portalSub", { state: stateName })}</span>
            </span>
          </span>
          <span className="fl-shell__lock">
            <Lock aria-hidden="true" />
            {ts("simulated")}
          </span>
        </div>

        {step !== "done" ? (
          <ol className="sb-steps" aria-label={ts("progress")}>
            {STEPS.map((k, n) => (
              <li
                key={k}
                data-state={n < stepIndex ? "done" : n === stepIndex ? "now" : "todo"}
                aria-current={n === stepIndex ? "step" : undefined}
              >
                <span className="sb-steps__dot">{n + 1}</span>
                <span className="sb-steps__label">{ts(`step.${k}`)}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="fl-shell__body" aria-live="polite">
          {step === "app" ? (
            <>
              <h1 className="mj-h2">{retest ? ts("titleRetest") : ts("title")}</h1>
              <p className="mj-caption">{ts("appLine")}</p>
              <dl className="fl-kv sb-app" data-testid="slot-application">
                <div>
                  <dt>{tf("pay.appNo")}</dt>
                  <dd className="mj-num">{appNo}</dd>
                </div>
                <div>
                  <dt>{ts("applicant")}</dt>
                  <dd>{name}</dd>
                </div>
                <div>
                  <dt>{ts("dob")}</dt>
                  <dd>{dob}</dd>
                </div>
                <div>
                  <dt>{ts("llNo")}</dt>
                  <dd className="mj-num">{llNo}</dd>
                </div>
                <div>
                  <dt>{ts("classes")}</dt>
                  <dd className="mj-num">{classes}</dd>
                </div>
                <div>
                  <dt>{ts("testType")}</dt>
                  <dd>{retest ? ts("testRetest") : ts("testFirst")}</dd>
                </div>
              </dl>
              <p className="sb-note">
                <CalendarCheck aria-hidden="true" />
                {ts("window", { from: date(earliest, "long"), until: date(until, "long") })}
              </p>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onPress={() => setStep("date")}
                data-testid="slot-app-next"
              >
                {ts("next")}
              </Button>
            </>
          ) : null}

          {step === "date" ? (
            <>
              <fieldset className="sb-group">
                <legend className="mj-card__title">{ts("centre")}</legend>
                <div className="fl-grid">
                  {offices.map((o) => (
                    <CentreOption
                      key={o.id}
                      o={o}
                      checked={office === o.id}
                      seats={slotDatesSeats(o.id, earliest, until)}
                      onPick={() => {
                        setOffice(o.id);
                        setDay("");
                        setTime("");
                        setMonth("");
                      }}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className="sb-group">
                <legend className="mj-card__title">{ts("date")}</legend>
                <div className="sb-cal">
                  <div className="sb-cal__head">
                    <button
                      type="button"
                      className="sb-cal__nav"
                      aria-label={ts("prevMonth")}
                      disabled={shownMonth.slice(0, 7) <= earliest.slice(0, 7)}
                      onClick={() => setMonth(shiftMonth(shownMonth, -1))}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </button>
                    <strong>
                      {new Date(`${shownMonth.slice(0, 7)}-15T06:30:00Z`).toLocaleDateString(
                        "en-IN",
                        { month: "long", year: "numeric", timeZone: "Asia/Kolkata" },
                      )}
                    </strong>
                    <button
                      type="button"
                      className="sb-cal__nav"
                      aria-label={ts("nextMonth")}
                      disabled={shownMonth.slice(0, 7) >= until.slice(0, 7)}
                      onClick={() => setMonth(shiftMonth(shownMonth, 1))}
                    >
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </div>
                  <div className="sb-cal__week" aria-hidden="true">
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, n) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed seven-day header.
                      <span key={n}>{d}</span>
                    ))}
                  </div>
                  <div className="sb-cal__grid" role="radiogroup" aria-label={ts("date")}>
                    {monthGrid(shownMonth).map((d, n) => {
                      if (!d) {
                        // biome-ignore lint/suspicious/noArrayIndexKey: padding cells have no identity.
                        return <span key={`pad-${n}`} className="sb-cal__pad" />;
                      }
                      const kind = dayKind(office, d, earliest, until);
                      const pickable = kind === "open" || kind === "few";
                      const holiday = HOLIDAYS[d];
                      return (
                        <label
                          key={d}
                          className="sb-cal__day"
                          data-kind={kind}
                          data-picked={day === d ? "true" : undefined}
                          title={holiday ?? ts(`legend.${kind}`)}
                        >
                          <input
                            type="radio"
                            name="sb-day"
                            value={d}
                            disabled={!pickable}
                            checked={day === d}
                            onChange={() => {
                              setDay(d);
                              setTime("");
                            }}
                            aria-label={`${date(d, "long")}, ${holiday ?? ts(`legend.${kind}`)}`}
                          />
                          <span>{Number(d.slice(8, 10))}</span>
                        </label>
                      );
                    })}
                  </div>
                  <ul className="sb-legend">
                    {(["open", "few", "full", "holiday", "out"] as const).map((k) => (
                      <li key={k} data-kind={k}>
                        <span aria-hidden="true" />
                        {ts(`legend.${k}`)}
                      </li>
                    ))}
                  </ul>
                </div>
                {expiry ? (
                  <p className="mj-caption">{t("expiryWarn", { date: date(expiry, "long") })}</p>
                ) : null}
              </fieldset>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                isDisabled={!day}
                onPress={() => setStep("time")}
                data-testid="slot-date-next"
              >
                {day ? ts("nextWithDate", { date: date(day, "long") }) : ts("pickDate")}
              </Button>
            </>
          ) : null}

          {step === "time" ? (
            <>
              <p className="sb-picked">
                <MapPin aria-hidden="true" />
                <span>
                  <strong>{chosen?.name}</strong>
                  <small>{date(day, "long")}</small>
                </span>
              </p>
              {(["morning", "afternoon"] as const).map((part) => (
                <fieldset key={part} className="sb-group">
                  <legend className="mj-card__title">{ts(`part.${part}`)}</legend>
                  <div className="sb-times">
                    {SLOTS[part].map((tm) => {
                      const n = seatsLeft(office, day, tm, earliest);
                      return (
                        <label
                          key={tm}
                          className="sb-time"
                          data-full={n === 0 ? "true" : undefined}
                          aria-disabled={n === 0}
                        >
                          <input
                            type="radio"
                            name="sb-time"
                            value={tm}
                            disabled={n === 0}
                            checked={time === tm}
                            onChange={() => setTime(tm)}
                          />
                          <strong className="mj-num">{tm}</strong>
                          <span className="sb-seats" aria-hidden="true">
                            <span style={{ inlineSize: `${(n / QUOTA) * 100}%` }} />
                          </span>
                          <small>{ts("seatsLeft", { n })}</small>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                isDisabled={!time}
                onPress={() => setStep("review")}
                data-testid="slot-time-next"
              >
                {time ? ts("nextWithTime", { time }) : ts("pickTime")}
              </Button>
            </>
          ) : null}

          {step === "review" ? (
            <>
              <h2 className="mj-h2">{ts("reviewTitle")}</h2>
              <dl className="fl-kv">
                <div>
                  <dt>{ts("applicant")}</dt>
                  <dd>{name}</dd>
                </div>
                <div>
                  <dt>{ts("classes")}</dt>
                  <dd className="mj-num">{classes}</dd>
                </div>
                <div>
                  <dt>{ts("centre")}</dt>
                  <dd>{chosen?.name}</dd>
                </div>
                <div>
                  <dt>{t("when")}</dt>
                  <dd className="mj-num">
                    {date(day)} · {time}
                  </dd>
                </div>
                <div>
                  <dt>{ts("report")}</dt>
                  <dd className="mj-num">{minus30(time)}</dd>
                </div>
              </dl>
              <p className="sb-note sb-note--otp">
                <Smartphone aria-hidden="true" />
                {ts("otpNote")}
              </p>
              <label className="mj-check-row sb-check">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                />
                <span>{t("notify")}</span>
              </label>
              {s.error ? <p className="mj-error">{tf("error")}</p> : null}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                isDisabled={s.busy}
                isPending={s.busy}
                onPress={() => void confirm()}
                data-testid="slot-confirm"
              >
                <CalendarCheck aria-hidden="true" />
                {t("confirm")}
              </Button>
            </>
          ) : null}

          {step === "done" ? (
            <div className="sb-ack" data-testid="slot-ack">
              <span className="fl-success__tick" aria-hidden="true">
                <CalendarCheck />
              </span>
              <h1 className="mj-h2">{ts("ackTitle")}</h1>
              <p className="mj-caption">{ts("ackSub")}</p>
              <dl className="fl-kv sb-ack__kv">
                <div>
                  <dt>{ts("bookingNo")}</dt>
                  <dd className="mj-num">{bookingNo}</dd>
                </div>
                <div>
                  <dt>{tf("pay.appNo")}</dt>
                  <dd className="mj-num">{appNo}</dd>
                </div>
                <div>
                  <dt>{ts("centre")}</dt>
                  <dd>{chosen?.name}</dd>
                </div>
                <div>
                  <dt>{t("when")}</dt>
                  <dd className="mj-num">
                    {date(day)} · {time}
                  </dd>
                </div>
                <div>
                  <dt>{ts("report")}</dt>
                  <dd className="mj-num">
                    <Clock aria-hidden="true" size={14} /> {minus30(time)}
                  </dd>
                </div>
              </dl>
              <p className="fl-wa">
                {ts("sms", { date: date(day, "long"), time, office: chosen?.name ?? "" })}
                <small>{ts("smsChannel")}</small>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {step === "done" ? (
        <div className="mj-sticky mj-actions">
          <Link
            href="/dl/test-day"
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            data-testid="slot-to-slip"
          >
            {ts("toSlip")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function slotDatesSeats(office: string, from: string, until: string): number {
  let n = 0;
  for (let d = from, i = 0; d <= until && i < 14; d = addDays(d, 1), i++) {
    const k = dayKind(office, d, from, until);
    if (k === "open" || k === "few") n += daySeats(office, d, from);
  }
  return n;
}

function CentreOption({
  o,
  checked,
  seats,
  onPick,
}: {
  o: TestOffice;
  checked: boolean;
  seats: number;
  onPick: () => void;
}) {
  const t = useTranslations("flow.dl");
  const ts = useTranslations("flow.dl.book");
  return (
    <label className="fl-opt sb-centre">
      <input type="radio" name="sb-office" value={o.id} checked={checked} onChange={onPick} />
      <strong>{o.name}</strong>
      <small>
        {o.district}
        {o.track ? ` · ${t("track", { track: o.track })}` : ""}
        {o.sample ? ` · ${t("sample")}` : ""}
      </small>
      <small className="sb-centre__seats">{ts("seats2w", { n: seats })}</small>
    </label>
  );
}

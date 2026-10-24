"use client";

import { Input, Label } from "@heroui/react";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { registerClip } from "./api";
import { useProblemText } from "./problem";
import { CuratorOfflineNote, MockSourceNote } from "./states";
import {
  type ClipRegister,
  FILMED_BY,
  POVS,
  ROAD_TYPES,
  SPEED_SOURCES,
  TIMES_OF_DAY,
  WEATHERS,
} from "./types";
import { newKey } from "./use-clip";

type FieldErr = "rawKey" | "state" | "city" | "month" | "duration" | "speed" | "consent";

/** The register call needs the upload's length (API-55 answers 422 without it); 1 s to 10 min. */
const MAX_UPLOAD_MS = 600_000;

/** clip-pipeline city rule: letters (any script), spaces, dot, apostrophe, hyphen; 2–60. */
export const CITY_RE = /^[\p{L}][\p{L} .'-]{1,59}$/u;

/** Client checks before API-55 register; the server validates again against clip.schema.json. */
export function registerErrors(f: ClipRegister): FieldErr[] {
  const out: FieldErr[] = [];
  if (!f.raw_object_key.trim()) out.push("rawKey");
  if (!/^[A-Z]{2,3}$/.test(f.state)) out.push("state");
  if (!CITY_RE.test(f.city.trim())) out.push("city");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.captured_month)) out.push("month");
  if (!(Number.isInteger(f.duration_ms) && f.duration_ms >= 1000 && f.duration_ms <= MAX_UPLOAD_MS))
    out.push("duration");
  const s = f.speed_kmh_est;
  if (f.speed_source === "not_logged" ? s !== null : s === null || !(s >= 0 && s <= 150))
    out.push("speed");
  if (!f.contributor_consent_id.trim()) out.push("consent");
  return out;
}

/**
 * Register a raw upload (API-55 `registerClip`, starts `clip_ingest`). Coarse metadata only
 * (NAZAR §4, §13): a city, never a street or coordinates; the month, never a date.
 */
export function RegisterForm() {
  const t = useTranslations("curator");
  const problem = useProblemText();
  const id = useId();
  const [form, setForm] = useState<ClipRegister>({
    raw_object_key: "",
    state: "JK",
    filmed_by: "passenger",
    city: "",
    road_type: "urban_arterial",
    time_of_day: "day",
    weather: "clear",
    pov: "2W",
    captured_month: "",
    speed_kmh_est: null,
    speed_source: "rider_log",
    licence: "CC-BY-4.0",
    contributor_consent_id: "",
    duration_ms: 0,
  });
  const [speedText, setSpeedText] = useState("");
  const [durationText, setDurationText] = useState("");
  const [errors, setErrors] = useState<FieldErr[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; mock: boolean } | null>(null);
  const key = useRef(newKey());

  const set = <K extends keyof ClipRegister>(k: K, v: ClipRegister[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const speed =
      form.speed_source === "not_logged" || speedText.trim() === "" ? null : Number(speedText);
    const body: ClipRegister = {
      ...form,
      city: form.city.trim(),
      raw_object_key: form.raw_object_key.trim(),
      contributor_consent_id: form.contributor_consent_id.trim(),
      speed_kmh_est: speed !== null && Number.isFinite(speed) ? speed : speed === null ? null : -1,
      duration_ms: Math.round(Number(durationText.trim() || "0") * 1000) || 0,
    };
    const found = registerErrors(body);
    setErrors(found);
    setErr(null);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const r = await registerClip(body, key.current);
      key.current = newKey();
      setDone({ id: r.data.clip_id, mock: r.source === "mock" });
    } catch (e) {
      setErr(problem(e));
    } finally {
      setBusy(false);
    }
  };

  const errFor = (f: FieldErr) =>
    errors.includes(f) ? (
      <span className="cu-error" role="alert" id={`${id}-${f}-err`}>
        {t(`register.errors.${f}`)}
      </span>
    ) : null;
  const invalid = (f: FieldErr) => ({
    "aria-invalid": errors.includes(f),
    ...(errors.includes(f) ? { "aria-describedby": `${id}-${f}-err` } : {}),
  });

  const select = <K extends keyof ClipRegister>(
    k: K,
    label: string,
    values: readonly string[],
    text: (v: string) => string,
    extra?: ReactNode,
  ) => (
    <label className="cu-field">
      <span className="cu-label">{label}</span>
      <select
        className="cu-select"
        value={String(form[k])}
        onChange={(e) => set(k, e.currentTarget.value as ClipRegister[K])}
        data-testid={`reg-${String(k)}`}
      >
        {values.map((v) => (
          <option key={v} value={v}>
            {text(v)}
          </option>
        ))}
      </select>
      {extra}
    </label>
  );

  return (
    <div className="cu-page" data-screen="ADMIN-CLIP-REGISTER" data-testid="register-form">
      <CuratorOfflineNote />
      <Link href="/admin/clips" className="md-link">
        ← {t("states.back")}
      </Link>
      <h1 className="md-h1">{t("register.h1")}</h1>
      <p className="cu-lead">{t("register.lead")}</p>
      {done ? (
        <div role="status" className="cu-ok" data-testid="register-done">
          <MockSourceNote source={done.mock ? "mock" : "server"} />
          <p>{t("register.done", { id: done.id })}</p>
          <Link
            href={`/admin/clips/${done.id}`}
            className={buttonClassName({ variant: "primary", size: "lg" })}
          >
            {t("register.openClip", { id: done.id })}
          </Link>
        </div>
      ) : (
        <form
          className="cu-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="cu-field">
            <Label className="cu-label" htmlFor={`${id}-raw`}>
              {t("register.rawKey")}
            </Label>
            <Input
              id={`${id}-raw`}
              className="cu-input"
              value={form.raw_object_key}
              maxLength={256}
              onChange={(e) => set("raw_object_key", e.currentTarget.value)}
              data-testid="reg-raw"
              {...invalid("rawKey")}
            />
            <span className="cu-hint">{t("register.rawKeyHint")}</span>
            {errFor("rawKey")}
          </div>
          <div className="cu-field">
            <Label className="cu-label" htmlFor={`${id}-state`}>
              {t("register.state")}
            </Label>
            <Input
              id={`${id}-state`}
              className="cu-input"
              value={form.state}
              maxLength={3}
              autoCapitalize="characters"
              onChange={(e) => set("state", e.currentTarget.value.toUpperCase())}
              data-testid="reg-state"
              {...invalid("state")}
            />
            {errFor("state")}
          </div>
          <div className="cu-field">
            <Label className="cu-label" htmlFor={`${id}-city`}>
              {t("register.city")}
            </Label>
            <Input
              id={`${id}-city`}
              className="cu-input"
              value={form.city}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => set("city", e.currentTarget.value)}
              data-testid="reg-city"
              {...invalid("city")}
            />
            <span className="cu-hint">{t("register.cityHint")}</span>
            {errFor("city")}
          </div>
          {select(
            "filmed_by",
            t("register.filmedBy"),
            FILMED_BY,
            (v) => t(`register.filmed.${v as (typeof FILMED_BY)[number]}`),
            <span className="cu-hint">{t("register.filmedNote")}</span>,
          )}
          {select("road_type", t("register.road"), ROAD_TYPES, (v) =>
            t(`options.road.${v as (typeof ROAD_TYPES)[number]}`),
          )}
          {select("time_of_day", t("register.time"), TIMES_OF_DAY, (v) =>
            t(`options.time.${v as (typeof TIMES_OF_DAY)[number]}`),
          )}
          {select("weather", t("register.weather"), WEATHERS, (v) =>
            t(`options.weather.${v as (typeof WEATHERS)[number]}`),
          )}
          {select("pov", t("register.pov"), POVS, (v) =>
            t(`options.pov.${v as (typeof POVS)[number]}`),
          )}
          <div className="cu-field">
            <Label className="cu-label" htmlFor={`${id}-month`}>
              {t("register.month")}
            </Label>
            <Input
              id={`${id}-month`}
              className="cu-input"
              type="month"
              value={form.captured_month}
              onChange={(e) => set("captured_month", e.currentTarget.value)}
              data-testid="reg-month"
              {...invalid("month")}
            />
            {errFor("month")}
          </div>
          {select("speed_source", t("register.speedSource"), SPEED_SOURCES, (v) =>
            t(`options.speedSource.${v as (typeof SPEED_SOURCES)[number]}`),
          )}
          <div className="cu-field">
            <Label className="cu-label" htmlFor={`${id}-duration`}>
              {t("register.duration")}
            </Label>
            <Input
              id={`${id}-duration`}
              className="cu-input"
              inputMode="decimal"
              value={durationText}
              onChange={(e) => setDurationText(e.currentTarget.value)}
              data-testid="reg-duration"
              {...invalid("duration")}
            />
            <span className="cu-hint">{t("register.durationHint")}</span>
            {errFor("duration")}
          </div>
          {form.speed_source !== "not_logged" ? (
            <div className="cu-field">
              <Label className="cu-label" htmlFor={`${id}-speed`}>
                {t("register.speed")}
              </Label>
              <Input
                id={`${id}-speed`}
                className="cu-input"
                inputMode="decimal"
                value={speedText}
                onChange={(e) => setSpeedText(e.currentTarget.value)}
                data-testid="reg-speed"
                {...invalid("speed")}
              />
              {errFor("speed")}
            </div>
          ) : null}
          <div className="cu-field">
            <Label className="cu-label" htmlFor={`${id}-consent`}>
              {t("register.consent")}
            </Label>
            <Input
              id={`${id}-consent`}
              className="cu-input"
              value={form.contributor_consent_id}
              autoComplete="off"
              onChange={(e) => set("contributor_consent_id", e.currentTarget.value)}
              data-testid="reg-consent"
              {...invalid("consent")}
            />
            {errFor("consent")}
          </div>
          <p className="cu-hint">{t("register.licence")}</p>
          {err ? (
            <p role="alert" className="cu-error">
              {err}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            isPending={busy}
            data-testid="reg-submit"
          >
            {t("register.submit")}
          </Button>
        </form>
      )}
    </div>
  );
}

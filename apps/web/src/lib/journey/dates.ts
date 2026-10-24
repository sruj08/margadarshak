import { addMonths as addMonthsDays, formatDate, parseDate, todayIST } from "@margdarshak/rules";

/**
 * IST calendar-date helpers (EC-15: server time is the clock). Dates are ISO `YYYY-MM-DD` strings
 * that are already IST calendar dates; arithmetic goes through the rules package's day numbers so
 * the UI and the engine never disagree by a day.
 */

export function istToday(now: Date = new Date()): string {
  return todayIST(now);
}

function day(iso: string): number {
  const d = parseDate(iso);
  if (d === null) throw new RangeError(`not an ISO date: ${iso}`);
  return d;
}

export function addDays(iso: string, n: number): string {
  return formatDate(day(iso) + n);
}

export function addMonths(iso: string, n: number): string {
  return formatDate(addMonthsDays(day(iso), n));
}

/** b − a in whole days. */
export function daysBetween(a: string, b: string): number {
  return day(b) - day(a);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && parseDate(v) !== null;
}

/**
 * Server clock offset (EC-15). The API's `server_time` sets the offset; countdowns use
 * Date.now() + offset, so changing the phone's clock never moves a deadline.
 */
let offsetMs = 0;
let hasServerTime = false;

export function syncServerTime(serverTime: string | null | undefined): void {
  if (!serverTime) return;
  const t = Date.parse(serverTime);
  if (Number.isFinite(t)) {
    offsetMs = t - Date.now();
    hasServerTime = true;
  }
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function serverToday(): string {
  return istToday(serverNow());
}

/** True when the phone clock is more than 5 minutes off the server clock (EC-15 notice). */
export function clockDrifted(): boolean {
  return hasServerTime && Math.abs(offsetMs) > 5 * 60 * 1000;
}

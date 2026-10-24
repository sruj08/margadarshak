// IST calendar arithmetic without Intl and without reading the clock.
// India Standard Time is UTC+05:30 all year (no DST), so an IST day is a fixed
// 24 h window offset from UTC. Server time in IST is the source of truth
// (BUILD_CONVENTIONS, EC-15); every function here takes the instant explicitly.

/** Milliseconds since the Unix epoch (UTC). The only time type this package uses. */
export type EpochMs = number;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
/** +05:30. */
export const IST_OFFSET_MS = 5 * HOUR_MS + 30 * MINUTE_MS;

const div = (a: number, b: number): number => Math.trunc(a / b);

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm). */
export function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = div(y >= 0 ? y : y - 399, 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = div(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + div(yoe, 4) - div(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of daysFromCivil → [year, month 1–12, day 1–31]. */
export function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = div(z >= 0 ? z : z - 146096, 146097);
  const doe = z - era * 146097;
  const yoe = div(doe - div(doe, 1460) + div(doe, 36524) - div(doe, 146096), 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100));
  const mp = div(5 * doy + 2, 153);
  const d = doy - div(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y++;
  return [y, m, d];
}

/** IST calendar day number (days since 1970-01-01 IST) containing the instant. */
export function istDay(at: EpochMs): number {
  return Math.floor((at + IST_OFFSET_MS) / DAY_MS);
}

/** The instant of 00:00 IST that starts the given IST day number. */
export function istDayStart(day: number): EpochMs {
  return day * DAY_MS - IST_OFFSET_MS;
}

/** "YYYY-MM-DD" of the IST calendar date containing the instant. */
export function istDate(at: EpochMs): string {
  const [y, m, d] = civilFromDays(istDay(at));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO weekday of an IST day number: Monday = 1 … Sunday = 7 (1970-01-01 was a Thursday). */
export function isoWeekday(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

export interface IsoWeek {
  /** ISO week-numbering year (can differ from the calendar year around 1 January). */
  readonly isoYear: number;
  /** 1–53. */
  readonly week: number;
  /** IST day number of the Monday that starts the week. */
  readonly monday: number;
  /** Stable key, e.g. "2026-W43". */
  readonly key: string;
}

/**
 * ISO-8601 week of an IST day number. Streak weeks are ISO weeks on the IST
 * calendar: Monday 00:00 IST to Sunday 23:59:59.999 IST (GAMIFICATION_ENGINE §7).
 */
export function isoWeekOfDay(day: number): IsoWeek {
  const monday = day - (isoWeekday(day) - 1);
  const thursday = monday + 3;
  const [isoYear] = civilFromDays(thursday);
  const week = div(thursday - daysFromCivil(isoYear, 1, 1), 7) + 1;
  return { isoYear, week, monday, key: `${isoYear}-W${String(week).padStart(2, "0")}` };
}

/** ISO week (IST) containing the instant. */
export function istWeek(at: EpochMs): IsoWeek {
  return isoWeekOfDay(istDay(at));
}

/** Parses "YYYY-Www" → the week's Monday (IST day number), or null when malformed. */
export function parseWeekKey(key: string): number | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (m === null) return null;
  const isoYear = Number(m[1]);
  const week = Number(m[2]);
  // Week 1 is the week containing 4 January.
  const jan4 = daysFromCivil(isoYear, 1, 4);
  const monday = jan4 - (isoWeekday(jan4) - 1) + (week - 1) * 7;
  const back = isoWeekOfDay(monday);
  return back.isoYear === isoYear && back.week === week ? monday : null;
}

/** The ISO week key that follows `key` (or null when `key` is malformed). */
export function nextWeekKey(key: string): string | null {
  const monday = parseWeekKey(key);
  return monday === null ? null : isoWeekOfDay(monday + 7).key;
}

/** Half-open activity interval [start, end) in epoch ms. */
export interface ActiveInterval {
  readonly start: EpochMs;
  readonly end: EpochMs;
}

/**
 * Active minutes that fall inside the IST day containing `now`
 * (GAMIFICATION_ENGINE §2.2 `minutes_today`). Intervals that cross midnight
 * are clipped, so a session from 23:50 to 00:20 adds 10 minutes to each day.
 * Overlapping intervals are counted once.
 */
export function istMinutesOnDay(intervals: readonly ActiveInterval[], now: EpochMs): number {
  const dayStart = istDayStart(istDay(now));
  const dayEnd = dayStart + DAY_MS;
  const clipped = intervals
    .map((iv) => [Math.max(iv.start, dayStart), Math.min(iv.end, dayEnd)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let curS = Number.NaN;
  let curE = Number.NaN;
  for (const [s, e] of clipped) {
    if (Number.isNaN(curS) || s > curE) {
      if (!Number.isNaN(curS)) total += curE - curS;
      curS = s;
      curE = e;
    } else if (e > curE) {
      curE = e;
    }
  }
  if (!Number.isNaN(curS)) total += curE - curS;
  return total / MINUTE_MS;
}

// Civil (IST calendar) dates as day numbers since 1970-01-01.
// Mirrors services/api/internal/rules/date.go exactly.

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

const div = (a: number, b: number): number => Math.trunc(a / b);

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return 31;
}

export function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = div(y, 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = div(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + div(yoe, 4) - div(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = div(z, 146097);
  const doe = z - era * 146097;
  const yoe = div(doe - div(doe, 1460) + div(doe, 36524) - div(doe, 146096), 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100));
  const mp = div(5 * doy + 2, 153);
  const d = doy - div(153 * mp + 2, 5) + 1;
  let m = mp + 3;
  if (m > 12) m -= 12;
  if (m <= 2) y++;
  return [y, m, d];
}

function digits(s: string): number | null {
  if (s.length === 0) return null;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return null;
    n = n * 10 + (c - 48);
  }
  return n;
}

/** Strict YYYY-MM-DD → day number, or null. */
export function parseDate(s: unknown): number | null {
  if (typeof s !== "string" || s.length !== 10 || s[4] !== "-" || s[7] !== "-") return null;
  const y = digits(s.slice(0, 4));
  const m = digits(s.slice(5, 7));
  const d = digits(s.slice(8, 10));
  if (y === null || m === null || d === null) return null;
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m))
    return null;
  return daysFromCivil(y, m, d);
}

export function parseYear(s: string): number | null {
  if (s.length !== 4) return null;
  const y = digits(s);
  if (y === null || y < MIN_YEAR || y > MAX_YEAR) return null;
  return y;
}

export function fromYMD(y: number, m: number, d: number): number {
  return daysFromCivil(y, m, d);
}

const pad = (n: number, w: number): string => String(n).padStart(w, "0");

export function formatDate(days: number): string {
  const [y, m, d] = civilFromDays(days);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

export function addMonths(days: number, n: number): number {
  const [y, m, d] = civilFromDays(days);
  const total = y * 12 + (m - 1) + n;
  const ny = div(total, 12);
  const nm = (total % 12) + 1;
  const dim = daysInMonth(ny, nm);
  return daysFromCivil(ny, nm, Math.min(d, dim));
}

/** Completed years on `on` for a person born on `dob` (29 Feb → 1 Mar). */
export function ageOn(dob: number, on: number): number {
  const [by, bm, bd] = civilFromDays(dob);
  const [oy, om, od] = civilFromDays(on);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age--;
  return age;
}

/** First date on which `years` are completed (consistent with ageOn). */
export function birthdayAt(dob: number, years: number): number {
  const [by, bm, bd] = civilFromDays(dob);
  const y = by + years;
  if (bm === 2 && bd === 29 && !isLeap(y)) return daysFromCivil(y, 3, 1);
  return daysFromCivil(y, bm, bd);
}

/** IST calendar date of an instant. */
export function todayIST(now: Date): string {
  const t = new Date(now.getTime() + (5 * 3600 + 1800) * 1000);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`;
}

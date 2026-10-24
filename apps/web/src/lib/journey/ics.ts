/**
 * "Add to calendar" (MD-132): an RFC 5545 all-day event that Google Calendar and iOS Calendar open.
 * The date is an IST calendar date, so the event is all-day (no time zone conversion can move it).
 */
export interface IcsEvent {
  uid: string;
  date: string;
  title: string;
  description: string;
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

export function buildIcs(ev: IcsEvent, stamp: Date = new Date()): string {
  const day = ev.date.replace(/-/g, "");
  const end = nextDay(ev.date).replace(/-/g, "");
  const dtstamp = `${stamp.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Margdarshak//Case clock//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}@margdarshak`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${end}`,
    fold(`SUMMARY:${esc(ev.title)}`),
    fold(`DESCRIPTION:${esc(ev.description)}`),
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    fold(`DESCRIPTION:${esc(ev.title)}`),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

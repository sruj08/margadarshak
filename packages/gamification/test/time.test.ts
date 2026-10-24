// IST day and ISO-week arithmetic (no Intl, no clock).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  civilFromDays,
  daysFromCivil,
  isoWeekday,
  istDate,
  istDay,
  istDayStart,
  istMinutesOnDay,
  istWeek,
  nextWeekKey,
  parseWeekKey,
} from "../src/time.ts";
import { ist } from "./helpers.ts";

describe("IST days", () => {
  it("the IST day flips at 18:30 UTC", () => {
    const before = Date.UTC(2026, 9, 24, 18, 29, 59, 999);
    const after = Date.UTC(2026, 9, 24, 18, 30);
    assert.equal(istDate(before), "2026-10-24");
    assert.equal(istDate(after), "2026-10-25");
    assert.equal(istDay(after) - istDay(before), 1);
    assert.equal(istDayStart(istDay(after)), after);
  });
  it("civil round trip", () => {
    for (const d of [-800000, -1, 0, 1, 20385, 60000]) {
      const [y, m, dd] = civilFromDays(d);
      assert.equal(daysFromCivil(y, m, dd), d);
    }
    assert.deepEqual(civilFromDays(0), [1970, 1, 1]);
  });
  it("ISO weekday: 1970-01-01 Thursday, 2026-10-19 Monday", () => {
    assert.equal(isoWeekday(0), 4);
    assert.equal(isoWeekday(daysFromCivil(2026, 10, 19)), 1);
    assert.equal(isoWeekday(daysFromCivil(2026, 10, 25)), 7);
    assert.equal(isoWeekday(-1), 3);
  });
});

describe("ISO weeks on the IST calendar", () => {
  it("Sunday 23:59 IST is the old week, Monday 00:00 IST the new one (even while UTC is still Sunday)", () => {
    assert.equal(istWeek(ist(2026, 10, 25, 23, 59, 59, 999)).key, "2026-W43");
    assert.equal(istWeek(ist(2026, 10, 26, 0, 0)).key, "2026-W44");
    assert.equal(istWeek(Date.UTC(2026, 9, 25, 18, 30)).key, "2026-W44");
  });
  it("year boundaries: 2026 has 53 weeks; 2027-01-03 is still 2026-W53", () => {
    assert.equal(istWeek(ist(2026, 12, 31, 12)).key, "2026-W53");
    assert.equal(istWeek(ist(2027, 1, 3, 12)).key, "2026-W53");
    assert.equal(istWeek(ist(2027, 1, 4, 0)).key, "2027-W01");
    assert.equal(istWeek(ist(2025, 12, 29, 0)).key, "2026-W01");
    assert.equal(nextWeekKey("2026-W53"), "2027-W01");
    assert.equal(nextWeekKey("2026-W43"), "2026-W44");
  });
  it("parseWeekKey validates", () => {
    assert.equal(parseWeekKey("2026-W43"), daysFromCivil(2026, 10, 19));
    assert.equal(parseWeekKey("2025-W53"), null);
    assert.equal(parseWeekKey("2026-43"), null);
    assert.equal(parseWeekKey("2026-W00"), null);
  });
});

describe("istMinutesOnDay", () => {
  it("clips at IST midnight and merges overlaps", () => {
    const now = ist(2026, 10, 24, 12);
    const m = istMinutesOnDay(
      [
        { start: ist(2026, 10, 23, 23, 50), end: ist(2026, 10, 24, 0, 20) }, // 20 today
        { start: ist(2026, 10, 24, 9, 0), end: ist(2026, 10, 24, 9, 30) }, // 30
        { start: ist(2026, 10, 24, 9, 15), end: ist(2026, 10, 24, 9, 45) }, // +15 (overlap)
        { start: ist(2026, 10, 25, 0, 0), end: ist(2026, 10, 25, 1, 0) }, // tomorrow
      ],
      now,
    );
    assert.equal(m, 65);
  });
});

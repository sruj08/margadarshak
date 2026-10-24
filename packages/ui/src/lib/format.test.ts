import { describe, expect, it } from "vitest";
import { formatCount, formatInr, formatIsoDate, paiseToRupees, spokenInr } from "./format";

describe("money formatting (D-06, LOCALIZATION §7)", () => {
  it("formats integer paise as rupees with the ₹ sign from Intl", () => {
    expect(formatInr(70000, "en")).toBe("₹700");
    expect(formatInr(20000, "hi")).toBe("₹200");
  });

  it("uses Indian lakh grouping in both locales", () => {
    expect(formatInr(13500000, "en")).toBe("₹1,35,000");
    expect(formatInr(13500000, "hi")).toBe("₹1,35,000");
    expect(formatCount(172890, "en")).toBe("1,72,890");
  });

  it("keeps paise only when present", () => {
    expect(formatInr(1250, "en")).toBe("₹12.50");
  });

  it("refuses non-integer paise", () => {
    expect(() => paiseToRupees(700.5)).toThrow(TypeError);
  });

  it("gives screen readers a spoken amount", () => {
    expect(spokenInr(70000, "en")).toBe("700 rupees");
    expect(spokenInr(70000, "hi")).toBe("700 रुपये");
  });
});

describe("date formatting (IST calendar dates)", () => {
  it("renders day-month-year", () => {
    expect(formatIsoDate("2026-10-23", "en")).toBe("23 Oct 2026");
    expect(formatIsoDate("2027-03-14", "en", "long")).toBe("14 March 2027");
    expect(formatIsoDate("2027-03-14", "hi", "long")).toBe("14 मार्च 2027");
  });

  it("passes through anything that is not an ISO date", () => {
    expect(formatIsoDate("soon", "en")).toBe("soon");
  });
});

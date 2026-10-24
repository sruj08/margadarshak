import realPack from "@rulepacks/fees.json";
import { describe, expect, it } from "vitest";
import { computeTrustFees, shortSource } from "./trust-line";
import fixture from "./trust-line.fixture.json";

type Fixture = { unit: string; items: Record<string, unknown>[] };
const clone = (): Fixture => structuredClone(fixture) as Fixture;

describe("trust line from fees.json (MD-024)", () => {
  it("computes one class and the card from the fixture pack", () => {
    const fees = computeTrustFees(fixture);
    expect(fees?.oneClassPaise).toBe(70000);
    expect(fees?.cardPaise).toBe(20000);
    expect(fees?.source.short).toBe("CMVR r.32");
    expect(fees?.source.checkedOn).toBe("2026-10-22");
  });

  it("changes when a fee row in the fixture changes, with no code change", () => {
    const edited = clone();
    const row = edited.items.find((i) => i["id"] === "FEE-LL-ISSUE");
    if (!row) throw new Error("fixture row missing");
    row["amount"] = 25000;
    expect(computeTrustFees(edited)?.oneClassPaise).toBe(80000);
  });

  it("ignores reported state rows that are not part of the total", () => {
    const edited = clone();
    edited.items.push({ id: "FEE-X", amount: 105000, per: "application", includedInTotal: false });
    expect(computeTrustFees(edited)?.oneClassPaise).toBe(70000);
  });

  it("uses the oldest check date and the weakest confidence", () => {
    const edited = clone();
    const row = edited.items[1];
    if (!row) throw new Error("fixture row missing");
    row["checkedOn"] = "2026-09-30";
    row["confidence"] = "low";
    const fees = computeTrustFees(edited);
    expect(fees?.source.checkedOn).toBe("2026-09-30");
    expect(fees?.source.confidence).toBe("low");
  });

  it("reads snake_case (API) rows too", () => {
    const snake = {
      unit: "paise",
      items: [
        { id: "A", amount_paise: 50000, per: "class", verified_on: "2026-10-01" },
        {
          id: "FEE-SMART-CARD",
          amount_paise: 20000,
          per: "application",
          verified_on: "2026-10-01",
        },
      ],
    };
    expect(computeTrustFees(snake)?.oneClassPaise).toBe(50000);
  });

  it("returns null instead of guessing when the pack is unusable", () => {
    expect(computeTrustFees(null)).toBeNull();
    expect(computeTrustFees({ unit: "rupees", items: fixture.items })).toBeNull();
    expect(computeTrustFees({ items: [{ id: "A", amount: 1.5, per: "class" }] })).toBeNull();
    const noCard = clone();
    noCard.items = noCard.items.filter((i) => i["id"] !== "FEE-SMART-CARD");
    expect(computeTrustFees(noCard)).toBeNull();
  });

  it("matches the golden expectation on the real rule pack", () => {
    const fees = computeTrustFees(realPack);
    expect(fees?.oneClassPaise).toBe(70000);
    expect(fees?.cardPaise).toBe(20000);
  });

  it("shortens source titles for the chip", () => {
    expect(shortSource("CMVR 1989 r.32 (HP reproduction)")).toBe("CMVR r.32");
    expect(shortSource("Delhi Transport LL page: fee")).toBe("Delhi Transport LL page");
  });
});

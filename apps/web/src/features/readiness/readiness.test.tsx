// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Readiness } from "@/features/learn/api-types";
import learnHub from "../../../messages/en/learnHub.json";
import { BookAnyway } from "./book-anyway";
import { dialLabel, readinessEquation, weakestTopics } from "./readiness-line";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const tpl = (p: { s: number; k: number; c: number }) =>
  learnHub.ready.eq
    .replace("{s}", String(p.s))
    .replace("{k}", String(p.k))
    .replace("{c}", String(p.c));

function readinessOf(score: number, knowledge: number, cal: number): Readiness {
  return {
    score,
    knowledge,
    calibration_penalty: cal,
    topics: [
      { topic_id: "LL1", weight: 0.25, mastery: 0.9 },
      { topic_id: "LL2", weight: 0.25, mastery: 0.5 },
      { topic_id: "LL3", weight: 0.25, mastery: 0.65 },
      { topic_id: "LL4", weight: 0.25, mastery: 0.8 },
    ],
    gate: { threshold: 85, met: false, advisory: true, book_anyway_visible: true },
  };
}

describe("readiness line (F-21: N = knowledge K − calibration C from API-33 fields only)", () => {
  it("renders the server's three fields verbatim", () => {
    expect(readinessEquation(readinessOf(78, 84, 6), tpl)).toBe(
      "78 = knowledge 84 − calibration 6",
    );
  });

  it("never recomputes: inconsistent fields are shown as sent, not 'fixed'", () => {
    // 90 − 5 is 85, but the server said 70: the line must say 70.
    expect(readinessEquation(readinessOf(70, 90, 5), tpl)).toBe(
      "70 = knowledge 90 − calibration 5",
    );
  });

  it("reads nothing but score, knowledge and calibration_penalty", () => {
    const fields = new Set<string>();
    const spy = new Proxy(readinessOf(12, 15, 3), {
      get(target, prop, recv) {
        fields.add(String(prop));
        return Reflect.get(target, prop, recv);
      },
    });
    readinessEquation(spy, tpl);
    expect([...fields].sort()).toEqual(["calibration_penalty", "knowledge", "score"]);
  });

  it("the dial's accessible name uses the same fields and the gate threshold", () => {
    const label = dialLabel(readinessOf(78, 84, 6), (p) =>
      learnHub.ready.dialLabel
        .replace("{s}", String(p.s))
        .replace("{k}", String(p.k))
        .replace("{c}", String(p.c))
        .replace("{g}", String(p.g)),
    );
    expect(label).toContain("Readiness 78 out of 100: knowledge 84 minus calibration 6");
    expect(label).toContain("85");
  });

  it("orders the weakest topics first", () => {
    expect(weakestTopics(readinessOf(50, 50, 0))).toEqual(["LL2", "LL3", "LL4"]);
  });
});

describe('"Book anyway" is always visible (DP-06, GAMIFICATION_ENGINE §5.2)', () => {
  const renderAt = (score: number, gateMet: boolean) =>
    render(
      <NextIntlClientProvider locale="en" messages={{ learnHub }}>
        <BookAnyway score={score} gateMet={gateMet} />
      </NextIntlClientProvider>,
    );

  for (const score of [0, 50, 85, 100]) {
    it(`at readiness ${score} (gate not met) a booking link is on screen`, () => {
      renderAt(score, false);
      const link = screen.getByTestId("book-anyway");
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe("/apply");
      expect(link.textContent).toBe("Book my LL test anyway");
      expect(link.closest("[hidden]")).toBeNull();
      expect(screen.getByText("We suggest 85. It's your choice.")).toBeTruthy();
    });

    it(`at readiness ${score} with every gate condition met, booking is the primary action`, () => {
      renderAt(score, true);
      const link = screen.getByTestId("book-anyway");
      expect(link.getAttribute("href")).toBe("/apply");
      expect(link.textContent).toBe("Book your LL test");
    });
  }

  it("the confirmation is one neutral question with two equal answers", () => {
    renderAt(40, false);
    fireEvent.click(screen.getByTestId("book-anyway"));
    expect(
      screen.getByText(/You're at 40\. We suggest 85, but you know your schedule/),
    ).toBeTruthy();
    expect(screen.getByText("Book now")).toBeTruthy();
    expect(screen.getByText("Not now")).toBeTruthy();
    // The link itself stays on screen while asking.
    expect(screen.getByTestId("book-anyway")).toBeTruthy();
  });
});

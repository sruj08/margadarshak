// @vitest-environment jsdom
import { generateFindings, templateDraft, validateDraft } from "@margdarshak/game-core/debrief";
import { goldenVectors } from "@margdarshak/game-core/fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntlWrap } from "@/features/games/test-utils";
import { buildTemplateCard, drillHref } from "./build-card";
import { catalogueFor } from "./catalogue.server";
import { TemplateCard } from "./TemplateCard";
import { coachCard } from "./use-debrief";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const catalogue = catalogueFor("nazar");
const nazarVectors = goldenVectors().filter((v) => v.ctx.gameId === "nazar");
const NOW = "2026-10-24T10:00:00.000Z";

describe("TemplateCard (DEBRIEF_SPEC §9, P2 DoD: the template debrief passes the validator)", () => {
  for (const locale of ["en", "hi"] as const) {
    it(`every Nazar golden vector: templateDraft passes validateDraft in ${locale}`, () => {
      expect(nazarVectors.length).toBeGreaterThanOrEqual(5);
      for (const v of nazarVectors) {
        const pack = generateFindings(v.expectedResult, {}, catalogue, { locale });
        const draft = templateDraft(pack, catalogue, locale);
        const verdict = validateDraft(draft, pack);
        expect(verdict.violations, v.name).toEqual([]);
        expect(verdict.verdict).toBe("pass");
      }
    });
  }

  it("renders the four sections, 'Auto notes' and the certification footer in English", () => {
    const v = nazarVectors.find((x) => x.name === "nazar-medium") ?? nazarVectors[0];
    if (!v) throw new Error("no vector");
    const { card } = buildTemplateCard({
      result: v.expectedResult,
      history: {},
      catalogue,
      locale: "en",
      now: NOW,
    });
    render(
      <IntlWrap>
        <TemplateCard
          card={card}
          findings={v.expectedResult.findings}
          sid={v.ctx.sid}
          source="template"
        />
      </IntlWrap>,
    );
    expect(screen.getByTestId("debrief-notes-label").textContent).toBe("Auto notes");
    expect(screen.getByTestId("debrief-footer").textContent).toBe(
      "Practice and familiarisation, not certification",
    );
    for (const h of ["How you did", "Where you lacked", "Your next drill"])
      expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    // No rule is verified today, so no rule chip appears (rule chips only for verified rules).
    expect(screen.queryByRole("button", { name: /Where this comes from/ })).toBeNull();
    expect(card.where_you_lacked.every((p) => p.rule === null)).toBe(true);
    // The drill deep link points at a web route.
    const drill = screen.getByTestId("debrief-drill");
    expect(drill.getAttribute("href")).toMatch(/^\/learn\/practise\/nazar\?mode=/);
    // Nazar findings tied to a clip offer the replay.
    expect(screen.getAllByTestId("debrief-watch").length).toBeGreaterThan(0);
  });

  it("renders in Hindi with the Hindi labels and no Western-only copy", () => {
    const v = nazarVectors[1] ?? nazarVectors[0];
    if (!v) throw new Error("no vector");
    const { card } = buildTemplateCard({
      result: v.expectedResult,
      history: {},
      catalogue,
      locale: "hi",
      now: NOW,
    });
    render(
      <IntlWrap locale="hi">
        <TemplateCard
          card={card}
          findings={v.expectedResult.findings}
          sid={v.ctx.sid}
          source="template"
        />
      </IntlWrap>,
    );
    expect(screen.getByTestId("debrief-notes-label").textContent).toBe("स्वचालित नोट्स");
    expect(screen.getByTestId("debrief-footer").textContent).toBe(
      "अभ्यास और परिचय के लिए, प्रमाणन नहीं",
    );
    expect(screen.getByRole("heading", { name: "कहाँ कमी रही" })).toBeTruthy();
  });

  it("drill links map debrief drills to the right mode", () => {
    expect(drillHref("margdarshak://play/nazar?drill=DR-NAZ-MOCK", "DR-NAZ-MOCK")).toBe(
      "/learn/practise/nazar?mode=mock&drill=DR-NAZ-MOCK",
    );
    expect(
      drillHref(
        "margdarshak://play/nazar?drill=DR-NAZ-OCCL-DOOR_OPENING&level=2",
        "DR-NAZ-OCCL-DOOR_OPENING",
      ),
    ).toBe("/learn/practise/nazar?mode=learn&drill=DR-NAZ-OCCL-DOOR_OPENING&level=2");
    expect(
      drillHref("margdarshak://play/stopping_distance?drill=DR-SD-PREDICT", "DR-SD-PREDICT"),
    ).toMatch(/^\/learn\/practise\/stopping-distance\?mode=practice/);
  });

  it("use-debrief keeps the template unless the server sends a validated AI card (API-36 is P3)", () => {
    const v = nazarVectors[0];
    if (!v) throw new Error("no vector");
    const { card } = buildTemplateCard({
      result: v.expectedResult,
      history: {},
      catalogue,
      locale: "en",
      now: NOW,
    });
    const wire = {
      debrief_id: "dbf_X",
      session_id: v.ctx.sid,
      status: "ai_ready" as const,
      source: "ai" as const,
      how_you_did: "ok",
      where_you_lacked: [],
      what_you_could_have_done: [],
      next_drill: { drill_id: "DR-NAZ-MOCK" },
      validator: { passed: false, attempts: 2 },
    };
    expect(coachCard(wire, card)).toBeNull();
    expect(coachCard({ ...wire, validator: { passed: true, attempts: 1 } }, card)?.kind).toBe(
      "coach_notes",
    );
  });

  it("a coach card cites only the server's verified rules and shows 'why these numbers?'", () => {
    const v = nazarVectors[0];
    if (!v) throw new Error("no vector");
    const { card } = buildTemplateCard({
      result: v.expectedResult,
      history: {},
      catalogue,
      locale: "en",
      now: NOW,
    });
    const wire = {
      debrief_id: "dbf_X",
      session_id: v.ctx.sid,
      status: "ai_ready" as const,
      source: "ai" as const,
      how_you_did: "ok",
      where_you_lacked: [
        { finding_id: "NAZ_LATE_RESPONSE", rule_id: "RR-PED-001", text: "late" },
        { finding_id: "NAZ_MISSED_HAZARD", rule_id: "RR-UNVERIFIED", text: "missed" },
      ],
      what_you_could_have_done: [],
      next_drill: { drill_id: "DR-NAZ-MOCK" },
      rules: [
        {
          rule_id: "RR-PED-001",
          text: "Give way to pedestrians.",
          source_url: "https://example.org",
          verified_on: "2026-10-22",
        },
      ],
      validator: { passed: true, attempts: 1 },
    };
    const coach = coachCard(wire, card);
    expect(coach?.where_you_lacked[0]?.rule?.verified_on).toBe("2026-10-22");
    expect(coach?.where_you_lacked[1]?.rule ?? null).toBeNull();
    if (!coach) throw new Error("no coach card");
    render(
      <IntlWrap>
        <TemplateCard
          card={coach}
          findings={v.expectedResult.findings}
          sid={v.ctx.sid}
          source="coach"
        />
      </IntlWrap>,
    );
    expect(screen.getByTestId("debrief-why").textContent).toContain("Why these numbers?");
    expect(screen.getByTestId("debrief-helpful-yes")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import studyEn from "../../../messages/en/study.json";
import * as api from "./api";
import { formFor, participantCode } from "./forms";
import { NearMissStep } from "./NearMiss";
import { scanNearMiss } from "./near-miss";
import { StudyFlow } from "./StudyFlow";
import { pickFeedbackClips, studyScore } from "./score";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: { href: string; children: ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

// The game phases mount the host through next/dynamic; they are covered by the e2e flow.
vi.mock("./StudyStage", () => ({ LlPhase: () => null, NazarPhase: () => null }));
vi.mock("./Feedback", () => ({ FeedbackStep: () => null }));

// Spy on every facade call while keeping the real (mock-mode) behaviour.
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    grantStudyConsent: vi.fn(actual.grantStudyConsent),
    enrolStudy: vi.fn(actual.enrolStudy),
    recordNearMiss: vi.fn(actual.recordNearMiss),
    getPublicStats: vi.fn(actual.getPublicStats),
  };
});

function Wrap({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ study: studyEn }} timeZone="Asia/Kolkata">
      {children}
    </NextIntlClientProvider>
  );
}

const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in tests")));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const storedStudyKeys = () =>
  [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith("md."));

describe("consent (FIELD_STUDY §4.3 step 1, §6.1)", () => {
  it("declining makes no API call and stores nothing", async () => {
    render(
      <Wrap>
        <StudyFlow />
      </Wrap>,
    );
    fireEvent.click(await screen.findByTestId("consent-decline"));
    expect(await screen.findByTestId("study-declined")).toBeTruthy();
    expect(api.grantStudyConsent).not.toHaveBeenCalled();
    expect(api.enrolStudy).not.toHaveBeenCalled();
    expect(api.recordNearMiss).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storedStudyKeys()).toEqual([]);
  });

  it("answering under 18 makes no API call and stores nothing", async () => {
    render(
      <Wrap>
        <StudyFlow />
      </Wrap>,
    );
    fireEvent.click(await screen.findByTestId("consent-under18"));
    expect(await screen.findByTestId("study-under18")).toBeTruthy();
    expect(api.grantStudyConsent).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storedStudyKeys()).toEqual([]);
  });

  it("no checkbox on the consent screen is pre-ticked; agree → bands → anonymous ID", async () => {
    render(
      <Wrap>
        <StudyFlow />
      </Wrap>,
    );
    const consent = await screen.findByTestId("study-consent");
    expect(consent.querySelectorAll("input:checked")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("consent-agree"));
    await screen.findByTestId("study-bands");
    expect(api.grantStudyConsent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("bands-continue"));
    expect(await screen.findByText("Choose one option in each group.")).toBeTruthy();
    expect(api.enrolStudy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("band-age-21_24"));
    fireEvent.click(screen.getByTestId("band-licence-2w"));
    fireEvent.click(screen.getByTestId("band-years-1_3"));
    fireEvent.click(screen.getByTestId("bands-continue"));
    expect((await screen.findByTestId("participant-code")).textContent).toBe("P-001");
    expect(screen.getByTestId("study-enrolled").getAttribute("data-form")).toBe("A");
    const body = vi.mocked(api.enrolStudy).mock.calls[0]?.[0];
    expect(body).toMatchObject({ age_ok: true, age_band: "21_24", licence_held: "2w" });
    expect(Object.keys(body ?? {})).not.toContain("name");
  });
});

describe("form rotation (FIELD_STUDY §4.2) is deterministic in mock mode", () => {
  it("A → B → C by arrival order", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(formFor)).toEqual(["A", "B", "C", "A", "B", "C", "A"]);
    expect(participantCode(7)).toBe("P-007");
    expect(participantCode(1234)).toBe("P-1234");
  });

  it("the mock enrolment rotates per arrival and repeats within one visit", () => {
    const body = {
      age_ok: true as const,
      age_band: "18_20" as const,
      licence_held: "ll" as const,
      years_driving: "0_1" as const,
    };
    const a = api.mockEnrol(body);
    expect([a.participant_code, a.form]).toEqual(["P-001", "A"]);
    expect(api.mockEnrol(body).participant_code).toBe("P-001");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      sessionStorage.clear(); // a new participant's visit on the same browser
      const p = api.mockEnrol(body);
      seen.push(`${p.participant_code}:${p.form}`);
    }
    expect(seen).toEqual(["P-002:B", "P-003:C", "P-004:A", "P-005:B"]);
  });
});

describe("near-miss line (D-21): privacy-scanned and redacted before sending", () => {
  it("masks phone numbers, vehicle numbers, licence numbers and e-mail", () => {
    const s = scanNearMiss("Bus ke peeche se JK02AB1234 wala aaya, call 9876543210 or a@b.co");
    expect(s.changed).toBe(true);
    expect(s.kinds).toEqual(expect.arrayContaining(["plate", "phone", "email"]));
    expect(s.text).not.toMatch(/JK02AB1234|9876543210|a@b\.co/);
    const l = scanNearMiss("my DL JK02 20190001234 was checked");
    expect(l.kinds).toContain("licence");
    expect(l.text).not.toContain("20190001234");
  });

  it("leaves an ordinary line alone and caps it at 140 characters", () => {
    const s = scanNearMiss(
      "A boy ran out from behind a bus at 30 km/h, I braked at the last second",
    );
    expect(s.changed).toBe(false);
    expect(scanNearMiss("x".repeat(200)).text).toHaveLength(140);
  });

  it("the step sends only the redacted text", async () => {
    render(
      <Wrap>
        <NearMissStep participantCode="P-017" onDone={() => {}} />
      </Wrap>,
    );
    fireEvent.change(screen.getByTestId("near-miss-text"), {
      target: { value: "Truck JK 02 AB 1234 cut me off, my number 98765 43210" },
    });
    fireEvent.click(screen.getByTestId("near-miss-send"));
    await screen.findByTestId("near-miss-sent");
    const call = vi.mocked(api.recordNearMiss).mock.calls[0];
    expect(call?.[0]).toBe("P-017");
    expect(call?.[1].text).not.toMatch(/1234|98765|43210/);
    expect(call?.[1].text).toContain("[vehicle number]");
    expect(screen.getByTestId("near-miss-removed").textContent).toContain("a vehicle number");
  });

  it("skipping sends nothing", () => {
    const done = vi.fn();
    render(
      <Wrap>
        <NearMissStep participantCode="P-017" onDone={done} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId("near-miss-skip"));
    expect(done).toHaveBeenCalled();
    expect(api.recordNearMiss).not.toHaveBeenCalled();
  });
});

describe("score card numbers (FIELD_STUDY §7.1 mapping)", () => {
  it("hpt 0–100, per-clip means 0–10, pass line at 60, provisional when unchecked", () => {
    const s = studyScore({
      test: { server_checked: false, score: { raw: 54, max: 100 } },
      fresh: { server_checked: false, score: { raw: 31, max: 50 } },
      ll: { raw: 11, max: 15 },
    });
    expect(s).toMatchObject({
      hpt: 54,
      preMean: 5.4,
      postMean: 6.2,
      belowPass: true,
      provisional: true,
    });
    const ok = studyScore({
      test: { server_checked: true, score: { raw: 60, max: 100 } },
      fresh: null,
      ll: null,
    });
    expect(ok.belowPass).toBe(false);
    expect(ok.provisional).toBe(false);
  });

  it("replays the latest tap first, then a missed hazard", () => {
    const clip = (ordinal: number, tap: number | null, late: number | null) => ({
      ordinal,
      windows: [{ hazard_id: "h1", a_ms: 1000 }],
      analysis: { hazards: [{ hazard_id: "h1", tap_mt: tap, late_s: late }] },
    });
    const picked = pickFeedbackClips([
      clip(1, 1200, 0),
      clip(2, null, null),
      clip(3, 4000, 2.1),
      clip(4, 3000, 0.8),
    ]);
    expect(picked.map((c) => c.ordinal)).toEqual([3, 4]);
  });
});

describe("resume after consent", () => {
  it("a reload after enrolment resumes the same participant", async () => {
    sessionStorage.setItem(
      "md.study.flow.v1",
      JSON.stringify({
        v: 1,
        step: "enrolled",
        sids: {},
        participant: {
          participant_code: "P-042",
          form: "C",
          cohort: "field_test",
          phases: [],
          ai_debrief: false,
          created_at: "2026-10-24T10:00:00Z",
        },
      }),
    );
    render(
      <Wrap>
        <StudyFlow />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByTestId("participant-code").textContent).toBe("P-042"));
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ai from "../../../messages/en/ai.json";
import type { CoachTurnRequest } from "./api";
import { QuestionCoach } from "./QuestionCoach";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const coachTurn = vi.fn();
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  coachTurn: (b: CoachTurnRequest) => coachTurn(b),
  sendAIFeedback: vi.fn(async () => ({ ok: true, data: null })),
}));

const spoken: string[] = [];
beforeEach(() => {
  spoken.length = 0;
  coachTurn.mockReset();
  class Utterance {
    lang = "";
    voice = null;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [],
    cancel: vi.fn(),
    speak: (u: Utterance) => spoken.push(u.text),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ll = { game: "ll" as const, itemId: "C-LL1-001:v1", chosenOptionId: "b" };

function show(subject: Parameters<typeof QuestionCoach>[0]["subject"] = ll) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ai }}>
      <QuestionCoach subject={subject} fallbackText="A red octagon means stop." />
    </NextIntlClientProvider>,
  );
}

describe("QuestionCoach (API-79 in the question flow)", () => {
  it("asks about THIS question, reads the turn aloud, and answers a typed follow-up", async () => {
    coachTurn.mockResolvedValueOnce({
      ok: true,
      data: {
        kind: "feedback",
        source: "ai",
        say: "Not quite: it means stop.",
        follow_up: "Where do you stop?",
      },
    });
    show();
    expect(coachTurn).toHaveBeenCalledWith({
      kind: "feedback",
      game: "ll",
      question: { question_id: "C-LL1-001", variant_id: "v1", chosen_option_id: "b" },
    });
    expect(await screen.findByTestId("coach-say")).toHaveProperty(
      "textContent",
      "Not quite: it means stop.",
    );
    expect(spoken[0]).toContain("Where do you stop?");

    coachTurn.mockResolvedValueOnce({
      ok: true,
      data: { kind: "reply", source: "ai", say: "Yes, at the stop line.", verdict: "good" },
    });
    fireEvent.change(screen.getByLabelText(/type your answer/i), {
      target: { value: "at the line" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(coachTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "reply",
        follow_up: "Where do you stop?",
        answer: "at the line",
      }),
    );
    expect((await screen.findByTestId("coach-reply")).dataset["verdict"]).toBe("good");
  });

  it("drops a late answer for a question the learner already left", async () => {
    let resolve: (v: unknown) => void = () => {};
    coachTurn.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const view = show({ ...ll, itemId: "C-LL2-001:v1" });
    coachTurn.mockResolvedValueOnce({
      ok: true,
      data: { kind: "feedback", source: "ai", say: "Second question.", follow_up: null },
    });
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ ai }}>
        <QuestionCoach subject={{ ...ll, itemId: "C-LL1-002:v1" }} fallbackText={null} />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("Second question.")).toBeTruthy();
    await act(async () =>
      resolve({
        ok: true,
        data: { kind: "feedback", source: "ai", say: "First question.", follow_up: null },
      }),
    );
    expect(screen.queryByText("First question.")).toBeNull();
  });

  it("says why there is no AI turn and offers the reviewed text aloud", async () => {
    coachTurn.mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: "CONSENT_REQUIRED",
      reason: "problem",
    });
    show({ ...ll, itemId: "C-LL3-001:v1" });
    const panel = await screen.findByTestId("coach-turn");
    await vi.waitFor(() =>
      expect(panel.dataset["why"] ?? screen.getByTestId("coach-turn").dataset["why"]).toBe(
        "consent",
      ),
    );
    expect(screen.getByText("Reviewed explanation")).toBeTruthy();
    fireEvent.click(screen.getByTestId("coach-listen"));
    expect(spoken).toEqual(["A red octagon means stop."]);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import learnHub from "../../../../messages/en/learnHub.json";
import type { BankItem } from "../content/bank-types";
import { QuestionCard } from "./question-card";

afterEach(cleanup);

const item: BankItem = {
  id: "C-LL1-001:v1",
  concept: "C-LL1-001",
  topic: "LL1",
  form: "sign_to_meaning",
  pool: "practice",
  stem: "What does this sign mean?",
  visuals: [
    {
      id: "SIGN-MAN-001",
      kind: "sign",
      shape: "octagon",
      scheme: "red_octagon_white_text",
      family: "MANDATORY",
      alt: "Red octagon with the word STOP in white letters",
    },
  ],
  options: [
    { id: "a", text: "Stop", visual: null },
    { id: "b", text: "Cross road", visual: null },
    { id: "c", text: "Parking", visual: null },
    { id: "d", text: "Give way", visual: null },
  ],
};

function setup() {
  const onAnswered = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ learnHub }}>
      <QuestionCard
        item={item}
        seed="s1"
        answerKey={{ correct: "a", explanation: "A red octagon is the stop sign.", ruleIds: [] }}
        onAnswered={onAnswered}
        onContinue={() => {}}
      />
    </NextIntlClientProvider>,
  );
  const check = screen.getByRole("button", { name: "Check" }) as HTMLButtonElement;
  return { onAnswered, check };
}

describe("QuestionCard: confidence is asked before feedback (UI_SPEC §2.5, GAME_DESIGN §11.3)", () => {
  it("Check stays disabled with an answer but no confidence, and no feedback shows", () => {
    const { check, onAnswered } = setup();
    fireEvent.click(screen.getByLabelText(/Stop/));
    expect(check.disabled).toBe(true);
    fireEvent.click(check);
    expect(onAnswered).not.toHaveBeenCalled();
    expect(screen.queryByTestId("feedback")).toBeNull();
  });

  it("Check stays disabled with a confidence but no answer", () => {
    const { check } = setup();
    fireEvent.click(screen.getByLabelText("Certain · 100%"));
    expect(check.disabled).toBe(true);
    expect(screen.queryByTestId("feedback")).toBeNull();
  });

  it("feedback appears only after answer + confidence + Check, and the confidence is then locked", () => {
    const { check, onAnswered } = setup();
    fireEvent.click(screen.getByLabelText(/Parking/));
    fireEvent.click(screen.getByLabelText("Certain · 100%"));
    expect(screen.queryByTestId("feedback")).toBeNull();
    expect(check.disabled).toBe(false);
    fireEvent.click(check);
    const fb = screen.getByTestId("feedback");
    expect(fb.textContent).toContain("Not quite");
    expect(fb.textContent).toContain("You were certain on this one.");
    expect(onAnswered).toHaveBeenCalledTimes(1);
    expect(onAnswered.mock.calls[0]?.[0]).toMatchObject({
      optionId: "c",
      confidence: "100",
      correct: false,
    });
    // Both radio groups are now disabled: the stated confidence can't be changed after the answer.
    expect(screen.getByLabelText("Guess · 50%").closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByLabelText(/Parking/).closest("fieldset")?.disabled).toBe(true);
  });

  it("the sign's description says shape and symbol, never the meaning", () => {
    setup();
    const fig = screen.getByRole("img");
    expect(fig.getAttribute("aria-label")).toBe("Red octagon with the word STOP in white letters");
    expect(fig.getAttribute("aria-label")).not.toMatch(/must stop|stop completely/i);
  });
});

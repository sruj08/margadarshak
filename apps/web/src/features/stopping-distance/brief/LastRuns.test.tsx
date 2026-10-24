// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "@/features/games/results-store";
import simsEn from "../../../../messages/en/sims.json";
import simsHi from "../../../../messages/hi/sims.json";
import { LastRuns } from "./LastRuns";

const store = vi.hoisted(() => ({ list: vi.fn((): SessionRecord[] => []) }));
vi.mock("@/features/games/results-store", () => ({ listSessionRecords: store.list }));

const wrap = (locale: "en" | "hi") =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ sims: locale === "hi" ? simsHi : simsEn }}
      timeZone="Asia/Kolkata"
    >
      <LastRuns gameId="stopping_distance" />
    </NextIntlClientProvider>,
  );

afterEach(() => {
  cleanup();
  store.list.mockReset();
});

describe("brief screen states (UI_SPEC_LEARN_GAMES §1.5) in en and hi", () => {
  it.each(["en", "hi"] as const)("%s: empty", (locale) => {
    store.list.mockReturnValue([]);
    wrap(locale);
    expect(screen.getByTestId("last-runs").dataset["state"]).toBe("empty");
    expect(screen.getByTestId("runs-empty").textContent).toBe(
      (locale === "hi" ? simsHi : simsEn).runs.empty,
    );
  });

  it.each(["en", "hi"] as const)("%s: error, with a retry", (locale) => {
    store.list.mockImplementation(() => {
      throw new Error("storage blocked");
    });
    wrap(locale);
    expect(screen.getByTestId("runs-error").textContent).toContain(
      (locale === "hi" ? simsHi : simsEn).runs.retry,
    );
  });

  it.each(["en", "hi"] as const)("%s: success lists the run, labelled provisional", (locale) => {
    store.list.mockReturnValue([
      {
        sid: "s1",
        savedAt: Date.UTC(2026, 9, 24),
        checked: { server_checked: false, server_score_pct: null, score: { pct: 72.5 } },
      } as unknown as SessionRecord,
    ]);
    wrap(locale);
    const text = screen.getByTestId("runs-list").textContent ?? "";
    expect(text).toContain("72.5");
    expect(text).toContain((locale === "hi" ? simsHi : simsEn).runs.provisional);
  });
});

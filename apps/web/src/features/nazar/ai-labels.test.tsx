// @vitest-environment jsdom
// ADR-0013: every AI-generated Nazar clip is labelled "AI-generated scene" (player, replay, SR
// version, results, share card), the placeholder keeps its own label, and the copy never claims
// real roads, Kerala's clips or anything "official".
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntlWrap } from "@/features/games/test-utils";
import type { SessionOutcome } from "@/features/games/types";
import { cardLabels, type GamesT } from "@/features/share/card-labels";
import { ShareCardView } from "@/features/share/ShareCardView";
import nazarEn from "../../../messages/en/nazar.json";
import nazarHi from "../../../messages/hi/nazar.json";
import { AiSceneChip } from "./AiSceneChip";
import { anyAiScene, clipOrigin } from "./origin";
import { ReplayScrubber } from "./replay/ReplayScrubber";
import { NazarResultsExtra } from "./results-extra";
import { ScreenReaderAlt } from "./sr/ScreenReaderAlt";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

const record = vi.hoisted(() => ({
  media: "video" as "video" | "placeholder",
  origin: "ai_generated" as "ai_generated" | "filmed",
}));
vi.mock("@/features/games/results-store", () => ({
  getSessionRecord: () => ({
    media: record.media,
    items: [{ item_ref: "clip:AIG-0001@1", kind: "clip", origin: record.origin }],
    events: [],
  }),
}));

afterEach(cleanup);

describe("clipOrigin", () => {
  it("is null for the placeholder timeline (not an AI scene)", () => {
    expect(clipOrigin({ origin: "ai_generated" }, "placeholder")).toBeNull();
    expect(clipOrigin(undefined, "placeholder")).toBeNull();
  });

  it("follows the item's own origin; no origin means no AI label", () => {
    expect(clipOrigin({ origin: "ai_generated" }, "video")).toBe("ai_generated");
    expect(clipOrigin({ origin: "filmed" }, "video")).toBe("filmed");
    expect(clipOrigin({ item_ref: "clip:KL-0001@1" }, "video")).toBeNull();
    expect(clipOrigin({ origin: 42 }, "video")).toBeNull();
    expect(clipOrigin(null, "video")).toBeNull();
  });

  it("anyAiScene is true only when a played item is an AI-generated scene", () => {
    expect(anyAiScene([{ origin: "filmed" }, { origin: "ai_generated" }], "video")).toBe(true);
    expect(anyAiScene([{ origin: "filmed" }, {}], "video")).toBe(false);
    expect(anyAiScene([{ origin: "ai_generated" }], "placeholder")).toBe(false);
  });
});

describe("AI-generated scene chip", () => {
  it("is visible text that screen readers read", () => {
    render(
      <IntlWrap>
        <AiSceneChip variant="overlay" />
      </IntlWrap>,
    );
    const chip = screen.getByTestId("ai-scene-chip");
    expect(chip.textContent).toBe("AI-generated scene");
    expect(chip.getAttribute("aria-hidden")).toBeNull();
  });

  it("shows on a replay of an AI-generated clip, not on the placeholder, a filmed or unlabelled clip", () => {
    const base = { durationMs: 30_000, windows: [], taps: [], reducedMotion: true };
    const { unmount } = render(
      <IntlWrap>
        <ReplayScrubber {...base} assetUrl="blob:clip" origin="ai_generated" />
      </IntlWrap>,
    );
    expect(screen.getByTestId("ai-scene-chip")).toBeTruthy();
    unmount();
    const unlabelled = render(
      <IntlWrap>
        <ReplayScrubber {...base} assetUrl="blob:clip" />
      </IntlWrap>,
    );
    expect(screen.queryByTestId("ai-scene-chip")).toBeNull();
    unlabelled.unmount();
    const placeholder = render(
      <IntlWrap>
        <ReplayScrubber {...base} />
      </IntlWrap>,
    );
    expect(screen.queryByTestId("ai-scene-chip")).toBeNull();
    placeholder.unmount();
    render(
      <IntlWrap>
        <ReplayScrubber {...base} assetUrl="blob:clip" origin="filmed" />
      </IntlWrap>,
    );
    expect(screen.queryByTestId("ai-scene-chip")).toBeNull();
  });

  it("the screen-reader version says the timed clips are AI-generated", () => {
    render(
      <IntlWrap>
        <ScreenReaderAlt />
      </IntlWrap>,
    );
    expect(screen.getByTestId("sr-ai-line").textContent).toBe(nazarEn.sr.aiLine);
  });
});

describe("results line", () => {
  const outcome: SessionOutcome = {
    sid: "s1",
    gameId: "nazar",
    mode: "practice",
    checked: null,
    status: "provisional",
  };

  it("says results describe the AI scenes when the clips were AI-generated", () => {
    record.media = "video";
    render(
      <IntlWrap>
        <NazarResultsExtra outcome={outcome} />
      </IntlWrap>,
    );
    expect(screen.getByTestId("nazar-ai-results").textContent).toBe(nazarEn.results.aiScenes);
  });

  it("stays off when the clips were filmed", () => {
    record.media = "video";
    record.origin = "filmed";
    render(
      <IntlWrap>
        <NazarResultsExtra outcome={outcome} />
      </IntlWrap>,
    );
    expect(screen.queryByTestId("nazar-ai-results")).toBeNull();
    record.origin = "ai_generated";
  });

  it("stays off for the placeholder timeline", () => {
    record.media = "placeholder";
    render(
      <IntlWrap>
        <NazarResultsExtra outcome={outcome} />
      </IntlWrap>,
    );
    expect(screen.queryByTestId("nazar-ai-results")).toBeNull();
  });
});

describe("share card AI label", () => {
  const content = {
    display_name: "KS",
    nazar_score: 64,
    counted_sessions: 2,
    rank: "gali" as const,
    kerala_line: false,
    percentile: null,
    calibration: null,
  };
  const t: GamesT = (key) => key;

  it("prints the label when the caller passes it", () => {
    const labels = cardLabels(t, content, { showRank: false, aiScenes: nazarEn.ai.shareCard });
    render(<ShareCardView content={content} labels={labels} />);
    expect(screen.getByTestId("share-ai-label").textContent).toBe(
      "Scored on AI-generated road scenes",
    );
  });

  it("older callers without it still render", () => {
    const labels = cardLabels(t, content, { showRank: false });
    expect(labels.aiScenes).toBeNull();
    render(<ShareCardView content={content} labels={labels} />);
    expect(screen.queryByTestId("share-ai-label")).toBeNull();
  });
});

describe("AI copy (ADR-0013 wording)", () => {
  it("the brief line is exact and every AI string is honest in both languages", () => {
    expect(nazarEn.ai.brief).toBe(
      "Practice on AI-generated road scenes in Kerala's announced format.",
    );
    expect(nazarEn.notTest).toContain("not Kerala's test");
    const en = JSON.stringify(nazarEn).toLowerCase();
    for (const banned of ["real indian roads", "kerala's clips", "official"])
      expect(en).not.toContain(banned);
    expect(JSON.stringify(nazarHi)).not.toContain("आधिकारिक");
    for (const s of [nazarHi.ai.chip, nazarHi.ai.brief, nazarHi.ai.shareCard])
      expect(s).toContain("AI");
  });
});

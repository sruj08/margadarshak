// @vitest-environment jsdom
import { arraySink, createEventRecorder, SessionLifecycle } from "@margdarshak/game-core/sdk";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_A11Y } from "@/features/games/host/a11y-context";
import { GameStage } from "@/features/games/host/GameStage";
import { queueStore } from "@/features/games/host/queue";
import { deviceComplete, deviceStartSession, manifestFor } from "@/features/games/mock-api";
import { IntlWrap } from "@/features/games/test-utils";
import type { GameA11y, WebGameModule } from "@/features/games/types";
import gamesEn from "../../../messages/en/games.json";
import nazarEn from "../../../messages/en/nazar.json";
import { freezePoints } from "./learn-mode";
import { NazarPlayer } from "./NazarPlayer";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

const bytes = () => new Response(new Uint8Array(2048));

/** Mounts the player alone with a device session, a memory sink and the page clock faked. */
async function mountPlayer(mode: "learn" | "practice" | "mock", a11y: Partial<GameA11y> = {}) {
  const started = deviceStartSession("nazar", { mode }, { locale: "en" });
  const sink = arraySink();
  const recorder = createEventRecorder(started.start.ctx, sink, { now: () => performance.now() });
  let module: WebGameModule | null = null;
  const onEnd = vi.fn();
  render(
    <IntlWrap>
      <NazarPlayer
        ctx={started.start.ctx}
        session={{
          start: started.start,
          source: "device",
          items: started.start.items,
          media: "placeholder",
          deviceContent: started.deviceContent,
        }}
        recorder={recorder}
        lifecycle={new SessionLifecycle()}
        a11y={{ ...DEFAULT_A11Y, ...a11y }}
        paused={false}
        register={(m) => {
          module = m;
          return () => {};
        }}
        reportProgress={vi.fn()}
        setCurrentItem={vi.fn()}
        setHud={vi.fn()}
        onEnd={onEnd}
      />
    </IntlWrap>,
  );
  await waitFor(() => expect(module).not.toBeNull());
  const m = module as unknown as WebGameModule;
  await act(async () => {
    await m.init(started.start.ctx, recorder);
    m.start();
  });
  return { started, sink, module: m, onEnd, recorder };
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => bytes()),
  );
  vi.useFakeTimers({ toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Nazar player", () => {
  it("learn mode freezes 0.5 s before onset and records the prediction, then 'Tap where' (MD-224)", async () => {
    const { started, sink, onEnd } = await mountPlayer("learn");
    const reveal = started.start.items[0]?.reveal;
    const points = freezePoints(reveal);
    expect(points.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("clip-start"));
    const first = points[0];
    if (!first) throw new Error("no freeze");
    await advance(first.freezeMs + 40);
    expect(screen.getByTestId("predict-panel")).toBeTruthy();
    expect(
      screen.getAllByRole("button").filter((b) => b.dataset["testid"]?.startsWith("predict-"))
        .length,
    ).toBe(4);
    const pause = sink.events.find((e) => e.type === "pause");
    expect(pause?.p).toEqual({ cause: "system" });
    fireEvent.click(screen.getByTestId(`predict-${first.hazardType}`));
    const prediction = sink.events.find((e) => e.type === "prediction");
    expect(prediction?.p).toEqual({ choice: first.hazardType });
    expect(prediction?.item).toBe(0);
    expect(prediction?.mt).toBeLessThanOrEqual(first.freezeMs + 40);
    fireEvent.click(screen.getByTestId("predict-continue"));
    expect(sink.events.some((e) => e.type === "resume" && e.p.cause === "system")).toBe(true);
    // "Tap where": a tap after the onset, then play to the end of the clip.
    await advance(700);
    fireEvent.keyDown(window, { key: " " });
    const tap = sink.events.find((e) => e.type === "tap");
    expect(tap?.mt).toBeGreaterThan(first.freezeMs);
    for (let guard = 0; guard < 4 && !screen.queryByTestId("clip-reveal"); guard++) {
      await advance(60_000);
      const panel = screen.queryByTestId("predict-panel");
      if (panel) {
        const truth = points[guard + 1]?.hazardType ?? first.hazardType;
        fireEvent.click(screen.getByTestId(`predict-${truth}`));
        fireEvent.click(screen.getByTestId("predict-continue"));
      }
    }
    expect(screen.getByTestId("clip-reveal")).toBeTruthy();
    const end = sink.events.find((e) => e.type === "item_end");
    expect(end?.p).toMatchObject({ reason: "done" });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("the correct prediction scores in learn mode (game-core pairs the k-th answer with the k-th hazard)", async () => {
    const { started, sink, recorder } = await mountPlayer("learn");
    const points = freezePoints(started.start.items[0]?.reveal);
    fireEvent.click(screen.getByTestId("clip-start"));
    // Media time only runs while the clip plays; a question stops it.
    let media = 0;
    for (const fp of points) {
      await advance(Math.max(0, fp.freezeMs + 40 - media));
      media = Math.max(media, fp.freezeMs + 40);
      fireEvent.click(screen.getByTestId(`predict-${fp.hazardType}`));
      fireEvent.click(screen.getByTestId("predict-continue"));
    }
    await advance(120_000);
    recorder.emit("session_end", { reason: "completed" });
    const { encodeReplay } = await import("@margdarshak/game-core/sdk");
    const ctx = { ...started.start.ctx, items: started.start.ctx.items.slice(0, 1) };
    const content =
      started.deviceContent?.gameId === "nazar"
        ? { ...started.deviceContent, clips: started.deviceContent.clips.slice(0, 1) }
        : null;
    const events = sink.events.map((e, seq) => ({ ...e, seq }));
    const checked = deviceComplete({
      manifest: manifestFor("nazar"),
      ctx,
      replay: encodeReplay(events, ctx.seed),
      events,
      content,
    });
    const predict = checked?.score.components.filter((c) => c.id.endsWith("_predict")) ?? [];
    expect(predict.length).toBe(points.length);
    expect(predict.every((c) => c.value === c.max)).toBe(true);
    expect(checked?.provisional).toBe(true);
    expect(checked?.server_score_pct).toBeNull();
  });

  it("reduced motion: the tap ring appears without the ripple (EC-18 / GAME_DESIGN §2.9)", async () => {
    await mountPlayer("practice", { reducedMotion: true });
    fireEvent.click(screen.getByTestId("clip-start"));
    await advance(1000);
    fireEvent.pointerDown(screen.getByTestId("tap-zone"), { clientX: 10, clientY: 10 });
    const ring = document.querySelector(".mg-ring");
    expect(ring).not.toBeNull();
    expect(ring?.classList.contains("mg-ring--ripple")).toBe(false);
  });

  it("with motion allowed the ring ripples", async () => {
    await mountPlayer("practice", { reducedMotion: false });
    fireEvent.click(screen.getByTestId("clip-start"));
    await advance(1000);
    fireEvent.pointerDown(screen.getByTestId("tap-zone"));
    expect(document.querySelector(".mg-ring--ripple")).not.toBeNull();
  });

  it("spam taps: every tap is recorded, the clip scores 0 and the copy never accuses (EC-18)", async () => {
    const { sink, started } = await mountPlayer("practice");
    fireEvent.click(screen.getByTestId("clip-start"));
    await advance(2000);
    const zone = screen.getByTestId("tap-zone");
    for (let i = 0; i < 10; i++) {
      fireEvent.pointerDown(zone);
      await advance(50);
    }
    expect(sink.events.filter((e) => e.type === "tap")).toHaveLength(10);
    await advance(120_000);
    expect(screen.getByTestId("reveal-pattern").textContent).toBe(nazarEn.reveal.pattern);
    const all = JSON.stringify([gamesEn, nazarEn]).toLowerCase();
    for (const word of ["cheat", "fraud", "caught", "suspicious"]) expect(all).not.toContain(word);
    expect(started.start.items[0]?.reveal).toBeDefined();
  });

  it("mock mode asks the pre-mock calibration first and records it", async () => {
    const { sink } = await mountPlayer("mock");
    expect(screen.getByTestId("calibration")).toBeTruthy();
    fireEvent.click(screen.getByTestId("calib-go"));
    expect(sink.events.find((e) => e.type === "confidence")?.p).toEqual({ predictedPassClips: 5 });
    expect(screen.getByTestId("clip-between")).toBeTruthy();
    expect(screen.queryByTestId("clip-reveal")).toBeNull();
    // The placeholder timeline is not an AI scene: no "AI-generated scene" chip (ADR-0013).
    expect(screen.queryByTestId("ai-scene-chip")).toBeNull();
  });
});

describe("EC-18 buffering blocks start", () => {
  it("Start stays unavailable until every clip is fully loaded", async () => {
    vi.useRealTimers();
    localStorage.clear();
    await queueStore().clear();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return bytes();
      }),
    );
    render(
      <IntlWrap>
        <GameStage gameId="nazar" mode="practice" exitHref="/learn/practise/nazar" />
      </IntlWrap>,
    );
    await screen.findByTestId("stage-loading", {}, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("stage-start")).toBeNull();
    expect(screen.queryByTestId("clip-start")).toBeNull();
    act(() => release?.());
    expect(await screen.findByTestId("stage-start", {}, { timeout: 8000 })).toBeTruthy();
  });
});

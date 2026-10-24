// @vitest-environment jsdom
import { fixtureContentDocs, fixtureFormats } from "@margdarshak/game-core/fixtures";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionRecord, listSessionRecords } from "../results-store";
import { IntlWrap } from "../test-utils";
import type { WebGame, WebGameModule, WebGameProps } from "../types";
import { GameStage } from "./GameStage";
import { queueStore } from "./queue";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function fakeGame() {
  const module: WebGameModule = {
    timingMode: "sim",
    init: vi.fn(async () => {}),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    end: vi.fn(),
    getPreview: () => null,
    destroy: vi.fn(),
    onItemVoided: vi.fn(),
  };
  const props: { current: WebGameProps | null } = { current: null };
  function FakeGame(p: WebGameProps) {
    props.current = p;
    useEffect(() => p.register(module), [p.register]);
    return <p>fake game</p>;
  }
  const game: WebGame = {
    gameId: "stopping_distance",
    replayManifest: {
      gameId: "stopping_distance",
      version: "1.0.0",
      scoringVersion: "1.0",
      budgets: { maxEvents: 1000, maxSessionSeconds: 900 },
    },
    Component: FakeGame,
  };
  return { module, props, game };
}

async function startStage() {
  const f = fakeGame();
  render(
    <IntlWrap>
      <GameStage
        gameId="stopping_distance"
        mode="practice"
        exitHref="/learn/practise"
        load={async () => ({ default: f.game })}
      />
    </IntlWrap>,
  );
  const start = await screen.findByTestId("stage-start", {}, { timeout: 5000 });
  expect(f.module.init).toHaveBeenCalledTimes(1);
  fireEvent.click(start);
  await waitFor(() => expect(f.module.start).toHaveBeenCalledTimes(1));
  return f;
}

beforeEach(async () => {
  localStorage.clear();
  await queueStore().clear();
  setVisibility("visible");
});
afterEach(cleanup);
// The stage imports game-core and the fixtures on first use; on a busy machine that takes seconds.
vi.setConfig({ testTimeout: 60_000 });

describe("GameStage (MD-205)", () => {
  it("pauses the module when the page is hidden (mandatory) and opens the pause sheet", async () => {
    const f = await startStage();
    expect(f.props.current?.lifecycle.state).toBe("Running");
    act(() => setVisibility("hidden"));
    expect(f.module.pause).toHaveBeenCalledTimes(1);
    expect(f.props.current?.lifecycle.state).toBe("Paused");
    await screen.findByTestId("pause-sheet");
    act(() => setVisibility("visible"));
    fireEvent.click(screen.getByTestId("pause-resume"));
    await waitFor(() => expect(f.module.resume).toHaveBeenCalledTimes(1));
    expect(f.props.current?.lifecycle.state).toBe("Running");
  });

  it("voids a timed item hidden mid-play and tells the module before resuming", async () => {
    const f = await startStage();
    act(() => f.props.current?.setCurrentItem(0, true));
    act(() => setVisibility("hidden"));
    expect(f.props.current?.lifecycle.state).toBe("ItemVoided");
    expect(
      await screen.findByText("That clip was paused partway, so it won't count."),
    ).toBeTruthy();
    act(() => setVisibility("visible"));
    fireEvent.click(screen.getByTestId("pause-resume"));
    await waitFor(() => expect(f.module.onItemVoided).toHaveBeenCalledTimes(1));
    expect(f.module.resume).toHaveBeenCalledTimes(1);
  });

  it("on end writes session_end, saves the run on this phone and marks a device result provisional", async () => {
    const f = await startStage();
    const sid = f.props.current?.ctx.sid ?? "";
    expect(f.props.current?.ctx.seedOrigin).toBe("client_offline");
    await act(async () => f.props.current?.onEnd("completed"));
    await screen.findByTestId("results-reveal", {}, { timeout: 5000 });
    expect(f.module.end).toHaveBeenCalledWith("completed");
    const rec = getSessionRecord(sid);
    expect(rec?.events.at(-1)?.type).toBe("session_end");
    expect(rec?.events[0]?.type).toBe("session_start");
    expect(rec?.status).toBe("provisional");
    expect(screen.getByTestId("reveal-status").textContent).not.toBe("Checked");
    // Accepted on the device: the queue no longer holds it.
    expect(await queueStore().session(sid)).toBeNull();
  });

  it("quit never scores the run: nothing is saved or submitted", async () => {
    const f = await startStage();
    const sid = f.props.current?.ctx.sid ?? "";
    fireEvent.click(screen.getByTestId("hud-pause"));
    fireEvent.click(await screen.findByTestId("pause-quit"));
    await waitFor(async () => expect(await queueStore().session(sid)).toBeNull());
    expect(listSessionRecords()).toHaveLength(0);
  });

  it("a deviceItems session keeps its documents and tenant and gets a provisional score (D's LL bank)", async () => {
    const f = fakeGame();
    const llGame: WebGame = {
      ...f.game,
      gameId: "ll_sim",
      replayManifest: { ...f.game.replayManifest, gameId: "ll_sim" },
    };
    const docs = Object.fromEntries(
      Object.entries(fixtureContentDocs()).filter(([ref]) => ref.startsWith("q:")),
    );
    const jk = fixtureFormats()["LLT-JK"] as Record<string, unknown>;
    const deviceItems = {
      items: Object.keys(docs).map((ref) => ({ ref, contentVersion: "1" })),
      docs,
      formats: { "LLT-MH": { ...jk, rule_id: "LLT-MH", state: "MH" } },
    };
    render(
      <IntlWrap>
        <GameStage
          gameId="ll_sim"
          mode="mock"
          tenant="MH"
          exitHref="/learn/practise"
          deviceItems={deviceItems}
          load={async () => ({ default: llGame })}
        />
      </IntlWrap>,
    );
    fireEvent.click(await screen.findByTestId("stage-start", {}, { timeout: 5000 }));
    await waitFor(() => expect(f.module.start).toHaveBeenCalled());
    const sid = f.props.current?.ctx.sid ?? "";
    expect(f.props.current?.ctx.tenant).toBe("MH");
    await act(async () => f.props.current?.onEnd("completed"));
    await screen.findByTestId("results-reveal", {}, { timeout: 5000 });
    const rec = getSessionRecord(sid);
    expect(rec?.deviceDocs?.docs).toEqual(docs);
    expect(rec?.checked?.provisional).toBe(true);
    expect(rec?.checked?.server_score_pct).toBeNull();
    expect(rec?.checked?.score.passRule).toEqual({ source: "rule_pack", ref: "LLT-MH" });
    expect(screen.getByTestId("reveal-score").textContent).not.toContain("Saved.");
  });
});

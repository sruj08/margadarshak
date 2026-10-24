// @vitest-environment jsdom
import { ctxFor, fixtureContentDocs } from "@margdarshak/game-core/fixtures";
import type { BlindSpotContent, BsItem } from "@margdarshak/game-core/schema";
import { GAME_CONFIG, rankFindings, scoreBlindSpot } from "@margdarshak/game-core/scoring";
import { arraySink, createEventRecorder } from "@margdarshak/game-core/sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasWebGL, resetWebGLProbe } from "@/features/phaser/context-loss";
import {
  fakeClock,
  harness,
  hostEnd,
  hostStart,
  SimsIntl,
} from "@/features/stopping-distance/sims-test-utils";
import { BlindSpotGame } from "./BlindSpotGame";
import { type PartA, type PartB, placementCorrect, probeFor, spotsFor, zoneHit } from "./geometry";
import { type LanePos, Ride, type SpeedMode } from "./ride";

const { loadPhaser } = vi.hoisted(() => ({
  loadPhaser: vi.fn(() => Promise.reject(new Error("Phaser must not load here"))),
}));
vi.mock("@/features/phaser/load", () => ({ loadPhaser }));

const C = GAME_CONFIG.blindSpot;
const opts = { gameVersion: "1.0.0", scoringVersion: "1.0", replayInputs: "" };
const docs = fixtureContentDocs();
const PART_A = docs["bs:part-a-truck"] as PartA;
const PART_B = docs["bs:part-b-highway"] as PartB;
const part = (r: ReturnType<typeof scoreBlindSpot>, id: string) =>
  r.score.components.find((c) => c.id === id)?.value ?? null;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  loadPhaser.mockClear();
});

/** Rides Part B on the real controller with a manual clock; returns the scored result. */
function rideWith(
  start: { pos: LanePos; mode: SpeedMode },
  actions: [number, (r: Ride) => void][] = [],
) {
  const ctx = ctxFor({
    n: 31,
    gameId: "blind_spot",
    mode: "practice",
    seed: 7,
    items: [{ ref: "bs:part-b-highway", contentVersion: "1" }],
  });
  let clock = 0;
  const sink = arraySink();
  const rec = createEventRecorder(ctx, sink, { now: () => clock });
  rec.emit("session_start", {
    deviceClass: "mid",
    timingMode: "sim",
    a11yModes: [],
    orientation: "portrait",
  });
  clock = 500;
  rec.emit("item_start", { ref: "bs:part-b-highway" }, { item: 0 });
  const ride = new Ride({ spec: PART_B, item: 0, recorder: rec, now: () => clock });
  ride.setPos(start.pos);
  ride.setMode(start.mode);
  ride.start();
  const todo = [...actions];
  const stepMs = 1000 / 60;
  while (ride.isRunning) {
    clock += stepMs;
    const t = clock - 500;
    while (todo.length > 0 && (todo[0]?.[0] ?? Number.POSITIVE_INFINITY) <= t)
      todo.shift()?.[1](ride);
    ride.step(stepMs);
  }
  rec.emit("item_end", { ref: "bs:part-b-highway", reason: "done" }, { item: 0 });
  rec.emit("session_end", { reason: "completed" });
  const content: BlindSpotContent = { gameId: "blind_spot", items: [PART_B] };
  return {
    ride,
    result: scoreBlindSpot(ctx, sink.events, content, opts),
    rejected: rec.stats().rejected,
  };
}

describe("Part B ride over game-core (GAME_DESIGN §4.7)", () => {
  it("riding up the truck's left while it indicates left: critical, Part B 0, BS_LEFT_OVERTAKE first", () => {
    const { ride, result, rejected } = rideWith({ pos: "kerb", mode: "cruise" });
    expect(rejected).toBe(0);
    expect(ride.snapshot().critical).toBe(true);
    expect(result.score.capApplied).toBe("critical_left_overtake_part_b_0");
    expect(part(result, "no_zone_time")).toBe(0);
    expect(part(result, "mirror_checks")).toBe(0);
    expect(part(result, "hold_back")).toBe(0);
    expect(result.findings[0]).toMatchObject({ findingId: "BS_LEFT_OVERTAKE", critical: true });
    // And it stays first whatever else is found (game-core ranking).
    const ranked = rankFindings([
      ...result.findings,
      { ...result.findings[0], findingId: "BS_NOZONE_TIME", critical: false, severity: 1 } as never,
    ]);
    expect(ranked[0]?.findingId).toBe("BS_LEFT_OVERTAKE");
  });

  it("well back in the centre, holding back: full Part B marks, no findings", () => {
    const { result } = rideWith({ pos: "centre", mode: "hold" });
    expect(result.score.capApplied).toBeNull();
    expect(part(result, "no_zone_time")).toBe(C.noZoneMax);
    expect(part(result, "mirror_checks")).toBe(C.mirrorMax);
    expect(part(result, "hold_back")).toBe(C.holdBackMax);
    expect(result.findings).toEqual([]);
  });

  it("a lane change counts its mirror check only when it came first (3 s window)", () => {
    const withMirror = rideWith({ pos: "centre", mode: "hold" }, [
      [5000, (r) => void r.mirror()],
      [6000, (r) => r.setPos("right")],
    ]);
    const without = rideWith({ pos: "centre", mode: "hold" }, [[6000, (r) => r.setPos("right")]]);
    expect(part(withMirror.result, "mirror_checks")).toBe(C.mirrorMax);
    expect(part(without.result, "mirror_checks")).toBe(0);
  });
});

describe("Part A geometry matches the scorer", () => {
  it.each([0, 90, 180, 270])("spots at %i°: the UI's feedback is the scorer's verdict", (theta) => {
    for (const s of spotsFor("truck")) {
      const probe = probeFor(s, theta);
      expect(placementCorrect("truck", theta, probe)).toBe(zoneHit("truck", s.x, s.y) === null);
    }
    const safe = spotsFor("truck").filter((s) => zoneHit("truck", s.x, s.y) === null);
    expect(safe.map((s) => s.key)).toEqual(["aheadFar", "rightOut", "behindFar"]);
  });
});

describe("the decision version (Lite, screen readers, no WebGL)", () => {
  it("plays Part A and Part B to the end without WebGL or Phaser, and replays to the same score", async () => {
    resetWebGLProbe();
    expect(hasWebGL()).toBe(false); // jsdom has no WebGL
    fakeClock();
    const refs = ["bs:part-a-truck", "bs:part-b-highway"];
    const content: BlindSpotContent = {
      gameId: "blind_spot",
      items: refs.map((r) => docs[r] as BsItem),
    };
    const h = harness({ gameId: "blind_spot", seed: 7001, refs, docs, content });
    render(
      <SimsIntl>
        <BlindSpotGame {...h.props} />
      </SimsIntl>,
    );
    await act(async () => hostStart(h, "sim"));
    expect(screen.getByTestId("bs-game").dataset["variant"]).toBe("decision");
    expect(screen.getByTestId("bs-format-note").textContent).toContain("A different format");

    // Part A: a safe spot for every prompt except the third (close beside it, on its right).
    const spots = spotsFor(PART_A.vehicleType);
    const feedback: boolean[] = [];
    for (let k = 0; k < PART_A.probes.length; k++) {
      const pick =
        k === 2
          ? spots.find((s) => s.key === "rightNear")
          : spots.find((s) => s.key === "behindFar");
      fireEvent.click(screen.getByTestId(`bs-spot-${pick?.n}`));
      fireEvent.click(screen.getByTestId("bs-place"));
      feedback.push(screen.getByTestId("bs-feedback").dataset["correct"] === "true");
      expect(screen.getAllByTestId("bs-zone")).toHaveLength(4);
      fireEvent.click(screen.getByTestId("bs-next"));
    }
    expect(feedback).toEqual([true, true, false, true, true]);

    // Part B: plan, then watch the ride play out.
    fireEvent.click(screen.getByTestId("bs-plan-follow-back"));
    fireEvent.click(screen.getByTestId("bs-plan-lane-mirror"));
    fireEvent.click(screen.getByTestId("bs-plan-turn-hold"));
    fireEvent.click(screen.getByTestId("bs-plan-start"));
    for (let i = 0; i < 25 && !screen.queryByTestId("bs-ride-over"); i++) {
      act(() => vi.advanceTimersByTime(1000));
    }
    expect(screen.getByTestId("bs-ride-over").dataset["critical"]).toBe("false");
    fireEvent.click(screen.getByTestId("bs-next"));
    expect(h.ended()).toBe("completed");
    hostEnd(h);

    expect(loadPhaser).not.toHaveBeenCalled();
    expect(h.recorder.stats().rejected).toBe(0);
    const decisions = h.events.filter((e) => e.type === "decision").map((e) => e.p);
    expect(decisions).toEqual([
      { node: "follow", choice: "back" },
      { node: "lane_change", choice: "mirror" },
      { node: "left_turn", choice: "hold" },
    ]);
    expect(h.events.filter((e) => e.type === "lane_pos").length).toBeGreaterThan(150);

    const result = scoreBlindSpot(h.props.ctx, h.events, content, opts);
    expect(part(result, "placement")).toBe((C.placementMax * 4) / 5);
    expect(part(result, "no_zone_time")).toBe(C.noZoneMax);
    expect(part(result, "mirror_checks")).toBe(C.mirrorMax);
    expect(part(result, "hold_back")).toBe(C.holdBackMax);
    expect(result.findings.map((f) => f.findingId)).toEqual(["BS_PLACEMENT_WRONG"]);
  });

  it("the decision version's 'keep going on its left' plays out as the critical fault", async () => {
    fakeClock();
    const refs = ["bs:part-b-highway"];
    const content: BlindSpotContent = { gameId: "blind_spot", items: [PART_B] };
    const h = harness({ gameId: "blind_spot", seed: 7004, refs, docs, content });
    render(
      <SimsIntl>
        <BlindSpotGame {...h.props} />
      </SimsIntl>,
    );
    await act(async () => hostStart(h, "sim"));
    fireEvent.click(screen.getByTestId("bs-plan-follow-back"));
    fireEvent.click(screen.getByTestId("bs-plan-lane-no_mirror"));
    fireEvent.click(screen.getByTestId("bs-plan-turn-pass_left"));
    fireEvent.click(screen.getByTestId("bs-plan-start"));
    for (let i = 0; i < 25 && !screen.queryByTestId("bs-ride-over"); i++) {
      act(() => vi.advanceTimersByTime(1000));
    }
    expect(screen.getByTestId("bs-ride-over").dataset["critical"]).toBe("true");
    fireEvent.click(screen.getByTestId("bs-next"));
    hostEnd(h);
    const result = scoreBlindSpot(h.props.ctx, h.events, content, opts);
    expect(result.findings[0]?.findingId).toBe("BS_LEFT_OVERTAKE");
    expect(result.score.capApplied).toBe("critical_left_overtake_part_b_0");
  });
});

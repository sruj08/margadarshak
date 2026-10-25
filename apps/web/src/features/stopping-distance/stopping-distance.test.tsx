// @vitest-environment jsdom
import { ctxFor, fixtureContentDocs, StreamBuilder } from "@margdarshak/game-core/fixtures";
import type { SdRound, StoppingDistanceContent } from "@margdarshak/game-core/schema";
import {
  GAME_CONFIG,
  scoreStoppingDistance,
  sdSightM,
  sdTrueDistanceM,
} from "@margdarshak/game-core/scoring";
import { maxSafeOptionKmh } from "@margdarshak/game-core/sim";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SD_UI } from "./config";
import { stopBreakdown, streetOutcome } from "./physics";
import { BrakeReflex } from "./rounds/BrakeReflex";
import { PredictReveal } from "./rounds/PredictReveal";
import type { Emit } from "./rounds/types";
import { StoppingDistanceGame } from "./StoppingDistanceGame";
import { fakeClock, harness, hostEnd, hostStart, SimsIntl } from "./sims-test-utils";

// The game coach (API-79) renders links; the app router is not mounted in these tests.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const C = GAME_CONFIG.stoppingDistance;
const opts = { gameVersion: "1.0.0", scoringVersion: "1.0", replayInputs: "" };
const docs = fixtureContentDocs();
const SD_REFS = Object.keys(docs).filter((r) => r.startsWith("sd:"));
const ROUNDS = SD_REFS.map((r) => docs[r] as SdRound);
const CONTENT: StoppingDistanceContent = { gameId: "stopping_distance", rounds: ROUNDS };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("golden distances render from game-core (GAME_DESIGN §3.7)", () => {
  // The same four checks as game-core's own sim test (test/sim.test.ts).
  const cases = [
    { kmh: 40, surface: "dry", total: 25.7 },
    { kmh: 60, surface: "dry", total: 45.2 },
    { kmh: 60, surface: "wet", total: 60.4, braking: 35.4 },
    { kmh: 80, surface: "dry", total: 69.3 },
  ] as const;

  it.each(cases)("$kmh km/h $surface: $total m", (c) => {
    const b = stopBreakdown(c.kmh, c.surface);
    expect(Math.round(b.totalM * 10) / 10).toBe(c.total);
    expect(b.reactionM + b.brakingM).toBeCloseTo(b.totalM, 9);
    if ("braking" in c) expect(Math.round(b.brakingM * 10) / 10).toBe(c.braking);
  });

  it.each(cases)("the reveal shows about $total m at $kmh km/h $surface", (c) => {
    const emit = vi.fn() as unknown as Emit;
    render(
      <SimsIntl>
        <PredictReveal
          item={0}
          spec={{ round: 1, speedKmh: c.kmh, surface: c.surface }}
          seed={1}
          mode="practice"
          emit={emit}
          paused={false}
          reducedMotion
          screenReaderAlt={false}
          heading="Round 1 of 3"
          onNext={() => {}}
        />
      </SimsIntl>,
    );
    fireEvent.change(screen.getByTestId("sd-guess-range"), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("sd-lock"));
    expect(screen.getByTestId("sd-total").textContent).toBe(
      `You guessed 30 m. Real: about ${c.total} m.`,
    );
    expect(emit).toHaveBeenCalledWith("estimate", {
      speedKmh: c.kmh,
      surface: c.surface,
      predictedM: 30,
    });
  });
});

/** Builds a one-session stream for the scorer with chosen speeds and reaction times. */
function scoreWith(play: {
  street?: { kmh: number; rts: number[] }[];
  sight?: (number | null)[];
  seed?: number;
}) {
  const seed = play.seed ?? 4242;
  const ctx = ctxFor({
    n: 77,
    gameId: "stopping_distance",
    mode: "practice",
    seed,
    items: SD_REFS.map((ref) => ({ ref, contentVersion: "1" })),
  });
  const s = new StreamBuilder(ctx.sid);
  s.push(
    "session_start",
    { deviceClass: "mid", timingMode: "none", a11yModes: [], orientation: "portrait" },
    { t: 0 },
  );
  let t = 1000;
  ROUNDS.forEach((r, item) => {
    const ref = SD_REFS[item] ?? "";
    s.push("item_start", { ref }, { t, item });
    t += 1000;
    if (r.round === 2) {
      const st = play.street?.[item - 4];
      if (st) {
        s.push("speed_choice", { chosenKmh: st.kmh, context: "street" }, { t, item });
        for (const rt of st.rts) {
          t += 3000;
          s.push("brake", { rtMs: rt }, { t, item });
        }
      }
    } else if (r.round === 3) {
      const kmh = play.sight?.[item - 6] ?? null;
      if (kmh !== null) s.push("speed_choice", { chosenKmh: kmh, context: "sight" }, { t, item });
    }
    t += 1000;
    s.push("item_end", { ref, reason: "done" }, { t, item });
    t += 500;
  });
  s.push("session_end", { reason: "completed" }, { t });
  return scoreStoppingDistance(ctx, s.build(), CONTENT, opts);
}

const part = (r: ReturnType<typeof scoreWith>, id: string) =>
  r.score.components.find((c) => c.id === id)?.value ?? null;

describe("no speed reward (CLAUDE.md: never reward going fast)", () => {
  it("speed for sight: a faster choice never scores higher, at any sight distance", () => {
    for (const seed of [1, 7, 4242, 90210]) {
      let prev = Number.POSITIVE_INFINITY;
      for (
        let kmh = SD_UI.sightSpeed.min;
        kmh <= SD_UI.sightSpeed.max;
        kmh += SD_UI.sightSpeed.step
      ) {
        const v = part(scoreWith({ seed, sight: [kmh, kmh] }), "speed_for_sight") ?? 0;
        expect(v).toBeLessThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it("the street round: with the same reaction, a faster choice never scores higher", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const kmh of [20, 30, 40, 50, 60]) {
      const v =
        part(
          scoreWith({
            street: [
              { kmh, rts: [900] },
              { kmh, rts: [900] },
            ],
          }),
          "no_collision",
        ) ?? 0;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it("the slowest choice gets full marks: being under the safe speed costs nothing", () => {
    const r = scoreWith({ sight: [SD_UI.sightSpeed.min, SD_UI.sightSpeed.min] });
    expect(part(r, "speed_for_sight")).toBe(C.sightMax);
  });
});

describe("an early brake press is penalised, never rewarded (GAME_DESIGN §3.10)", () => {
  it("an anticipatory press is not a stop: alone it counts as reaching the child at full speed", () => {
    const early = scoreWith({
      street: [
        { kmh: 20, rts: [0] },
        { kmh: 20, rts: [0] },
      ],
    });
    const real = scoreWith({
      street: [
        { kmh: 20, rts: [700] },
        { kmh: 20, rts: [700] },
      ],
    });
    expect(part(early, "no_collision")).toBe(0);
    expect(part(real, "no_collision")).toBe(C.noCollisionMax);
    expect(early.integrity.flags).toContain("INT_RT_ANTICIPATORY");
    expect(early.findings[0]?.findingId).toBe("SD_COLLISION");
    // The UI mirror of the scorer says the same.
    expect(streetOutcome(20, null, 30, "dry").collision).toBe(true);
  });

  it("the component: a press before the child steps out re-deals; too many end the round", () => {
    fakeClock();
    const emit = vi.fn() as unknown as Emit & ReturnType<typeof vi.fn>;
    const spec = ROUNDS[4] as Extract<SdRound, { round: 2 }>;
    render(
      <SimsIntl>
        <BrakeReflex
          item={4}
          spec={spec}
          seed={5}
          mode="practice"
          emit={emit}
          paused={false}
          reducedMotion
          screenReaderAlt={false}
          heading="Round 2 of 3"
          onNext={() => {}}
        />
      </SimsIntl>,
    );
    fireEvent.click(screen.getByTestId("sd-speed-20"));
    fireEvent.click(screen.getByTestId("sd-ride"));
    for (let i = 0; i <= SD_UI.maxRedeals; i++) {
      fireEvent.click(screen.getByTestId("sd-brake")); // before the child steps out
      if (i < SD_UI.maxRedeals) {
        expect(screen.getByTestId("sd-early").textContent).toContain(
          "That was before anything happened",
        );
        fireEvent.click(screen.getByTestId("sd-retry"));
      }
    }
    const outcome = screen.getByTestId("sd-outcome");
    expect(outcome.dataset["collision"]).toBe("true");
    const brakes = emit.mock.calls.filter((c) => c[0] === "brake").map((c) => c[1]);
    expect(brakes).toEqual(Array.from({ length: SD_UI.maxRedeals + 1 }, () => ({ rtMs: 0 })));
  });
});

describe("a recorded run replays through scoreStoppingDistance", () => {
  it("the component's own event stream scores what the reveals showed", async () => {
    fakeClock();
    const seed = 4001;
    const h = harness({
      gameId: "stopping_distance",
      seed,
      refs: SD_REFS,
      docs,
      content: CONTENT,
    });
    render(
      <SimsIntl>
        <StoppingDistanceGame {...h.props} />
      </SimsIntl>,
    );
    await act(async () => hostStart(h, "none"));
    const guesses: number[] = [];
    for (let item = 0; item < ROUNDS.length; item++) {
      const r = ROUNDS[item] as SdRound;
      if (r.round === 1) {
        const guess = Math.round(sdTrueDistanceM(r.speedKmh, r.surface));
        guesses.push(guess);
        fireEvent.change(screen.getByTestId("sd-guess-range"), {
          target: { value: String(guess) },
        });
        fireEvent.click(screen.getByTestId("sd-lock"));
      } else if (r.round === 2) {
        fireEvent.click(screen.getByTestId("sd-speed-20"));
        fireEvent.click(screen.getByTestId("sd-ride"));
        // The step-out wait is seeded and unpredictable: advance until the child appears.
        for (let ms = 0; ms <= SD_UI.stepOutMs.max; ms += 10) {
          if (screen.getByTestId("sd-status").textContent === "A child steps out!") break;
          act(() => vi.advanceTimersByTime(10));
        }
        expect(screen.getByTestId("sd-status").textContent).toBe("A child steps out!");
        act(() => vi.advanceTimersByTime(700));
        fireEvent.click(screen.getByTestId("sd-brake"));
        expect(screen.getByTestId("sd-outcome").dataset["collision"]).toBe("false");
        expect(screen.getByTestId("sd-rt").textContent).toMatch(
          /^Your reaction: 0\.7\d? s \(not scored\)$/,
        );
      } else {
        const sight = sdSightM(seed, item, r);
        const best = maxSafeOptionKmh(sight, C.reactionTimeS, C.mu[r.surface]);
        fireEvent.change(screen.getByTestId("sd-sight-speed-range"), {
          target: { value: String(best) },
        });
        fireEvent.click(screen.getByTestId("sd-ride"));
        expect(screen.getByTestId("sd-max-safe").textContent).toContain(`${best} km/h`);
      }
      fireEvent.click(screen.getByTestId("sd-next"));
    }
    expect(h.ended()).toBe("completed");
    hostEnd(h);
    expect(h.recorder.stats().rejected).toBe(0);

    const types = h.events.map((e) => e.type);
    expect(types.filter((x) => x === "estimate")).toHaveLength(4);
    expect(types.filter((x) => x === "speed_choice")).toHaveLength(4);
    expect(types.filter((x) => x === "brake")).toHaveLength(2);
    expect(types.filter((x) => x === "item_start")).toHaveLength(8);

    const result = scoreStoppingDistance(h.props.ctx, h.events, CONTENT, opts);
    const r1 = ROUNDS.slice(0, 4) as Extract<SdRound, { round: 1 }>[];
    const expectedEst =
      (C.estimationMax *
        r1.reduce((acc, r, i) => {
          const tr = sdTrueDistanceM(r.speedKmh, r.surface);
          return acc + Math.max(0, 1 - Math.abs((guesses[i] ?? 0) - tr) / tr);
        }, 0)) /
      r1.length;
    expect(part(result, "estimation")).toBeCloseTo(expectedEst, 1);
    expect(part(result, "no_collision")).toBe(C.noCollisionMax);
    expect(part(result, "speed_for_sight")).toBe(C.sightMax);
    expect(result.integrity.flags).not.toContain("INT_RT_ANTICIPATORY");
    expect(result.findings.map((f) => f.findingId)).not.toContain("SD_COLLISION");
  });
});

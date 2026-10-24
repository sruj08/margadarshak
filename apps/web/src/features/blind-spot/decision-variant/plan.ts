import type { PartB } from "../geometry";
import type { LanePos, Ride, SpeedMode } from "../ride";

export type FollowChoice = "back" | "beside" | "kerb";
export type LaneChoice = "mirror" | "no_mirror";
export type TurnChoice = "hold" | "pass_left" | "pass_right";

export interface RidePlan {
  follow: FollowChoice;
  lane: LaneChoice;
  turn: TurnChoice;
}

export const FOLLOW: readonly FollowChoice[] = ["back", "beside", "kerb"];
export const LANE: readonly LaneChoice[] = ["mirror", "no_mirror"];
export const TURN: readonly TurnChoice[] = ["hold", "pass_left", "pass_right"];

/**
 * When the planned lane change happens, as a share of the ride before the first left indicator
 * (or of the whole ride when the truck never indicates) [D]; the mirror check, if planned, comes
 * one second before it (inside the scorer's 3 s window).
 */
const LANE_CHANGE_AT = 0.6;
const MIRROR_LEAD_MS = 1000;

export interface PlanStep {
  atMs: number;
  run(ride: Ride): void;
}

const followStart: Record<FollowChoice, { pos: LanePos; mode: SpeedMode }> = {
  back: { pos: "centre", mode: "hold" },
  beside: { pos: "left", mode: "cruise" },
  kerb: { pos: "kerb", mode: "cruise" },
};

/** One third to the right of where you are (the planned move across your lane). */
const rightOf: Record<LanePos, LanePos> = {
  kerb: "left",
  left: "centre",
  centre: "right",
  right: "centre",
};

/**
 * The decision version's ride, played by the same controller as the canvas game: the learner's
 * three choices become timed actions (positions, hold back, a mirror check), so every event is a
 * real `lane_pos` / `mirror_check` from a real ride and `scoreBlindSpot` replays it unchanged.
 */
export function planSteps(spec: PartB, plan: RidePlan): PlanStep[] {
  const turnAt = spec.indicateLeft[0]?.fromMs ?? null;
  const laneAt = Math.round((turnAt ?? spec.durationMs) * LANE_CHANGE_AT);
  const start = followStart[plan.follow];
  const steps: PlanStep[] = [
    {
      atMs: 0,
      run: (r) => {
        r.setPos(start.pos);
        r.setMode(start.mode);
      },
    },
  ];
  const moved: LanePos = rightOf[start.pos];
  if (plan.lane === "mirror")
    steps.push({ atMs: Math.max(0, laneAt - MIRROR_LEAD_MS), run: (r) => void r.mirror() });
  steps.push({ atMs: laneAt, run: (r) => r.setPos(moved) });
  if (turnAt !== null) {
    if (plan.turn === "hold") {
      steps.push({ atMs: turnAt, run: (r) => r.setMode("hold") });
    } else {
      const after: LanePos = plan.turn === "pass_left" ? "kerb" : "right";
      if (plan.lane === "mirror")
        steps.push({ atMs: Math.max(0, turnAt - MIRROR_LEAD_MS), run: (r) => void r.mirror() });
      steps.push({
        atMs: turnAt,
        run: (r) => {
          r.setPos(after);
          r.setMode("pass");
        },
      });
    }
  }
  return steps.sort((a, b) => a.atMs - b.atMs);
}

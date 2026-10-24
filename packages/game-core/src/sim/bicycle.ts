// Kinematic bicycle model (GAME_DESIGN §6.3): ψ̇ = v·tan δ / L, advanced at a fixed 60 Hz step with
// deterministic math. Inputs are the quantised integers the recorder stores (steer −127..127,
// throttle and brake 0..255), so client preview and server replay consume identical numbers.
import { dcos, dsin, dtan } from "./dmath.ts";

export interface BicycleParams {
  wheelbaseM: number;
  maxSpeedMps: number;
  maxSteerRad: number;
  accelMps2: number;
  brakeMps2: number;
  /** Constant rolling deceleration when coasting. */
  dragMps2: number;
}

export interface BicycleState {
  x: number;
  y: number;
  headingRad: number;
  v: number;
}

export interface QuantisedInput {
  steer: number;
  throttle: number;
  brake: number;
}

/** One fixed step of `dtS` seconds. Speed is clamped to [0, maxSpeedMps] (no speed content). */
export function stepBicycle(
  s: BicycleState,
  input: QuantisedInput,
  p: BicycleParams,
  dtS: number,
): BicycleState {
  const accel =
    (input.throttle / 255) * p.accelMps2 -
    (input.brake / 255) * p.brakeMps2 -
    (s.v > 0 ? p.dragMps2 : 0);
  let v = s.v + accel * dtS;
  if (v < 0) v = 0;
  if (v > p.maxSpeedMps) v = p.maxSpeedMps;
  const delta = (input.steer / 127) * p.maxSteerRad;
  const headingRad = s.headingRad + ((v * dtan(delta)) / p.wheelbaseM) * dtS;
  return {
    x: s.x + v * dcos(headingRad) * dtS,
    y: s.y + v * dsin(headingRad) * dtS,
    headingRad,
    v,
  };
}

/** Reference model namespace (README name). */
export const bicycleModel = { step: stepBicycle } as const;

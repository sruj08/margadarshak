// All golden vector inputs (without expected results), in a fixed order.

import { blindSpotVectors } from "./blind-spot.ts";
import type { VectorInput } from "./builders.ts";
import { junctionScanVectors } from "./junction-scan.ts";
import { llSimVectors } from "./ll-sim.ts";
import { nazarVectors } from "./nazar.ts";
import { stoppingDistanceVectors } from "./stopping-distance.ts";
import { trackTwinVectors } from "./track-twin.ts";

export function allVectorInputs(): VectorInput[] {
  return [
    ...nazarVectors(),
    ...stoppingDistanceVectors(),
    ...blindSpotVectors(),
    ...junctionScanVectors(),
    ...trackTwinVectors(),
    ...llSimVectors(),
  ];
}

"use client";

import type { ProbePrompt } from "@margdarshak/game-core/schema";
import type { Vec2 } from "@margdarshak/game-core/sim";
import { useCallback, useMemo, useState } from "react";
import {
  localOfProbe,
  orientationDeg,
  type PartA,
  probeFor,
  type Spot,
  spotsFor,
  type ZoneName,
  zoneHit,
} from "./geometry";

export interface PlacementResult {
  probe: { x: number; y: number };
  /** Where the scorer reads the bike (vehicle frame, m), from the probe actually sent. */
  local: Vec2;
  zone: ZoneName | "body" | null;
  correct: boolean;
}

/**
 * Part A, one item (GAME_DESIGN §4.3: retrieval first, feedback second). The learner picks a spot
 * (or drags the bike on the canvas), commits with "Place here" (`place {zoneProbe}` in world-frame
 * decimetres at the seeded orientation), then sees the zones. Shared by the Phaser scene and the
 * DOM decision version, so both send exactly the same events.
 */
export function usePlacement(o: {
  spec: PartA;
  seed: number;
  item: number;
  place: (probe: { x: number; y: number }) => void;
  onDone: () => void;
}) {
  const theta = orientationDeg(o.seed, o.item, o.spec);
  const spots = useMemo(() => spotsFor(o.spec.vehicleType), [o.spec.vehicleType]);
  const [k, setK] = useState(0);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [dragged, setDragged] = useState<Vec2 | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);

  const select = useCallback((s: Spot) => {
    setSelected(s);
    setDragged(null);
  }, []);

  const drag = useCallback((local: Vec2) => {
    setDragged(local);
    setSelected(null);
  }, []);

  const commit = useCallback(() => {
    const at = dragged ?? (selected ? { x: selected.x, y: selected.y } : null);
    if (at === null || result !== null) return;
    const probe = probeFor(at, theta);
    o.place(probe);
    const local = localOfProbe(probe, theta);
    const zone = zoneHit(o.spec.vehicleType, local.x, local.y);
    setResult({ probe, local, zone, correct: zone === null });
  }, [dragged, selected, result, theta, o]);

  const next = useCallback(() => {
    if (k + 1 < o.spec.probes.length) {
      setK(k + 1);
      setSelected(null);
      setDragged(null);
      setResult(null);
    } else o.onDone();
  }, [k, o]);

  return {
    theta,
    spots,
    k,
    // The schema guarantees at least one probe.
    prompt: (o.spec.probes[k] ?? o.spec.probes[0]) as ProbePrompt,
    total: o.spec.probes.length,
    selected,
    dragged,
    result,
    select,
    drag,
    commit,
    next,
    canCommit: (dragged !== null || selected !== null) && result === null,
  };
}

export type Placement = ReturnType<typeof usePlacement>;

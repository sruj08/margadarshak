"use client";

import { useTranslations } from "next-intl";
import { type RefObject, useCallback, useRef } from "react";
import { PhaserMount } from "@/features/phaser/PhaserMount";
import type { PartA } from "./geometry";
import { PartARound } from "./PartARound";
import type { Placement } from "./placement";
import { createPartAScene, PART_A_SIZE, type PartABridge } from "./scenes/PartA";

/** Part A on the canvas: the shared placement flow with the Phaser scene as its picture. */
export function PhaserPartA(p: {
  spec: PartA;
  seed: number;
  item: number;
  learn: boolean;
  coach?: boolean;
  tapOnly: boolean;
  paused: boolean;
  reducedMotion: boolean;
  place: (probe: { x: number; y: number }) => void;
  onDone: () => void;
  onCanvasError: () => void;
}) {
  const t = useTranslations("sims");
  const plRef = useRef<Placement | null>(null);
  const Picture = useCallback(
    (pl: Placement) => {
      plRef.current = pl;
      return (
        <CanvasA
          pl={plRef}
          spec={p.spec}
          dragEnabled={!p.tapOnly}
          paused={p.paused}
          reducedMotion={p.reducedMotion}
          label={t("bs.canvas.partA", { vehicle: t(`bs.vehicle.${p.spec.vehicleType}`) })}
          zoneLabel={t("bs.zoneLabel")}
          lostLine={t("canvas.lost")}
          continueLabel={t("canvas.continue")}
          loadingLabel={t("canvas.loading")}
          onError={p.onCanvasError}
        />
      );
    },
    [p.spec, p.tapOnly, p.paused, p.reducedMotion, p.onCanvasError, t],
  );
  return (
    <PartARound
      spec={p.spec}
      seed={p.seed}
      item={p.item}
      learn={p.learn}
      coach={p.coach ?? false}
      place={p.place}
      onDone={p.onDone}
      picture={Picture}
      dragHint={!p.tapOnly}
    />
  );
}

function CanvasA(p: {
  pl: RefObject<Placement | null>;
  spec: PartA;
  dragEnabled: boolean;
  paused: boolean;
  reducedMotion: boolean;
  label: string;
  zoneLabel: string;
  lostLine: string;
  continueLabel: string;
  loadingLabel: string;
  onError: () => void;
}) {
  const plRef = p.pl;
  const scenes = useRef<
    ((P: Parameters<typeof createPartAScene>[0]) => Phaser.Types.Scenes.SceneType[]) | null
  >(null);
  if (scenes.current === null) {
    const first = plRef.current;
    const bridge: PartABridge = {
      type: p.spec.vehicleType,
      thetaDeg: first?.theta ?? 0,
      spots: first?.spots ?? [],
      dragEnabled: p.dragEnabled,
      zoneLabel: p.zoneLabel,
      get: () => {
        const pl = plRef.current;
        return {
          selected: pl?.selected?.n ?? null,
          dragged: pl?.dragged ?? null,
          placed: pl?.result?.local ?? null,
          placedVisible: pl?.result ? pl.result.correct : null,
        };
      },
      onPick: (n) => {
        const pl = plRef.current;
        const s = pl?.spots.find((x) => x.n === n);
        if (pl && s && pl.result === null) pl.select(s);
      },
      onDrag: (local) => {
        const pl = plRef.current;
        if (pl && pl.result === null) pl.drag(local);
      },
    };
    scenes.current = (P) => [createPartAScene(P, bridge)];
  }
  return (
    <PhaserMount
      scenes={scenes.current}
      width={PART_A_SIZE.width}
      height={PART_A_SIZE.height}
      paused={p.paused}
      reducedMotion={p.reducedMotion}
      label={p.label}
      lostLine={p.lostLine}
      continueLabel={p.continueLabel}
      loadingLabel={p.loadingLabel}
      onError={p.onError}
      testId="bs-canvas-a"
    />
  );
}

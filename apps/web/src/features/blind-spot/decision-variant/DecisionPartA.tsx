"use client";

import { useTranslations } from "next-intl";
import type { PartA } from "../geometry";
import { PartARound } from "../PartARound";
import { VehicleDiagram } from "./VehicleDiagram";

/** Part A in the decision version: the same placement flow over a still SVG diagram (no canvas). */
export function DecisionPartA(p: {
  spec: PartA;
  seed: number;
  item: number;
  learn: boolean;
  coach?: boolean;
  place: (probe: { x: number; y: number }) => void;
  onDone: () => void;
}) {
  const t = useTranslations("sims.bs");
  return (
    <PartARound
      spec={p.spec}
      seed={p.seed}
      item={p.item}
      learn={p.learn}
      coach={p.coach ?? false}
      place={p.place}
      onDone={p.onDone}
      picture={(pl) => (
        <VehicleDiagram
          type={p.spec.vehicleType}
          thetaDeg={pl.theta}
          spots={pl.spots}
          selected={pl.selected?.n ?? null}
          placed={pl.result?.local ?? null}
          placedVisible={pl.result ? pl.result.correct : null}
          showZones={pl.result !== null}
          zoneLabel={t("zoneLabel")}
          title={t("canvas.partA", { vehicle: t(`vehicle.${p.spec.vehicleType}`) })}
        />
      )}
    />
  );
}

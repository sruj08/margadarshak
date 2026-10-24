"use client";

import type { HazardType } from "@margdarshak/game-core/schema";
import { Button } from "@margdarshak/ui/components/button";
import { Bike, Bus, Car, DoorOpen, Footprints, PawPrint, TriangleAlert, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentType, useState } from "react";
import type { ItemReveal } from "@/features/games/api-types";
import { hazardLabel } from "./hazard-labels";

/** How long before onset the clip freezes for "what happens next?" (NAZAR §1, [D]). */
export const FREEZE_BEFORE_MS = 500;

export interface FreezePoint {
  /** k-th hazard of the clip by onset: the scorer pairs the k-th answer with it. */
  k: number;
  hazardType: HazardType;
  freezeMs: number;
}

/**
 * Freeze points from the practice `reveal` windows (API-34 learn/practice items only), in onset
 * order with ties by hazard id, exactly as game-core pairs `prediction` events with hazards.
 */
export function freezePoints(reveal: ItemReveal | undefined): FreezePoint[] {
  if (!reveal) return [];
  return [...reveal.hazards]
    .sort((x, y) => x.a_ms - y.a_ms || (x.hazard_id < y.hazard_id ? -1 : 1))
    .map((h, k) => ({
      k,
      hazardType: h.hazard_type,
      freezeMs: Math.max(0, h.a_ms - FREEZE_BEFORE_MS),
    }));
}

/** Pictogram per hazard family (the "picture options"; the label carries the meaning). */
const ICON: Partial<Record<HazardType, ComponentType<{ size?: number; "aria-hidden"?: boolean }>>> =
  {
    bus_stop_pedestrian: Bus,
    door_opening: DoorOpen,
    auto_cut_in: Car,
    wrong_side_2w: Bike,
    cattle_animal: PawPrint,
    child_school: Footprints,
    pedestrian_median: Footprints,
    vehicle_pulling_out: Car,
    truck_left_turn: Truck,
    junction_emerging: Car,
    overtaking_oncoming: Truck,
    parked_vehicle_hidden: Car,
    cyclist: Bike,
  };

/**
 * "What happens next?" (learn mode): four picture options from the hazard-type enum. The answer
 * is recorded once (a `prediction` event; correctness is computed by the scorer, never sent), then
 * the learner sees the answer and resumes with "Tap where".
 */
export function PredictionPanel({
  options,
  truth,
  locale,
  onAnswer,
  onContinue,
}: {
  options: readonly HazardType[];
  truth: HazardType;
  locale: string;
  onAnswer: (choice: HazardType) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("nazar");
  const [choice, setChoice] = useState<HazardType | null>(null);
  return (
    <fieldset className="mg-panel" aria-labelledby="predict-q" data-testid="predict-panel">
      <p id="predict-q" className="mg-overlay__title">
        {t("learn.predict")}
      </p>
      <div className="mg-options">
        {options.map((o) => {
          const Icon = ICON[o] ?? TriangleAlert;
          const picked = choice === o;
          return (
            <button
              key={o}
              type="button"
              className={`mg-option${picked ? " mg-option--picked" : ""}`}
              aria-pressed={picked}
              disabled={choice !== null}
              onClick={() => {
                setChoice(o);
                onAnswer(o);
              }}
              data-testid={`predict-${o}`}
            >
              <Icon size={28} aria-hidden={true} />
              <span>{hazardLabel(o, locale)}</span>
            </button>
          );
        })}
      </div>
      {choice !== null ? (
        <div role="status" className="mg-panel__feedback">
          <p>
            {choice === truth
              ? t("learn.correct", { hazard: hazardLabel(truth, locale) })
              : t("learn.wrong", { hazard: hazardLabel(truth, locale) })}
          </p>
          <Button variant="primary" size="lg" onPress={onContinue} data-testid="predict-continue">
            {t("learn.where")}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

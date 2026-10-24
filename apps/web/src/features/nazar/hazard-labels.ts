import hazardTypes from "@content/catalogue/hazard_types.json";
import type { HazardType } from "@margdarshak/game-core/schema";

/** Labels for the 15 hazard types (content/catalogue/hazard_types.json; Hindi pending review). */
const LABELS = new Map<string, { en: string; hi: string }>(
  hazardTypes.hazard_types.map((h) => [h.hazard_type, h.label]),
);

export function hazardLabel(type: string, locale: string): string {
  const l = LABELS.get(type);
  if (!l) return type.replaceAll("_", " ");
  return locale === "hi" ? l.hi : l.en;
}

/** Hazard types a clip may carry in a prediction question ("other" is never an option). */
export const PREDICTABLE: readonly HazardType[] = hazardTypes.hazard_types
  .map((h) => h.hazard_type as HazardType)
  .filter((t) => t !== "other");

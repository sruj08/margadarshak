import hazardTypes from "@content/catalogue/hazard_types.json";
import { HAZARD_TYPES, type HazardType } from "./types";

/**
 * Hazard types for raters (NAZAR §3.3), mirrored from content/catalogue/hazard_types.json: the
 * label in the UI language and the English definition of the developing event (given to raters
 * with the §6.1 definitions). Hindi labels are pending native review in the catalogue.
 */
const BY_TYPE = new Map<string, { label: { en: string; hi: string }; definition: string }>(
  hazardTypes.hazard_types.map((h) => [
    h.hazard_type,
    { label: h.label, definition: h.definition_en },
  ]),
);

export function hazardLabel(type: string, locale: string): string {
  const h = BY_TYPE.get(type);
  if (!h) return type.replaceAll("_", " ");
  return locale === "hi" ? h.label.hi : h.label.en;
}

export function hazardDefinition(type: string): string {
  return BY_TYPE.get(type)?.definition ?? "";
}

export const HAZARD_OPTIONS: readonly HazardType[] = HAZARD_TYPES;

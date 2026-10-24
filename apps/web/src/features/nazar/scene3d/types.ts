/** One row of the scene catalogue (generated from content/nazar/scenes.json). */
export interface SceneRow {
  id: string;
  hazardType: string;
  pov: "2W" | "4W";
  setting: string;
  roadType: string;
  timeOfDay: "day" | "dusk" | "dawn";
  weather: "clear" | "rain" | "overcast" | "haze";
  speedKmh: number;
  durationMs: number;
  /** Nominal onset and end (ms); null for quiet scenes. Raters confirm them (NAZAR §17). */
  aMs: number | null;
  bMs: number | null;
  difficulty: number;
  occlusion: boolean;
  cue: { en: string; hi: string };
}

/** A hazard the scene must stage, with the window it is scored against. */
export interface PlanHazard {
  type: string;
  aMs: number;
  bMs: number;
}

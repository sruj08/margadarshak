import scenes from "@content/nazar/scenes.json";
import { HAZARD_TYPES, type HazardType, type NazarScene, ROAD_TYPES } from "./types";

/**
 * The AI clip scene catalogue (`content/nazar/scenes.json`, ADR-0013) trimmed for the curator's
 * generate screen: ID, revision, the bilingual cue as its title, hazard, road, length and speed.
 * The shot prompts stay on the server. The API checks `sceneId` + `version` against the same file.
 */
interface RawScene {
  sceneId: string;
  revision: number;
  hazardType?: string;
  roadType?: string;
  targetDurationS?: number;
  speedKmh?: number;
  cue?: { en?: string; hi?: string };
}

const isHazard = (v: string | undefined): v is HazardType =>
  !!v && (HAZARD_TYPES as readonly string[]).includes(v);
const isRoad = (v: string | undefined): v is (typeof ROAD_TYPES)[number] =>
  !!v && (ROAD_TYPES as readonly string[]).includes(v);

export function sceneCatalogue(): NazarScene[] {
  return ((scenes as unknown as { scenes: RawScene[] }).scenes ?? []).map((s) => ({
    scene_id: s.sceneId,
    revision: s.revision,
    title: { en: s.cue?.en ?? s.sceneId, hi: s.cue?.hi ?? s.cue?.en ?? s.sceneId },
    ...(isHazard(s.hazardType) ? { hazard_type: s.hazardType } : {}),
    ...(isRoad(s.roadType) ? { road_type: s.roadType } : {}),
    ...(typeof s.targetDurationS === "number" ? { duration_s: s.targetDurationS } : {}),
    ...(typeof s.speedKmh === "number" ? { speed_kmh_est: s.speedKmh } : {}),
  }));
}

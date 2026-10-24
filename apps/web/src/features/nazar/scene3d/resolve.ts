import type { NazarClip } from "@margdarshak/game-core/schema";
import { SCENES } from "./catalogue.data";
import { buildPlan, type ScenePlan } from "./choreo";
import type { PlanHazard, SceneRow } from "./types";

/** `clip:SCN-001@2` → `SCN-001`. */
export const clipIdOf = (ref: string): string => /^[a-z]+:([^@]+)/.exec(ref)?.[1] ?? ref;

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** `?scene=SCN-009` stages that scene for every clip (demo and QA); the scene plays its own hazard. */
const forcedScene = (): string | null => {
  try {
    const id = new URLSearchParams(window.location.search).get("scene");
    return SCENES.some((s) => s.id === id) ? id : null;
  } catch {
    return null;
  }
};

/**
 * The scene to stage for a clip. A clip named like a catalogue scene (SCN-xxx) is that scene;
 * any other clip (the sample bank) borrows the dressing of a scene with the same first hazard type,
 * chosen by hashing its id, and a clip with no hazards borrows a quiet scene.
 */
export function pickRow(clipId: string, hazards: readonly PlanHazard[] | null): SceneRow {
  const exact = SCENES.find((s) => s.id === (forcedScene() ?? clipId));
  if (exact) return exact;
  const type = hazards === null ? null : (hazards[0]?.type ?? "quiet");
  const pool = SCENES.filter((s) =>
    type === null ? s.hazardType !== "quiet" : s.hazardType === type,
  );
  const rows = pool.length > 0 ? pool : SCENES;
  return rows[hash(clipId) % rows.length] as SceneRow;
}

/**
 * Builds the plan for one clip. `hazards` are the windows the session already knows (a device clip
 * or a learn/practice reveal); without them (a mock served by the API) the scene's own nominal
 * onset is used. The renderer never scores anything: the server replay does (D-11).
 */
export function planFor(
  clipId: string,
  hazards: readonly PlanHazard[] | null,
  durationMs?: number,
): ScenePlan {
  const row = pickRow(clipId, hazards);
  const list: PlanHazard[] =
    hazards !== null && forcedScene() === null
      ? [...hazards]
      : row.aMs === null || row.bMs === null
        ? []
        : [{ type: row.hazardType, aMs: row.aMs, bMs: row.bMs }];
  const end = Math.max(0, ...list.map((h) => h.bMs));
  return buildPlan(
    {
      ...row,
      durationMs:
        forcedScene() === null
          ? (durationMs ?? Math.max(row.durationMs, end + 3000))
          : row.durationMs,
    },
    list,
  );
}

const fromClip = (c: NazarClip): PlanHazard[] =>
  c.hazards.map((h) => ({ type: h.hazardType, aMs: h.window.aMs, bMs: h.window.bMs }));

interface ItemLike {
  item_ref: string;
  reveal?: { hazards: { hazard_type: string; a_ms: number; b_ms: number }[] } | undefined;
}

/** One plan per session item, in order. Loads the sample bank lazily, only to look up its windows. */
export async function plansForSession(
  items: readonly ItemLike[],
  deviceClips: readonly NazarClip[],
): Promise<ScenePlan[]> {
  let bank: Record<string, unknown> | null = null;
  const sample = async (ref: string): Promise<NazarClip | null> => {
    bank ??= (await import("@margdarshak/game-core/fixtures")).fixtureContentDocs();
    const doc = bank[ref];
    return typeof doc === "object" && doc !== null && "hazards" in doc ? (doc as NazarClip) : null;
  };
  const out: ScenePlan[] = [];
  for (const [i, it] of items.entries()) {
    const id = clipIdOf(it.item_ref);
    const dev = deviceClips[i];
    if (dev) out.push(planFor(id, fromClip(dev), dev.durationMs));
    else if (it.reveal)
      out.push(
        planFor(
          id,
          it.reveal.hazards.map((h) => ({ type: h.hazard_type, aMs: h.a_ms, bMs: h.b_ms })),
        ),
      );
    else {
      const c = SCENES.some((s) => s.id === id) ? null : await sample(it.item_ref);
      out.push(c ? planFor(id, fromClip(c), c.durationMs) : planFor(id, null));
    }
  }
  return out;
}

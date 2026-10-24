// Nazar golden vectors: a 10-clip Kerala-format mock bank plus practice/learn clips.
import type { HptFormat, NazarClip, NazarContent } from "../schema/content.ts";
import type { GameMode, HazardType } from "../schema/ids.ts";
import { ctxFor, StreamBuilder, type VectorInput, vector } from "./builders.ts";

export const HPT_KL: HptFormat = {
  rule_id: "HPT-KL",
  clips: 10,
  marks_per_clip: 10,
  max_hazards_per_clip: 2,
  pass: 60,
  total_marks: 100,
  status: "announced",
  source_url:
    "https://www.onmanorama.com/news/kerala/2026/09/14/kerala-adds-hazard-perception-test-for-driving-licences-from-dec-1-first-in-india.html",
  verified_on: "2026-10-22",
  confidence: "medium",
};

function clip(
  id: string,
  speedKmhEst: number,
  durationMs: number,
  hazards: [string, HazardType, number, number][],
): NazarClip {
  return {
    clipId: id,
    version: 1,
    speedKmhEst,
    durationMs,
    hazards: hazards.map(([hazardId, hazardType, aMs, bMs]) => ({
      hazardId,
      hazardType,
      window: { aMs, bMs },
    })),
    quietSegments:
      hazards.length === 0 ? [{ fromMs: 0, toMs: durationMs }] : [{ fromMs: 0, toMs: 5000 }],
  };
}

/** The mock bank (clip ordinal = index + 1). */
export const NAZAR_CLIPS: readonly NazarClip[] = [
  clip("KL-0001", 40, 45000, [["h1", "bus_stop_pedestrian", 12000, 16500]]),
  clip("KL-0002", 30, 40000, [["h1", "door_opening", 8000, 12000]]),
  clip("KL-0003", 35, 50000, [["h1", "auto_cut_in", 20000, 25000]]),
  clip("KL-0004", 30, 55000, [
    ["h1", "cattle_animal", 10000, 14000],
    ["h2", "wrong_side_2w", 30000, 35000],
  ]),
  clip("KL-0005", 25, 45000, [["h1", "child_school", 15000, 20000]]),
  clip("KL-0006", 35, 40000, [["h1", "vehicle_pulling_out", 9000, 13500]]),
  clip("KL-0007", 30, 45000, [["h1", "truck_left_turn", 18000, 22500]]),
  clip("KL-0008", 30, 50000, [
    ["h1", "pedestrian_median", 11000, 16000],
    ["h2", "parked_vehicle_hidden", 13000, 18000],
  ]),
  clip("KL-0009", 40, 40000, [["h1", "junction_emerging", 7000, 11000]]),
  clip("KL-0010", 40, 50000, [["h1", "bus_stop_pedestrian", 25000, 30000]]),
];

export const NAZAR_QUIET_CLIP: NazarClip = clip("KL-Q001", 30, 30000, []);

export const nazarRef = (c: NazarClip): string => `clip:${c.clipId}@${c.version}`;

/** Media time inside 5-band `band` (1..5) of a window, at fraction `frac` of the band. */
export function inBand(c: NazarClip, hazard: number, band: number, frac = 0.5): number {
  const h = c.hazards[hazard];
  if (h === undefined) throw new Error(`no hazard ${hazard} in ${c.clipId}`);
  const w = (h.window.bMs - h.window.aMs) / 5;
  return Math.round(h.window.aMs + w * (band - 1 + frac));
}

const CLIP_GAP_MS = 70000;

interface ClipPlay {
  clip: NazarClip;
  taps: number[];
  /** Learn mode: "what happens next?" answers, each at the media time of its freeze. */
  predictions?: { mt: number; choice: HazardType }[];
  hidden?: boolean;
  /** Extra wall-clock ms added to item_end (simulates a speed hack or a stalled video). */
  driftMs?: number;
}

function session(
  n: number,
  mode: GameMode,
  seed: number,
  plays: readonly ClipPlay[],
  opts: { predicted?: number; timingMode?: "rvfc" | "fallback" } = {},
) {
  const ctx = ctxFor({
    n,
    gameId: "nazar",
    mode,
    seed,
    items: plays.map((p) => ({ ref: nazarRef(p.clip), contentVersion: String(p.clip.version) })),
  });
  const s = new StreamBuilder(ctx.sid);
  s.push(
    "session_start",
    {
      deviceClass: "mid",
      timingMode: opts.timingMode ?? "rvfc",
      a11yModes: ["no_audio"],
      orientation: "landscape",
    },
    { t: 0 },
  );
  if (opts.predicted !== undefined)
    s.push("confidence", { predictedPassClips: opts.predicted }, { t: 2000 });
  plays.forEach((p, item) => {
    const t0 = 5000 + item * CLIP_GAP_MS;
    const ref = nazarRef(p.clip);
    s.push("item_start", { ref }, { t: t0, mt: 0, item });
    const inputs = [...p.taps.map((mt) => ({ mt, choice: null })), ...(p.predictions ?? [])].sort(
      (x, y) => x.mt - y.mt,
    );
    for (const { mt, choice } of inputs) {
      if (choice === null) s.push("tap", { x: 0.5, y: 0.42 }, { t: t0 + mt, mt, item });
      else s.push("prediction", { choice }, { t: t0 + mt, mt, item });
    }
    if (p.hidden === true) s.push("visibility_hidden", {}, { t: t0 + 6000, item });
    s.push(
      "item_end",
      { ref, reason: p.hidden === true ? "voided" : "done" },
      { t: t0 + p.clip.durationMs + (p.driftMs ?? 0), mt: p.clip.durationMs, item },
    );
  });
  const end = 5000 + plays.length * CLIP_GAP_MS;
  s.push("session_end", { reason: "completed" }, { t: end });
  const content: NazarContent = {
    gameId: "nazar",
    clips: plays.map((p) => p.clip),
    format: HPT_KL,
  };
  return { ctx, events: s.build(), content };
}

const C = NAZAR_CLIPS as readonly [NazarClip, ...NazarClip[]];
const at = (i: number): NazarClip => C[i] as NazarClip;

/** Every hazard of a clip tapped in the given bands (one band per hazard; 0 = no tap). */
function plays(bands: readonly (readonly number[])[]): ClipPlay[] {
  return bands.map((bs, i) => {
    const c = at(i);
    const taps = bs
      .flatMap((b, h) => (b === 0 ? [] : [inBand(c, h, b, 0.3)]))
      .sort((x, y) => x - y);
    return { clip: c, taps };
  });
}

export function nazarVectors(): VectorInput[] {
  const out: VectorInput[] = [];

  {
    const s = session(
      101,
      "mock",
      734119,
      plays([[1], [1], [1], [1, 1], [1], [1], [1], [1, 1], [1], [1]]),
      {
        predicted: 9,
      },
    );
    out.push(
      vector({
        name: "nazar-strong",
        description: "Kerala mock, every hazard tapped in band 1: 100/100, passed",
        tags: ["strong"],
        ...s,
      }),
    );
  }
  {
    const s = session(
      102,
      "mock",
      1203,
      plays([[2], [3], [2], [1, 4], [3], [2], [5], [2, 0], [3], [3]]),
      {
        predicted: 7,
      },
    );
    out.push(
      vector({
        name: "nazar-medium",
        description: "Kerala mock, mixed bands, one late truck response, one missed hazard: 61/100",
        tags: ["medium"],
        ...s,
      }),
    );
  }
  {
    const s = session(
      103,
      "mock",
      99,
      plays([[0], [5], [0], [0, 0], [4], [1], [0], [3, 0], [0], [3]]),
      {
        predicted: 8,
      },
    );
    out.push(
      vector({
        name: "nazar-weak",
        description:
          "Kerala mock, many misses, bus-stop pedestrians missed or late twice, predicted 8 clips",
        tags: ["weak"],
        ...s,
      }),
    );
  }
  {
    const base = plays([[2], [2], [2], [2, 2], [2], [2], [2], [2, 2], [2], [2]]);
    const c3 = at(2);
    const a3 = c3.hazards[0]?.window.aMs ?? 0;
    // Clip 3: 4 taps inside 900 ms (pattern). Clip 5: 7 taps, each > 1 s apart (cap 2·1 + 4 = 6).
    base[2] = { clip: c3, taps: [a3 + 100, a3 + 400, a3 + 700, a3 + 1000] };
    base[4] = { clip: at(4), taps: [2000, 6000, 10000, 15500, 25000, 30000, 38000] };
    base[6] = { ...(base[6] as ClipPlay), hidden: true };
    const s = session(104, "mock", 4242, base, { predicted: 6 });
    out.push(
      vector({
        name: "nazar-voided",
        description:
          "Kerala mock: clip 3 pattern-voided (4 taps < 1 s), clip 5 over the tap cap, clip 7 hidden tab",
        tags: ["voided", "critical"],
        ...s,
      }),
    );
  }
  {
    const c1 = at(0);
    const c8 = at(7);
    const c2 = at(1);
    const a1 = c1.hazards[0]?.window.aMs ?? 0;
    const a2 = c2.hazards[0]?.window.aMs ?? 0;
    const s = session(105, "practice", 5150, [
      // Exactly 3 taps in 1 s (allowed); the first, exactly at onset, scores 5.
      { clip: c1, taps: [a1, a1 + 400, a1 + 800] },
      // Overlapping windows: one tap at 14 s credits the earlier onset; a tap exactly at b2 scores 1.
      { clip: c8, taps: [14000, 18000] },
      // Quiet clip: 4 taps (cap 2·0 + 4) are false alarms but do not void it.
      { clip: NAZAR_QUIET_CLIP, taps: [3000, 9000, 15000, 21000] },
      // One early tap (500 ms before onset), then band 2.
      { clip: c2, taps: [a2 - 500, inBand(c2, 0, 2)] },
    ]);
    out.push(
      vector({
        name: "nazar-edge-practice",
        description:
          "Practice: 3 taps in 1 s allowed, tap at onset = 5, overlapping windows, tap at b = 1, quiet-clip false alarms",
        tags: ["edge"],
        ...s,
      }),
    );
  }
  {
    const c5 = at(4);
    const c9 = at(8);
    const a5 = c5.hazards[0]?.window.aMs ?? 0;
    const a9 = c9.hazards[0]?.window.aMs ?? 0;
    const s = session(106, "learn", 66, [
      { clip: c5, taps: [a5 - 900, a5 - 300, inBand(c5, 0, 1)] },
      { clip: c9, taps: [a9 - 600, inBand(c9, 0, 2)] },
    ]);
    out.push(
      vector({
        name: "nazar-learn-early",
        description:
          "Learn mode: anticipation taps before onset are logged as early_taps, never points",
        tags: ["edge"],
        ...s,
      }),
    );
  }
  {
    // Freezes 0.5 s before each onset (NAZAR §1). KL-0004: cattle predicted right, the wrong-side
    // rider predicted as a door opening; KL-0001: right. Taps land in bands 1, 3 and 2.
    const c4 = at(3);
    const c1 = at(0);
    const freeze = (c: NazarClip, h: number): number => (c.hazards[h]?.window.aMs ?? 0) - 500;
    const s = session(108, "learn", 4242, [
      {
        clip: c4,
        taps: [inBand(c4, 0, 1), inBand(c4, 1, 3)],
        predictions: [
          { mt: freeze(c4, 0), choice: "cattle_animal" },
          { mt: freeze(c4, 1), choice: "door_opening" },
        ],
      },
      {
        clip: c1,
        taps: [inBand(c1, 0, 2)],
        predictions: [{ mt: freeze(c1, 0), choice: "bus_stop_pedestrian" }],
      },
    ]);
    out.push(
      vector({
        name: "nazar-learn-predict",
        description:
          "Learn mode: each 'what happens next?' answer scores half the hazard and writes FSRS evidence",
        tags: ["medium"],
        ...s,
      }),
    );
  }
  {
    const p = plays([[1], [1], [1], [1, 1], [1], [1], [1], [1, 1], [1], [1]]);
    p[1] = { ...(p[1] as ClipPlay), driftMs: 400 };
    const s = session(107, "mock", 31337, p, { timingMode: "fallback" });
    out.push(
      vector({
        name: "nazar-fallback-drift",
        description:
          "Fallback timing (no rVFC) and a 400 ms t/mt drift on clip 2: clip voided, trust 0.5",
        tags: ["edge", "voided"],
        ...s,
      }),
    );
  }
  return out;
}

// Stopping Distance golden vectors: 4 estimation items, 2 street rounds, 2 speed-for-sight items.
import type { SdRound, StoppingDistanceContent } from "../schema/content.ts";
import { GAME_CONFIG } from "../scoring/config.ts";
import { sdSightM, sdTrueDistanceM } from "../scoring/stopping-distance.ts";
import { maxSafeOptionKmh } from "../sim/stopping.ts";
import { ctxFor, StreamBuilder, type VectorInput, vector } from "./builders.ts";

export const SD_ROUNDS: readonly { id: string; round: SdRound }[] = [
  { id: "sd:r1-40-dry", round: { round: 1, speedKmh: 40, surface: "dry" } },
  { id: "sd:r1-60-dry", round: { round: 1, speedKmh: 60, surface: "dry" } },
  { id: "sd:r1-60-wet", round: { round: 1, speedKmh: 60, surface: "wet" } },
  { id: "sd:r1-80-dry", round: { round: 1, speedKmh: 80, surface: "dry" } },
  {
    id: "sd:r2-street-dry",
    round: {
      round: 2,
      surface: "dry",
      childDistanceM: { min: 25, max: 35 },
      speedOptionsKmh: [20, 30, 40, 50, 60],
    },
  },
  {
    id: "sd:r2-street-wet",
    round: {
      round: 2,
      surface: "wet",
      childDistanceM: { min: 20, max: 30 },
      speedOptionsKmh: [20, 30, 40, 50, 60],
    },
  },
  { id: "sd:r3-sight-dry", round: { round: 3, surface: "dry", sightM: { min: 40, max: 60 } } },
  { id: "sd:r3-sight-wet", round: { round: 3, surface: "wet", sightM: { min: 40, max: 60 } } },
];

interface Play {
  /** Predicted metres for the 4 estimation items (null = no answer). */
  estimates: (number | null)[];
  /** Street rounds: chosen speed and brake reaction times in order (anticipatory ones re-deal). */
  street: { kmh: number | null; rts: number[] }[];
  /** Speed-for-sight: km/h relative to the max safe option (0 = exactly the option). */
  sightOver: (number | null)[];
}

const R1 = (i: number): Extract<SdRound, { round: 1 }> =>
  SD_ROUNDS[i]?.round as Extract<SdRound, { round: 1 }>;
const R3 = (i: number): Extract<SdRound, { round: 3 }> =>
  SD_ROUNDS[i]?.round as Extract<SdRound, { round: 3 }>;

/** The true distance for estimation item i (m), rounded to 0.1 m like a slider would. */
export const sdTrue = (i: number): number =>
  Math.round(sdTrueDistanceM(R1(i).speedKmh, R1(i).surface) * 10) / 10;

/** Pushes one round's responses from time t; returns the time of the last one. */
function playRound(
  s: StreamBuilder,
  seed: number,
  round: SdRound,
  item: number,
  t0: number,
  play: Play,
): number {
  let t = t0;
  if (round.round === 1) {
    const p = play.estimates[item] ?? null;
    if (p !== null) {
      s.push(
        "estimate",
        { speedKmh: round.speedKmh, surface: round.surface, predictedM: p },
        { t, item },
      );
    }
    return t;
  }
  if (round.round === 2) {
    const st = play.street[item - 4];
    const kmh = st?.kmh ?? null;
    if (kmh !== null) s.push("speed_choice", { chosenKmh: kmh, context: "street" }, { t, item });
    for (const rt of st?.rts ?? []) {
      t += 3000;
      s.push("brake", { rtMs: rt }, { t, item });
    }
    return t;
  }
  const over = play.sightOver[item - 6] ?? null;
  if (over === null) return t;
  const opt = maxSafeOptionKmh(
    sdSightM(seed, item, R3(item)),
    GAME_CONFIG.stoppingDistance.reactionTimeS,
    GAME_CONFIG.stoppingDistance.mu[round.surface],
  );
  s.push("speed_choice", { chosenKmh: opt + over, context: "sight" }, { t, item });
  return t;
}

function session(n: number, seed: number, play: Play) {
  const ctx = ctxFor({
    n,
    gameId: "stopping_distance",
    mode: "practice",
    seed,
    items: SD_ROUNDS.map((r) => ({ ref: r.id, contentVersion: "1" })),
  });
  const s = new StreamBuilder(ctx.sid);
  s.push(
    "session_start",
    { deviceClass: "mid", timingMode: "none", a11yModes: [], orientation: "portrait" },
    { t: 0 },
  );
  let t = 1000;
  SD_ROUNDS.forEach((r, item) => {
    s.push("item_start", { ref: r.id }, { t, item });
    t = playRound(s, seed, r.round, item, t + 4000, play) + 2000;
    s.push("item_end", { ref: r.id, reason: "done" }, { t, item });
    t += 1000;
  });
  s.push("session_end", { reason: "completed" }, { t });
  const content: StoppingDistanceContent = {
    gameId: "stopping_distance",
    rounds: SD_ROUNDS.map((r) => r.round),
  };
  return { ctx, events: s.build(), content };
}

const scaled = (f: number): number[] =>
  [0, 1, 2, 3].map((i) => Math.round(sdTrue(i) * f * 10) / 10);

export function stoppingDistanceVectors(): VectorInput[] {
  return [
    vector({
      name: "sd-strong",
      description:
        "Accurate estimates, 20 km/h in the street with a 0.7 s reaction, speeds at the max safe option",
      tags: ["strong"],
      ...session(201, 4001, {
        estimates: scaled(1),
        street: [
          { kmh: 20, rts: [700] },
          { kmh: 20, rts: [750] },
        ],
        sightOver: [0, 0],
      }),
    }),
    vector({
      name: "sd-medium",
      description:
        "Estimates about 12% short, 30/40 km/h in the street, one sight choice 5 km/h over",
      tags: ["medium"],
      ...session(202, 4002, {
        estimates: scaled(0.88),
        street: [
          { kmh: 30, rts: [900] },
          { kmh: 40, rts: [1000] },
        ],
        sightOver: [5, 0],
      }),
    }),
    vector({
      name: "sd-weak",
      description:
        "Underestimates (dry −25%, wet −60%), 50 km/h in the street, sight choices 15 km/h over",
      tags: ["weak"],
      ...session(203, 4003, {
        estimates: [sdTrue(0) * 0.75, sdTrue(1) * 0.75, sdTrue(2) * 0.4, sdTrue(3) * 0.75].map(
          (x) => Math.round(x * 10) / 10,
        ),
        street: [
          { kmh: 50, rts: [1200] },
          { kmh: 50, rts: [1100] },
        ],
        sightOver: [15, 15],
      }),
    }),
    vector({
      name: "sd-collision",
      description:
        "60 km/h in both street rounds with a 1.5 s reaction: collisions in the 50–80 km/h band",
      tags: ["critical"],
      ...session(204, 4004, {
        estimates: scaled(1.05),
        street: [
          { kmh: 60, rts: [1500] },
          { kmh: 60, rts: [1500] },
        ],
        sightOver: [0, 10],
      }),
    }),
    vector({
      name: "sd-edge",
      description:
        "Anticipatory brake (60 ms) re-deals the round; a street round with no brake; one estimate missing",
      tags: ["edge"],
      ...session(205, 4005, {
        estimates: [sdTrue(0), null, sdTrue(2), sdTrue(3)],
        street: [
          { kmh: 30, rts: [60, 800] },
          { kmh: 20, rts: [] },
        ],
        sightOver: [0, null],
      }),
    }),
  ];
}

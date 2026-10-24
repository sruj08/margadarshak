// biome-ignore-all lint/performance/noBarrelFile: this file is the `./fixtures` subpath entry point.
// Golden replay vectors (GAME_SDK §11): {manifest, ctx, replayPackage, content, expectedResult} per
// game, at least 5 each (strong, medium, weak, critical or voided, edge). Used by the TS tests, the
// verifier's fixture content store, its CLI and (through the verifier) the Go contract tests.
import type { SessionResult } from "../schema/result.ts";
import { BS_PART_A, BS_PART_A_BUS, BS_PART_B } from "./blind-spot.ts";
import type { GoldenVector, VectorInput } from "./builders.ts";
import { EXPECTED_RESULTS } from "./expected.ts";
import { JS_T_BUS, JS_T_CLEAR, JS_T_PED } from "./junction-scan.ts";
import { LL_KEYS, LLT_JK } from "./ll-sim.ts";
import { HPT_KL, NAZAR_CLIPS, NAZAR_QUIET_CLIP, nazarRef } from "./nazar.ts";
import { SD_ROUNDS } from "./stopping-distance.ts";
import { TRACK_GENERIC_8 } from "./track-twin.ts";
import { allVectorInputs } from "./vectors.ts";

export type { GoldenVector, VectorInput } from "./builders.ts";
export { ctxFor, fixtureSid, manifestFor, StreamBuilder } from "./builders.ts";

function withExpected(v: VectorInput): GoldenVector {
  const stored = EXPECTED_RESULTS[v.name];
  if (stored === undefined) throw new Error(`no expected result for vector ${v.name}`);
  const expectedResult: SessionResult = {
    ...stored,
    replay: { seed: stored.replay.seed, inputs: v.replayPackage.inputs },
  };
  return { ...v, expectedResult };
}

let cache: GoldenVector[] | null = null;

/** Every golden vector, in a fixed order. Built lazily (the Track Twin driver takes a moment). */
export function goldenVectors(): GoldenVector[] {
  cache ??= allVectorInputs().map(withExpected);
  return cache;
}

/**
 * Raw content documents by item ref, as a content store would hold them (clip.json, round configs,
 * track specs, answer keys). Server-side only.
 */
export function fixtureContentDocs(): Record<string, unknown> {
  const docs: Record<string, unknown> = {};
  for (const c of [...NAZAR_CLIPS, NAZAR_QUIET_CLIP]) docs[nazarRef(c)] = c;
  for (const r of SD_ROUNDS) docs[r.id] = r.round;
  docs["bs:part-a-truck"] = BS_PART_A;
  docs["bs:part-a-bus"] = BS_PART_A_BUS;
  docs["bs:part-b-highway"] = BS_PART_B;
  docs["js:t-bus"] = JS_T_BUS;
  docs["js:t-clear"] = JS_T_CLEAR;
  docs["js:t-ped"] = JS_T_PED;
  docs[`track:${TRACK_GENERIC_8.trackId}@${TRACK_GENERIC_8.version}`] = TRACK_GENERIC_8;
  for (const k of LL_KEYS) docs[`q:${k.qref}`] = k;
  return docs;
}

/** Raw rule-pack format rows by rule ID. */
export function fixtureFormats(): Record<string, unknown> {
  return { [HPT_KL.rule_id]: HPT_KL, [LLT_JK.rule_id]: LLT_JK };
}

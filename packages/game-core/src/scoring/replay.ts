// The verifier's single entry point (GAME_SDK §6.3): validate → decode → dispatch to the scorer at
// the session's scoringVersion. The same function runs on the device for the instant preview.
import { ReplayError } from "../errors.ts";
import type { IntegrityHints } from "../integrity/checks.ts";
import { GameContent } from "../schema/content.ts";
import type { GameEvent } from "../schema/events.ts";
import type { GameId } from "../schema/ids.ts";
import { type ReplayManifest, SessionContext } from "../schema/manifest.ts";
import { ReplayPackage, type SessionResult } from "../schema/result.ts";
import { decodeReplay, decodeReplayAsync } from "../sdk/replay-codec.ts";
import { scoreBlindSpot } from "./blind-spot.ts";
import type { ScoreOptions } from "./common.ts";
import { scoreJunctionScan } from "./junction-scan.ts";
import { scoreLlSim } from "./ll-sim.ts";
import { scoreNazarKerala5Band } from "./nazar.ts";
import { scoreStoppingDistance } from "./stopping-distance.ts";
import { scoreTrackTwin } from "./track-twin.ts";

/**
 * Supported `major.minor` scoring versions per game. The verifier keeps the last two minors
 * loaded (GAME_SDK §9). Helmet Fit, Golden Hour, Night & Glare and Hill Road have no scorer yet.
 */
export const SCORING_VERSIONS: Readonly<Partial<Record<GameId, readonly string[]>>> = {
  nazar: ["1.0"],
  stopping_distance: ["1.0"],
  blind_spot: ["1.0"],
  junction_scan: ["1.0"],
  track_twin: ["1.0"],
  ll_sim: ["1.0"],
};

export const SUPPORTED_GAMES = Object.keys(SCORING_VERSIONS) as GameId[];

export interface ReplayOptions {
  hints?: IntegrityHints;
  provisional?: boolean;
}

function check(manifest: ReplayManifest, ctxIn: unknown, contentIn: unknown) {
  const ctxR = SessionContext.safeParse(ctxIn);
  if (!ctxR.success)
    throw new ReplayError(
      "CONTEXT_MISMATCH",
      `invalid SessionContext: ${ctxR.error.issues[0]?.message ?? ""}`,
    );
  const ctx = ctxR.data;
  const versions = SCORING_VERSIONS[manifest.gameId];
  if (versions === undefined)
    throw new ReplayError("UNSUPPORTED_GAME", `no scorer for ${manifest.gameId}`);
  if (!versions.includes(manifest.scoringVersion)) {
    throw new ReplayError(
      "UNSUPPORTED_VERSION",
      `${manifest.gameId} scoring ${manifest.scoringVersion} not loaded (have ${versions.join(", ")})`,
    );
  }
  if (ctx.gameId !== manifest.gameId)
    throw new ReplayError("CONTEXT_MISMATCH", "ctx.gameId differs from the manifest");
  const contentR = GameContent.safeParse(contentIn);
  if (!contentR.success) {
    const i = contentR.error.issues[0];
    throw new ReplayError(
      "CONTENT_MISMATCH",
      `invalid content: ${i?.path.join(".") ?? ""} ${i?.message ?? ""}`,
    );
  }
  if (contentR.data.gameId !== ctx.gameId)
    throw new ReplayError("CONTENT_MISMATCH", "content is for another game");
  return { ctx, content: contentR.data };
}

function parsePkg(pkgIn: unknown, seed: number): ReplayPackage {
  const r = ReplayPackage.safeParse(pkgIn);
  if (!r.success)
    throw new ReplayError(
      "BAD_REPLAY",
      `invalid ReplayPackage: ${r.error.issues[0]?.message ?? ""}`,
    );
  if (r.data.seed !== seed)
    throw new ReplayError("CONTEXT_MISMATCH", "replay seed differs from the session seed");
  return r.data;
}

/** Scores already-decoded events (shared by replay, replayAsync and client previews). */
export function scoreEvents(
  manifest: ReplayManifest,
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: GameContent,
  opts: ScoreOptions,
): SessionResult {
  switch (content.gameId) {
    case "nazar":
      return scoreNazarKerala5Band(ctx, events, content, opts);
    case "stopping_distance":
      return scoreStoppingDistance(ctx, events, content, opts);
    case "blind_spot":
      return scoreBlindSpot(ctx, events, content, opts);
    case "junction_scan":
      return scoreJunctionScan(ctx, events, content, opts);
    case "track_twin":
      return scoreTrackTwin(ctx, events, content, opts);
    case "ll_sim":
      return scoreLlSim(ctx, events, content, opts);
    default:
      throw new ReplayError("UNSUPPORTED_GAME", `no scorer for ${manifest.gameId}`);
  }
}

function scoreOpts(
  manifest: ReplayManifest,
  pkg: ReplayPackage,
  opts: ReplayOptions,
): ScoreOptions {
  return {
    gameVersion: manifest.version,
    scoringVersion: manifest.scoringVersion,
    replayInputs: pkg.inputs,
    maxEvents: manifest.budgets.maxEvents,
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
    ...(opts.provisional === undefined ? {} : { provisional: opts.provisional }),
  };
}

/** Replays an `mdr1` package synchronously and returns the authoritative SessionResult. */
export function replay(
  manifest: ReplayManifest,
  ctxIn: SessionContext,
  pkgIn: ReplayPackage,
  contentIn: GameContent,
  opts: ReplayOptions = {},
): SessionResult {
  const { ctx, content } = check(manifest, ctxIn, contentIn);
  const pkg = parsePkg(pkgIn, ctx.seed);
  const events = decodeReplay(pkg, ctx.sid);
  return scoreEvents(manifest, ctx, events, content, scoreOpts(manifest, pkg, opts));
}

/** As `replay`, also accepting the `mdr1+gzip` encoding. */
export async function replayAsync(
  manifest: ReplayManifest,
  ctxIn: SessionContext,
  pkgIn: ReplayPackage,
  contentIn: GameContent,
  opts: ReplayOptions = {},
): Promise<SessionResult> {
  const { ctx, content } = check(manifest, ctxIn, contentIn);
  const pkg = parsePkg(pkgIn, ctx.seed);
  const events = await decodeReplayAsync(pkg, ctx.sid);
  return scoreEvents(manifest, ctx, events, content, scoreOpts(manifest, pkg, opts));
}

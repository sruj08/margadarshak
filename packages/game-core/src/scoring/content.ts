// Assembles per-game scoring content from raw content documents (clip.json, round configs, track
// specs, LL answer keys, rule-pack format rows). Shared by the verifier's directory store and the
// fixture store so both resolve a session's items the same way.
//
// Item refs carry their kind: clip:<id>@<v> (nazar), sd:<id> (stopping_distance), bs:<id>
// (blind_spot), js:<id> (junction_scan), track:<id>@<v> (track_twin), q:<qref> (ll_sim).

import type { z } from "zod";
import { ReplayError } from "../errors.ts";
import {
  BsItem,
  type GameContent,
  HptFormat,
  JsItem,
  LlAnswerKey,
  LlExamFormat,
  NazarClip,
  SdRound,
  TrackSpec,
} from "../schema/content.ts";
import type { GameId } from "../schema/ids.ts";
import type { SessionContext } from "../schema/manifest.ts";
import { GAME_CONFIG } from "./config.ts";

export const ITEM_KIND: Readonly<Partial<Record<GameId, string>>> = {
  nazar: "clip",
  stopping_distance: "sd",
  blind_spot: "bs",
  junction_scan: "js",
  track_twin: "track",
  ll_sim: "q",
};

/** The Kerala HPT row used by Nazar's mock format (NAZAR §8). */
export const HPT_FORMAT_ID = "HPT-KL";

/** Format rows a session needs, in lookup order (first found wins). */
export function requiredFormats(ctx: Pick<SessionContext, "gameId" | "tenant">): string[] {
  if (ctx.gameId === "nazar") return [HPT_FORMAT_ID];
  if (ctx.gameId === "ll_sim") return [`LLT-${ctx.tenant}`];
  return [];
}

/** The default LL format when the tenant has no rule-pack row (GAME_DESIGN §11.3). */
export function defaultLlFormat(): LlExamFormat {
  const q = GAME_CONFIG.llSim.defaultQuestions;
  return {
    rule_id: "LLT-DEFAULT",
    state: "DEFAULT",
    known: false,
    questions: q,
    pass: Math.ceil((q * GAME_CONFIG.llSim.defaultPassPct) / 100),
    per_q_timer_s: null,
    total_timer_s: null,
    source_url: null,
    verified_on: null,
    confidence: null,
  };
}

export interface RawContent {
  /** Raw documents aligned with ctx.items (undefined = not found). */
  items: readonly unknown[];
  /** Raw format rows by rule ID (undefined = not found). */
  formats: Readonly<Record<string, unknown>>;
}

function parse<S extends z.ZodType>(schema: S, raw: unknown, what: string): z.infer<S> {
  if (raw === undefined) throw new ReplayError("CONTENT_NOT_FOUND", `content not found: ${what}`);
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ReplayError(
      "CONTENT_MISMATCH",
      `${what}: ${i?.path.join(".") ?? ""} ${i?.message ?? "invalid"}`,
    );
  }
  return r.data as z.infer<S>;
}

export function assembleContent(ctx: SessionContext, raw: RawContent): GameContent {
  const kind = ITEM_KIND[ctx.gameId];
  if (kind === undefined)
    throw new ReplayError("UNSUPPORTED_GAME", `no scorer for ${ctx.gameId} yet`);
  if (raw.items.length !== ctx.items.length) {
    throw new ReplayError(
      "CONTENT_MISMATCH",
      `expected ${ctx.items.length} item documents, got ${raw.items.length}`,
    );
  }
  for (const it of ctx.items) {
    if (!it.ref.startsWith(`${kind}:`)) {
      throw new ReplayError("CONTENT_MISMATCH", `item ${it.ref} is not a ${kind}: item`);
    }
  }
  const each = <S extends z.ZodType>(schema: S): z.infer<S>[] =>
    ctx.items.map((it, i) => parse(schema, raw.items[i], it.ref));

  switch (ctx.gameId) {
    case "nazar": {
      const clips = each(NazarClip);
      clips.forEach((c, i) => {
        const it = ctx.items[i];
        if (it !== undefined && String(c.version) !== it.contentVersion) {
          throw new ReplayError(
            "CONTENT_MISMATCH",
            `${it.ref}: content version ${c.version} ≠ ${it.contentVersion}`,
          );
        }
      });
      return {
        gameId: "nazar",
        clips,
        format: parse(HptFormat, raw.formats[HPT_FORMAT_ID], HPT_FORMAT_ID),
      };
    }
    case "stopping_distance":
      return { gameId: "stopping_distance", rounds: each(SdRound) };
    case "blind_spot":
      return { gameId: "blind_spot", items: each(BsItem) };
    case "junction_scan":
      return { gameId: "junction_scan", items: each(JsItem) };
    case "track_twin": {
      const tracks = each(TrackSpec);
      tracks.forEach((t, i) => {
        const it = ctx.items[i];
        if (it !== undefined && String(t.version) !== it.contentVersion) {
          throw new ReplayError(
            "CONTENT_MISMATCH",
            `${it.ref}: track version ${t.version} ≠ ${it.contentVersion}`,
          );
        }
      });
      return { gameId: "track_twin", tracks };
    }
    case "ll_sim": {
      const questions = each(LlAnswerKey);
      questions.forEach((q, i) => {
        const it = ctx.items[i];
        if (it !== undefined && it.ref !== `q:${q.qref}`) {
          throw new ReplayError("CONTENT_MISMATCH", `${it.ref}: answer key is for ${q.qref}`);
        }
      });
      const id = `LLT-${ctx.tenant}`;
      const format =
        raw.formats[id] === undefined
          ? defaultLlFormat()
          : parse(LlExamFormat, raw.formats[id], id);
      return { gameId: "ll_sim", format, questions };
    }
    default:
      throw new ReplayError("UNSUPPORTED_GAME", `no scorer for ${ctx.gameId} yet`);
  }
}

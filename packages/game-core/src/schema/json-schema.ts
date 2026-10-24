// JSON Schema export (Zod 4 `z.toJSONSchema`). The Go API consumes these documents; the committed
// copies in packages/game-core/schema/*.json are checked for drift by a test.
import { z } from "zod";
import { DebriefCard, DebriefDraft, FactsPack } from "../debrief/schema.ts";
import {
  BsItem,
  GameContent,
  HptFormat,
  JsItem,
  LlAnswerKey,
  LlExamFormat,
  NazarClip,
  SdRound,
  TrackSpec,
} from "./content.ts";
import { GameEvent } from "./events.ts";
import { A11yMode, GameId, HazardType } from "./ids.ts";
import { GameManifest, SessionContext } from "./manifest.ts";
import {
  Evidence,
  Finding,
  IntegrityFlag,
  IntegrityReport,
  ReplayPackage,
  SessionResult,
} from "./result.ts";

/** Every schema that crosses a process boundary, by document name. */
export const EXPORTED_SCHEMAS = {
  GameId,
  A11yMode,
  HazardType,
  GameManifest,
  SessionContext,
  GameEvent,
  ReplayPackage,
  Finding,
  Evidence,
  IntegrityFlag,
  IntegrityReport,
  SessionResult,
  NazarClip,
  HptFormat,
  SdRound,
  BsItem,
  JsItem,
  TrackSpec,
  LlExamFormat,
  LlAnswerKey,
  GameContent,
  // Debrief (DEBRIEF_SPEC §5.1, §7.1, §7.2), read by the Go AI path.
  FactsPack,
  DebriefDraft,
  DebriefCard,
} as const satisfies Record<string, z.ZodType>;

export type ExportedSchemaName = keyof typeof EXPORTED_SCHEMAS;

/** JSON Schema (draft 2020-12) documents for every exported schema. */
export function toJsonSchemas(): Record<ExportedSchemaName, Record<string, unknown>> {
  const out = {} as Record<ExportedSchemaName, Record<string, unknown>>;
  for (const name of Object.keys(EXPORTED_SCHEMAS).sort() as ExportedSchemaName[]) {
    const doc = z.toJSONSchema(EXPORTED_SCHEMAS[name], {
      target: "draft-2020-12",
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    out[name] = {
      ...doc,
      $id: `https://margdarshak.example/schemas/game-core/${name}.json`,
      title: name,
    };
  }
  return out;
}

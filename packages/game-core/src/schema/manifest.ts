// GameManifest (GAME_SDK §2.1) and SessionContext (GAME_SDK §3).
// SessionContext holds no personal data by construction: `.strict()` rejects any extra key and a
// test scans every exported schema for PII-like field names.
import { z } from "zod";
import {
  A11yMode,
  DRILL_ID_RE,
  FINDING_ID_RE,
  GameId,
  GameMode,
  ItemRef,
  RULE_ID_RE,
  ScoringVersion,
  SeedOrigin,
  SemVer,
} from "./ids.ts";

export const MANIFEST_LABEL = {
  en: "Practice and familiarisation, not certification",
  hi: "अभ्यास और परिचय के लिए, प्रमाणन नहीं",
} as const;

export const GameManifest = z
  .object({
    gameId: GameId,
    code: z.enum(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10"]),
    version: SemVer,
    scoringVersion: ScoringVersion,
    telemetryVersion: z.literal(1),
    engine: z.enum(["phaser4", "video_svg", "react_dom", "react_mediapipe"]),
    modules: z
      .array(z.string().regex(/^(M([1-9]|1\d|2[0-2])|LL[0-4]|DL1)$/))
      .min(1)
      .max(24),
    skills: z
      .array(z.string().regex(/^SK-(M\d{1,2}|LL\d|DL1)$/))
      .min(1)
      .max(24),
    ruleIds: z.array(z.string().regex(RULE_ID_RE)).max(64),
    findingIds: z.array(z.string().regex(FINDING_ID_RE)).max(64),
    drillIds: z.array(z.string().regex(DRILL_ID_RE)).max(64),
    modes: z.array(GameMode).min(1).max(4),
    debriefMode: z.enum(["ai_or_template", "template_only"]),
    minUserBand: z.literal("u18"),
    u18Behaviour: z.literal("full"),
    offline: z.boolean(),
    liteMode: z.enum(["full", "decision_variant", "none"]),
    a11yModes: z.array(A11yMode).min(3).max(8),
    assets: z
      .array(
        z
          .object({
            url: z.url(),
            bytes: z.number().int().positive(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            kind: z.enum(["chunk", "atlas", "clip", "model", "audio", "image"]),
          })
          .strict(),
      )
      .max(200),
    budgets: z
      .object({
        chunkKbGzip: z.number().positive().max(350),
        maxEvents: z.number().int().positive().max(5000),
        maxSessionSeconds: z.number().int().positive().max(1200),
      })
      .strict(),
    label: z
      .object({
        en: z.literal(MANIFEST_LABEL.en),
        hi: z.literal(MANIFEST_LABEL.hi),
      })
      .strict(),
    contentGate: z
      .object({
        medicalReview: z.boolean(),
        reviewedBy: z.string().max(64).nullable(),
        reviewedOn: z.iso.date().nullable(),
        draftLabelUntilReviewed: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type GameManifest = z.infer<typeof GameManifest>;

/** The subset of a manifest that replay needs (the verifier builds it from the request). */
export type ReplayManifest = Pick<GameManifest, "gameId" | "version" | "scoringVersion"> & {
  budgets: Pick<GameManifest["budgets"], "maxEvents" | "maxSessionSeconds">;
};

export const SessionItem = z
  .object({
    ref: ItemRef,
    contentVersion: z.string().min(1).max(24),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type SessionItem = z.infer<typeof SessionItem>;

export const SessionContext = z
  .object({
    sid: z.uuid(),
    gameId: GameId,
    mode: GameMode,
    // Derived server-side from the date of birth; never the date itself. u18 = family mode.
    userBand: z.enum(["u18", "adult"]),
    locale: z.enum(["en", "hi"]),
    a11y: z
      .object({
        modes: z.array(A11yMode).max(8),
        textScale: z.number().min(1).max(2),
        haptics: z.boolean(),
      })
      .strict(),
    difficulty: z.number().int().min(1).max(5),
    seed: z.number().int().nonnegative().max(4294967295),
    seedOrigin: SeedOrigin,
    items: z.array(SessionItem).max(40),
    deviceClass: z.enum(["low", "mid", "high"]),
    offline: z.boolean(),
    serverStartIso: z.iso.datetime().nullable(),
    tenant: z
      .string()
      .min(2)
      .max(16)
      .regex(/^[A-Z][A-Z0-9_]{1,15}$/),
    rulePackVersion: z.string().min(1).max(32),
  })
  .strict();
export type SessionContext = z.infer<typeof SessionContext>;

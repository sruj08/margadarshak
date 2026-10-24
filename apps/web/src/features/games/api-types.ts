/**
 * Wire types for the P2 game endpoints (API-34/35/36/37, the replay endpoint and share cards),
 * taken from the generated client (`@margdarshak/api-client`, api/openapi.yaml). The aliases keep
 * the names the screens already use.
 *
 * Convention: top-level API fields are snake_case; the game-core wire objects (`ctx` =
 * SessionContext, `client_result` / `result` = SessionResult, `replay` = ReplayPackage) keep
 * game-core's camelCase byte for byte, so those fields are typed with game-core's own types (the
 * generated copies are the same JSON, but loosen enums such as integrity flags to strings).
 */
import type { Schemas } from "@margdarshak/api-client";
import type { ReplayPackage, SessionContext, SessionResult } from "@margdarshak/game-core/schema";

export type SeedOrigin = Schemas["GameSessionStart"]["seed_origin"];

/**
 * API-34 request body (`GameSessionCreate`). The late-registration fields (`offline_started_at`,
 * `offline_seed`, `offline_items`) are left out on purpose: the API answers 422
 * `offline_registration_unavailable` for them, so an offline session stays on the device
 * (provisional) instead. `text_scale` and `haptics` have server defaults.
 */
export type GameSessionCreate = Omit<
  Schemas["GameSessionCreate"],
  "offline_started_at" | "offline_seed" | "offline_items" | "text_scale" | "haptics"
> & { text_scale?: number; haptics?: boolean };

/** A final hazard window (`HazardWindow`), sent only for learn/practice items and after API-35. */
export type HazardWindowWire = Schemas["HazardWindow"];

export type ItemReveal = Schemas["ItemReveal"];

/**
 * One item of a session (`GameSessionItem`). The API sends no `public` documents today: the client
 * fills `public` from its own client-safe copy (the LL bank for `q:` items, the game-core fixture
 * scenarios for sims) before the game sees the items. `origin` says whether a clip was filmed or is
 * an AI-generated scene (only the latter carries the AI label).
 */
export type GameSessionItem = Schemas["GameSessionItem"];

/** API-34 201 body (`GameSessionStart`); `ctx` is game-core's SessionContext, unchanged. */
export type GameSessionStart = Omit<Schemas["GameSessionStart"], "ctx" | "items"> & {
  ctx: SessionContext;
  items: GameSessionItem[];
};

/** API-35 request body (`GameSessionComplete`). */
export type GameSessionComplete = Omit<
  Schemas["GameSessionComplete"],
  "client_result" | "replay"
> & {
  client_result: SessionResult;
  replay: ReplayPackage;
};

/** One analysed Nazar clip (`NazarClipAnalysis`); never carries a window. */
export type NazarClipAnalysisWire = Schemas["NazarClipAnalysis"];

export type NazarSessionFacts = Schemas["NazarSessionFacts"];

export type NazarIneligibleReason = NonNullable<NazarSessionFacts["ineligible_reasons"]>[number];

export type BadgeKey = Schemas["BadgeId"];

export type RankKey = Schemas["Achievement"]["rank"];

/**
 * API-35 200 body (`CheckedSessionResult`). The server replay result wins (D-11). `xp_awarded` is
 * null while provisional, for an anonymous device session, and on an idempotent replay of a session
 * that was already completed (the XP was awarded the first time).
 */
export type CheckedSessionResult = Omit<
  Schemas["CheckedSessionResult"],
  "score" | "findings" | "integrity" | "result"
> & {
  score: SessionResult["score"];
  findings: SessionResult["findings"];
  integrity: SessionResult["integrity"];
  result?: SessionResult;
};

/** Replay endpoint body (`GameSessionReplay`, GET /v1/games/sessions/{id}/replay). */
export type GameSessionReplay = Schemas["GameSessionReplay"];

/** API-36 body (`Debrief`, E-19). The AI path is P3; P2 keeps the template card. */
export type DebriefWire = Schemas["Debrief"];

/**
 * API-37 entry (`ClipManifestItem`): an allowlist, no windows, no hazard count or speed. `media`
 * lists only the rendition that was asked for (`resolution`).
 */
export type ClipManifestItem = Schemas["ClipManifestItem"];

export type ClipPage = Schemas["ClipPage"];

/** The one rendition the offline pack asks API-37 for (its `media[]` lists only this one). */
export const PACK_RESOLUTION: ClipManifestItem["media"][number]["res"] = "360p";

/**
 * Share cards (API-57 delta). Every number is recomputed by the server. `kerala_line`,
 * `show_percentile` and `locale` have server defaults.
 */
export type ShareCardCreate = Omit<
  Schemas["ShareCardCreate"],
  "kerala_line" | "show_percentile" | "locale"
> &
  Partial<Pick<Schemas["ShareCardCreate"], "kerala_line" | "show_percentile" | "locale">>;

/**
 * With `name_display: "display_name"` the server keeps at most 20 characters (letters, spaces,
 * apostrophes and hyphens) and answers 422 otherwise; with initials only the initials are stored.
 */
export const SHARE_DISPLAY_NAME_MAX = 20;

export type ShareCardContentWire = Schemas["ShareCardContent"];

export type ShareCard = Schemas["ShareCard"];

export type ShareCardPublic = Schemas["ShareCardPublic"];

/** The slice of API-59 `FamilyMember` the share gate reads. */
export type FamilyMemberWire = Pick<
  Schemas["FamilyMember"],
  "member_id" | "label" | "is_minor" | "parental_consent" | "parental_extras"
>;

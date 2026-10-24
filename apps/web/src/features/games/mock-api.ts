/**
 * The device implementation of the P2 game endpoints (mock mode, or the real API unavailable).
 * Loaded lazily by api.ts, so game-core's scorers and fixture clips stay out of every first load.
 *
 *  - API-34: a device session over the game-core fixture items, seeded on the device
 *    (`seedOrigin: client_offline`, flagged INT_OFFLINE_SEED by the scorer). Never counts.
 *  - API-35: game-core `replay` on the device gives a **provisional** result (`server_checked:
 *    false`, `server_score_pct: null`). The real verifier's result always replaces it (D-11).
 *  - Replay endpoint: windows and per-clip analysis from the fixture clips (`analyseNazarClips`).
 *  - API-37: no clip media is published yet, so the device pack is empty (said honestly).
 *  - Share cards: device scores never count, so the device never creates a card.
 */
import { SCORING_VERSIONS } from "@margdarshak/game-core";
import { fixtureContentDocs, fixtureFormats } from "@margdarshak/game-core/fixtures";
import type {
  GameContent,
  GameEvent,
  GameId,
  HazardType,
  NazarClip,
  NazarContent,
  ReplayManifest,
  ReplayPackage,
  SessionContext,
  SessionItem,
} from "@margdarshak/game-core/schema";
import {
  analyseNazarClips,
  assembleContent,
  GAME_CONFIG,
  ITEM_KIND,
  replay,
} from "@margdarshak/game-core/scoring";
import { mulberry32, shuffle } from "@margdarshak/game-core/sim";
import { PLACEHOLDER_CLIP_BYTES } from "@/features/nazar/placeholder";
import type { StartedSession } from "./api";
import type {
  CheckedSessionResult,
  ClipPage,
  GameSessionCreate,
  GameSessionItem,
  GameSessionReplay,
  HazardWindowWire,
  NazarClipAnalysisWire,
  NazarSessionFacts,
  ShareCardCreate,
} from "./api-types";
import type { DeviceItems, DeviceMedia, StudyForm } from "./types";

const SESSION_TTL_MS = 60 * 60 * 1000;

const docs = (): Record<string, unknown> => fixtureContentDocs();

/** A uniformly random uint32 from the platform CSPRNG (the device's seed; never a server seed). */
function deviceSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

const isClip = (v: unknown): v is NazarClip =>
  typeof v === "object" && v !== null && "clipId" in v && "hazards" in v;

/** Every fixture clip, keyed by ref. */
export function fixtureClips(): Map<string, NazarClip> {
  const out = new Map<string, NazarClip>();
  for (const [ref, doc] of Object.entries(docs())) if (isClip(doc)) out.set(ref, doc);
  return out;
}

const drillHazard = (drillId: string | undefined): HazardType | null => {
  const m = /^DR-NAZ-OCCL-([A-Z0-9_]+)$/.exec(drillId ?? "");
  return m?.[1] ? (m[1].toLowerCase() as HazardType) : null;
};

/** Nazar items for a device session: mock = the 10-clip Kerala-format bank; practice/learn fewer. */
function nazarRefs(mode: GameSessionCreate["mode"], seed: number, drillId?: string): string[] {
  const clips = [...fixtureClips().entries()];
  const rng = mulberry32(seed);
  const hazardClips = clips.filter(([, c]) => c.hazards.length > 0);
  if (mode === "mock" || mode === "pair") return shuffle(rng, hazardClips).map(([r]) => r);
  const want = drillHazard(drillId);
  const preferred = want
    ? hazardClips.filter(([, c]) => c.hazards.some((h) => h.hazardType === want))
    : [];
  const rest = shuffle(
    rng,
    hazardClips.filter(([r]) => !preferred.some(([p]) => p === r)),
  );
  const count = mode === "learn" ? 2 : 3;
  return [...preferred, ...rest].slice(0, count).map(([r]) => r);
}

/** Which blocks are test and which is fresh for a form (FIELD_STUDY §4.2, DEC-017). */
export const FORM_BLOCKS: Readonly<Record<StudyForm, { test: [number, number]; fresh: number }>> = {
  A: { test: [0, 1], fresh: 2 },
  B: { test: [1, 2], fresh: 0 },
  C: { test: [0, 2], fresh: 1 },
};

/** The form the server would have dealt: A, B, C in order of arrival (P-001 → A, P-002 → B …). */
export function formFromCode(code: string): StudyForm {
  const n = Number(/^P-(\d{3,4})$/.exec(code)?.[1] ?? "1");
  return (["A", "B", "C"] as const)[(((n - 1) % 3) + 3) % 3] ?? "A";
}

/**
 * Field-study items on the device: the pool (in its given order) is cut into blocks B1, B2, B3 of
 * five; phase `test` deals the form's two test blocks (10 clips), `fresh` its fresh block (5).
 * With fewer than 15 clips the blocks wrap around the pool, so a "fresh" clip may repeat a test
 * clip: fine for trying the flow, never for study data (the server deals real forms).
 */
export function studyRefs(
  pool: readonly string[],
  phase: "test" | "fresh",
  form: StudyForm,
): string[] {
  if (pool.length === 0) return [];
  if (pool.length < 15)
    console.warn(`study blocks need 15 clips; only ${pool.length} on this device, blocks wrap`);
  const block = (b: number) =>
    Array.from({ length: 5 }, (_, i) => pool[(b * 5 + i) % pool.length] as string);
  const f = FORM_BLOCKS[form];
  return phase === "test" ? [...block(f.test[0]), ...block(f.test[1])] : block(f.fresh);
}

/** Nazar clips a device session can deal: the caller's device documents, else the fixtures. */
function nazarPool(device: DeviceItems | undefined): Map<string, NazarClip> {
  if (!device) return fixtureClips();
  const out = new Map<string, NazarClip>();
  for (const it of device.items) {
    const doc = device.docs[it.ref];
    if (isClip(doc)) out.set(it.ref, doc);
  }
  return out;
}

const toWindow = (clip: NazarClip): HazardWindowWire[] =>
  clip.hazards.map((h) => ({
    hazard_id: h.hazardId,
    hazard_type: h.hazardType,
    a_ms: h.window.aMs,
    b_ms: h.window.bMs,
    full_marks_until_ms: Math.round(h.window.aMs + (h.window.bMs - h.window.aMs) / 5),
    occlusion: false,
  }));

function nazarItem(
  ref: string,
  clip: NazarClip,
  mode: GameSessionCreate["mode"],
  locale: string,
  media?: DeviceMedia,
): GameSessionItem {
  const item: GameSessionItem = media
    ? {
        item_ref: ref,
        kind: "clip",
        content_version: String(clip.version),
        asset_url: media.url,
        ...(media.bytes ? { bytes: media.bytes } : {}),
        ...(media.sha256 ? { sha256: media.sha256 } : {}),
        ...(media.posterUrl ? { poster_url: media.posterUrl } : {}),
        ...(media.srAltUrl ? { sr_alt_url: media.srAltUrl } : {}),
        ...(media.origin ? { origin: media.origin } : {}),
      }
    : {
        item_ref: ref,
        kind: "clip",
        content_version: String(clip.version),
        // Placeholder media served by this app (no clip media is published yet); the player draws
        // a labelled placeholder timeline once these bytes are fully loaded.
        asset_url: `/${locale}/learn/practise/nazar/clip/${clip.clipId}`,
        bytes: PLACEHOLDER_CLIP_BYTES,
      };
  // Windows go to learn and practice only, never to a mock (NAZAR §3.2).
  if (mode === "learn" || mode === "practice")
    item.reveal = { speed_kmh_est: clip.speedKmhEst, hazards: toWindow(clip) };
  return item;
}

function genericItems(gameId: GameId): DeviceItems {
  const kind = ITEM_KIND[gameId];
  if (kind === undefined) return { items: [], docs: {} };
  const all = docs();
  const refs = Object.keys(all).filter((r) => r.startsWith(`${kind}:`));
  const version = (doc: unknown): string => {
    const v = (doc as { version?: unknown } | null)?.version;
    return typeof v === "number" ? String(v) : "1";
  };
  return {
    items: refs.map((ref) => ({ ref, contentVersion: version(all[ref]) })),
    docs: Object.fromEntries(refs.map((r) => [r, all[r]])),
    formats: fixtureFormats(),
    publicDocs: Object.fromEntries(
      kind === "q" ? [] : refs.map((r) => [r, all[r] as Record<string, unknown>]),
    ),
  };
}

/**
 * The client-safe document of a sim item (stopping distance, blind spot, junction scan, track),
 * from the game-core fixtures the server deals those items from. Never for `q:` (fixture LL items
 * are answer keys) or clips (scoring windows).
 */
export function fixturePublicDoc(ref: string): Record<string, unknown> | undefined {
  const kind = ref.split(":", 1)[0];
  if (kind === "q" || kind === "clip") return undefined;
  const doc = docs()[ref];
  return typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : undefined;
}

/** A SessionContext tenant (pattern ^[A-Z][A-Z0-9_]{1,15}$); anything else falls back to JK. */
export function deviceTenant(t: string): string {
  const up = t.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,15}$/.test(up) ? up : "JK";
}

export const manifestFor = (gameId: GameId, version = "1.0.0"): ReplayManifest => ({
  gameId,
  version,
  scoringVersion: SCORING_VERSIONS[gameId]?.[0] ?? "1.0",
  budgets: GAME_CONFIG.budgets[gameId],
});

type DeviceOpts = {
  locale: string;
  deviceItems?: DeviceItems;
  tenant?: string;
  studyForm?: StudyForm;
};

/** What a device session deals: its items, their scoring documents and format rows. */
interface Dealt {
  items: GameSessionItem[];
  ctxItems: SessionItem[];
  docs: unknown[];
  formats: Record<string, unknown>;
  /** Every clip has real media (Nazar). */
  allMedia: boolean;
}

/** Nazar: a study form's blocks, the caller's device clips, or the fixture bank. */
function dealNazar(body: GameSessionCreate, opts: DeviceOpts, seed: number): Dealt {
  const device = opts.deviceItems;
  const locale = opts.locale === "hi" ? "hi" : "en";
  const clips = nazarPool(device);
  const pool = [...clips.keys()];
  const study = body.study;
  let refs: string[];
  if (study && study.phase !== "ll_mock")
    refs = studyRefs(pool, study.phase, opts.studyForm ?? formFromCode(study.participant_code));
  else refs = device ? pool : nazarRefs(body.mode, seed, body.drill_id);
  const list = refs.map((r) => clips.get(r) as NazarClip);
  const media = device?.media ?? {};
  return {
    items: refs.map((r, i) => nazarItem(r, list[i] as NazarClip, body.mode, locale, media[r])),
    ctxItems: refs.map((r, i) => ({ ref: r, contentVersion: String(list[i]?.version ?? 1) })),
    docs: list,
    formats: { ...fixtureFormats(), ...(device?.formats ?? {}) },
    allMedia: refs.length > 0 && refs.every((r) => media[r] !== undefined),
  };
}

/** Any other game: the caller's device items (e.g. the LL bank), else the game-core fixtures. */
function dealGeneric(gameId: GameId, opts: DeviceOpts): Dealt {
  const src = opts.deviceItems ?? genericItems(gameId);
  return {
    items: src.items.map((it) => {
      const pub = src.publicDocs?.[it.ref];
      return {
        item_ref: it.ref,
        kind: it.ref.split(":", 1)[0] ?? "item",
        content_version: it.contentVersion,
        ...(pub ? { public: pub } : {}),
      };
    }),
    ctxItems: src.items,
    docs: src.items.map((it) => src.docs[it.ref]),
    formats: { ...fixtureFormats(), ...(src.formats ?? {}) },
    allMedia: false,
  };
}

/** API-34 on the device. */
export function deviceStartSession(
  gameId: GameId,
  body: GameSessionCreate,
  opts: DeviceOpts,
): StartedSession {
  const seed = deviceSeed();
  const sid = crypto.randomUUID();
  const locale = opts.locale === "hi" ? "hi" : "en";
  const nowMs = Date.now();
  // The study's LL mock is the common 15-question format (FIELD_STUDY §4.2), not a state's.
  const fallbackTenant =
    gameId === "nazar" ? "KL" : body.study?.phase === "ll_mock" ? "DEFAULT" : "JK";
  const tenant = deviceTenant(opts.tenant ?? opts.deviceItems?.tenant ?? fallbackTenant);
  const dealt = gameId === "nazar" ? dealNazar(body, opts, seed) : dealGeneric(gameId, opts);

  const ctx: SessionContext = {
    sid,
    gameId,
    mode: body.mode,
    userBand: "adult",
    locale,
    a11y: {
      modes: body.a11y_modes ?? [],
      textScale: body.text_scale ?? 1,
      haptics: body.haptics ?? false,
    },
    difficulty: body.difficulty ?? 3,
    seed,
    seedOrigin: "client_offline",
    items: dealt.ctxItems,
    deviceClass: body.device_class ?? "mid",
    offline: true,
    serverStartIso: null,
    tenant,
    rulePackVersion: "2026.10.23",
  };
  let content: GameContent | null = null;
  try {
    content = assembleContent(ctx, { items: dealt.docs, formats: dealt.formats });
  } catch (e) {
    // No scorer or documents that do not fit: the session still plays, unscored.
    console.warn("device content failed", e);
  }

  return {
    source: "device",
    // Real clip media only when every clip has it (e.g. AI-generated scenes); else the placeholder.
    media: dealt.allMedia ? "video" : "placeholder",
    deviceContent: content,
    start: {
      session_id: sid,
      game_id: gameId,
      manifest_version: "1.0.0",
      scoring_version: SCORING_VERSIONS[gameId]?.[0] ?? "1.0",
      seed,
      seed_origin: "client_offline",
      difficulty: ctx.difficulty,
      mode: body.mode,
      items: dealt.items,
      ctx,
      label_key: "game.familiarisation_not_certification",
      expires_at: new Date(nowMs + SESSION_TTL_MS).toISOString(),
    },
  };
}

/** Scoring content from a game's own device documents (`deviceItems`); null when they do not fit. */
export function contentFromDocs(
  ctx: SessionContext,
  docs: Readonly<Record<string, unknown>>,
  formats: Readonly<Record<string, unknown>>,
): GameContent | null {
  try {
    return assembleContent(ctx, {
      items: ctx.items.map((it) => docs[it.ref]),
      formats: { ...fixtureFormats(), ...formats },
    });
  } catch {
    return null;
  }
}

/** Rebuilds a device session's scoring content from its refs (fixtures, or reveal windows). */
export function deviceContentFor(
  ctx: SessionContext,
  items: readonly GameSessionItem[],
): GameContent | null {
  if (ctx.gameId === "nazar") {
    const clips = fixtureClips();
    const list: NazarClip[] = [];
    for (const [i, it] of ctx.items.entries()) {
      const fixture = clips.get(it.ref);
      if (fixture) {
        list.push(fixture);
        continue;
      }
      // A server practice/learn item: its reveal windows are enough to score it on the device.
      const reveal = items[i]?.reveal;
      if (!reveal) return null;
      const m = /^clip:([A-Za-z0-9_-]+)@(\d+)$/.exec(it.ref);
      const durationMs = Math.max(1000, ...reveal.hazards.map((h) => h.b_ms));
      list.push({
        clipId: m?.[1] ?? "clip",
        version: Number(m?.[2] ?? 1),
        speedKmhEst: reveal.speed_kmh_est ?? 30,
        durationMs,
        hazards: reveal.hazards.map((h) => ({
          hazardId: h.hazard_id,
          hazardType: h.hazard_type,
          window: { aMs: h.a_ms, bMs: h.b_ms },
        })),
        quietSegments: [],
      });
    }
    const formats = fixtureFormats();
    return { gameId: "nazar", clips: list, format: formats["HPT-KL"] as NazarContent["format"] };
  }
  try {
    const all = docs();
    return assembleContent(ctx, {
      items: ctx.items.map((it) => all[it.ref]),
      formats: fixtureFormats(),
    });
  } catch {
    return null;
  }
}

function analysisWire(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: NazarContent,
): NazarClipAnalysisWire[] {
  return analyseNazarClips(ctx, events, content).map((c) => ({
    ordinal: c.ordinal,
    item_ref: ctx.items[c.item]?.ref ?? "",
    voided: c.voided,
    taps: c.tapCount,
    max_taps_in_window: c.maxTapsInWindow,
    early_taps: c.earlyTaps,
    false_alarms: c.falseAlarms,
    marks: c.marks,
    hazards: c.hazards.map((h) => ({
      hazard_id: h.hazard.hazardId,
      hazard_type: h.hazard.hazardType,
      credit: h.credit,
      band: h.band,
      tap_mt: h.tapMt,
      late_s: h.lateS,
      metres: h.metres,
    })),
  }));
}

/**
 * API-35 on the device: game-core `replay` gives the provisional preview. `server_score_pct` stays
 * null: only the verifier's score counts (D-11). Returns null when there is nothing to score with.
 */
export function deviceComplete(args: {
  manifest: ReplayManifest;
  ctx: SessionContext;
  replay: ReplayPackage;
  events: readonly GameEvent[];
  content: GameContent | null;
}): CheckedSessionResult | null {
  if (args.content === null) return null;
  const result = replay(args.manifest, args.ctx, args.replay, args.content, { provisional: true });
  const out: CheckedSessionResult = {
    session_id: args.ctx.sid,
    game_id: args.ctx.gameId,
    server_checked: false,
    provisional: true,
    client_score_pct: result.score.pct,
    server_score_pct: null,
    mismatch: false,
    score: result.score,
    findings: result.findings,
    integrity: result.integrity,
    result,
    xp_awarded: null,
    badges_awarded: [],
  };
  if (args.content.gameId === "nazar") {
    const facts: NazarSessionFacts = {
      rule: "kerala_5band",
      analysis: analysisWire(args.ctx, args.events, args.content),
      score_eligible: false,
      ineligible_reasons: [
        ...(args.ctx.mode === "mock" ? [] : (["not_mock"] as const)),
        ...(args.ctx.seedOrigin === "client_offline" ? (["offline_seed"] as const) : []),
        "provisional" as const,
      ],
    };
    out.nazar = facts;
  }
  return out;
}

/** The replay endpoint on the device: windows from the content, analysis from the events. */
export function deviceReplayView(args: {
  ctx: SessionContext;
  items: readonly GameSessionItem[];
  events: readonly GameEvent[];
  /** The content the session started with (device documents such as AI-generated clips). */
  content?: GameContent | null;
}): GameSessionReplay | null {
  const content = args.content ?? deviceContentFor(args.ctx, args.items);
  if (content === null || content.gameId !== "nazar") return null;
  const analysis = analysisWire(args.ctx, args.events, content);
  return {
    session_id: args.ctx.sid,
    game_id: "nazar",
    status: "pending_verification",
    rule: "kerala_5band",
    clips: content.clips.map((clip, i) => {
      const a = analysis[i];
      const assetUrl = args.items[i]?.asset_url;
      return {
        ordinal: i + 1,
        item_ref: args.ctx.items[i]?.ref ?? "",
        ...(assetUrl ? { asset_url: assetUrl } : {}),
        duration_ms: clip.durationMs,
        speed_kmh_est: clip.speedKmhEst,
        windows: toWindow(clip),
        ...(a ? { analysis: a } : {}),
      };
    }),
  };
}

/** API-37 on the device: no clip media is published yet, so there is nothing to download. */
export function devicePack(): ClipPage {
  return {
    manifest_version: "device-placeholder",
    licence: "CC-BY-4.0",
    total_bytes: 0,
    items: [],
    next_cursor: null,
  };
}

/** Device scores are provisional and never count, so no card can be made from them. */
export function deviceCreateShareCard(_body: ShareCardCreate) {
  return { status: "not_allowed" as const };
}

/**
 * Mock profile: a signed-in account holder with one family member aged 16 whose parent has given
 * the base consent but not the `share_cards` extra (so the consent gate can be seen in mock mode).
 */
export function deviceProfile() {
  return {
    account: "signed_in" as const,
    members: [
      {
        member_id: "fam_DEMO01",
        label: "Rahul",
        is_minor: true,
        parental_consent: { status: "granted" as const },
        parental_extras: [] as ("squads" | "share_cards" | "pair_mode")[],
      },
    ],
  };
}

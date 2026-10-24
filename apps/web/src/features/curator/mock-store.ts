import { findPii } from "@/lib/redact/redact";
import {
  adjudicatedHazards,
  adjudicationIssues,
  canPublish,
  computeAgreement,
  framesTotal,
  markIssues,
  publishChecks,
} from "./rules";
import type {
  AdminIdentity,
  BlurAuditSummary,
  Clip,
  ClipAdjudicationCreate,
  ClipBlurAuditCreate,
  ClipCueTextsUpdate,
  ClipGenerate,
  ClipGenerateAccepted,
  ClipRating,
  ClipRatingCreate,
  ClipRegister,
  ClipStatus,
  ClipSyntheticReviewCreate,
  NazarScene,
} from "./types";
import { SYNTHETIC_CHECKS } from "./types";

/**
 * The clip admin in mock mode (no API URL, or the API not live yet): a small store in this
 * browser's localStorage that behaves like API-55 — blind ratings, agreement, adjudication, blur
 * audit, cue texts and publish preconditions — over synthetic clips with **placeholder media**.
 * Nothing here is real footage, and nothing leaves the browser. Personas are pseudonyms only.
 */

export class MockProblem extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    title: string,
    public readonly detail?: string,
  ) {
    super(title);
  }
}

export interface MockPersona {
  pseudonym: string;
  roles: ("curator" | "rater")[];
}

/** Demo pseudonyms (never names): one curator and three raters. */
export const MOCK_PERSONAS: readonly MockPersona[] = [
  { pseudonym: "curator-01", roles: ["curator"] },
  { pseudonym: "rater-01", roles: ["rater"] },
  { pseudonym: "rater-02", roles: ["rater"] },
  { pseudonym: "rater-03", roles: ["rater"] },
];

const STORE_KEY = "md.curator.mock.v1";
const PERSONA_KEY = "md.curator.persona.v1";

interface Store {
  v: 1;
  seq: number;
  clips: Clip[];
}

const ATTRIBUTION = "Margdarshak clip bank, team Chanakya (Nestiq Private Limited), 2026";

/** A deterministic, obviously synthetic 64-hex "sha256" for placeholder renditions. */
export function mockSha(seed: string): string {
  let h = 2166136261;
  let out = "";
  for (let round = 0; out.length < 64; round++) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + round;
      h = Math.imul(h, 16777619) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Both renditions, as the real pipeline stores them (publish needs 360p and 480p). */
function renditions(id: string, version: number, bytes480: number): NonNullable<Clip["media"]> {
  return [
    { res: "360p", bytes: Math.round(bytes480 * 0.6), sha256: mockSha(`${id}@${version}:360p`) },
    { res: "480p", bytes: bytes480, sha256: mockSha(`${id}@${version}`) },
  ];
}
const SEED_TIME = Date.UTC(2026, 9, 23, 9, 0, 0);

function base(id: string, status: ClipStatus, durationMs: number, extra: Partial<Clip>): Clip {
  return {
    clip_id: id,
    version: 1,
    item_ref: `clip:${id}@1`,
    status,
    origin: "filmed",
    tenant_tags: ["KL"],
    city: "Kochi",
    road_type: "urban_arterial",
    time_of_day: "day",
    weather: "clear",
    pov: "2W",
    captured_month: "2026-10",
    speed_kmh_est: 35,
    speed_source: "rider_log",
    duration_ms: durationMs,
    modules: [],
    licence: "CC-BY-4.0",
    attribution: ATTRIBUTION,
    difficulty: { curator: null, empirical: null, irt: null, n_takers: 0 },
    media: status === "raw" || status === "transcoded" ? [] : renditions(id, 1, 2_900_000),
    flash_check: status === "raw" || status === "transcoded" ? null : { passed: true },
    mock_eligible: false,
    hazards: [],
    quiet_segments: [],
    blur_audit: null,
    proposals_visible: false,
    proposals: [],
    ratings_visible: false,
    rating_count: 0,
    ratings: [],
    adjudication: null,
    review_tasks: [],
    workflow_runs: [],
    raw_deleted_at: null,
    ...extra,
  };
}

function passedAudit(id: string, durationMs: number): BlurAuditSummary {
  const total = framesTotal(durationMs);
  return {
    auditor: "curator-01",
    rendition_sha256: mockSha(`${id}@1`),
    frames_total: total,
    frames_checked: total,
    misses: 0,
    audited_at: iso(SEED_TIME),
    passed: true,
  };
}

function rating(
  id: string,
  rater: string,
  marks: ClipRating["marks"],
  minutes: number,
): ClipRating {
  return {
    rating_id: `rtg_${mockSha(id + rater)
      .slice(0, 10)
      .toUpperCase()}`,
    clip_id: id,
    version: 1,
    rater,
    decision: "windows_set",
    marks,
    submitted_at: iso(SEED_TIME + minutes * 60_000),
  };
}

/** The synthetic seed board: one clip waiting at each step of the pipeline. */
export function seedClips(): Clip[] {
  const adjA = rating(
    "KL-0008",
    "rater-01",
    [{ hazard_type: "pedestrian_median", a_ms: 11_000, b_ms: 16_000, cue: "man steps off median" }],
    30,
  );
  const adjB = rating(
    "KL-0008",
    "rater-02",
    [{ hazard_type: "parked_vehicle_hidden", a_ms: 12_200, b_ms: 17_900, cue: "rider behind van" }],
    45,
  );
  const ratedA = rating(
    "KL-0007",
    "rater-01",
    [{ hazard_type: "truck_left_turn", a_ms: 17_800, b_ms: 22_400, cue: "lorry indicator on" }],
    20,
  );
  const ratedB = rating(
    "KL-0007",
    "rater-02",
    [{ hazard_type: "truck_left_turn", a_ms: 18_200, b_ms: 22_600 }],
    25,
  );
  const ratedAgreement = computeAgreement("KL-0007", 1, ratedA, ratedB, iso(SEED_TIME + 26 * 60e3));
  const adjAgreement = computeAgreement("KL-0008", 1, adjA, adjB, iso(SEED_TIME + 46 * 60e3));
  const published = base("KL-0002", "published", 40_000, {
    blur_audit: passedAudit("KL-0002", 40_000),
    difficulty: { curator: 2, empirical: null, irt: null, n_takers: 0 },
    rating_count: 2,
    hazards: [
      {
        hazard_id: "h1",
        hazard_type: "door_opening",
        a_ms: 8_000,
        b_ms: 12_000,
        rater_count: 2,
        delta_onset_ms: 200,
        delta_end_ms: 300,
        adjudicated: false,
        occlusion: false,
        cue_text: { en: "Door gap opens on the parked car", hi: "खड़ी कार का दरवाज़ा खुलने लगा" },
      },
    ],
    raw_deleted_at: iso(SEED_TIME + 3_600_000),
  });
  return [
    base("KL-0003", "raw", 50_000, {
      workflow_runs: [
        { job: "clip_ingest", run_id: "trn-mock01", runner: "inline", status: "started" },
      ],
    }),
    base("KL-0004", "blurred", 55_000, {}),
    base("KL-0011", "proposed", 30_000, {
      city: "Kochi",
      road_type: "market_street",
      blur_audit: passedAudit("KL-0011", 30_000),
    }),
    base("KL-0012", "proposed", 36_000, {
      road_type: "school_zone",
      blur_audit: passedAudit("KL-0012", 36_000),
      ratings: [
        rating(
          "KL-0012",
          "rater-01",
          [{ hazard_type: "child_school", a_ms: 14_000, b_ms: 19_000, cue: "child near the gate" }],
          10,
        ),
      ],
    }),
    base("KL-0008", "adjudication", 50_000, {
      blur_audit: passedAudit("KL-0008", 50_000),
      ratings: [adjA, adjB],
      agreement: adjAgreement,
    }),
    base("KL-0007", "rated", 45_000, {
      blur_audit: passedAudit("KL-0007", 45_000),
      ratings: [ratedA, ratedB],
      agreement: ratedAgreement,
      hazards: ratedAgreement.final_hazards.map(({ cues: _c, ...h }) => ({ ...h, cue_text: null })),
    }),
    published,
    aiClip("AI-0001", "proposed", 30_000, "SC-BUS-STOP-01", {}),
    aiClip("AI-0002", "raw", 0, "SC-DOOR-01", {
      workflow_runs: [
        { job: "clip_generate", run_id: "gen-mock02", runner: "inline", status: "started" },
      ],
    }),
  ];
}

/** An AI-generated seed clip (no real place, no blur step; product decision 2026-10-24). */
function aiClip(
  id: string,
  status: ClipStatus,
  durationMs: number,
  sceneId: string,
  extra: Partial<Clip>,
): Clip {
  const scene = MOCK_SCENES.find((x) => x.scene_id === sceneId);
  const c = base(id, status, durationMs, {
    origin: "ai_generated",
    scene_id: sceneId,
    batch_id: "batch-2026-10-24",
    tenant_tags: ["JK"],
    city: "Synthetic",
    road_type: scene?.road_type ?? "urban_arterial",
    speed_kmh_est: scene?.speed_kmh_est ?? 30,
    speed_source: "passenger_estimate",
    synthetic_review: null,
    ...extra,
  });
  if (durationMs <= 0) delete c.duration_ms;
  return c;
}

/**
 * Sample generation scenes for mock mode, until `content/nazar/scenes.json` lands (another
 * workstream owns it; its schema is not final). Labelled as samples on the Generate screen.
 */
export const MOCK_SCENES: readonly NazarScene[] = [
  {
    scene_id: "SC-BUS-STOP-01",
    revision: 1,
    title: {
      en: "Bus stop: a person steps out in front of the bus",
      hi: "बस स्टॉप: बस के आगे से एक व्यक्ति निकलता है",
    },
    hazard_type: "bus_stop_pedestrian",
    road_type: "urban_arterial",
    duration_s: 30,
    speed_kmh_est: 30,
  },
  {
    scene_id: "SC-DOOR-01",
    revision: 1,
    title: { en: "Parked car door opens into the lane", hi: "खड़ी कार का दरवाज़ा लेन में खुलता है" },
    hazard_type: "door_opening",
    road_type: "market_street",
    duration_s: 25,
    speed_kmh_est: 25,
  },
  {
    scene_id: "SC-SCHOOL-01",
    revision: 1,
    title: {
      en: "Child near a school gate moves toward the road",
      hi: "स्कूल गेट के पास बच्चा सड़क की ओर बढ़ता है",
    },
    hazard_type: "child_school",
    road_type: "school_zone",
    duration_s: 35,
    speed_kmh_est: 20,
  },
];

// ---------- persistence ----------

let memory: Store | null = null;

function load(): Store {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (parsed.v === 1 && Array.isArray(parsed.clips)) {
        memory = parsed;
        return parsed;
      }
    }
  } catch {
    // private mode or corrupted: start from the seed
  }
  memory = { v: 1, seq: 20, clips: seedClips() };
  return memory;
}

function save(s: Store): void {
  memory = s;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: keep the in-memory copy
  }
}

/** Back to the seed board (mock mode only). */
export function resetMockStore(): void {
  memory = null;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}

export function mockPersona(): MockPersona | null {
  try {
    const p = localStorage.getItem(PERSONA_KEY);
    return MOCK_PERSONAS.find((x) => x.pseudonym === p) ?? null;
  } catch {
    return null;
  }
}

export function setMockPersona(pseudonym: string | null): void {
  try {
    if (pseudonym) localStorage.setItem(PERSONA_KEY, pseudonym);
    else localStorage.removeItem(PERSONA_KEY);
  } catch {
    // ignore
  }
}

export function mockIdentity(): AdminIdentity {
  const p = mockPersona();
  return p
    ? { admin: true, pseudonym: p.pseudonym, roles: [...p.roles], source: "mock" }
    : { admin: false, pseudonym: null, roles: [], source: "mock" };
}

// ---------- the server's view rules ----------

/** What `viewer` may see of a stored clip (NAZAR §6.2: blind until both ratings exist). */
export function viewFor(clip: Clip, viewer: string | null): Clip {
  const all = clip.ratings ?? [];
  const both = all.length >= 2;
  const mine = all.find((r) => r.rater === viewer);
  const { ratings: _r, agreement, proposals, my_rating: _m, ...rest } = clip;
  return {
    ...rest,
    rating_count: all.length,
    ratings_visible: both,
    proposals_visible: both,
    ...(both ? { ratings: all, proposals: proposals ?? [] } : {}),
    ...(both && agreement ? { agreement } : {}),
    ...(mine ? { my_rating: mine } : {}),
  };
}

function need(viewer: MockPersona | null, role: "curator" | "rater"): MockPersona {
  if (!viewer) throw new MockProblem(401, "UNAUTHENTICATED", "Sign in as an admin");
  if (!viewer.roles.includes(role))
    throw new MockProblem(403, "FORBIDDEN", `Needs the ${role} role`);
  return viewer;
}

function find(s: Store, id: string): Clip {
  const c = s.clips.find((x) => x.clip_id === id);
  if (!c) throw new MockProblem(404, "NOT_FOUND", "No such clip");
  return c;
}

function replace(s: Store, clip: Clip): void {
  s.clips = s.clips.map((c) => (c.clip_id === clip.clip_id ? clip : c));
  save(s);
}

const nowIso = () => new Date().toISOString();

// ---------- operations (API-55 in mock mode) ----------

export function listClips(viewer: MockPersona | null, status?: ClipStatus): Clip[] {
  if (!viewer) throw new MockProblem(401, "UNAUTHENTICATED", "Sign in as an admin");
  const s = load();
  return s.clips
    .filter((c) => !status || c.status === status)
    .map((c) => viewFor(c, viewer.pseudonym));
}

export function getClip(viewer: MockPersona | null, id: string): Clip {
  if (!viewer) throw new MockProblem(401, "UNAUTHENTICATED", "Sign in as an admin");
  return viewFor(find(load(), id), viewer.pseudonym);
}

export function registerClip(viewer: MockPersona | null, body: ClipRegister): Clip {
  need(viewer, "curator");
  const s = load();
  const prefix = /^[A-Z]{2,4}$/.test(body.state) ? body.state : "KL";
  s.seq += 1;
  const id = `${prefix}-${String(s.seq).padStart(4, "0")}`;
  const clip = base(id, "raw", body.duration_ms, {
    tenant_tags: [body.state, ...(body.tenant_tags ?? []).filter((t) => t !== body.state)],
    city: body.city,
    road_type: body.road_type,
    time_of_day: body.time_of_day,
    weather: body.weather,
    pov: body.pov,
    captured_month: body.captured_month,
    speed_kmh_est: body.speed_kmh_est,
    speed_source: body.speed_source,
    workflow_runs: [
      {
        job: "clip_ingest",
        run_id: `trn-${id.toLowerCase()}`,
        runner: "inline",
        status: "started",
      },
    ],
  });
  s.clips = [clip, ...s.clips];
  save(s);
  return viewFor(clip, viewer?.pseudonym ?? null);
}

/** Mock only: the ingest workflow (transcode, blur, flash check) finishing, on a placeholder. */
export function simulateIngest(viewer: MockPersona | null, id: string): Clip {
  need(viewer, "curator");
  const s = load();
  const c = find(s, id);
  if (c.status !== "raw" && c.status !== "transcoded")
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Already ingested");
  const duration =
    c.duration_ms ?? 30_000 + (Number.parseInt(mockSha(id).slice(0, 4), 16) % 21) * 1000;
  const ai = c.origin === "ai_generated";
  const next: Clip = {
    ...c,
    // AI clips have no real footage to blur: generation → transcode → review opens.
    status: ai ? "proposed" : "blurred",
    duration_ms: duration,
    media: renditions(id, c.version, 2_400_000),
    flash_check: { passed: true },
    workflow_runs: [
      {
        job: ai ? "clip_generate" : "clip_ingest",
        run_id: c.workflow_runs?.[0]?.run_id ?? "trn-mock",
        runner: "inline",
        status: "succeeded",
      },
    ],
  };
  replace(s, next);
  return viewFor(next, viewer?.pseudonym ?? null);
}

function validateMarks(body: ClipRatingCreate, duration: number): void {
  if (body.decision === "reject" && body.marks.length > 0)
    throw new MockProblem(422, "VALIDATION_FAILED", "A rejection carries no marks");
  for (const m of body.marks) {
    const issues = markIssues(m, duration, (t) => findPii(t).length > 0);
    if (issues.includes("cue_pii"))
      throw new MockProblem(422, "PROHIBITED_FIELD", "A cue contains personal data");
    if (issues.length > 0) throw new MockProblem(422, "VALIDATION_FAILED", "A mark is invalid");
  }
}

export function rateClip(
  viewer: MockPersona | null,
  id: string,
  body: ClipRatingCreate,
): ClipRating {
  const who = need(viewer, "rater");
  const s = load();
  const c = find(s, id);
  if (body.version !== c.version)
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Not the current version");
  if (!["blurred", "audited", "proposed"].includes(c.status))
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", `Not open for rating (${c.status})`);
  const all = c.ratings ?? [];
  if (all.some((r) => r.rater === who.pseudonym))
    throw new MockProblem(409, "RATING_ALREADY_SUBMITTED", "You have already rated this version");
  if (all.length >= 2)
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Two ratings are already stored");
  validateMarks(body, c.duration_ms ?? 0);
  const r: ClipRating = {
    rating_id: `rtg_${mockSha(id + who.pseudonym + Date.now())
      .slice(0, 12)
      .toUpperCase()}`,
    clip_id: c.clip_id,
    version: c.version,
    rater: who.pseudonym,
    decision: body.decision,
    marks: body.marks,
    submitted_at: nowIso(),
  };
  const ratings = [...all, r];
  let next: Clip = { ...c, ratings };
  if (ratings.length === 2) {
    const [a, b] = ratings as [ClipRating, ClipRating];
    const agreement = computeAgreement(c.clip_id, c.version, a, b, nowIso());
    const bothRejected = a.decision === "reject" && b.decision === "reject";
    next = {
      ...next,
      agreement,
      status: bothRejected ? "retired" : agreement.accepted ? "rated" : "adjudication",
      hazards: agreement.accepted
        ? agreement.final_hazards.map(({ cues: _c, ...h }) => ({ ...h, cue_text: null }))
        : [],
    };
  }
  replace(s, next);
  return r;
}

export function recordBlurAudit(
  viewer: MockPersona | null,
  id: string,
  body: ClipBlurAuditCreate,
): Clip {
  const who = need(viewer, "curator");
  const s = load();
  const c = find(s, id);
  if (c.origin === "ai_generated")
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "AI-generated clips skip the blur audit");
  if (["raw", "transcoded", "published", "retired"].includes(c.status))
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", `No rendition to audit (${c.status})`);
  if (body.version !== c.version)
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Not the current version");
  const rendition = c.media?.find((m) => m.res === "480p") ?? c.media?.[0];
  if (!rendition || rendition.sha256 !== body.rendition_sha256)
    throw new MockProblem(422, "VALIDATION_FAILED", "Not the rendition that will be published");
  if (body.frames_total !== framesTotal(c.duration_ms ?? 0))
    throw new MockProblem(422, "VALIDATION_FAILED", "frames_total does not match the duration");
  if (body.misses !== body.miss_frames.length)
    throw new MockProblem(422, "VALIDATION_FAILED", "misses must equal the listed frames");
  const passed = body.frames_checked >= body.frames_total && body.misses === 0;
  let next: Clip = {
    ...c,
    blur_audit: {
      auditor: who.pseudonym,
      rendition_sha256: body.rendition_sha256,
      frames_total: body.frames_total,
      frames_checked: body.frames_checked,
      misses: body.misses,
      audited_at: nowIso(),
      passed,
    },
  };
  if (passed && c.status === "blurred") next = { ...next, status: "proposed" };
  if (!passed && body.misses > 0) {
    // Misses become manual masks; the re-blurred bytes are a new rendition that needs a new audit.
    const sha = mockSha(`${id}@${c.version}:reblur:${Date.now()}`);
    next = {
      ...next,
      status: c.status === "rated" || c.status === "adjudication" ? c.status : "blurred",
      media: [
        ...(c.media ?? []).filter((m) => m.res !== "480p"),
        { res: "480p", bytes: rendition.bytes, sha256: sha },
      ],
    };
  }
  replace(s, next);
  return viewFor(next, who.pseudonym);
}

export function adjudicateClip(
  viewer: MockPersona | null,
  id: string,
  body: ClipAdjudicationCreate,
): Clip {
  const who = need(viewer, "curator");
  const s = load();
  const c = find(s, id);
  if (c.status !== "adjudication" || !c.agreement)
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Only a clip in adjudication");
  if ((c.ratings ?? []).some((r) => r.rater === who.pseudonym))
    throw new MockProblem(403, "ADJUDICATOR_IS_RATER", "The adjudicator must not be a rater");
  const issues = adjudicationIssues(c.agreement, body, c.duration_ms ?? 0);
  if (issues.length > 0)
    throw new MockProblem(422, "VALIDATION_FAILED", "Rule on every cluster", issues.join(", "));
  const hazards = adjudicatedHazards(c.agreement, body);
  const next: Clip = {
    ...c,
    status: "rated",
    hazards,
    adjudication: {
      adjudicator: who.pseudonym,
      decided_at: nowIso(),
      reason_code: body.reason_code,
      resolved: true,
      dropped: body.decisions.filter((d) => d.verdict === "not_hazard").map((d) => d.cluster_id),
      issues: [],
    },
  };
  replace(s, next);
  return viewFor(next, who.pseudonym);
}

export function setCueTexts(
  viewer: MockPersona | null,
  id: string,
  body: ClipCueTextsUpdate,
): Clip {
  const who = need(viewer, "curator");
  const s = load();
  const c = find(s, id);
  if (c.status !== "rated")
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Cue texts are written on a rated clip");
  const hazards = (c.hazards ?? []).map((h) => {
    const cue = body.cues[h.hazard_id];
    if (!cue) return h;
    for (const t of [cue.en, cue.hi]) {
      if (!t.trim() || t.length > 160)
        throw new MockProblem(422, "VALIDATION_FAILED", "Each cue is 1–160 characters");
      if (findPii(t).length > 0)
        throw new MockProblem(422, "PROHIBITED_FIELD", "A cue contains personal data");
    }
    return { ...h, cue_text: { en: cue.en.trim(), hi: cue.hi.trim() } };
  });
  const d = body.difficulty_curator;
  if (d !== undefined && !(Number.isInteger(d) && d >= 1 && d <= 5))
    throw new MockProblem(422, "VALIDATION_FAILED", "Difficulty is 1–5");
  const next: Clip = {
    ...c,
    hazards,
    difficulty: { ...c.difficulty, ...(d !== undefined ? { curator: d } : {}) },
  };
  replace(s, next);
  return viewFor(next, who.pseudonym);
}

export function publishClip(viewer: MockPersona | null, id: string): Clip {
  const who = need(viewer, "curator");
  const s = load();
  const c = find(s, id);
  const view = viewFor(c, who.pseudonym);
  if (!canPublish(view)) {
    const failing = publishChecks(view)
      .filter((x) => !x.ok)
      .map((x) => x.id);
    throw new MockProblem(
      409,
      "CLIP_INVALID_TRANSITION",
      "Publish preconditions not met",
      failing.join(","),
    );
  }
  const next: Clip = {
    ...c,
    status: "published",
    raw_deleted_at: nowIso(),
    workflow_runs: [
      ...(c.workflow_runs ?? []),
      {
        job: "clip_finalize",
        run_id: `trn-fin-${id.toLowerCase()}`,
        runner: "inline",
        status: "succeeded",
      },
    ],
  };
  replace(s, next);
  return viewFor(next, who.pseudonym);
}

/**
 * `POST /v1/admin/clips/generate {sceneId, version, batchId}`: answers like the API (202
 * ClipGenerateAccepted: the clip_generate run). The mock registers the clip at once, so `clip` is
 * present; the real API adds it only once the task has registered the clip.
 */
export function generateClip(viewer: MockPersona | null, body: ClipGenerate): ClipGenerateAccepted {
  need(viewer, "curator");
  const scene = MOCK_SCENES.find((x) => x.scene_id === body.sceneId);
  if (!scene) throw new MockProblem(422, "VALIDATION_FAILED", "Unknown scene");
  if (body.version !== scene.revision)
    throw new MockProblem(422, "VALIDATION_FAILED", "Scene revision mismatch");
  if (!/^[A-Za-z0-9-]{3,40}$/.test(body.batchId))
    throw new MockProblem(422, "VALIDATION_FAILED", "Invalid batch ID");
  const s = load();
  s.seq += 1;
  const id = `AI-${String(s.seq).padStart(4, "0")}`;
  const clip = aiClip(id, "raw", (scene.duration_s ?? 30) * 1000, scene.scene_id, {
    batch_id: body.batchId,
    workflow_runs: [
      {
        job: "clip_generate",
        run_id: `gen-${id.toLowerCase()}`,
        runner: "inline",
        status: "started",
      },
    ],
  });
  s.clips = [clip, ...s.clips];
  save(s);
  const run = clip.workflow_runs?.[0];
  return {
    scene_id: scene.scene_id,
    version: scene.revision,
    batch_id: body.batchId,
    origin: "ai_generated",
    generation_key: `${scene.scene_id}:${scene.revision}:${body.batchId}`,
    workflow_run: run ?? {
      job: "clip_generate",
      run_id: `gen-${id.toLowerCase()}`,
      runner: "inline",
      status: "started",
    },
    clip: viewFor(clip, viewer?.pseudonym ?? null),
  };
}

/** Proposed `POST /v1/admin/clips/{clipId}/synthetic-review` (AI clips only; replaces the blur audit). */
export function recordSyntheticReview(
  viewer: MockPersona | null,
  id: string,
  body: ClipSyntheticReviewCreate,
): Clip {
  const who = need(viewer, "curator");
  const s = load();
  const c = find(s, id);
  if (c.origin !== "ai_generated")
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Filmed clips need the blur audit");
  if (["raw", "transcoded", "published", "retired"].includes(c.status))
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", `Nothing to review (${c.status})`);
  if (body.version !== c.version)
    throw new MockProblem(409, "CLIP_INVALID_TRANSITION", "Not the current version");
  if (body.note && findPii(body.note).length > 0)
    throw new MockProblem(422, "PROHIBITED_FIELD", "The note contains personal data");
  const checks = Object.fromEntries(
    SYNTHETIC_CHECKS.map((k) => [k, body.checks[k] === true]),
  ) as Record<(typeof SYNTHETIC_CHECKS)[number], boolean>;
  const next: Clip = {
    ...c,
    synthetic_review: {
      reviewer: who.pseudonym,
      reviewed_at: nowIso(),
      checks,
      passed: SYNTHETIC_CHECKS.every((k) => checks[k]),
      ...(body.note ? { note: body.note } : {}),
    },
  };
  replace(s, next);
  return viewFor(next, who.pseudonym);
}

export function listScenes(): readonly NazarScene[] {
  return MOCK_SCENES;
}

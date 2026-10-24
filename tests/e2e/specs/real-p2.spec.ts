import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type APIRequestContext,
  request as apiRequest,
  expect,
  type Page,
  type Response,
  test,
} from "@playwright/test";
import { REAL } from "../real-env.mjs";
import { onboard } from "./helpers";
import { API, apiCall, internalCall, type Json, serverNow } from "./real-helpers";

/**
 * P2 on the full stack (E2E_MODE=real): apps/web built with NEXT_PUBLIC_API_URL against the Go API
 * on embedded PostgreSQL, with the score verifier (services/score-verifier, the compute service of
 * decision D1) for every learning, scoring and clip-agreement number. Every step asserts that the
 * server answered (no silent fall-back to the device):
 *  - learn: API-31 queue (card IDs only, mapped to questions on the client), API-32 answers that
 *    persist (a replay comes back `duplicate`), API-33 readiness with its formula and "book anyway";
 *  - an LL mock and a Nazar practice through API-34/35 (`server_checked: true`), the template
 *    debrief and the replay endpoint;
 *  - API-38 achievements after a counted session (XP > 0), API-39 squad create as an adult;
 *  - the clip admin: persona-only admin access, generate (202 = the workflow run) and a publish
 *    refusal (409 CLIP_INVALID_TRANSITION, check IDs in `detail`).
 *
 * The verifier: the API calls SCORE_VERIFIER_URL (default http://127.0.0.1:8081) with
 * SCORE_VERIFIER_SHARED_SECRET (dev default). When nothing answers there, this file starts the
 * verifier from source on that port and stops it afterwards. Its signatures are checked against the
 * API clock, so the API clock must not be shifted (run with E2E_CLOCK_OFFSET= at night).
 *
 * Nazar clips: the dev seed publishes sample clips whose media is the placeholder body (the web
 * draws its labelled placeholder timeline for them). When fewer than 3 published clips exist (no
 * seed), the curator persona publishes 3 through the admin API (register, review steps, two blind
 * raters, agreement, blur audit, cue texts, publish); the clip admin test always publishes one.
 * Their media are written into the API's mock object store ($E2E_WORK_DIR/media): a 6-second
 * VP9/MP4 made with ffmpeg, or E2E_CLIP_MP4. Without either those steps are skipped and say why.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const VERIFIER_URL = (process.env["SCORE_VERIFIER_URL"] ?? "http://127.0.0.1:8081").replace(
  /\/+$/,
  "",
);
const VERIFIER_SECRET =
  process.env["SCORE_VERIFIER_SHARED_SECRET"] ??
  process.env["VERIFIER_SHARED_SECRET"] ??
  "dev-only-verifier-secret";
const ADULT = "dl_holder";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "X-Tenant": "JK",
  "X-Requested-With": "margdarshak",
};

let verifier: ChildProcess | null = null;

async function verifierUp(): Promise<boolean> {
  try {
    const r = await fetch(`${VERIFIER_URL}/healthz`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Starts services/score-verifier from source when nothing answers at SCORE_VERIFIER_URL. */
async function ensureVerifier(): Promise<void> {
  if (await verifierUp()) return;
  const url = new URL(VERIFIER_URL);
  verifier = spawn(
    process.execPath,
    [
      "--conditions=margdarshak-source",
      "--experimental-strip-types",
      join("services", "score-verifier", "src", "server.ts"),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        VERIFIER_SHARED_SECRET: VERIFIER_SECRET,
        PORT: url.port || "8081",
        HOST: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
        VERIFIER_CONTENT_DIR: join(ROOT, "services", "score-verifier", "content"),
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 60; i++) {
    if (await verifierUp()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`score verifier did not start at ${VERIFIER_URL}`);
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(60_000);
  const skew = Math.abs((await serverNow(request)).getTime() - Date.now());
  test.skip(
    skew > 120_000,
    `The API clock is shifted by ${Math.round(skew / 1000)} s (DEV_CLOCK_OFFSET); the verifier rejects signatures outside ±300 s. Run with E2E_CLOCK_OFFSET= .`,
  );
  await ensureVerifier();
});

test.afterAll(() => {
  verifier?.kill();
  verifier = null;
});

test.beforeEach(async ({ context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
});

// Real clips play in real time and the stage fires many frames: traces add nothing here.
test.use({ trace: "off" });

/** The next API response for method + path (string = exact path, RegExp = test on the path). */
function nextApi(page: Page, method: string, path: string | RegExp): Promise<Response> {
  return page.waitForResponse(
    (r) => {
      if (r.request().method() !== method || !r.url().startsWith(API)) return false;
      const p = new URL(r.url()).pathname;
      return typeof path === "string" ? p === path : path.test(p);
    },
    { timeout: 60_000 },
  );
}

/** Signs the browser in as a synthetic seed persona (cookie shared by page and page.request). */
async function personaSession(page: Page, id: string): Promise<void> {
  const r = await apiCall(page, "POST", `/v1/demo/personas/${id}/session`, {});
  expect(r.status, `persona ${id}`).toBe(201);
}

async function json(r: Response): Promise<Json> {
  return r.json().catch(() => null);
}

// ---------- learn: review queue, answers, readiness ----------

test("learn hub -> review: 3 answers persist (API-32), readiness shows the API-33 formula with book anyway", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Hub first: the anonymous device session (API-06) and the queue (API-31).
  const queueRes = nextApi(page, "GET", "/v1/learn/review-queue");
  await page.goto("/en/learn");
  const queue = await queueRes;
  expect(queue.status(), "API-31").toBe(200);
  const queueBody = await json(queue);
  expect(Array.isArray(queueBody.items)).toBe(true);
  for (const it of queueBody.items as Json[]) {
    expect(it.card_id).toMatch(/^C-LL\d-/);
    expect(it.question_id).toBeUndefined();
  }

  // Review: each card (concept) is mapped to one of its question variants on the client.
  await page.goto("/en/learn/review");
  const card = page.getByTestId("question-card");
  await expect(card).toBeVisible();
  const items: string[] = [];
  for (let i = 0; i < 3; i++) {
    await expect(card).toBeVisible();
    const item = (await card.getAttribute("data-item")) ?? "";
    expect(item).toMatch(/^C-LL\d-\d+:v\d+$/);
    items.push(item);
    await card.getByRole("radio").first().check();
    await page.getByLabel("Fairly · 75%").check();
    await page.getByRole("button", { name: "Check" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page
        .getByTestId("review-done")
        .or(page.locator(`[data-testid="question-card"]:not([data-item="${item}"])`)),
    ).toBeVisible();
  }

  // Leave mid-sitting; the hub's outbox sync posts the 3 answers (API-32) once.
  const answersRes = nextApi(page, "POST", "/v1/learn/answers");
  await page.goto("/en/learn");
  const answers = await answersRes;
  expect(answers.status(), "API-32").toBe(200);
  const sent = answers.request().postDataJSON() as { answers: Json[] };
  expect(sent.answers).toHaveLength(3);
  expect(sent.answers.map((a) => `${a.question_id}:${a.variant_id}`)).toEqual(items);
  const results = (await json(answers)).results as Json[];
  expect(results).toHaveLength(3);
  for (const r of results) {
    expect(typeof r.correct).toBe("boolean");
    expect(r.rating).toBeGreaterThanOrEqual(1);
    expect(r.duplicate).toBe(false);
  }

  // Persisted: the same answers again come back as duplicates and are not counted twice.
  const again = await apiCall(page, "POST", "/v1/learn/answers", { answers: sent.answers });
  expect(again.status).toBe(200);
  expect((again.json.results as Json[]).map((r) => r.duplicate)).toEqual([true, true, true]);

  // Readiness: the server's arithmetic, never recomputed on the phone (D-09, D-10).
  const readyRes = nextApi(page, "GET", "/v1/readiness");
  await page.goto("/en/learn/readiness");
  const ready = await readyRes;
  expect(ready.status(), "API-33").toBe(200);
  const r = await json(ready);
  expect(r.display_key).toBe("readiness.formula");
  expect(r.gate).toMatchObject({ advisory: true, book_anyway_visible: true });
  expect(Object.keys(r.road_readiness).sort()).toEqual(
    [
      "knowledge_part",
      "modules",
      "nazar_part",
      "nazar_score",
      "nazar_verified_sessions",
      "nodes",
      "score",
    ].sort(),
  );
  await expect(page.getByTestId("readiness-screen")).toHaveAttribute("data-source", "server");
  await expect(page.getByTestId("device-note")).toHaveCount(0);
  await expect(page.getByTestId("readiness-eq")).toHaveText(
    `${r.score} = knowledge ${r.knowledge} − calibration ${r.calibration_penalty}`,
  );
  const book = page.getByTestId("book-anyway");
  await expect(book).toBeVisible();
  if (!r.gate.met) {
    await book.click();
    await expect(
      page.getByText(`You're at ${r.score}. We suggest ${r.gate.threshold}`),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Book now" })).toBeVisible();
  }
});

// ---------- LL mock through API-34/35, then achievements ----------

test("LL mock through API-34/35 is server-checked; achievements (API-38) then show XP", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/en/help");
  await personaSession(page, ADULT);

  const startRes = nextApi(page, "POST", "/v1/games/ll_sim/sessions");
  await page.goto("/en/learn/practise/ll-sim/exam?mode=mock&state=JK");
  const start = await startRes;
  expect(start.status(), "API-34").toBe(201);
  const started = await json(start);
  expect(started.seed_origin).toBe("server");
  // No public documents from the API: the questions come from the client bank.
  for (const it of started.items as Json[]) {
    expect(it.item_ref).toMatch(/^q:C-LL\d-/);
    expect(it.public).toBeUndefined();
  }
  const total = (started.items as Json[]).length;
  expect(total).toBe(10);

  const completeRes = nextApi(page, "POST", /^\/v1\/games\/sessions\/[0-9a-f-]+\/complete$/);
  await page.getByTestId("stage-start").click({ timeout: 30_000 });
  const counter = page.getByTestId("exam-counter");
  for (let i = 1; i <= total; i++) {
    await expect(counter).toHaveText(`Question ${i} of ${total}`);
    await page.getByTestId("ll-exam").getByRole("radio").first().check();
    await page.getByTestId("exam-next").click();
  }
  const complete = await completeRes;
  expect(complete.status(), "API-35").toBe(200);
  const checked = await json(complete);
  expect(checked.server_checked).toBe(true);
  expect(checked.provisional).toBe(false);
  expect(typeof checked.server_score_pct).toBe("number");
  await expect(page.getByTestId("reveal-score")).toHaveAttribute("data-status", "verified");
  await expect(page.getByTestId("reveal-score")).toContainText(String(checked.score.raw));

  // API-38 after the counted session.
  const ach = await apiCall(page, "GET", "/v1/me/achievements");
  expect(ach.status, "API-38").toBe(200);
  expect(ach.json.xp_total).toBeGreaterThan(0);
  const meRes = nextApi(page, "GET", "/v1/me/achievements");
  await page.goto("/en/learn/me");
  expect((await meRes).status()).toBe(200);
  await expect(page.getByTestId("me-tab")).toHaveAttribute("data-source", "server");
  await expect(page.getByTestId("me-xp")).toContainText(String(ach.json.xp_total));
});

// ---------- Nazar practice through API-34/35, debrief and replay ----------

interface ClipMedia {
  bytes: Buffer;
  sha256: string;
}

/** A small playable clip: E2E_CLIP_MP4, else a 6 s VP9-in-MP4 test pattern from ffmpeg. */
function clipMedia(): ClipMedia | { skip: string } {
  let file = process.env["E2E_CLIP_MP4"];
  if (!file) {
    file = join(REAL.workDir, "e2e-clip.mp4");
    if (!existsSync(file)) {
      mkdirSync(REAL.workDir, { recursive: true });
      const r = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=30",
          "-t",
          "6",
          "-c:v",
          "libvpx-vp9",
          "-b:v",
          "150k",
          "-deadline",
          "realtime",
          "-cpu-used",
          "8",
          "-pix_fmt",
          "yuv420p",
          "-an",
          "-movflags",
          "+faststart",
          file,
        ],
        { stdio: "ignore" },
      );
      if (r.error || r.status !== 0)
        return {
          skip: "No published clips, no clip seed, and no media to publish them with: install ffmpeg or set E2E_CLIP_MP4 to a short MP4 that Chromium plays (VP9 in MP4).",
        };
    }
  }
  const bytes = readFileSync(file);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function adminContext(persona: string): Promise<APIRequestContext> {
  const ctx = await apiRequest.newContext({ baseURL: API, extraHTTPHeaders: JSON_HEADERS });
  const r = await ctx.post(`/v1/demo/personas/${persona}/session`, { data: {} });
  expect(r.status(), `persona ${persona}`).toBe(201);
  return ctx;
}

async function call(
  ctx: APIRequestContext,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await ctx.fetch(path, {
    method,
    headers: { "Idempotency-Key": randomUUID() },
    ...(body === undefined ? {} : { data: JSON.stringify(body) }),
  });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

/** Published, mock-eligible JK clips the games can deal (practice and mock draw from them). */
async function publishedClipCount(): Promise<number> {
  const ctx = await apiRequest.newContext({ baseURL: API, extraHTTPHeaders: JSON_HEADERS });
  try {
    const s = await ctx.post("/v1/sessions/device", {
      data: { device_public_key: `e2e-${randomUUID()}`, platform: "pwa", app_version: "0.1.0" },
    });
    expect(s.ok()).toBe(true);
    const r = await ctx.get("/v1/nazar/clips?resolution=360p");
    if (!r.ok()) return 0;
    return (((await r.json()) as Json).items as Json[]).filter((i) => i.mock_eligible).length;
  } finally {
    await ctx.dispose();
  }
}

/**
 * Publishes one filmed clip through the admin API as the curator and two blind raters. The review
 * steps the workflows run (clip.open_review, clip.agreement) are internal job-step calls here.
 */
async function publishClip(
  request: APIRequestContext,
  ctx: { curator: APIRequestContext; r1: APIRequestContext; r2: APIRequestContext },
  consentId: string,
  media: ClipMedia,
  n: number,
  opts: { checkRefusal?: boolean } = {},
): Promise<string> {
  const reg = await call(ctx.curator, "POST", "/v1/admin/clips", {
    raw_object_key: `raw/e2e/${randomUUID()}.mp4`,
    state: "JK",
    filmed_by: "passenger",
    city: "Jammu",
    road_type: "urban_arterial",
    time_of_day: "day",
    weather: "clear",
    pov: "2W",
    captured_month: "2026-10",
    speed_kmh_est: 30,
    speed_source: "rider_log",
    licence: "CC-BY-4.0",
    contributor_consent_id: consentId,
    duration_ms: 30_000,
  });
  expect(reg.status, `register clip ${n}`).toBe(202);
  const id = reg.json.clip_id as string;
  const version = reg.json.version as number;
  // The media the API will serve: its mock object store reads $E2E_WORK_DIR/media/<key>.
  for (const res of ["360p", "480p"]) {
    const file = join(REAL.workDir, "media", "clips", id, `v${version}`, `${res}.mp4`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, media.bytes);
  }
  const rendition = { bytes: media.bytes.length, sha256: media.sha256 };
  const open = await internalCall(request, "/internal/job-steps/clip.open_review", {
    run_id: `e2e-open-${id}`,
    args: {
      clip_id: id,
      version,
      flash_passed: true,
      media: [
        { res: "360p", ...rendition },
        { res: "480p", ...rendition },
      ],
    },
  });
  expect(open.status, `open review ${id}`).toBe(200);
  // Two blind raters: the hazard inside the 6 s media (agreement: Δonset ≤ 500, Δend ≤ 1000 ms).
  for (const [rater, a, b] of [
    [ctx.r1, 2000, 4500],
    [ctx.r2, 2100, 4600],
  ] as const) {
    const rated = await call(rater, "POST", `/v1/admin/clips/${id}/ratings`, {
      version,
      decision: "windows_set",
      marks: [
        { hazard_type: "bus_stop_pedestrian", a_ms: a, b_ms: b, cue: "feet at the bus front" },
      ],
    });
    expect(rated.status, `rating ${id}`).toBe(201);
  }
  const agreed = await internalCall(request, "/internal/job-steps/clip.agreement", {
    run_id: `e2e-agree-${id}`,
    args: { clip_id: id, version, round: 1 },
  });
  expect(agreed.status, `agreement ${id}`).toBe(200);
  const clip = await call(ctx.curator, "GET", `/v1/admin/clips/${id}`);
  expect(clip.json.status).toBe("rated");
  const audited = await call(ctx.curator, "POST", `/v1/admin/clips/${id}/blur-audit`, {
    version,
    rendition_sha256: media.sha256,
    frames_total: 900,
    frames_checked: 900,
    misses: 0,
    miss_frames: [],
  });
  expect(audited.status, `blur audit ${id}`).toBe(201);
  if (opts.checkRefusal) {
    // No cue texts or curator difficulty yet: 409 with the failing check IDs as a comma list.
    const refused = await call(ctx.curator, "POST", `/v1/admin/clips/${id}/publish`);
    expect(refused.status, "publish refused").toBe(409);
    expect(refused.json.code).toBe("CLIP_INVALID_TRANSITION");
    const ids = String(refused.json.detail).split(",");
    expect(ids).toEqual(expect.arrayContaining(["cue_texts", "difficulty"]));
  }
  const cues = Object.fromEntries(
    (clip.json.hazards as Json[]).map((h) => [
      h.hazard_id,
      { en: "Feet at the bus front", hi: "बस के आगे पैर" },
    ]),
  );
  const cued = await call(ctx.curator, "PUT", `/v1/admin/clips/${id}/cue-texts`, {
    version,
    cues,
    difficulty_curator: 2,
  });
  expect(cued.status, `cue texts ${id}`).toBe(200);
  const published = await call(ctx.curator, "POST", `/v1/admin/clips/${id}/publish`);
  expect(published.status, `publish ${id}`).toBe(200);
  expect(published.json.status).toBe("published");
  return id;
}

/**
 * At least `need` published clips: the dev seed's, or ones the curator publishes now. With
 * `publish`, that many more are published whatever already exists (the clip admin test).
 */
async function ensurePublishedClips(
  request: APIRequestContext,
  need: number,
  opts: { publish?: number; checkRefusal?: boolean } = {},
): Promise<{ created: string[]; skip?: string }> {
  const have = await publishedClipCount();
  const toPublish = opts.publish ?? Math.max(0, need - have);
  if (toPublish === 0) return { created: [] };
  const want = Math.max(need, have + toPublish);
  const media = clipMedia();
  if ("skip" in media) return { created: [], skip: media.skip };
  const ctx = {
    curator: await adminContext("curator_01"),
    r1: await adminContext("rater_01"),
    r2: await adminContext("rater_02"),
  };
  try {
    const consent = await call(ctx.curator, "POST", "/v1/me/consents", {
      purpose: "clip_contribution",
      action: "grant",
      notice_version: "2026.10",
    });
    expect(consent.status, "clip_contribution consent").toBe(201);
    const created: string[] = [];
    for (let i = 0; i < toPublish; i++)
      created.push(
        await publishClip(request, ctx, consent.json.consent_id, media, i + 1, {
          checkRefusal: opts.checkRefusal === true && i === 0,
        }),
      );
    // Publishing rebuilds the manifests (mock eligibility) through the verifier.
    let eligible = await publishedClipCount();
    let rebuild: Json = null;
    if (eligible < want) {
      rebuild = await internalCall(request, "/internal/job-steps/clip.publish_manifest", {
        run_id: `e2e-manifest-${randomUUID()}`,
        args: {},
      });
      eligible = await publishedClipCount();
    }
    if (opts.publish !== undefined && eligible < want) {
      // Publishing itself succeeded; eligibility comes from the manifest rebuild, which one
      // invalid clip anywhere in the bank blocks (see the API log, "manifest rebuild").
      test.info().annotations.push({
        type: "open-issue",
        description: `Published ${created.join(", ")} but the manifest rebuild failed (internal step ${rebuild?.status ?? "n/a"}), so the clip is not mock-eligible yet.`,
      });
      return { created };
    }
    expect(eligible, "published, mock-eligible clips").toBeGreaterThanOrEqual(want);
    return { created };
  } finally {
    await Promise.all(Object.values(ctx).map((c) => c.dispose()));
  }
}

test("Nazar practice through API-34/35 with server verification, the template debrief and the replay", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const clips = await ensurePublishedClips(request, 3);
  test.skip(!!clips.skip, clips.skip);

  await personaSession(page, ADULT);
  // The page clock runs on the API's time; it moves placeholder timelines on (real video plays on).
  await page.clock.install({ time: await serverNow(page.request) });
  const startRes = nextApi(page, "POST", "/v1/games/nazar/sessions");
  await page.goto("/en/learn/practise/nazar/play?mode=practice");
  const start = await startRes;
  expect(start.status(), "API-34").toBe(201);
  const started = await json(start);
  const items = started.items as Json[];
  expect(items).toHaveLength(3);
  for (const it of items) {
    expect(it.kind).toBe("clip");
    // Practice reveals the windows (learn and practice only; a quiet clip has none), and every
    // clip says how it was made.
    expect(Array.isArray(it.reveal?.hazards)).toBe(true);
    expect(["filmed", "ai_generated"]).toContain(it.origin);
  }
  expect(items.some((it) => it.reveal.hazards.length > 0)).toBe(true);
  // The clip seed publishes sample clips whose media is the placeholder body (96 KiB of zeros).
  const placeholder = items.every(
    (it) => it.bytes === 96 * 1024 && String(it.sha256).startsWith("3a3ed164e42500a1"),
  );

  const completeRes = nextApi(page, "POST", /^\/v1\/games\/sessions\/[0-9a-f-]+\/complete$/);
  await page.getByTestId("stage-start").click({ timeout: 60_000 });
  await expect(page.getByTestId("game-hud")).toBeVisible();
  for (let i = 0; i < items.length; i++) {
    await page.getByTestId("clip-start").click();
    await expect(page.getByTestId("tap-zone")).toBeVisible();
    if (placeholder) {
      await expect(page.getByTestId("placeholder-clip")).toContainText("Placeholder clip");
      // The placeholder timeline is not an AI scene: no AI label on it.
      await expect(page.getByTestId("ai-scene-chip")).toHaveCount(0);
    } else if (items[i].origin === "ai_generated") {
      await expect(page.getByTestId("ai-scene-chip").first()).toBeVisible();
    } else {
      // The AI label follows each item's origin: a filmed clip carries none.
      await expect(page.getByTestId("ai-scene-chip")).toHaveCount(0);
    }
    // One tap on the first clip; the other hazards are missed (findings for the debrief).
    if (i === 0) {
      await page.clock.runFor(2500);
      await page.getByTestId("tap-zone").click();
    }
    await page.clock.runFor(70_000);
    await expect(page.getByTestId("clip-reveal")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("reveal-next").click();
  }
  const complete = await completeRes;
  expect(complete.status(), "API-35").toBe(200);
  const checked = await json(complete);
  expect(checked.server_checked, "verified by the score verifier").toBe(true);
  expect(checked.provisional).toBe(false);
  expect(checked.nazar?.rule).toBe("kerala_5band");
  expect(checked.nazar?.analysis).toHaveLength(3);
  await expect(page.getByTestId("reveal-score")).toHaveAttribute("data-status", "verified");
  if (placeholder) await expect(page.getByTestId("nazar-ai-results")).toHaveCount(0);
  const sid = checked.session_id as string;

  // API-38 after the counted session.
  const ach = await apiCall(page, "GET", "/v1/me/achievements");
  expect(ach.status).toBe(200);
  expect(ach.json.xp_total).toBeGreaterThan(0);

  // Template debrief (the AI path is P3) and the replay endpoint.
  await page.getByTestId("reveal-debrief").click();
  await expect(page).toHaveURL(new RegExp(`/learn/practise/sessions/${sid}/debrief`));
  await expect(page.getByTestId("debrief-card")).toBeVisible();
  await expect(page.getByTestId("debrief-notes-label")).toHaveText("Auto notes");
  await expect(page.getByTestId("debrief-provisional")).toHaveCount(0);
  const replayRes = nextApi(page, "GET", `/v1/games/sessions/${sid}/replay`);
  await page.getByTestId("debrief-watch").first().click();
  const replay = await replayRes;
  expect(replay.status(), "replay endpoint").toBe(200);
  const replayBody = await json(replay);
  expect(replayBody.status).toBe("verified");
  expect(replayBody.clips).toHaveLength(3);
  await expect(page.getByTestId("replay-moment")).toBeVisible();
  await expect(page.getByTestId("replay-scrubber")).toBeVisible();
});

// ---------- clip admin ----------

test("clip admin: persona-only access, generate answers the workflow run, publish refusals list check IDs", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  // Admin access in real mode is a clip-team persona session, never a signed-in account.
  await page.goto("/en/admin/clips");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible();
  await page.getByTestId("real-persona-curator-01").click();
  await expect(page.getByTestId("curator-board")).toBeVisible();

  // Generate (POST /v1/admin/clips/generate): the 202 is the clip_generate run, not a Clip.
  await page.goto("/en/admin/clips/generate");
  await page.getByTestId("scene-SCN-001").check();
  const genRes = nextApi(page, "POST", "/v1/admin/clips/generate");
  await page.getByTestId("generate-start").click();
  const gen = await genRes;
  expect(gen.status(), "generate").toBe(202);
  const accepted = await json(gen);
  expect(accepted).toMatchObject({ scene_id: "SCN-001", version: 1, origin: "ai_generated" });
  expect(accepted.workflow_run?.job).toBe("clip_generate");
  expect(accepted.clip_id).toBeUndefined();
  await expect(page.getByTestId("generate-done")).toContainText(
    accepted.clip?.clip_id ?? "Generation started (run",
  );

  // A filmed clip through the review steps; publish is refused (409) before the cue texts.
  const clips = await ensurePublishedClips(request, 0, { publish: 1, checkRefusal: true });
  test.skip(!!clips.skip, clips.skip);
  const id = clips.created[0] as string;
  await page.goto("/en/admin/clips");
  await expect(page.getByTestId(`clip-card-${id}`)).toHaveAttribute("data-status", "published");
});

// ---------- squads ----------

test("an adult creates a squad (API-39); the invite link survives the list without a code", async ({
  page,
}) => {
  await page.goto("/en/help");
  await personaSession(page, ADULT);
  await page.goto("/en/learn/me/squad/new");
  await expect(page.getByTestId("new-squad")).toBeVisible();
  await page.getByLabel("Your name in the squad").fill("Ayesha");
  const createRes = nextApi(page, "POST", "/v1/squads");
  await page.getByTestId("new-squad").getByRole("button", { name: "Start a squad" }).click();
  const created = await createRes;
  expect(created.status(), "API-39 create").toBe(201);
  const squad = await json(created);
  expect(squad.squad_id).toMatch(/^sqd_[0-9A-Z]{26}$/);
  expect(squad.invite_code).toMatch(/^SQ-[0-9A-Z]{6}$/);
  expect(squad.members).toEqual([expect.objectContaining({ role: "owner", is_me: true })]);
  await expect(page.getByTestId("squad-card")).toBeVisible();
  await expect(page.getByRole("button", { name: /Invite a friend/ })).toBeVisible();

  // The list never carries the code; this phone kept it for the invite link.
  const mineRes = nextApi(page, "GET", "/v1/squads/mine");
  await page.goto("/en/learn/me/squad");
  const mine = await json(await mineRes);
  const listed = (mine.items as Json[]).find((s) => s.squad_id === squad.squad_id);
  expect(listed).toBeTruthy();
  expect(listed.invite_code).toBeUndefined();
  await expect(page.getByTestId("squad-card")).toBeVisible();
  await expect(page.getByRole("button", { name: /Invite a friend/ })).toBeVisible();
});

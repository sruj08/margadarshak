// clip_finalize (RW-1) with the fake defineTask, a fake Go API and an in-memory object store.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { CLIP_FINALIZE_STEPS, type Clip, TASK_LIMITS } from "@margdarshak/clip-pipeline";
import { TASK_CLIP_FINALIZE } from "../src/tasks/clip-finalize.ts";
import { stagedKey } from "../src/tasks/clip-media.ts";
import { defineTasks } from "../src/tasks/index.ts";
import { MemoryObjectStore } from "./clip-fakes.ts";
import { type Attempt, fakeClipApi, retryingCtx, type StepReply } from "./clip-harness.ts";
import type { Call } from "./helpers.ts";
import { ENV, fakeCtx, fakeSdk } from "./helpers.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const STAGED = { "360p": enc("blurred 360p bytes"), "480p": enc("blurred 480p bytes") };

/** NAZAR §3.2 example clip (clip-pipeline test helpers), published, media hashes = staged bytes. */
function publishedClip(over: Partial<Clip> = {}): Clip {
  return {
    clipId: "JMU-0012",
    version: 3,
    status: "published",
    tenantTags: ["JK"],
    city: "Jammu",
    roadType: "urban_arterial",
    timeOfDay: "day",
    weather: "clear",
    pov: "2W",
    capturedMonth: "2026-10",
    speedKmhEst: 40,
    speedSource: "rider_log",
    durationMs: 38000,
    hazards: [
      {
        hazardId: "h1",
        hazardType: "bus_stop_pedestrian",
        window: { aMs: 12400, bMs: 16900 },
        raterCount: 2,
        deltaOnsetMs: 300,
        deltaEndMs: 600,
        adjudicated: false,
        occlusion: true,
        cueText: {
          en: "Feet visible at the bus's front edge",
          hi: "बस के आगे वाले किनारे पर पैर दिख रहे हैं",
        },
      },
    ],
    quietSegments: [{ fromMs: 0, toMs: 9000 }],
    difficulty: { curator: 3, empirical: null, irt: null, nTakers: 0 },
    modules: ["M18", "M5"],
    licence: "CC-BY-4.0",
    attribution: "Margdarshak clip bank, team Chanakya (Nestiq Private Limited), 2026",
    blurAudit: {
      auditor: "rater-07",
      framesChecked: 1140,
      misses: 0,
      auditedAt: "2026-10-23T09:12:00Z",
    },
    media: [
      { res: "360p", bytes: STAGED["360p"].byteLength, sha256: sha(STAGED["360p"]) },
      { res: "480p", bytes: STAGED["480p"].byteLength, sha256: sha(STAGED["480p"]) },
    ],
    ...over,
  };
}

interface Opts {
  accepted?: boolean;
  passes?: boolean;
  clips?: Clip[];
  deleteRaw?: StepReply;
  difficulty?: StepReply;
  env?: Record<string, string>;
  cdnStatus?: number;
  tamper?: boolean;
}

function setup(o: Opts = {}) {
  const api = fakeClipApi({
    "clip.agreement": () => ({ status: 200, body: { accepted: o.accepted ?? true } }),
    "clip.request_adjudication": () => ({ status: 200, body: { status: "adjudication" } }),
    "clip.blur_audit_check": () => ({ status: 200, body: { passes: o.passes ?? true } }),
    "clip.delete_raw": () => o.deleteRaw ?? { status: 200, body: { deleted: 3 } },
    "clip.publish_manifest": (c: Call) =>
      c.json!.args["stage"] === "prepare"
        ? {
            status: 200,
            body: {
              clips: o.clips ?? [publishedClip()],
              mock_eligible: { "JMU-0012": true },
              manifest_version: 7,
              generated_at: "2026-10-24T10:00:00Z",
            },
          }
        : { status: 200, body: { recorded: true } },
    "clip.recompute_difficulty": () =>
      o.difficulty ?? { status: 200, body: { difficulty: { curator: 3 } } },
  });
  const cdn: string[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    if (url.startsWith("https://media.example.org/")) {
      cdn.push(url);
      assert.equal((init.headers as Record<string, string>)["Range"], "bytes=0-0");
      return new Response("x", { status: o.cdnStatus ?? 206 });
    }
    return api.fetch(url, init);
  };
  const store = new MemoryObjectStore();
  void store.put(
    "ingest",
    stagedKey("JMU-0012", 3, "360p.mp4"),
    o.tamper ? enc("unblurred!") : STAGED["360p"],
    "video/mp4",
  );
  void store.put("ingest", stagedKey("JMU-0012", 3, "480p.mp4"), STAGED["480p"], "video/mp4");
  void store.put("ingest", stagedKey("JMU-0012", 3, "poster.jpg"), enc("poster"), "image/jpeg");
  const sdk = fakeSdk();
  const tasks = defineTasks(sdk.define, {
    env: { ...ENV, MEDIA_PUBLIC_BASE_URL: "https://media.example.org", ...o.env },
    fetch,
    sleep: async () => {},
    log: () => {},
    store: () => store,
  });
  return { api, store, sdk, tasks, cdn };
}

const JOB = { clip_id: "JMU-0012", version: 3 };

describe("clip_finalize registration", () => {
  it("registers the parent with TASK_LIMITS and one subtask per CLIP_FINALIZE_STEPS entry", () => {
    const { sdk } = setup();
    assert.deepEqual(sdk.registered.get(TASK_CLIP_FINALIZE), {
      name: "clip_finalize",
      retry: TASK_LIMITS.clip_finalize.retry,
      timeoutSeconds: TASK_LIMITS.clip_finalize.timeoutSeconds,
    });
    for (const s of CLIP_FINALIZE_STEPS) {
      assert.deepEqual(
        sdk.registered.get(`clip_finalize_${s.id}`),
        { name: `clip_finalize_${s.id}`, retry: s.retry, timeoutSeconds: s.timeoutSeconds },
        s.id,
      );
    }
  });
});

describe("clip_finalize (RW-1)", () => {
  it("agreement → audit → delete_raw → publish_manifest → cdn_warm → recompute_difficulty", async () => {
    const { api, store, sdk, tasks, cdn } = setup();
    const attempts: Attempt[] = [];
    const out = await tasks.clipFinalize.func(retryingCtx(sdk.registered, attempts), JOB);
    assert.equal(out.outcome, "published");
    assert.deepEqual(
      attempts.map((a) => a.name),
      CLIP_FINALIZE_STEPS.map((s) => `clip_finalize_${s.id}`),
    );
    assert.deepEqual(api.names(), [
      "clip.agreement",
      "clip.blur_audit_check",
      "clip.delete_raw",
      "clip.publish_manifest",
      "clip.publish_manifest",
      "clip.recompute_difficulty",
    ]);
    assert.deepEqual(api.keys(), [
      "JMU-0012:agreement:3:r1",
      "JMU-0012:blur_audit_check:3:r1",
      "JMU-0012:delete_raw:3:r1",
      "JMU-0012:publish_manifest:3:r1:prepare",
      "JMU-0012:publish_manifest:3:r1:commit",
      "JMU-0012:recompute_difficulty:3:r1",
    ]);
    // audited renditions and poster promoted to the public keys, byte for byte
    assert.deepEqual(
      [...(await store.get("clips", "clips/JMU-0012/v3/360p.mp4"))!],
      [...STAGED["360p"]],
    );
    assert.ok(store.has("clips", "clips/JMU-0012/v3/480p.mp4"));
    assert.ok(store.has("clips", "clips/JMU-0012/v3/poster.jpg"));
    // bank manifest (final windows) private; client manifest (no windows) public, then latest.json
    const bank = JSON.parse(store.text("ingest", "manifests/bank/v7.json")!) as {
      clips: { hazards?: unknown[] }[];
    };
    assert.ok(bank.clips[0]!.hazards!.length > 0);
    assert.equal(store.has("clips", "manifests/bank/v7.json"), false);
    const clientText = store.text("clips", "manifests/client/v7.json")!;
    assert.doesNotMatch(clientText, /aMs|bMs|hazardType|window/);
    assert.match(clientText, /https:\/\/media\.example\.org\/clips\/JMU-0012\/v3\/360p\.mp4/);
    const latest = JSON.parse(store.text("clips", "manifests/client/latest.json")!) as {
      version: string;
      key: string;
    };
    assert.deepEqual(
      { version: latest.version, key: latest.key },
      { version: "7", key: "manifests/client/v7.json" },
    );
    assert.ok(
      store.puts.indexOf("clips:manifests/client/latest.json") >
        store.puts.indexOf("clips:manifests/client/v7.json"),
      "pointer moves last",
    );
    const commit = api.args("clip.publish_manifest")[1]!;
    assert.equal(commit["stage"], "commit");
    assert.equal(commit["manifest_version"], "7");
    // cdn warm hit every public URL
    assert.deepEqual(cdn.sort(), [
      "https://media.example.org/clips/JMU-0012/v3/360p.mp4",
      "https://media.example.org/clips/JMU-0012/v3/480p.mp4",
      "https://media.example.org/clips/JMU-0012/v3/poster.jpg",
      "https://media.example.org/manifests/client/v7.json",
    ]);
    assert.deepEqual(out.cdn_warm?.result, { skipped: false, urls: 4, ok: 4 });
  });

  it("requests adjudication and stops when the raters do not agree (round in every key)", async () => {
    const { api, store, sdk, tasks } = setup({ accepted: false });
    const out = await tasks.clipFinalize.func(retryingCtx(sdk.registered), { ...JOB, round: 2 });
    assert.equal(out.outcome, "adjudication");
    assert.deepEqual(api.names(), ["clip.agreement", "clip.request_adjudication"]);
    assert.deepEqual(api.keys(), ["JMU-0012:agreement:3:r2", "JMU-0012:request_adjudication:3:r2"]);
    assert.equal(store.puts.filter((p) => p.startsWith("clips:")).length, 0);
  });

  it("stops before anything is public when the blur audit fails", async () => {
    const { api, store, sdk, tasks } = setup({ passes: false });
    const out = await tasks.clipFinalize.func(retryingCtx(sdk.registered), JOB);
    assert.equal(out.outcome, "reblur");
    assert.deepEqual(api.names(), ["clip.agreement", "clip.blur_audit_check"]);
    assert.equal(store.puts.filter((p) => p.startsWith("clips:")).length, 0);
  });

  it("refuses to publish a staged file whose sha256 differs from the audited one", async () => {
    const { store, sdk, tasks } = setup({ tamper: true });
    await assert.rejects(
      tasks.clipFinalize.func(retryingCtx(sdk.registered), JOB),
      /does not match the audited sha256/,
    );
    assert.equal(store.has("clips", "clips/JMU-0012/v3/360p.mp4"), false);
    assert.equal(store.has("clips", "manifests/client/latest.json"), false);
  });

  it("refuses a prepare answer that does not mark this clip published", async () => {
    const { sdk, tasks } = setup({ clips: [publishedClip({ status: "rated", blurAudit: null })] });
    await assert.rejects(tasks.clipFinalize.func(retryingCtx(sdk.registered), JOB), /as published/);
  });

  it("does not fail the run when delete_raw, cdn_warm or recompute_difficulty fail", async () => {
    const { sdk, tasks } = setup({
      deleteRaw: { status: 422, body: { title: "x" } },
      difficulty: { status: 422, body: { title: "y" } },
      cdnStatus: 500,
    });
    const out = await tasks.clipFinalize.func(retryingCtx(sdk.registered), JOB);
    assert.equal(out.outcome, "published");
    assert.equal(out.delete_raw?.ok, false);
    assert.equal(out.recompute_difficulty?.ok, false);
    assert.equal(out.cdn_warm?.ok, false);
    assert.match(out.cdn_warm!.error!, /did not answer 200\/206/);
  });

  it("skips cdn_warm without MEDIA_PUBLIC_BASE_URL and keeps relative media keys in the manifest", async () => {
    const { store, sdk, tasks, cdn } = setup({ env: { MEDIA_PUBLIC_BASE_URL: "" } });
    const out = await tasks.clipFinalize.func(retryingCtx(sdk.registered), JOB);
    assert.deepEqual(out.cdn_warm?.result, { skipped: true, urls: 0, ok: 0 });
    assert.equal(cdn.length, 0);
    assert.match(
      store.text("clips", "manifests/client/v7.json")!,
      /"clips\/JMU-0012\/v3\/360p\.mp4"/,
    );
  });

  it("fails fast without R2 or with a bad job", async () => {
    const sdk = fakeSdk();
    const api = fakeClipApi({
      "clip.agreement": () => ({ status: 200, body: { accepted: true } }),
      "clip.blur_audit_check": () => ({ status: 200, body: { passes: true } }),
      "clip.delete_raw": () => ({ status: 200, body: {} }),
      "clip.publish_manifest": () => ({ status: 200, body: { clips: [publishedClip()] } }),
    });
    const tasks = defineTasks(sdk.define, { env: ENV, fetch: api.fetch, log: () => {} });
    await assert.rejects(
      tasks.clipFinalize.func(retryingCtx(sdk.registered), JOB),
      /R2 is not configured/,
    );
    await assert.rejects(
      tasks.clipFinalize.func(fakeCtx(), { clip_id: "JMU-0012" }),
      /bad version/,
    );
  });
});

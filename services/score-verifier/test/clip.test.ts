// routes/clip.ts over real HTTP: the clip-pipeline agreement golden cases, adjudication, final
// windows, scoring clips, and manifests (a client manifest never carries hazard windows).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { NazarClip } from "@margdarshak/game-core/schema";
import { ClipManifestsResponse } from "../src/routes/clip.ts";
import { call, NOW_MS, post, type Reply, type Running, startVerifier } from "./helpers.ts";

const problem = (r: Reply, status: number, slug: string): void => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.match(r.type, /^application\/problem\+json/);
  assert.equal(r.body["type"], `https://margdarshak.example/problems/${slug}`);
};

type Mark = { hazardType: string; aMs: number; bMs: number };
const rating = (rater: string, marks: Mark[], clipId = "JMU-0012", version = 3) => ({
  rater,
  clipId,
  version,
  marks,
  submittedAt: "2026-10-23T10:00:00Z",
});

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The NAZAR §3.2 example clip (as clip-pipeline's tests build it): valid and published. */
function publishedClip(over: Record<string, unknown> = {}) {
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
      { res: "360p", bytes: 1840000, sha256: sha("JMU-0012@3/360p") },
      { res: "480p", bytes: 2900000, sha256: sha("JMU-0012@3/480p") },
    ],
    ...over,
  };
}

const golden = JSON.parse(
  readFileSync(
    new URL("../../../packages/clip-pipeline/test/fixtures/agreement-golden.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    raterA: Mark[];
    raterB: Mark[];
    expected: {
      accepted: boolean;
      reasons: string[];
      pairs: { deltaOnsetMs: number; deltaEndMs: number }[];
      onlyA: number;
      onlyB: number;
      finalHazards: { hazardId: string; hazardType: string; aMs: number; bMs: number }[];
    };
  }[];
};

/** Every key path in a JSON value. */
function allKeys(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((e, i) => allKeys(e, `${prefix}[${i}]`));
  if (v !== null && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      `${prefix}.${k}`,
      ...allKeys(x, `${prefix}.${k}`),
    ]);
  }
  return [];
}

describe("clip routes over HTTP", () => {
  let v: Running;
  before(async () => {
    v = await startVerifier();
  });
  after(async () => {
    await v.close();
  });

  it("both routes are HMAC-signed and strict (400 on an unknown field)", async () => {
    for (const path of ["/clip/agreement", "/clip/manifests"]) {
      const r = await post(v.url, JSON.stringify({ now: NOW_MS }), { path, header: null });
      problem(r, 401, "unauthorized");
    }
    const extra = await call(v.url, "/clip/agreement", {
      op: "agreement",
      now: NOW_MS,
      raterA: rating("rater-01", []),
      raterB: rating("rater-02", []),
      gps: "x",
    });
    problem(extra, 400, "validation-failed");
    const noOp = await call(v.url, "/clip/agreement", { now: NOW_MS });
    problem(noOp, 400, "validation-failed");
    const extraM = await call(v.url, "/clip/manifests", { now: NOW_MS, clips: [], admin: true });
    problem(extraM, 400, "validation-failed");
  });

  for (const c of golden.cases) {
    it(`agreement golden: ${c.name}`, async () => {
      const r = await call(v.url, "/clip/agreement", {
        op: "agreement",
        now: NOW_MS,
        raterA: rating("rater-01", c.raterA),
        raterB: rating("rater-02", c.raterB),
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const g = r.body["agreement"] as {
        accepted: boolean;
        needsThirdRater: boolean;
        reasons: string[];
        pairs: { deltaOnsetMs: number; deltaEndMs: number }[];
        onlyA: unknown[];
        onlyB: unknown[];
        finalHazards: {
          hazardId: string;
          hazardType: string;
          window: { aMs: number; bMs: number };
        }[];
      };
      assert.equal(g.accepted, c.expected.accepted);
      assert.equal(g.needsThirdRater, !c.expected.accepted);
      assert.deepEqual(g.reasons, c.expected.reasons);
      assert.deepEqual(
        g.pairs.map((p) => ({ deltaOnsetMs: p.deltaOnsetMs, deltaEndMs: p.deltaEndMs })),
        c.expected.pairs,
      );
      assert.equal(g.onlyA.length, c.expected.onlyA);
      assert.equal(g.onlyB.length, c.expected.onlyB);
      assert.deepEqual(
        g.finalHazards.map((h) => ({
          hazardId: h.hazardId,
          hazardType: h.hazardType,
          aMs: h.window.aMs,
          bMs: h.window.bMs,
        })),
        c.expected.finalHazards,
      );
    });
  }

  it("ratings for different clips or from one rater are a 422", async () => {
    const other = await call(v.url, "/clip/agreement", {
      op: "agreement",
      now: NOW_MS,
      raterA: rating("rater-01", []),
      raterB: rating("rater-02", [], "JMU-0013"),
    });
    problem(other, 422, "invalid-ratings");
    const same = await call(v.url, "/clip/agreement", {
      op: "agreement",
      now: NOW_MS,
      raterA: rating("rater-01", []),
      raterB: rating("rater-01", []),
    });
    problem(same, 422, "invalid-ratings");
  });

  it("adjudicate: a third person resolves an onset disagreement with the median", async () => {
    const body = {
      op: "adjudicate",
      now: NOW_MS,
      raterA: rating("rater-01", [{ hazardType: "bus_stop_pedestrian", aMs: 12000, bMs: 16500 }]),
      raterB: rating("rater-02", [{ hazardType: "bus_stop_pedestrian", aMs: 12600, bMs: 16500 }]),
      adjudication: {
        adjudicator: "rater-03",
        decidedAt: "2026-10-23T11:00:00Z",
        reasonCode: "window_resolved",
        decisions: [
          {
            clusterId: "c1",
            verdict: "hazard",
            mark: { hazardType: "bus_stop_pedestrian", aMs: 12300, bMs: 16500 },
          },
        ],
      },
    };
    const r = await call(v.url, "/clip/agreement", body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const adj = r.body["adjudication"] as {
      resolved: boolean;
      hazards: { window: { aMs: number }; raterCount: number; adjudicated: boolean }[];
    };
    assert.equal((r.body["agreement"] as { accepted: boolean }).accepted, false);
    assert.equal(adj.resolved, true);
    assert.deepEqual(
      [adj.hazards[0]?.window.aMs, adj.hazards[0]?.raterCount, adj.hazards[0]?.adjudicated],
      [12300, 3, true],
    );
    const selfAdjudged = await call(v.url, "/clip/agreement", {
      ...body,
      adjudication: { ...body.adjudication, adjudicator: "rater-01" },
    });
    problem(selfAdjudged, 422, "invalid-adjudication");
  });

  it("final_window: mean of two, median of three, frame-snapped", async () => {
    const two = await call(v.url, "/clip/agreement", {
      op: "final_window",
      now: NOW_MS,
      marks: [
        { aMs: 12000, bMs: 16500 },
        { aMs: 12500, bMs: 17000 },
      ],
    });
    assert.deepEqual(two.body, { op: "final_window", window: { aMs: 12267, bMs: 16767 } });
    const one = await call(v.url, "/clip/agreement", {
      op: "final_window",
      now: NOW_MS,
      marks: [{ aMs: 1, bMs: 2 }],
    });
    problem(one, 400, "validation-failed");
  });

  it("scoring_clip: a published clip becomes a game-core NazarClip", async () => {
    const r = await call(v.url, "/clip/agreement", {
      op: "scoring_clip",
      now: NOW_MS,
      clip: publishedClip(),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const sc = r.body["scoringClip"];
    assert.ok(NazarClip.safeParse(sc).success, "usable as inline /verify content");
    const noSpeed = await call(v.url, "/clip/agreement", {
      op: "scoring_clip",
      now: NOW_MS,
      clip: publishedClip({ speedKmhEst: null, speedSource: "not_logged" }),
    });
    problem(noSpeed, 422, "not-scorable");
  });

  it("manifests: the client manifest never contains windows; the bank one does", async () => {
    const r = await call(v.url, "/clip/manifests", {
      now: NOW_MS,
      clips: [
        publishedClip(),
        publishedClip({ clipId: "JMU-0020", version: 1, status: "retired" }),
      ],
      flashPassed: { "JMU-0012@3": true },
      mediaBaseUrl: "https://media.example/",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = ClipManifestsResponse.parse(r.body);
    assert.equal(m.generatedAt, new Date(NOW_MS).toISOString(), "time from Go's now");
    const client = m.client as NonNullable<typeof m.client>;
    assert.equal(client.clips.length, 1, "retired clips are not served");
    const keys = allKeys(client).map((k) => k.toLowerCase());
    for (const banned of ["window", "hazard", "ams", "bms", "quiet", "cue", "speed"]) {
      assert.ok(!keys.some((k) => k.includes(banned)), `client manifest leaks ${banned}`);
    }
    assert.equal(client.clips[0]?.mockEligible, true);
    assert.equal(
      client.clips[0]?.media[0]?.url,
      "https://media.example/clips/JMU-0012/v3/360p.mp4",
    );
    const bank = m.bank as NonNullable<typeof m.bank>;
    assert.deepEqual(bank.counts, { published: 1, retired: 1 });
    assert.ok(
      allKeys(bank).some((k) => k.endsWith(".window")),
      "bank keeps final windows",
    );
    assert.ok(!JSON.stringify(bank).includes("rater-07"), "no rater pseudonyms in the bank");
    assert.deepEqual(m.mockEligibility["JMU-0012@3"], { eligible: true, reasons: [] });
    assert.equal(m.mockEligibility["JMU-0020@1"]?.eligible, false);

    const noFlash = await call(v.url, "/clip/manifests", {
      now: NOW_MS,
      clips: [publishedClip()],
      include: ["client"],
    });
    const nf = ClipManifestsResponse.parse(noFlash.body);
    assert.equal(nf.bank, null);
    assert.equal(nf.client?.clips[0]?.mockEligible, false, "no flash result → not mock-eligible");
    assert.ok(nf.mockEligibility["JMU-0012@3"]?.reasons.includes("failed the flash check"));
  });

  it("manifests: an unpublishable published clip is a 422", async () => {
    const r = await call(v.url, "/clip/manifests", {
      now: NOW_MS,
      clips: [
        publishedClip({
          blurAudit: {
            auditor: "rater-07",
            framesChecked: 10,
            misses: 0,
            auditedAt: "2026-10-23T09:12:00Z",
          },
        }),
      ],
    });
    problem(r, 422, "not-publishable");
  });

  it("manifests: an AI-generated clip is labelled for clients and carries its record in the bank", async () => {
    const ai = publishedClip({
      clipId: "AIG-0004",
      version: 1,
      speedSource: "scene_spec",
      blurAudit: null,
      origin: "ai_generated",
      generation: {
        model: "gemini-omni-1.1-flash",
        sceneId: "SCN-001",
        promptVersion: "1.0.0",
        seedOrBatchId: "b20261024a",
        generatedAt: "2026-10",
        durationMs: 38000,
        extensions: 3,
        synthId: true,
        disclosure: "ai_generated",
      },
      syntheticReview: {
        reviewer: "curator-02",
        checkedAt: "2026-10-24T08:00:00Z",
        noRealPersonLikeness: true,
        noReadablePlates: true,
        noRealBrands: true,
        noCollisionOrInjury: true,
        hazardVisible: true,
      },
    });
    const r = await call(v.url, "/clip/manifests", {
      now: NOW_MS,
      clips: [ai],
      flashPassed: { "AIG-0004@1": true },
      mediaBaseUrl: "https://media.example/",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = ClipManifestsResponse.parse(r.body);
    assert.equal(m.client?.clips[0]?.origin, "ai_generated");
    const bankEntry = m.bank?.clips[0] as Record<string, unknown>;
    assert.equal(bankEntry["origin"], "ai_generated");
    assert.equal(bankEntry["blurAudit"], null);
    assert.ok(!JSON.stringify(m.bank).includes("curator-02"), "no reviewer pseudonym in the bank");
  });
});

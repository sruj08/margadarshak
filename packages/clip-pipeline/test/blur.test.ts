import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BlurAuditRecord,
  blurAuditIssues,
  blurAuditPasses,
  buildBlurArgv,
  buildBlurFilterGraph,
  checkRawDeletion,
  type Detection,
  frameRangeSeconds,
  MAX_INLINE_GRAPH_CHARS,
  manualMask,
  planBlurRegions,
  type RawDeletionRecord,
  rawDeletionDeadline,
  toClipBlurAudit,
} from "../src/blur.ts";

const HD = { width: 1920, height: 1080 };
const face = (from: number, to = from, x = 0.5, y = 0.3, score = 0.9): Detection => ({
  cls: "face",
  score,
  box: { x, y, w: 0.05, h: 0.1 },
  fromFrame: from,
  toFrame: to,
});

describe("planBlurRegions", () => {
  it("pads faces 30% per side, snaps outward to even pixels and dilates ±3 frames", () => {
    const [r] = planBlurRegions([face(10)], HD);
    // x: (0.5 − 0.015) × 1920 = 931.2 → 930; x1: (0.55 + 0.015) × 1920 = 1084.8 → 1086
    // y: (0.3 − 0.03) × 1080 = 291.6 → 290; y1: (0.4 + 0.03) × 1080 = 464.4 → 466
    assert.deepEqual(r, {
      cls: "face",
      fromFrame: 7,
      toFrame: 13,
      x: 930,
      y: 290,
      w: 156,
      h: 176,
      sigma: 30,
    });
  });

  it("pads plates 20% and clamps to the frame edge and the first frame", () => {
    const [r] = planBlurRegions(
      [
        {
          cls: "plate",
          score: 0.5,
          box: { x: 0.95, y: 0.9, w: 0.05, h: 0.1 },
          fromFrame: 1,
          toFrame: 1,
        },
      ],
      HD,
    );
    assert.ok(r);
    assert.equal(r.fromFrame, 0);
    assert.equal(r.x + r.w, 1920);
    assert.equal(r.y + r.h, 1080);
    assert.ok(r.sigma >= 8);
  });

  it("drops detections under the class threshold, keeps manual masks", () => {
    assert.equal(planBlurRegions([face(1, 1, 0.5, 0.3, 0.49)], HD).length, 0);
    assert.equal(
      planBlurRegions(
        [
          {
            cls: "plate",
            score: 0.3,
            box: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 },
            fromFrame: 0,
            toFrame: 0,
          },
        ],
        HD,
      ).length,
      0,
    );
    assert.equal(
      planBlurRegions([manualMask({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, 0, 30)], HD).length,
      1,
    );
  });

  it("bridges gaps of up to 5 missed frames, not 6", () => {
    assert.equal(planBlurRegions([face(10), face(16)], HD).length, 1, "gap of 5 frames (11..15)");
    assert.equal(planBlurRegions([face(10), face(17)], HD).length, 2, "gap of 6 frames");
  });

  it("splits long tracks into ≤ 15-frame segments that still overlap after dilation", () => {
    const track = Array.from({ length: 40 }, (_, i) => face(i, i, 0.3 + i * 0.002));
    const regions = planBlurRegions(track, HD, { totalFrames: 40 });
    assert.equal(regions.length, 3);
    for (let k = 1; k < regions.length; k++) {
      assert.ok(
        (regions[k]?.fromFrame ?? 0) <= (regions[k - 1]?.toFrame ?? 0),
        "segments overlap in time",
      );
    }
    assert.equal(regions.at(-1)?.toFrame, 39, "clamped to the last frame");
  });

  it("does not merge separate faces or different classes", () => {
    const far = planBlurRegions([face(5, 5, 0.1), face(5, 5, 0.8)], HD);
    assert.equal(far.length, 2);
    const mixed = planBlurRegions([face(5), { ...face(5), cls: "plate", score: 0.9 }], HD);
    assert.equal(mixed.length, 2);
  });

  it("is independent of detection order", () => {
    const ds = [
      face(3),
      face(20, 22, 0.1),
      face(5, 6),
      { ...face(40), cls: "plate" as const },
      face(8),
    ];
    assert.deepEqual(planBlurRegions(ds, HD), planBlurRegions([...ds].reverse(), HD));
  });

  it("throws on invalid detections and frame sizes", () => {
    assert.throws(
      () => planBlurRegions([{ ...face(1), box: { x: 0.9, y: 0.1, w: 0.2, h: 0.1 } }], HD),
      /invalid/,
    );
    assert.throws(() => planBlurRegions([{ ...face(5), toFrame: 4 }], HD), /invalid/);
    assert.throws(() => planBlurRegions([], { width: 0, height: 10 }), /frame size/);
  });
});

describe("blur filter graph and argv", () => {
  it("pads the enable window by half a frame", () => {
    assert.deepEqual(frameRangeSeconds(0, 0), ["0.0000", "0.0167"]);
    assert.deepEqual(frameRangeSeconds(30, 59), ["0.9833", "1.9833"]);
  });

  it("builds one crop/blur/overlay stage per region (snapshot)", () => {
    const regions = planBlurRegions([face(10)], HD);
    const { graph, outLabels } = buildBlurFilterGraph(regions, [
      { res: "360p", path: "a.mp4" },
      { res: "480p", path: "b.mp4" },
    ]);
    assert.equal(
      graph,
      "[0:v:0]fps=30[v0];" +
        "[v0]split[v0m][v0c];" +
        "[v0c]crop=156:176:930:290,gblur=sigma=30:steps=3:enable='between(t,0.2167,0.4500)'[r0];" +
        "[v0m][r0]overlay=930:290:enable='between(t,0.2167,0.4500)'[v1];" +
        "[v1]split=2[s0][s1];" +
        "[s0]scale=-2:360:flags=lanczos,setsar=1[out360p];" +
        "[s1]scale=-2:480:flags=lanczos,setsar=1[out480p]",
    );
    assert.deepEqual(outLabels, ["out360p", "out480p"]);
  });

  it("renders blurred renditions from the mezzanine (argv snapshot)", () => {
    const r = buildBlurArgv({
      input: "mezz.mp4",
      frame: HD,
      detections: [face(10)],
      outputs: [{ res: "480p", path: "b480.mp4" }],
    });
    const a = r.command.args;
    assert.deepEqual(a.slice(0, 10), [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-v",
      "error",
      "-y",
      "-i",
      "mezz.mp4",
      "-filter_complex",
      r.filterGraph,
    ]);
    assert.deepEqual(a.slice(10, 12), ["-map", "[out480p]"]);
    assert.equal(a.at(-1), "b480.mp4");
    for (const f of ["-an", "-map_metadata", "+faststart", "libx264", "+bitexact"])
      assert.ok(a.includes(f), f);
    assert.equal(r.regions.length, 1);
  });

  it("with no detections still renders (the audit decides), and can pass the graph as a file", () => {
    const r = buildBlurArgv({
      input: "mezz.mp4",
      frame: HD,
      detections: [],
      outputs: [{ res: "360p", path: "o.mp4" }],
      graphFile: "work/graph.txt",
    });
    assert.equal(
      r.filterGraph,
      "[0:v:0]fps=30[v0];[v0]scale=-2:360:flags=lanczos,setsar=1[out360p]",
    );
    const k = r.command.args.indexOf("-/filter_complex");
    assert.equal(r.command.args[k + 1], "work/graph.txt");
    assert.ok(!r.command.args.includes("-filter_complex"));
  });

  it("refuses an over-long inline graph", () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      face(i * 20, i * 20, (i % 15) * 0.06, Math.floor(i / 15) * 0.03),
    );
    assert.throws(
      () =>
        buildBlurArgv({
          input: "m.mp4",
          frame: HD,
          detections: many,
          outputs: [{ res: "360p", path: "o.mp4" }],
        }),
      new RegExp(`pass graphFile|${MAX_INLINE_GRAPH_CHARS}`),
    );
  });
});

describe("blur audit and raw deletion", () => {
  const audit: BlurAuditRecord = {
    clipId: "JMU-0012",
    version: 3,
    auditor: "rater-07",
    renditionSha256: "a".repeat(64),
    framesTotal: 1140,
    framesChecked: 1140,
    misses: 0,
    missFrames: [],
    auditedAt: "2026-10-23T09:12:00Z",
  };

  it("passes only with 100% of frames and zero misses", () => {
    assert.ok(blurAuditPasses(audit));
    assert.ok(blurAuditPasses(audit, { mediaSha256: "a".repeat(64) }));
    assert.ok(!blurAuditPasses({ ...audit, framesChecked: 1139 }));
    assert.ok(
      !blurAuditPasses({ ...audit, misses: 1, missFrames: [{ frame: 400, kind: "plate" }] }),
    );
    assert.ok(
      !blurAuditPasses(audit, { mediaSha256: "b".repeat(64) }),
      "audit must be for the published bytes",
    );
    assert.ok(!blurAuditPasses({ ...audit, framesTotal: 0, framesChecked: 0 }));
    assert.match(blurAuditIssues({ ...audit, auditor: "Asha" }).join(), /pseudonym/);
    assert.deepEqual(toClipBlurAudit(audit), {
      auditor: "rater-07",
      framesChecked: 1140,
      misses: 0,
      auditedAt: "2026-10-23T09:12:00Z",
    });
  });

  it("deadline is min(upload + 7 days, audit pass + 24 h)", () => {
    assert.equal(rawDeletionDeadline("2026-10-20T00:00:00Z", null), "2026-10-27T00:00:00.000Z");
    assert.equal(
      rawDeletionDeadline("2026-10-20T00:00:00Z", "2026-10-23T09:12:00Z"),
      "2026-10-24T09:12:00.000Z",
    );
    assert.equal(
      rawDeletionDeadline("2026-10-20T00:00:00Z", "2026-10-26T12:00:00Z"),
      "2026-10-27T00:00:00.000Z",
    );
  });

  it("checks a deletion record", () => {
    const rec: RawDeletionRecord = {
      clipId: "JMU-0012",
      version: 3,
      objectKeys: ["raw/JMU-0012/v3/upload", "private/JMU-0012/v3/mezzanine.mp4"],
      reason: "audit_passed",
      uploadedAt: "2026-10-22T06:00:00Z",
      auditPassedAt: "2026-10-23T09:12:00Z",
      deletedAt: "2026-10-23T10:00:00Z",
      deletedBy: "clip_finalize",
    };
    assert.deepEqual(checkRawDeletion(rec), {
      onTime: true,
      deadline: "2026-10-24T09:12:00.000Z",
      issues: [],
    });
    assert.match(
      checkRawDeletion({ ...rec, deletedAt: "2026-10-23T09:00:00Z" }).issues.join(),
      /before the audit/,
    );
    assert.equal(checkRawDeletion({ ...rec, deletedAt: "2026-10-25T00:00:00Z" }).onTime, false);
    assert.match(
      checkRawDeletion({
        ...rec,
        objectKeys: ["https://r2.example/raw?X-Amz-Signature=1"],
      }).issues.join(),
      /not URLs/,
    );
    assert.match(
      checkRawDeletion({ ...rec, auditPassedAt: null }).issues.join(),
      /without an audit pass/,
    );
  });
});

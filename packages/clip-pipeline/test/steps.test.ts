import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as api from "../src/index.ts";
import {
  artefactKey,
  CLIP_FINALIZE_STEPS,
  CLIP_INGEST_STEPS,
  stepIdempotencyKey,
  stepsFor,
  TASK_LIMITS,
} from "../src/steps.ts";

describe("pipeline step definitions", () => {
  it("clip_ingest matches ARCHITECTURE §8 in order and placement", () => {
    assert.deepEqual(
      CLIP_INGEST_STEPS.map((s) => [s.id, s.runsIn, s.apiStep]),
      [
        ["transcode", "task", null],
        ["blur", "task", null],
        ["flash_check", "task", null],
        ["propose_windows", "task", null],
        ["open_review", "api", "clip.open_review"],
      ],
    );
    const t = CLIP_INGEST_STEPS.find((s) => s.id === "transcode");
    assert.equal(t?.timeoutSeconds, 1800, "transcode/blur 30 min");
    assert.equal(
      CLIP_INGEST_STEPS.find((s) => s.id === "propose_windows")?.timeoutSeconds,
      600,
      "propose 10 min",
    );
    for (const s of CLIP_INGEST_STEPS)
      assert.deepEqual([s.retry.maxRetries, s.retry.backoffScaling], [3, 1.5]);
    assert.equal(
      CLIP_INGEST_STEPS.find((s) => s.id === "propose_windows")?.continueOnFailure,
      true,
    );
  });

  it("clip_finalize matches ARCHITECTURE §8 (plus MD-218 raw deletion after the audit check)", () => {
    assert.deepEqual(
      CLIP_FINALIZE_STEPS.map((s) => s.id),
      [
        "agreement",
        "blur_audit_check",
        "delete_raw",
        "publish_manifest",
        "cdn_warm",
        "recompute_difficulty",
      ],
    );
    for (const s of CLIP_FINALIZE_STEPS) {
      assert.equal(s.retry.maxRetries, 3);
      assert.ok(s.timeoutSeconds >= 120 && s.timeoutSeconds <= 600, `${s.id} 5–10 min`);
      if (s.runsIn !== "task") assert.match(s.apiStep ?? "", /^clip\.[a-z_]+$/);
    }
    assert.equal(stepsFor("clip_finalize"), CLIP_FINALIZE_STEPS);
    assert.ok(TASK_LIMITS.clip_ingest.timeoutSeconds <= 86_400, "Workflows 24 h cap");
  });

  it("every helper a step names exists in the package API", () => {
    for (const s of [...CLIP_INGEST_STEPS, ...CLIP_FINALIZE_STEPS]) {
      for (const name of s.uses) assert.ok(name in api, `${s.id} uses missing export ${name}`);
    }
  });

  it("idempotency keys are clipId:step:version, with a round for finalize re-runs", () => {
    assert.equal(stepIdempotencyKey("transcode", "JMU-0012", 3), "JMU-0012:transcode:3");
    assert.equal(stepIdempotencyKey("agreement", "JMU-0012", 3, 2), "JMU-0012:agreement:3:r2");
    assert.throws(() => stepIdempotencyKey("Transcode", "JMU-0012", 3), /step/);
    assert.throws(() => stepIdempotencyKey("blur", "jmu-12", 3), /clipId/);
    assert.throws(() => stepIdempotencyKey("blur", "JMU-0012", 0), /version/);
    assert.throws(() => stepIdempotencyKey("blur", "JMU-0012", 1, 0), /round/);
  });

  it("artefact keys are deterministic per clip version", () => {
    assert.equal(artefactKey("JMU-0012", 3, "mezzanine"), "private/JMU-0012/v3/mezzanine.mp4");
    assert.equal(artefactKey("JMU-0012", 3, "raw"), "raw/JMU-0012/v3/upload");
    assert.equal(artefactKey("JMU-0012", 3, "poster"), "clips/JMU-0012/v3/poster.jpg");
  });
});

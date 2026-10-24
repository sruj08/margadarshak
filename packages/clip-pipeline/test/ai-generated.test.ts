// AI-generated clips (ADR-0013): origin rules in clip.json, the per-origin status machine and
// publish gate, client/bank projections, the prompt template and guardrails (with a drift test
// against ai/prompts/clip_generator.md), the onset hint, keys, and the scene catalogue.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderClipSchema } from "../scripts/gen-schema.ts";
import {
  approximateOnsetHint,
  buildShotPrompts,
  CLIP_GENERATOR_PROMPT,
  DEFAULT_VIDEO_MODEL,
  GUARDRAILS,
  generatedObjectKey,
  generationIdempotencyKey,
  generationRecord,
  guardrailBlock,
  nominalOnsetS,
  PROMPT_TEMPLATES,
  type SceneSpec,
  SceneSpecSchema,
  sceneClipFacts,
  sceneShotIssues,
} from "../src/generation.ts";
import * as api from "../src/index.ts";
import { buildBankManifest, buildClientManifest } from "../src/manifest.ts";
import { toClientManifestEntry, toScoringClip } from "../src/projection.ts";
import { type Clip, ClipSchema, parseClip } from "../src/schema.ts";
import {
  checkInvariants,
  clipReviewPasses,
  isAllowedFor,
  mockEligibility,
  syntheticReviewPasses,
  transition,
} from "../src/status.ts";
import { CLIP_GENERATE_FLOW, CLIP_GENERATE_STEPS, stepsFor, TASK_LIMITS } from "../src/steps.ts";
import { aiClip, allKeys, specClip } from "./helpers.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");

function issues(input: unknown): string {
  const r = ClipSchema.safeParse(input);
  return r.success ? "" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
}

function codes(r: ReturnType<typeof transition>): string[] {
  return r.ok ? [] : r.violations.map((v) => v.code);
}

/** A pre-rating AI clip in `status` (no final windows yet, no review yet). */
function aiPipeline(status: Clip["status"]): Clip {
  const { syntheticReview: _s, ...rest } = aiClip({ status, hazards: [], quietSegments: [] });
  return rest as Clip;
}

const SCENE: SceneSpec = {
  sceneId: "SCN-001",
  revision: 1,
  hazardType: "bus_stop_pedestrian",
  pov: "2W",
  roadType: "urban_arterial",
  region: "Indian metro",
  tenantTags: ["JK", "KL"],
  timeOfDay: "day",
  weather: "clear",
  speedKmh: 30,
  leadInS: 12,
  targetDurationS: 30,
  scene: "A wide four-lane city road with shops set back behind a footpath.",
  shots: [
    { kind: "opening", durationS: 8, prompt: "The scooter rides in the left lane behind a car." },
    { kind: "extension", durationS: 6, prompt: "A plain white bus slows and stops at a shelter." },
    {
      kind: "extension",
      durationS: 8,
      prompt: "Feet show under the front of the bus; a man steps out.",
      hazardBegins: true,
      cueAtS: 2,
    },
    {
      kind: "extension",
      durationS: 8,
      prompt: "The scooter eases off; the man waits; road clear.",
    },
  ],
  cue: { en: "Feet under the bus", hi: "बस के नीचे पैर" },
  difficulty: 3,
  occlusion: true,
};

describe("clip.json origin (ADR-0013)", () => {
  it("parses a pre-ADR clip (no origin) as filmed, and the AI example as ai_generated", () => {
    const { origin: _o, ...old } = specClip();
    assert.equal(parseClip(old).origin, "filmed");
    assert.equal(parseClip(aiClip()).origin, "ai_generated");
  });

  it("an AI clip needs its generation record, no blur audit and the scene's speed", () => {
    const { generation: _g, ...noGen } = aiClip();
    assert.match(issues(noGen), /need their generation record/);
    assert.match(issues(aiClip({ blurAudit: specClip().blurAudit })), /no blur audit/);
    assert.match(issues(aiClip({ speedSource: "rider_log" })), /scene_spec/);
    assert.match(issues(aiClip({ capturedMonth: "2026-09" })), /generation month/);
  });

  it("a filmed clip carries neither generation nor syntheticReview, nor a scene speed", () => {
    const ai = aiClip();
    assert.match(issues({ ...specClip(), generation: ai.generation }), /only for ai_generated/);
    assert.match(issues({ ...specClip(), syntheticReview: ai.syntheticReview }), /blur audit/);
    assert.match(issues({ ...specClip(), speedSource: "scene_spec" }), /only for ai_generated/);
  });

  it("generation and review are strict literals: SynthID, disclosure and every check true", () => {
    const ai = aiClip();
    const g = ai.generation;
    const r = ai.syntheticReview;
    assert.ok(g && r);
    assert.match(issues(aiClip({ generation: { ...g, synthId: false as true } })), /synthId/);
    assert.match(
      issues(aiClip({ generation: { ...g, disclosure: "none" as "ai_generated" } })),
      /disclosure/,
    );
    assert.match(issues(aiClip({ generation: { ...g, durationMs: 45_000 } })), /durationMs/);
    assert.match(
      issues(aiClip({ generation: { ...g, prompt: "x" } as typeof g })),
      /Unrecognized key/,
    );
    assert.match(
      issues(aiClip({ syntheticReview: { ...r, noRealBrands: false as true } })),
      /noRealBrands/,
    );
    assert.match(issues(aiClip({ syntheticReview: { ...r, reviewer: "Asha Nair" } })), /reviewer/);
  });

  it("JSON Schema: origin is optional with default filmed; new objects are strict", () => {
    const s = JSON.parse(renderClipSchema());
    assert.ok(!s.required.includes("origin"));
    assert.equal(s.properties.origin.default, "filmed");
    assert.deepEqual(s.properties.origin.enum, ["filmed", "ai_generated"]);
    assert.equal(s.properties.generation.additionalProperties, false);
    assert.equal(s.properties.syntheticReview.additionalProperties, false);
    assert.ok(s.properties.speedSource.enum.includes("scene_spec"));
  });
});

describe("status machine per origin", () => {
  it("AI clips go transcoded → proposed and never through blurred or audited", () => {
    assert.ok(isAllowedFor("ai_generated", "transcoded", "proposed"));
    assert.ok(!isAllowedFor("ai_generated", "transcoded", "blurred"));
    assert.ok(!isAllowedFor("ai_generated", "blurred", "audited"));
    assert.ok(!isAllowedFor("filmed", "transcoded", "proposed"), "filmed clips are always blurred");
    assert.ok(isAllowedFor("filmed", "transcoded", "blurred"));
    assert.ok(transition(aiPipeline("transcoded"), "proposed").ok);
    assert.deepEqual(codes(transition(aiPipeline("transcoded"), "blurred")), ["transition"]);
    const filmed = {
      ...specClip(),
      status: "transcoded" as const,
      hazards: [],
      quietSegments: [],
      blurAudit: null,
    };
    const r = transition(filmed, "proposed");
    assert.ok(!r.ok && /for filmed clips/.test(r.violations[0]?.message ?? ""));
  });

  it("flags an AI clip found in a blur status", () => {
    assert.ok(checkInvariants(aiPipeline("blurred")).some((v) => v.code === "origin_status"));
  });

  it("runs the full AI lifecycle: raw → transcoded → proposed → rated → published", () => {
    let c: Clip = { ...aiPipeline("raw"), media: [] };
    const step = (to: Clip["status"], over: Partial<Clip> = {}) => {
      const r = transition({ ...c, ...over }, to);
      assert.ok(r.ok, `${c.status} → ${to}: ${JSON.stringify(r.ok ? [] : r.violations)}`);
      c = r.clip;
    };
    step("transcoded");
    step("proposed", { media: aiClip().media });
    const final = aiClip();
    step("rated", { hazards: final.hazards, quietSegments: final.quietSegments });
    step("published", {
      ...(final.syntheticReview ? { syntheticReview: final.syntheticReview } : {}),
    });
    assert.equal(c.status, "published");
    assert.equal(toScoringClip(c).hazards.length, 1, "scoring windows are the raters' windows");
  });

  it("publishing an AI clip needs the synthetic review, not a blur audit", () => {
    const rated = { ...aiClip(), status: "rated" as const };
    assert.ok(transition(rated, "published").ok);
    const { syntheticReview: _s, ...noReview } = rated;
    assert.deepEqual(codes(transition(noReview as Clip, "published")), ["synthetic_review"]);
    assert.ok(clipReviewPasses(aiClip()) && syntheticReviewPasses(aiClip()));
    assert.ok(clipReviewPasses(specClip()) && !syntheticReviewPasses(specClip()));
  });

  it("two agreeing human raters are still required for an AI clip", () => {
    const h = aiClip().hazards[0];
    assert.ok(h);
    const rated = { ...aiClip(), status: "rated" as const, hazards: [{ ...h, deltaOnsetMs: 900 }] };
    assert.deepEqual(codes(transition(rated, "published")), ["raters_disagree"]);
    const one = { ...aiClip(), status: "proposed" as const, hazards: [{ ...h, raterCount: 1 }] };
    assert.ok(!transition(one as Clip, "rated").ok, "one rater never sets a window");
  });

  it("a published AI clip is mock-eligible on the same rules as a filmed one", () => {
    assert.deepEqual(mockEligibility(aiClip(), { flashPassed: true }), {
      eligible: true,
      reasons: [],
    });
    assert.ok(!mockEligibility(aiClip(), { flashPassed: false }).eligible);
  });
});

describe("projections and manifests carry the label, not the generation details", () => {
  it("client entry: origin only for AI clips, no generation or review data", () => {
    const ai = toClientManifestEntry(aiClip(), { mockEligible: true });
    assert.equal(ai.origin, "ai_generated");
    const filmed = toClientManifestEntry(specClip(), { mockEligible: true });
    assert.ok(!("origin" in filmed), "filmed entries keep their pre-ADR shape");
    for (const k of allKeys(ai))
      assert.doesNotMatch(k, /generation|sceneId|model|prompt|syntheticReview|reviewer|synth/i, k);
  });

  it("bank manifest: AI entry has origin, generation and the review without the reviewer", () => {
    const bank = buildBankManifest([aiClip(), specClip()], { generatedAt: "2026-10-24T00:00:00Z" });
    const ai = bank.clips.find((c) => c.clipId === "AIG-0004");
    const filmed = bank.clips.find((c) => c.clipId === "JMU-0012");
    assert.ok(ai && ai.status === "published" && filmed && filmed.status === "published");
    assert.equal(ai.origin, "ai_generated");
    assert.equal(ai.blurAudit, null);
    assert.equal(ai.generation?.synthId, true);
    assert.ok(ai.syntheticReview && !("reviewer" in ai.syntheticReview));
    assert.ok(!JSON.stringify(bank).includes("curator-02"), "no reviewer pseudonym in the bank");
    assert.ok(!("origin" in filmed) && !("generation" in filmed));
    const client = buildClientManifest([aiClip()], {
      generatedAt: "2026-10-24T00:00:00Z",
      isMockEligible: () => true,
    });
    assert.equal(client.clips[0]?.origin, "ai_generated");
  });
});

describe("prompt template and guardrails", () => {
  it("every prompt of a scene ends with the full guardrail block", () => {
    const prompts = buildShotPrompts(SCENE);
    assert.equal(prompts.length, 4);
    assert.equal(prompts[0]?.kind, "opening");
    for (const p of prompts) {
      assert.ok(p.text.endsWith(guardrailBlock()), `shot ${p.n}`);
      for (const g of GUARDRAILS) assert.ok(p.text.includes(g), `shot ${p.n}: ${g}`);
      assert.doesNotMatch(p.text, /\{[a-z_]+\}/, "every placeholder filled");
      assert.match(p.text, /about 30 km\/h/);
      assert.match(p.text, new RegExp(`Shot ${p.n} of 4`));
    }
    assert.match(prompts[0]?.text ?? "", /fictional, AI-generated Indian road scene/);
    assert.match(prompts[1]?.text ?? "", /^Extend the previous video/);
  });

  it("covers each required guardrail topic", () => {
    const all = GUARDRAILS.join(" ");
    for (const re of [
      /collision/,
      /injury/,
      /blood/,
      /brands/,
      /logos/,
      /number plate/,
      /real people/,
      /text overlays/,
      /speeding/,
      /stunts/,
      /No speech/,
      /ambient traffic/,
      /resolves safely/,
      /early cue first/,
    ])
      assert.match(all, re);
  });

  it("matches ai/prompts/clip_generator.md (drift test)", () => {
    const md = read("ai/prompts/clip_generator.md");
    const block = (name: string) => {
      const m = new RegExp(
        `<!-- ${name}:start -->\\s*\`\`\`text\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- ${name}:end -->`,
      ).exec(md);
      assert.ok(m, `${name} block`);
      return m[1];
    };
    assert.equal(block("guardrails"), guardrailBlock());
    assert.equal(block("template:opening"), PROMPT_TEMPLATES.opening);
    assert.equal(block("template:extension"), PROMPT_TEMPLATES.extension);
    assert.match(md, new RegExp(`^id: ${CLIP_GENERATOR_PROMPT.id}$`, "m"));
    assert.match(
      md,
      new RegExp(`^version: ${CLIP_GENERATOR_PROMPT.version.replace(/\./g, "\\.")}$`, "m"),
    );
    assert.match(md, new RegExp(`default ${DEFAULT_VIDEO_MODEL.replace(/\./g, "\\.")}`));
  });

  it("rejects scenes that break the shot rules", () => {
    assert.deepEqual(sceneShotIssues(SCENE), []);
    const hazardFirst = SCENE.shots.map((s, i) =>
      i === 0 ? { ...s, hazardBegins: true, cueAtS: 1 } : { ...s, hazardBegins: false },
    );
    assert.ok(
      sceneShotIssues({ ...SCENE, shots: hazardFirst }).some((x) => /opening shot/.test(x)),
    );
    assert.ok(sceneShotIssues({ ...SCENE, leadInS: 20 }).some((x) => /lead-in/.test(x)));
    assert.ok(sceneShotIssues({ ...SCENE, targetDurationS: 31 }).some((x) => /add up/.test(x)));
    assert.ok(sceneShotIssues({ ...SCENE, hazardType: "quiet" }).some((x) => /quiet/.test(x)));
    assert.equal(
      SceneSpecSchema.safeParse({ ...SCENE, speedKmh: 80 }).success,
      false,
      "no speed content",
    );
    assert.equal(SceneSpecSchema.safeParse({ ...SCENE, timeOfDay: "night" }).success, false);
  });
});

describe("onset hint, clip facts, generation record and keys", () => {
  it("measures the hint from the generated turns; never authoritative", () => {
    assert.equal(nominalOnsetS(SCENE), 16);
    assert.deepEqual(approximateOnsetHint(SCENE), {
      approxOnsetMs: 16_000,
      toleranceMs: 3_000,
      authoritative: false,
      basis: "nominal",
    });
    // The model made the first two turns 8.4 s and 15.2 s long: the cue follows its real timing.
    assert.equal(
      approximateOnsetHint(SCENE, [8_400, 15_200, 23_000, 31_000])?.approxOnsetMs,
      17_200,
    );
    assert.equal(approximateOnsetHint(SCENE, [8_400, 15_200])?.basis, "measured");
    assert.equal(
      approximateOnsetHint({
        ...SCENE,
        hazardType: "quiet",
        shots: SCENE.shots.map(({ hazardBegins: _h, cueAtS: _c, ...s }) => s),
      }),
      null,
    );
  });

  it("derives the clip.json facts from the scene", () => {
    assert.deepEqual(sceneClipFacts(SCENE), {
      city: "Indian metro",
      tenantTags: ["JK", "KL"],
      roadType: "urban_arterial",
      timeOfDay: "day",
      weather: "clear",
      pov: "2W",
      speedKmhEst: 30,
      speedSource: "scene_spec",
      modules: ["M18"],
      origin: "ai_generated",
    });
  });

  it("builds a valid generation record with the prompt version", () => {
    const g = generationRecord({
      model: DEFAULT_VIDEO_MODEL,
      sceneId: "SCN-001",
      batchId: "b20261024a",
      generatedAt: "2026-10",
      durationMs: 30_100,
      extensions: 3,
    });
    assert.deepEqual(g, {
      model: "gemini-omni-1.1-flash",
      sceneId: "SCN-001",
      promptVersion: CLIP_GENERATOR_PROMPT.version,
      seedOrBatchId: "b20261024a",
      generatedAt: "2026-10",
      durationMs: 30_100,
      extensions: 3,
      synthId: true,
      disclosure: "ai_generated",
    });
    assert.throws(
      () => generationRecord({ ...g, sceneId: "SCN-001", generatedAt: "2026-10-24" }),
      /YYYY-MM/,
    );
  });

  it("keys are deterministic per sceneId:version:batchId", () => {
    assert.equal(generationIdempotencyKey("generate", "SCN-004", 2, "b1"), "SCN-004:2:b1:generate");
    assert.equal(
      generatedObjectKey("SCN-004", 2, "b1", "source.mp4"),
      "generated/SCN-004/v2/b1/source.mp4",
    );
    assert.throws(() => generationIdempotencyKey("generate", "SCN-4", 2, "b1"), /sceneId/);
    assert.throws(() => generatedObjectKey("SCN-004", 2, "../x", "source.mp4"), /batchId/);
    assert.throws(() => generationIdempotencyKey("generate", "SCN-004", 0, "b1"), /version/);
  });
});

describe("clip_generate steps", () => {
  it("defines generate → precheck → register → render, and the flow reuses clip_ingest", () => {
    assert.deepEqual(
      CLIP_GENERATE_STEPS.map((s) => [s.id, s.runsIn, s.apiStep]),
      [
        ["generate", "task", null],
        ["precheck", "task", null],
        ["register", "api", "clip.register_generated"],
        ["render", "task", null],
      ],
    );
    assert.equal(stepsFor("clip_generate"), CLIP_GENERATE_STEPS);
    assert.ok(!CLIP_GENERATE_FLOW.includes("clip_ingest.blur"), "AI clips skip blur");
    assert.ok(TASK_LIMITS.clip_generate.timeoutSeconds <= 86_400, "Workflows 24 h cap");
    for (const s of CLIP_GENERATE_STEPS)
      for (const name of s.uses) assert.ok(name in api, `${s.id} uses missing export ${name}`);
  });
});

describe("content/nazar/scenes.json against the generator's contract", () => {
  const file = JSON.parse(read("content/nazar/scenes.json")) as {
    promptVersion: string;
    scenes: unknown[];
  };

  it("uses this prompt version, and every scene parses and builds guarded prompts", () => {
    assert.equal(file.promptVersion, CLIP_GENERATOR_PROMPT.version);
    assert.ok(file.scenes.length >= 28);
    for (const raw of file.scenes) {
      const scene = SceneSpecSchema.parse(raw);
      const prompts = buildShotPrompts(scene);
      for (const p of prompts) assert.ok(p.text.endsWith(guardrailBlock()), scene.sceneId);
      const hint = approximateOnsetHint(scene);
      if (scene.hazardType === "quiet") assert.equal(hint, null);
      else assert.ok(hint && hint.approxOnsetMs >= 10_000, scene.sceneId);
    }
  });
});

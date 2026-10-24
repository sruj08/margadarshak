// content/nazar/scenes.json (ADR-0013): schema, bank coverage, prompt-text bans, prompt version,
// and the committed JSON Schema. Each check also has a negative test that seeds a defect.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  checkSceneCoverage,
  checkSceneIds,
  checkScenePromptVersion,
  checkSceneText,
  nazarScenesJsonSchema,
} from "../src/nazar.ts";
import {
  CLIP_GENERATOR_PROMPT_PATH,
  loadNazarScenes,
  NAZAR_SCENES_PATH,
  NAZAR_SCENES_SCHEMA_PATH,
  readJson,
} from "../src/node.ts";
import { HAZARD_TYPES } from "../src/schema/common.ts";
import {
  NazarScene,
  type NazarScenesFile,
  NazarScenesFile as NazarScenesFileSchema,
  sceneNominalOnsetS,
} from "../src/schema/nazar-scenes.ts";
import { show } from "./helpers.ts";

const loaded = loadNazarScenes();
const file = loaded.file;
const clone = (): NazarScenesFile => structuredClone(file);
const firstHazard = () => clone().scenes.find((s) => s.hazardType !== "quiet") as NazarScene;

describe("Nazar scene catalogue (content/nazar/scenes.json)", () => {
  it("parses and passes every cross-scene check", () => {
    for (const [check, issues] of Object.entries(loaded.issues))
      assert.deepEqual(issues, [], `${check}:${show(issues)}`);
  });

  it("covers all 15 hazard types with at least 24 hazard scenes and 4 quiet scenes", () => {
    const hazard = file.scenes.filter((s) => s.hazardType !== "quiet");
    const quiet = file.scenes.filter((s) => s.hazardType === "quiet");
    assert.ok(hazard.length >= 24, `${hazard.length} hazard scenes`);
    assert.ok(quiet.length >= 4, `${quiet.length} quiet scenes`);
    assert.deepEqual(new Set(hazard.map((s) => s.hazardType)), new Set(HAZARD_TYPES));
  });

  it("varies point of view, light, weather and Indian context", () => {
    assert.deepEqual(new Set(file.scenes.map((s) => s.pov)), new Set(["2W", "4W"]));
    for (const t of ["day", "dusk"])
      assert.ok(
        file.scenes.some((s) => s.timeOfDay === t),
        t,
      );
    assert.ok(file.scenes.some((s) => s.weather === "rain"));
    for (const st of ["jk_hill_road", "kerala_town", "metro_arterial", "small_town_market"])
      assert.ok(
        file.scenes.some((s) => s.setting === st),
        st,
      );
  });

  it("gives every hazard scene a calm lead-in of at least 10 s and time to resolve", () => {
    for (const s of file.scenes) {
      assert.ok(s.targetDurationS >= 20 && s.targetDurationS <= 40, s.sceneId);
      assert.equal(
        s.shots.reduce((t, x) => t + x.durationS, 0),
        s.targetDurationS,
        s.sceneId,
      );
      const onset = sceneNominalOnsetS(s);
      if (s.hazardType === "quiet") {
        assert.equal(onset, null, s.sceneId);
        continue;
      }
      assert.ok(onset !== null && onset >= 10 && onset >= s.leadInS, `${s.sceneId} onset ${onset}`);
      assert.ok(s.targetDurationS - (onset ?? 0) >= 4, `${s.sceneId} resolves`);
      assert.notEqual(s.shots[0]?.hazardBegins, true, `${s.sceneId}: never in the opening shot`);
    }
  });

  it("keeps speeds calm and legal", () => {
    for (const s of file.scenes) assert.ok(s.speedKmh >= 10 && s.speedKmh <= 60, s.sceneId);
    for (const s of file.scenes.filter((x) =>
      ["school_zone", "small_town_market"].includes(x.setting),
    ))
      assert.ok(s.speedKmh <= 25, `${s.sceneId} ${s.speedKmh} km/h`);
  });

  it("has en and Devanagari hi cue text for every scene", () => {
    for (const s of file.scenes) {
      assert.ok(s.cue.en.trim().length > 0, s.sceneId);
      assert.match(s.cue.hi, /[ऀ-ॿ]/, s.sceneId);
    }
  });

  it("matches the prompt file's id and version and declares the disclosure", () => {
    assert.equal(file.disclosure, "ai_generated");
    assert.deepEqual(
      checkScenePromptVersion(file, readFileSync(CLIP_GENERATOR_PROMPT_PATH, "utf8")),
      [],
    );
  });

  it("committed JSON Schema matches Zod (regenerate with gen:nazar-schema)", () => {
    assert.deepEqual(readJson(NAZAR_SCENES_SCHEMA_PATH), nazarScenesJsonSchema());
    assert.equal(
      (readJson(NAZAR_SCENES_PATH) as { $schema: string }).$schema,
      "./scenes.schema.json",
    );
  });
});

describe("Nazar scene checks catch seeded defects", () => {
  it("schema: unknown keys, onset inside the lead-in, opening-shot hazards, bad sums", () => {
    const s = firstHazard();
    assert.equal(NazarScene.safeParse({ ...s, gps: "32.7,74.8" }).success, false);
    const early = structuredClone(s);
    early.leadInS = 30;
    assert.equal(NazarScene.safeParse(early).success, false, "onset before lead-in ends");
    const opening = structuredClone(s);
    opening.shots = opening.shots.map((x, i) => {
      const { hazardBegins: _h, cueAtS: _c, ...rest } = x;
      return i === 0 ? { ...rest, hazardBegins: true as const, cueAtS: 1 } : rest;
    });
    assert.equal(NazarScene.safeParse(opening).success, false, "hazard in the opening shot");
    const sum = structuredClone(s);
    sum.targetDurationS =
      sum.targetDurationS + 1 > 40 ? sum.targetDurationS - 1 : sum.targetDurationS + 1;
    assert.equal(NazarScene.safeParse(sum).success, false, "shots must add up");
    const fast = structuredClone(s);
    fast.setting = "school_zone";
    fast.speedKmh = 45;
    assert.equal(NazarScene.safeParse(fast).success, false, "school zone speed");
    const quiet = structuredClone(s);
    quiet.hazardType = "quiet";
    assert.equal(NazarScene.safeParse(quiet).success, false, "quiet scenes mark no hazard shot");
    const long = structuredClone(s);
    long.shots = [
      ...long.shots,
      { kind: "extension", durationS: 10, prompt: "The road continues straight and calm." },
      { kind: "extension", durationS: 10, prompt: "The road continues straight and calm again." },
    ];
    long.targetDurationS = long.shots.reduce((t, x) => t + x.durationS, 0);
    assert.equal(NazarScene.safeParse(long).success, false, "over 40 s");
  });

  it("schema: the file needs the disclosure and the prompt id", () => {
    assert.equal(
      NazarScenesFileSchema.safeParse({ ...clone(), disclosure: "filmed" }).success,
      false,
    );
    assert.equal(NazarScenesFileSchema.safeParse({ ...clone(), promptId: "PRM-X" }).success, false);
  });

  it("coverage: a missing hazard type, too few quiet scenes, one POV only", () => {
    const f = clone();
    f.scenes = f.scenes.filter((s) => s.hazardType !== "cyclist" && s.hazardType !== "quiet");
    const issues = checkSceneCoverage(f);
    assert.ok(
      issues.some((i) => /cyclist/.test(i)),
      show(issues),
    );
    assert.ok(
      issues.some((i) => /quiet/.test(i)),
      show(issues),
    );
    const g = clone();
    g.scenes = g.scenes.map((s) => ({ ...s, pov: "2W" as const }));
    assert.ok(checkSceneCoverage(g).some((i) => /4W/.test(i)));
  });

  it("ids: duplicates", () => {
    const f = clone();
    const s = f.scenes[0] as NazarScene;
    f.scenes.push(s);
    assert.deepEqual(checkSceneIds(f), [`duplicate sceneId ${s.sceneId}`]);
  });

  it("text: harm, speed, brands, readable plates, speech and 'official'", () => {
    const cases: [string, RegExp][] = [
      ["The two scooters collide at the junction.", /harm/],
      ["A rider is speeding past.", /speed/],
      ["A Maruti hatchback waits at the kerb.", /brand/],
      ["The plate KL 07 AB 1234 is visible.", /plate/],
      ["The board reads Bus Stand.", /readable-text/],
      ["A man shouts at the driver.", /speech/],
      ["An official car is parked.", /official/],
    ];
    for (const [text, rule] of cases) {
      const f = clone();
      const s = f.scenes[0] as NazarScene;
      const shot = s.shots[1];
      assert.ok(shot);
      shot.prompt = text;
      const issues = checkSceneText(f);
      assert.ok(
        issues.some((i) => rule.test(i)),
        `${text} → ${show(issues)}`,
      );
    }
  });

  it("prompt version: a mismatch with clip_generator.md", () => {
    const f = { ...clone(), promptVersion: "9.9.9" };
    const md = readFileSync(CLIP_GENERATOR_PROMPT_PATH, "utf8");
    assert.equal(checkScenePromptVersion(f, md).length, 1);
  });
});

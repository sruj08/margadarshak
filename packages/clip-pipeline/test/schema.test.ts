import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderClipSchema } from "../scripts/gen-schema.ts";
import {
  ClipSchema,
  clipRef,
  expectedFrameCount,
  HAZARD_MODULES,
  HAZARD_TYPES,
  parseClip,
} from "../src/schema.ts";
import { clipWith, specClip } from "./helpers.ts";

function rejects(input: unknown, pathOrMessage: RegExp): void {
  const r = ClipSchema.safeParse(input);
  assert.equal(r.success, false, "expected rejection");
  if (!r.success) {
    const text = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    assert.match(text, pathOrMessage);
  }
}

describe("clip.json schema", () => {
  it("accepts the NAZAR §3.2 example", () => {
    const c = parseClip(specClip());
    assert.equal(clipRef(c), "JMU-0012@3");
  });

  it("has the 15 hazard types of §3.3, each with its modules", () => {
    assert.equal(HAZARD_TYPES.length, 15);
    for (const t of HAZARD_TYPES) assert.ok(Array.isArray(HAZARD_MODULES[t]));
  });

  it("rejects precise-location fields anywhere (strict objects)", () => {
    rejects({ ...specClip(), lat: 32.73, lng: 74.86 }, /Unrecognized key/);
    rejects({ ...specClip(), location: "32.7266,74.8570" }, /Unrecognized key/);
    rejects({ ...specClip(), gps: { lat: 1, lng: 2 } }, /Unrecognized key/);
    const h = specClip().hazards[0];
    rejects(
      { ...specClip(), hazards: [{ ...h, where: "Gandhi Nagar bus stop" }] },
      /Unrecognized key/,
    );
    rejects({ ...specClip(), media: [{ ...specClip().media[0], geo: "x" }] }, /Unrecognized key/);
  });

  it("keeps city coarse: no digits, coordinates or addresses", () => {
    rejects(clipWith({ city: "12 MG Road, Jammu" }), /city/);
    rejects(clipWith({ city: "32.7266,74.8570" }), /city/);
    assert.ok(ClipSchema.safeParse(clipWith({ city: "Sri Nagar" })).success);
  });

  it("allows month precision only for the capture date", () => {
    rejects(clipWith({ capturedMonth: "2026-10-23" }), /capturedMonth/);
    rejects(clipWith({ capturedMonth: "2026-13" }), /capturedMonth/);
  });

  it("rejects bad windows and segments", () => {
    const h = specClip().hazards[0];
    assert.ok(h);
    rejects(
      clipWith({ hazards: [{ ...h, window: { aMs: 5000, bMs: 5000 } }] }),
      /aMs must be < bMs/,
    );
    rejects(
      clipWith({ hazards: [{ ...h, window: { aMs: 30000, bMs: 39000 } }] }),
      /ends after the clip/,
    );
    rejects(clipWith({ quietSegments: [{ fromMs: 9000, toMs: 13000 }] }), /overlaps hazard h1/);
    rejects(
      clipWith({
        quietSegments: [
          { fromMs: 0, toMs: 5000 },
          { fromMs: 4000, toMs: 9000 },
        ],
      }),
      /quiet segments overlap/,
    );
    rejects(
      clipWith({ hazards: [h, { ...h, window: { aMs: 20000, bMs: 22000 } }] }),
      /duplicate hazardId/,
    );
  });

  it("ties three marks to adjudication and speed to its source", () => {
    const h = specClip().hazards[0];
    assert.ok(h);
    rejects(clipWith({ hazards: [{ ...h, raterCount: 3, adjudicated: false }] }), /three marks/);
    rejects(clipWith({ speedKmhEst: null }), /speedKmhEst is null exactly/);
    assert.ok(
      ClipSchema.safeParse(clipWith({ speedKmhEst: null, speedSource: "not_logged" })).success,
    );
  });

  it("rejects a non-pseudonymous auditor, a wrong licence and duplicate renditions", () => {
    rejects(
      clipWith({
        blurAudit: {
          auditor: "Priya Sharma",
          framesChecked: 1140,
          misses: 0,
          auditedAt: "2026-10-23T09:12:00Z",
        },
      }),
      /auditor/,
    );
    rejects({ ...specClip(), licence: "CC-BY-SA-4.0" }, /licence/);
    const m = specClip().media[0];
    assert.ok(m);
    rejects(clipWith({ media: [m, m] }), /duplicate rendition/);
  });

  it("counts audit frames at 30 fps", () => {
    assert.equal(expectedFrameCount(38000), 1140);
    assert.equal(expectedFrameCount(38010), 1140);
  });

  it("JSON Schema on disk matches the generator (drift test)", () => {
    const onDisk = JSON.parse(
      readFileSync(new URL("../schema/clip.schema.json", import.meta.url), "utf8"),
    );
    assert.deepEqual(
      onDisk,
      JSON.parse(renderClipSchema()),
      "run: node --experimental-strip-types scripts/gen-schema.ts",
    );
  });

  it("JSON Schema is strict at every object level", () => {
    const s = JSON.parse(renderClipSchema());
    assert.equal(s.additionalProperties, false);
    assert.equal(s.properties.hazards.items.additionalProperties, false);
    assert.equal(s.properties.hazards.items.properties.window.additionalProperties, false);
    assert.equal(s.properties.media.items.additionalProperties, false);
    assert.deepEqual(s.properties.hazards.items.properties.hazardType.enum, [...HAZARD_TYPES]);
    assert.ok(!("lat" in s.properties) && !("location" in s.properties));
  });
});

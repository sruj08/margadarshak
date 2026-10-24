import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBankManifest, buildClientManifest, latestReleasedVersions } from "../src/manifest.ts";
import { sha256Hex } from "../src/math.ts";
import type { Clip } from "../src/schema.ts";
import { allKeys, clipWith, pipelineClip, specClip } from "./helpers.ts";

const AT = "2026-10-24T06:00:00Z";

function bankClips(): Clip[] {
  return [
    clipWith({
      clipId: "JMU-0020",
      version: 1,
      media: [
        { res: "360p", bytes: 1000000, sha256: sha256Hex("20/360") },
        { res: "480p", bytes: 2000000, sha256: sha256Hex("20/480") },
      ],
    }),
    specClip(),
    clipWith({ version: 2 }), // an older published version of JMU-0012
    clipWith({ clipId: "JMU-0007", version: 4, status: "retired" }),
    { ...pipelineClip("proposed"), clipId: "JMU-0030", version: 1 },
  ];
}

describe("bank manifest (CC-BY)", () => {
  it("one entry per clip, highest released version, sorted, with retired stubs", () => {
    const m = buildBankManifest(bankClips(), { generatedAt: AT });
    assert.deepEqual(
      m.clips.map((c) => `${c.ref}:${c.status}`),
      ["JMU-0007@4:retired", "JMU-0012@3:published", "JMU-0020@1:published"],
    );
    assert.deepEqual(m.counts, { published: 2, retired: 1 });
    assert.equal(m.licence, "CC-BY-4.0");
    assert.equal(
      m.attribution,
      "Margdarshak clip bank, team Chanakya (Nestiq Private Limited), 2026, CC-BY 4.0",
    );
  });

  it("carries media hashes, final windows, licence and attribution; drops rater pseudonyms", () => {
    const m = buildBankManifest(bankClips(), { generatedAt: AT });
    const e = m.clips.find((c) => c.clipId === "JMU-0012");
    assert.ok(e && e.status === "published");
    assert.deepEqual(e.media, [
      {
        res: "360p",
        bytes: 1840000,
        sha256: specClip().media[0]?.sha256,
        key: "clips/JMU-0012/v3/360p.mp4",
      },
      {
        res: "480p",
        bytes: 2900000,
        sha256: specClip().media[1]?.sha256,
        key: "clips/JMU-0012/v3/480p.mp4",
      },
    ]);
    assert.deepEqual(e.hazards[0]?.window, { aMs: 12400, bMs: 16900 });
    assert.equal(e.licence, "CC-BY-4.0");
    assert.equal(e.attribution, specClip().attribution);
    assert.ok(
      !allKeys(m).some((k) => /auditor|rater(?!Count)/.test(k)),
      "no rater or auditor pseudonyms",
    );
    assert.ok(!JSON.stringify(m).includes("rater-07"));
  });

  it("is deterministic regardless of input order", () => {
    const a = buildBankManifest(bankClips(), { generatedAt: AT });
    const b = buildBankManifest([...bankClips()].reverse(), { generatedAt: AT });
    assert.deepEqual(a, b);
    assert.match(a.digest, /^[0-9a-f]{64}$/);
    const changed = buildBankManifest([...bankClips(), clipWith({ version: 4 })], {
      generatedAt: AT,
    });
    assert.notEqual(changed.digest, a.digest);
  });

  it("refuses unpublishable clips and contradictory versions", () => {
    assert.throws(
      () => buildBankManifest([clipWith({ blurAudit: null })], { generatedAt: AT }),
      /not publishable/,
    );
    assert.throws(
      () => buildBankManifest([specClip(), clipWith({ status: "retired" })], { generatedAt: AT }),
      /both published and retired/,
    );
    assert.throws(
      () => buildBankManifest([specClip()], { generatedAt: "yesterday" }),
      /generatedAt/,
    );
    assert.equal(latestReleasedVersions([pipelineClip("rated")]).length, 0);
  });
});

describe("client manifest (API-37)", () => {
  it("published only, no windows, totals per rendition, tenant and resolution filters", () => {
    const m = buildClientManifest(bankClips(), {
      generatedAt: AT,
      isMockEligible: (c) => c.clipId === "JMU-0012",
    });
    assert.deepEqual(
      m.clips.map((c) => [c.ref, c.mockEligible]),
      [
        ["clip:JMU-0012@3", true],
        ["clip:JMU-0020@1", false],
      ],
    );
    assert.deepEqual(m.totalBytes, { "360p": 2840000, "480p": 4900000 });
    assert.ok(!allKeys(m).some((k) => /window|hazard|quiet|cue/i.test(k)));
    const r360 = buildClientManifest(bankClips(), {
      generatedAt: AT,
      isMockEligible: () => true,
      resolution: "360p",
      tenant: "JK",
    });
    assert.ok(r360.clips.every((c) => c.media.length === 1 && c.media[0]?.res === "360p"));
    assert.deepEqual(r360.totalBytes, { "360p": 2840000, "480p": 0 });
    assert.equal(
      buildClientManifest(bankClips(), {
        generatedAt: AT,
        isMockEligible: () => true,
        tenant: "KL",
      }).clips.length,
      0,
    );
  });
});

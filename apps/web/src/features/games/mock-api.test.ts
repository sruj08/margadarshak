import type { NazarClip } from "@margdarshak/game-core/schema";
import { describe, expect, it } from "vitest";
import {
  isPlaceholderClip,
  PLACEHOLDER_CLIP_BYTES,
  PLACEHOLDER_CLIP_SHA256,
} from "@/features/nazar/placeholder";
import type { CheckedSessionResult } from "./api-types";
import { keepAwardedXp } from "./host/queue";
import {
  deviceStartSession,
  FORM_BLOCKS,
  fixturePublicDoc,
  formFromCode,
  studyRefs,
} from "./mock-api";
import type { DeviceItems, DeviceMedia } from "./types";

/** Fifteen device clips, as AI-generated scenes would arrive (docs + media URLs). */
function aiClips(n = 15): DeviceItems {
  const items: DeviceItems["items"] = [];
  const docs: Record<string, NazarClip> = {};
  const media: Record<string, DeviceMedia> = {};
  for (let i = 1; i <= n; i++) {
    const id = `AI-${String(i).padStart(4, "0")}`;
    const ref = `clip:${id}@1`;
    items.push({ ref, contentVersion: "1" });
    docs[ref] = {
      clipId: id,
      version: 1,
      speedKmhEst: 30,
      durationMs: 20000,
      hazards: [{ hazardId: "h1", hazardType: "door_opening", window: { aMs: 8000, bMs: 12000 } }],
      quietSegments: [],
    };
    media[ref] = { url: `https://media.example/${id}.mp4`, bytes: 1000, origin: "ai_generated" };
  }
  return { items, docs, media };
}

describe("device sessions: field-study forms (FIELD_STUDY §4.2)", () => {
  it("forms rotate A, B, C by arrival, from the participant code", () => {
    expect(["P-001", "P-002", "P-003", "P-004"].map(formFromCode)).toEqual(["A", "B", "C", "A"]);
  });

  it("test deals the form's two blocks (10 clips) and fresh its third block (5), disjoint", () => {
    const pool = Array.from({ length: 15 }, (_, i) => `c${i}`);
    for (const form of ["A", "B", "C"] as const) {
      const test = studyRefs(pool, "test", form);
      const fresh = studyRefs(pool, "fresh", form);
      expect(test).toHaveLength(10);
      expect(fresh).toHaveLength(5);
      expect(test.filter((r) => fresh.includes(r))).toEqual([]);
      expect(fresh[0]).toBe(`c${FORM_BLOCKS[form].fresh * 5}`);
    }
  });

  it("phase test / fresh on Nazar: 10 and 5 clips, real media from device docs, origin kept", () => {
    const device = aiClips();
    const body = {
      mode: "mock" as const,
      study: { participant_code: "P-002", phase: "test" as const },
    };
    const test = deviceStartSession("nazar", body, { locale: "en", deviceItems: device });
    expect(test.start.items).toHaveLength(10);
    expect(test.media).toBe("video");
    expect(test.start.items[0]?.asset_url).toMatch(/^https:\/\/media\.example\/AI-\d{4}\.mp4$/);
    expect(test.start.items[0]?.origin).toBe("ai_generated");
    expect(test.start.items.every((i) => i.reveal === undefined)).toBe(true);
    expect(test.deviceContent?.gameId).toBe("nazar");
    // Form B (P-002): test = B2 + B3, fresh = B1.
    expect(test.start.items[0]?.item_ref).toBe("clip:AI-0006@1");
    const fresh = deviceStartSession(
      "nazar",
      { ...body, study: { ...body.study, phase: "fresh" as const } },
      { locale: "en", deviceItems: device },
    );
    expect(fresh.start.items.map((i) => i.item_ref)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `clip:AI-000${n}@1`),
    );
  });

  it("an explicit form wins over the code; without device clips the fixtures fill the blocks", () => {
    const s = deviceStartSession(
      "nazar",
      { mode: "mock", study: { participant_code: "P-001", phase: "fresh" } },
      { locale: "en", studyForm: "C" },
    );
    expect(s.start.items).toHaveLength(5);
    expect(s.media).toBe("placeholder");
  });

  it("phase ll_mock deals the LL set in the common format (tenant DEFAULT: 15 questions, 9 to pass)", () => {
    const s = deviceStartSession(
      "ll_sim",
      { mode: "mock", study: { participant_code: "P-001", phase: "ll_mock" } },
      { locale: "en" },
    );
    expect(s.start.ctx.tenant).toBe("DEFAULT");
    expect(s.start.items.length).toBeGreaterThan(0);
    const c = s.deviceContent;
    expect(c?.gameId === "ll_sim" ? [c.format.questions, c.format.pass] : null).toEqual([15, 9]);
  });
});

describe("device sessions: Nazar deviceItems (AI-generated clips)", () => {
  it("deals the caller's clips in order with their media, and scores them on the device", () => {
    const device = aiClips(3);
    const s = deviceStartSession(
      "nazar",
      { mode: "practice" },
      { locale: "en", deviceItems: device },
    );
    expect(s.start.items.map((i) => i.item_ref)).toEqual(device.items.map((i) => i.ref));
    expect(s.start.items.every((i) => i.asset_url?.startsWith("https://"))).toBe(true);
    expect(s.start.items[0]?.reveal?.hazards[0]?.hazard_type).toBe("door_opening");
    expect(s.deviceContent?.gameId === "nazar" ? s.deviceContent.clips.length : 0).toBe(3);
  });

  it("clips without media fall back to the labelled placeholder", () => {
    const device = { ...aiClips(2), media: {} };
    const s = deviceStartSession(
      "nazar",
      { mode: "practice" },
      { locale: "en", deviceItems: device },
    );
    expect(s.media).toBe("placeholder");
    expect(s.start.items[0]?.asset_url).toBe("/en/learn/practise/nazar/clip/AI-0001");
  });
});

describe("real API shapes on the client", () => {
  it("sim items get their fixture scenario; LL items and clips never get a fixture document", () => {
    expect(fixturePublicDoc("sd:r1-40-dry") ?? fixturePublicDoc("bs:part-a-1")).toBeTruthy();
    expect(fixturePublicDoc("clip:KL-0001@1")).toBeUndefined();
    expect(fixturePublicDoc("q:C-LL1-001:v1")).toBeUndefined();
  });

  it("the seed's placeholder clips are recognised by size and hash only", () => {
    const placeholder = {
      kind: "clip",
      bytes: PLACEHOLDER_CLIP_BYTES,
      sha256: PLACEHOLDER_CLIP_SHA256,
    };
    expect(isPlaceholderClip(placeholder)).toBe(true);
    expect(isPlaceholderClip({ ...placeholder, sha256: "a".repeat(64) })).toBe(false);
    expect(isPlaceholderClip({ ...placeholder, bytes: 1000 })).toBe(false);
    expect(isPlaceholderClip({ ...placeholder, kind: "q" })).toBe(false);
  });

  it("an idempotent API-35 replay (xp_awarded null) keeps the XP of the first answer", () => {
    const first = { server_checked: true, xp_awarded: 40 } as CheckedSessionResult;
    const replay = { server_checked: true, xp_awarded: null } as CheckedSessionResult;
    expect(keepAwardedXp(replay, first).xp_awarded).toBe(40);
    expect(keepAwardedXp(replay, null).xp_awarded).toBeNull();
    expect(keepAwardedXp(first, { ...first, xp_awarded: 10 }).xp_awarded).toBe(40);
    const provisional = { server_checked: false, xp_awarded: 5 } as CheckedSessionResult;
    expect(keepAwardedXp(replay, provisional).xp_awarded).toBeNull();
  });
});

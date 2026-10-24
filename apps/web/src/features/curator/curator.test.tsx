// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import curatorEn from "../../../messages/en/curator.json";
import { FrameLedger } from "./BlurAudit";
import * as store from "./mock-store";
import { Publish } from "./Publish";
import { RatingPanel } from "./RaterForm";
import { canPublish, computeAgreement, framesTotal, publishChecks } from "./rules";
import type { BlurAuditSummary, Clip, ClipRating } from "./types";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: { href: string; children: ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

function Wrap({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ curator: curatorEn }} timeZone="Asia/Kolkata">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  store.resetMockStore();
});

const rating = (rater: string, a: number, b: number, cue: string): ClipRating => ({
  rating_id: `rtg_${rater.toUpperCase().replace("-", "")}X`,
  clip_id: "KL-0099",
  version: 1,
  rater,
  decision: "windows_set",
  marks: [{ hazard_type: "bus_stop_pedestrian", a_ms: a, b_ms: b, cue }],
  submitted_at: "2026-10-24T10:00:00Z",
});

const baseClip = (extra: Partial<Clip>): Clip => ({
  clip_id: "KL-0099",
  version: 1,
  item_ref: "clip:KL-0099@1",
  status: "proposed",
  origin: "filmed",
  duration_ms: 30_000,
  media: [
    { res: "360p", bytes: 1_000_000, sha256: "b".repeat(64) },
    { res: "480p", bytes: 2_000_000, sha256: "c".repeat(64) },
  ],
  speed_kmh_est: 30,
  licence: "CC-BY-4.0",
  flash_check: { passed: true },
  difficulty: { curator: 2 },
  ratings_visible: false,
  proposals_visible: false,
  rating_count: 0,
  ...extra,
});

const fullAudit = (duration = 30_000): BlurAuditSummary => ({
  auditor: "curator-01",
  rendition_sha256: "a".repeat(64),
  frames_total: framesTotal(duration),
  frames_checked: framesTotal(duration),
  misses: 0,
  audited_at: "2026-10-24T09:00:00Z",
  passed: true,
});

describe("rater form: blind until both ratings are saved (NAZAR §6.2)", () => {
  it("shows the blind form and nothing of the other rater before this rater saves", () => {
    const other = rating("rater-01", 12_000, 16_500, "SECRET-CUE-R1 boy behind the bus");
    // Defence in depth: even if a response carried the other rating, it must not render.
    const clip = baseClip({ rating_count: 1, ratings: [other] });
    render(
      <Wrap>
        <RatingPanel clip={clip} viewer="rater-02" canRate onSaved={() => {}} />
      </Wrap>,
    );
    expect(screen.getByTestId("rater-form")).toBeTruthy();
    expect(screen.getByTestId("rate-blind-note").textContent).toContain(
      "You can't see the other rater's window until you save",
    );
    expect(screen.queryByText(/SECRET-CUE-R1/)).toBeNull();
    expect(screen.queryByTestId("rating-rater-01")).toBeNull();
    expect(screen.queryByTestId("agreement")).toBeNull();
  });

  it("after saving, shows only the caller's own rating while the other is pending", () => {
    const mine = rating("rater-02", 12_300, 16_800, "my cue");
    const other = rating("rater-01", 12_000, 16_500, "the other cue");
    const clip = baseClip({ rating_count: 2, my_rating: mine, ratings: [other, mine] });
    // ratings_visible stays false here: the server has not reported both yet.
    render(
      <Wrap>
        <RatingPanel clip={clip} viewer="rater-02" canRate onSaved={() => {}} />
      </Wrap>,
    );
    expect(screen.queryByTestId("rater-form")).toBeNull();
    expect(screen.getByTestId("rating-rater-02")).toBeTruthy();
    expect(screen.queryByTestId("rating-rater-01")).toBeNull();
    expect(screen.queryByText(/the other cue/)).toBeNull();
  });

  it("shows both ratings and the agreement once both are saved", () => {
    const a = rating("rater-01", 12_000, 16_500, "the other cue");
    const b = rating("rater-02", 12_300, 16_800, "my cue");
    const agreement = computeAgreement("KL-0099", 1, a, b, "2026-10-24T10:06:00Z");
    const clip = baseClip({
      status: "rated",
      rating_count: 2,
      ratings_visible: true,
      ratings: [a, b],
      my_rating: b,
      agreement,
    });
    render(
      <Wrap>
        <RatingPanel clip={clip} viewer="rater-02" canRate onSaved={() => {}} />
      </Wrap>,
    );
    expect(screen.getByTestId("rating-rater-01").textContent).toContain("the other cue");
    expect(screen.getByTestId("agreement-result").getAttribute("data-accepted")).toBe("true");
  });

  it("the mock server view hides the other rating, proposals and agreement until both exist", () => {
    const r1 = store.rateClip(store.MOCK_PERSONAS[1] ?? null, "KL-0011", {
      version: 1,
      decision: "windows_set",
      marks: [{ hazard_type: "auto_cut_in", a_ms: 9_000, b_ms: 13_000, cue: "auto drifts left" }],
    });
    expect(r1.rater).toBe("rater-01");
    const seenBy2 = store.getClip(store.MOCK_PERSONAS[2] ?? null, "KL-0011");
    expect(seenBy2.ratings_visible).toBe(false);
    expect(seenBy2.ratings).toBeUndefined();
    expect(seenBy2.agreement).toBeUndefined();
    expect(seenBy2.my_rating).toBeUndefined();
    expect(seenBy2.rating_count).toBe(1);
    store.rateClip(store.MOCK_PERSONAS[2] ?? null, "KL-0011", {
      version: 1,
      decision: "windows_set",
      marks: [{ hazard_type: "auto_cut_in", a_ms: 9_200, b_ms: 13_400 }],
    });
    const after = store.getClip(store.MOCK_PERSONAS[2] ?? null, "KL-0011");
    expect(after.ratings_visible).toBe(true);
    expect(after.ratings).toHaveLength(2);
    expect(after.agreement?.accepted).toBe(true);
    expect(after.status).toBe("rated");
  });

  it("refuses a second rating from the same rater", () => {
    const p = store.MOCK_PERSONAS[1] ?? null;
    const body = {
      version: 1,
      decision: "windows_set" as const,
      marks: [{ hazard_type: "child_school" as const, a_ms: 1000, b_ms: 3000 }],
    };
    store.rateClip(p, "KL-0011", body);
    expect(() => store.rateClip(p, "KL-0011", body)).toThrow(/already rated/);
  });
});

describe("publish is blocked without two ratings and a 100% blur audit", () => {
  const ready = (): Clip => {
    const a = rating("rater-01", 12_000, 16_500, "x");
    const b = rating("rater-02", 12_300, 16_800, "y");
    const agreement = computeAgreement("KL-0099", 1, a, b, "2026-10-24T10:06:00Z");
    return baseClip({
      status: "rated",
      rating_count: 2,
      ratings_visible: true,
      ratings: [a, b],
      agreement,
      blur_audit: fullAudit(),
      hazards: agreement.final_hazards.map(({ cues: _c, ...h }) => ({
        ...h,
        cue_text: { en: "Feet at the bus front", hi: "बस के आगे पैर" },
      })),
    });
  };

  it("a complete clip can publish", () => {
    expect(canPublish(ready())).toBe(true);
  });

  it("one rating: blocked", () => {
    const c = { ...ready(), rating_count: 1, agreement: undefined } as unknown as Clip;
    const failing = publishChecks(c)
      .filter((x) => !x.ok)
      .map((x) => x.id);
    expect(failing).toEqual(expect.arrayContaining(["two_ratings", "agreement"]));
    expect(canPublish(c)).toBe(false);
  });

  it("audit below 100% or with a miss: blocked", () => {
    const partial = ready();
    const audit = fullAudit();
    partial.blur_audit = { ...audit, frames_checked: audit.frames_total - 1, passed: false };
    expect(canPublish(partial)).toBe(false);
    const missed = ready();
    missed.blur_audit = { ...audit, misses: 1, passed: false };
    expect(canPublish(missed)).toBe(false);
    const none = ready();
    none.blur_audit = null;
    expect(publishChecks(none).find((x) => x.id === "blur_audit")?.ok).toBe(false);
  });

  it("the Publish button is disabled and the missing checks are explained", () => {
    const c = { ...ready(), rating_count: 1, blur_audit: null };
    render(
      <Wrap>
        <Publish clip={c} onPublished={() => {}} />
      </Wrap>,
    );
    const btn = screen.getByTestId("publish-go");
    expect(btn.hasAttribute("disabled") || btn.getAttribute("data-disabled") === "true").toBe(true);
    expect(screen.getByTestId("check-two_ratings").getAttribute("data-ok")).toBe("false");
    expect(screen.getByTestId("check-blur_audit").getAttribute("data-ok")).toBe("false");
    expect(screen.getByTestId("publish-blocked")).toBeTruthy();
  });

  it("the mock server refuses publish with the failing checks", () => {
    const curator = store.MOCK_PERSONAS[0] ?? null;
    expect(() => store.publishClip(curator, "KL-0011")).toThrow(/preconditions/);
    try {
      store.publishClip(curator, "KL-0011");
    } catch (e) {
      expect((e as store.MockProblem).detail).toContain("two_ratings");
    }
  });
});

describe("agreement and adjudication (mock stand-ins)", () => {
  it("a type mismatch or a 1.2 s onset gap goes to adjudication", () => {
    const a = rating("rater-01", 11_000, 16_000, "a");
    const b: ClipRating = {
      ...rating("rater-02", 12_200, 17_900, "b"),
      marks: [{ hazard_type: "parked_vehicle_hidden", a_ms: 12_200, b_ms: 17_900 }],
    };
    const ag = computeAgreement("KL-0099", 1, a, b, "2026-10-24T10:06:00Z");
    expect(ag.accepted).toBe(false);
    expect(ag.reasons).toEqual(expect.arrayContaining(["type_mismatch", "onset_delta"]));
    expect(ag.final_hazards).toEqual([]);
  });

  it("an adjudicator who rated the clip is refused", () => {
    expect(() =>
      store.adjudicateClip({ pseudonym: "rater-01", roles: ["curator"] }, "KL-0008", {
        version: 1,
        reason_code: "type_resolved",
        decisions: [],
      }),
    ).toThrow(/must not be a rater/);
  });

  it("the curator resolves every cluster and the clip is rated", () => {
    const curator = store.MOCK_PERSONAS[0] ?? null;
    const before = store.getClip(curator, "KL-0008");
    const clusters = before.agreement?.clusters ?? [];
    const out = store.adjudicateClip(curator, "KL-0008", {
      version: 1,
      reason_code: "type_resolved",
      decisions: clusters.map((c) => ({
        cluster_id: c.cluster_id,
        verdict: "hazard" as const,
        mark: { hazard_type: "pedestrian_median" as const, a_ms: 11_500, b_ms: 16_500 },
      })),
    });
    expect(out.status).toBe("rated");
    expect(out.hazards?.every((h) => h.adjudicated)).toBe(true);
  });
});

describe("blur audit bookkeeping", () => {
  it("counts each frame once and reaches 100% only when all are shown", () => {
    const total = framesTotal(45_000);
    expect(total).toBe(1350);
    const l = new FrameLedger(total);
    l.mark(0, 99);
    l.mark(50, 149);
    expect(l.checked).toBe(150);
    l.mark(0, total - 1);
    expect(l.checked).toBe(total);
  });
});

describe("AI-generated clips (product decision 2026-10-24)", () => {
  const reviewAll = {
    no_real_likeness: true,
    no_readable_plates: true,
    no_real_brands: true,
    no_collision_or_injury: true,
    hazard_visible: true,
  };

  it("skip the blur audit but need a passed synthetic review, two ratings and agreement", () => {
    const a = rating("rater-01", 12_000, 16_500, "x");
    const b = rating("rater-02", 12_300, 16_800, "y");
    const agreement = computeAgreement("KL-0099", 1, a, b, "2026-10-24T10:06:00Z");
    const ai = baseClip({
      origin: "ai_generated",
      status: "rated",
      rating_count: 2,
      ratings_visible: true,
      agreement,
      blur_audit: null,
      synthetic_review: null,
      hazards: agreement.final_hazards.map(({ cues: _c, ...h }) => ({
        ...h,
        cue_text: { en: "Feet at the bus front", hi: "बस के आगे पैर" },
      })),
    });
    const ids = publishChecks(ai).map((c) => c.id);
    expect(ids).toContain("synthetic_review");
    expect(ids).not.toContain("blur_audit");
    expect(canPublish(ai)).toBe(false);
    const reviewed: Clip = {
      ...ai,
      synthetic_review: {
        reviewer: "curator-01",
        reviewed_at: "2026-10-24T11:00:00Z",
        checks: reviewAll,
        passed: true,
      },
    };
    expect(canPublish(reviewed)).toBe(true);
    // One unticked check, or no reviewer, still blocks.
    expect(
      canPublish({
        ...reviewed,
        synthetic_review: {
          ...(reviewed.synthetic_review as NonNullable<Clip["synthetic_review"]>),
          checks: { ...reviewAll, hazard_visible: false },
        },
      }),
    ).toBe(false);
    // Two raters stay required for AI clips too.
    expect(canPublish({ ...reviewed, rating_count: 1 })).toBe(false);
  });

  it("the mock store generates an AI clip, refuses a blur audit on it and records the review", () => {
    const curator = store.MOCK_PERSONAS[0] ?? null;
    const accepted = store.generateClip(curator, {
      sceneId: "SC-SCHOOL-01",
      version: 1,
      batchId: "batch-test-01",
    });
    // Same shape as the API's 202 (ClipGenerateAccepted), not a Clip.
    expect(accepted).toMatchObject({
      scene_id: "SC-SCHOOL-01",
      version: 1,
      batch_id: "batch-test-01",
      origin: "ai_generated",
      generation_key: "SC-SCHOOL-01:1:batch-test-01",
      workflow_run: { job: "clip_generate", status: "started" },
    });
    expect(() =>
      store.generateClip(curator, { sceneId: "SC-SCHOOL-01", version: 2, batchId: "batch-x1" }),
    ).toThrow(/revision/);
    const c = accepted.clip as Clip;
    expect(c.origin).toBe("ai_generated");
    expect(c.status).toBe("raw");
    const ready = store.simulateIngest(curator, c.clip_id);
    expect(ready.status).toBe("proposed");
    expect(() =>
      store.recordBlurAudit(curator, c.clip_id, {
        version: 1,
        rendition_sha256: "a".repeat(64),
        frames_total: 1,
        frames_checked: 1,
        misses: 0,
        miss_frames: [],
      }),
    ).toThrow(/skip the blur audit/);
    const half = store.recordSyntheticReview(curator, c.clip_id, {
      version: 1,
      checks: { ...reviewAll, no_real_brands: false },
    });
    expect(half.synthetic_review?.passed).toBe(false);
    const full = store.recordSyntheticReview(curator, c.clip_id, { version: 1, checks: reviewAll });
    expect(full.synthetic_review).toMatchObject({ passed: true, reviewer: "curator-01" });
    expect(full.synthetic_review?.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("publish needs both renditions (server check missing_rendition)", () => {
    const only480 = baseClip({ media: [{ res: "480p", bytes: 1, sha256: "c".repeat(64) }] });
    expect(publishChecks(only480).find((c) => c.id === "missing_rendition")?.ok).toBe(false);
    expect(publishChecks(baseClip({})).find((c) => c.id === "missing_rendition")?.ok).toBe(true);
  });

  it("a filmed clip cannot take a synthetic review instead of the blur audit", () => {
    expect(() =>
      store.recordSyntheticReview(store.MOCK_PERSONAS[0] ?? null, "KL-0004", {
        version: 1,
        checks: reviewAll,
      }),
    ).toThrow(/blur audit/);
  });
});

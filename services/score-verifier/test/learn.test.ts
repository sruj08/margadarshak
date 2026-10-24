// routes/learn.ts: the maths pass-throughs (with the gamification README's golden numbers) and the
// three endpoints over real HTTP on an ephemeral port.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { LlAnswerKey } from "@margdarshak/game-core/schema";
import { DAY_MS, istWeek, type RatedAnswer, SKILL_NODES } from "@margdarshak/gamification";
import { buildContent, writeContent } from "../scripts/build-content.ts";
import { DirectoryContentStore } from "../src/content-store.ts";
import { sign } from "../src/hmac.ts";
import {
  calibrationSummary,
  EvaluateRequest,
  evaluateGamification,
  LearnAnswersRequest,
  LearnAnswersResponse,
  LearnStateResponse,
  readinessFrom,
  scoreAnswers,
} from "../src/routes/learn.ts";
import {
  call,
  NOW,
  NOW_MS,
  post,
  type Reply,
  type Running,
  SECRET,
  startVerifier,
} from "./helpers.ts";

const answers = (n: number, confidence: "50" | "75" | "100", correct: number): RatedAnswer[] =>
  Array.from({ length: n }, (_, i) => ({ confidence, correct: i < correct }));

const problem = (r: Reply, status: number, slug: string): void => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.match(r.type, /^application\/problem\+json/);
  assert.equal(r.body["type"], `https://margdarshak.example/problems/${slug}`);
};

const week = (offsetWeeks: number): string => istWeek(NOW_MS + offsetWeeks * 7 * DAY_MS).key;

/** A minimal valid /gamification/evaluate request. */
function evaluateBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    now: NOW_MS,
    minutesToday: 0,
    sessionMinutes: 0,
    xpTotal: 0,
    nodeStates: {},
    verifiedNazarMocks: 0,
    currentRank: null,
    streakState: null,
    weekKey: week(0),
    sessionsThisWeek: 1,
    badgeHistory: { hasAccount: true },
    ...over,
  };
}

const mock58 = {
  gameId: "nazar",
  mode: "mock",
  score: { pct: 58 },
  integrity: { trust: 1, flags: [] },
};

const evaluate = (over: Record<string, unknown>) =>
  evaluateGamification(EvaluateRequest.parse(evaluateBody(over)));

describe("calibration and readiness goldens (gamification README)", () => {
  it("Brier = 0.25 when every answer is at 50%, whatever the accuracy", () => {
    assert.equal(calibrationSummary(answers(40, "50", 13)).brier, 0.25);
    assert.equal(calibrationSummary(answers(40, "50", 40)).brier, 0.25);
  });
  it("Brier = 0.39 when every answer is at 100% with 61% accuracy", () => {
    assert.equal(calibrationSummary(answers(100, "100", 61), undefined, 100).brier, 0.39);
  });
  it("readiness 78 = knowledge 84 − calibration 6", () => {
    const r = readinessFrom({ LL1: 0.9, LL2: 0.85, LL3: 0.8, LL4: 0.81 }, [
      ...answers(8, "100", 6),
      ...answers(12, "75", 7),
    ]);
    assert.deepEqual([r.readiness, r.knowledge, r.calPenalty], [78, 84, 6]);
    assert.equal(r.gate.bookAnywayVisible, true);
  });
  it("calibration bins and sure-and-wrong", () => {
    const c = calibrationSummary([...answers(4, "100", 1), ...answers(2, "50", 1)]);
    assert.equal(c.n, 6);
    assert.equal(c.sureAndWrong, 3);
    assert.deepEqual(
      c.bins.map((b) => [b.stated, b.n, b.accuracy]),
      [
        ["50", 2, 0.5],
        ["75", 0, null],
        ["100", 4, 0.25],
      ],
    );
  });
});

describe("XP, rank and streak maths", () => {
  it("Nazar mock at 58% → 23 XP; ×0.5 after 45 minutes; ×0.2 after 90", () => {
    assert.equal(evaluate({ session: mock58 }).xp.session?.xp, 23);
    const at45 = evaluate({ session: mock58, minutesToday: 45 }).xp.session;
    assert.deepEqual([at45?.diminish, at45?.xp], [0.5, 12]);
    const at90 = evaluate({ session: mock58, minutesToday: 90 }).xp.session;
    assert.deepEqual([at90?.diminish, at90?.xp], [0.2, 5]);
    // A session straddling 45 is split pro rata: 30 → 60 min = ×0.75.
    assert.equal(
      evaluate({ session: mock58, minutesToday: 30, sessionMinutes: 30 }).xp.session?.diminish,
      0.75,
    );
  });
  it("due reviews earn 5 each after the session's minutes; nothing else earns XP", () => {
    const r = evaluate({ reviews: { dueCardsReviewed: 12, reviewMinutes: 0 }, minutesToday: 60 });
    assert.equal(r.xp.reviews?.xp, 30);
    assert.equal(r.xp.session, null);
    const none = evaluate({});
    assert.deepEqual([none.xp.gained, none.xp.total], [0, 0]);
    const seen = evaluate({
      session: { ...mock58, integrity: { trust: 1, flags: ["INT_SEEN_CLIP"] } },
    });
    assert.equal(seen.xp.session?.xp, 0);
    assert.equal(seen.xp.session?.zeroReason, "seen_clip_replay");
  });
  it("rank needs XP and mastery, promotes once, and never demotes", () => {
    const xpOnly = evaluate({ session: mock58, xpTotal: 5000 });
    assert.equal(xpOnly.rank.rank, "R1", "XP alone cannot unlock a rank");
    const up = evaluate({
      session: mock58,
      xpTotal: 290,
      nodeStates: { "SK-LL1": "learning", "SK-M1": "learning" },
    });
    assert.deepEqual([up.xp.total, up.rank.rank, up.rank.promoted], [313, "R2", true]);
    const held = evaluate({ currentRank: "R3", xpTotal: 0, nodeStates: {} });
    assert.deepEqual([held.rank.rank, held.rank.promoted], ["R3", false]);
    assert.equal(held.rank.next?.rank, "R4");
  });
  it("streak: goal met, token, repairable, repaired, idempotent, archived; never notifies", () => {
    const base = { status: "active", weeks: 2, tokens: 0, goal: 4 } as const;
    const met = evaluate({
      streakState: { ...base, lastClosedWeek: week(-2) },
      closedWeeks: [{ weekKey: week(-1), sessions: 4 }],
    }).streak;
    assert.deepEqual(met.events, ["goal_met"]);
    assert.deepEqual(
      [met.state.weeks, met.state.tokens, met.state.lastClosedWeek],
      [3, 1, week(-1)],
    );
    assert.equal(met.notify, false);

    const lapsed = evaluate({
      streakState: { ...base, tokens: 1, lastClosedWeek: week(-3) },
    }).streak;
    assert.deepEqual(lapsed.events, ["token_applied", "became_repairable"]);
    assert.equal(lapsed.state.status, "repairable");
    assert.equal(lapsed.view.pothole, true);
    assert.equal(lapsed.view.dots, 6, "goal + 2 while repairing");

    const repaired = evaluate({
      streakState: { ...base, status: "repairable", lastClosedWeek: week(-2) },
      closedWeeks: [{ weekKey: week(-1), sessions: 6 }],
    }).streak;
    assert.deepEqual(
      [repaired.events, repaired.state.status, repaired.state.weeks],
      [["repaired"], "active", 3],
    );

    const again = evaluate({
      streakState: met.state,
      closedWeeks: [{ weekKey: week(-1), sessions: 9 }],
    });
    assert.deepEqual(again.streak.events, [], "closing a closed week changes nothing");
    assert.deepEqual(again.streak.state, met.state);

    const fresh = evaluate({}).streak;
    assert.deepEqual([fresh.state.weeks, fresh.state.lastClosedWeek, fresh.events], [0, null, []]);

    const archived = evaluate({ streakState: met.state, testPassedAt: NOW_MS }).streak;
    assert.equal(archived.state.status, "archived");
    assert.ok(archived.events.includes("archived"));
  });
  it("badges: awarded once, silently revoked, criteria from the package", () => {
    const r = evaluate({
      badgeHistory: { hasAccount: true, declarations: { firstAttemptPass: true } },
      earnedBadges: ["B1"],
    }).badges;
    assert.equal(r.statuses.length, 9);
    assert.deepEqual(r.awarded, ["B2"]);
    assert.deepEqual(r.revoked, ["B1"]);
    const b2 = r.statuses.find((b) => b.id === "B2");
    assert.equal(b2?.yourWord, true);
    const held = evaluate({
      badgeHistory: { hasAccount: true, declarations: { firstAttemptPass: true } },
      earnedBadges: ["B2"],
    }).badges;
    assert.deepEqual(held.awarded, []);
  });
});

describe("answers maths", () => {
  const key = (qref: string, correct: string): LlAnswerKey =>
    LlAnswerKey.parse({
      qref,
      cardId: qref.split(":")[0],
      correctOptionId: correct,
      topic: "LL1",
      signFamily: null,
      signId: null,
    });
  it("rates from evidence, keeps plausible device times and is monotonic per card", () => {
    const keys = new Map([
      ["C-LL1-001:v1", key("C-LL1-001:v1", "a")],
      ["C-LL1-002:v1", key("C-LL1-002:v1", "b")],
    ]);
    const req = LearnAnswersRequest.parse({
      now: NOW_MS,
      reviewLog: [{ cardId: "C-LL1-002", rating: 3, reviewedAt: NOW_MS - 2 * DAY_MS }],
      answers: [
        {
          client_answer_id: "a1",
          qref: "C-LL1-001:v1",
          selected_option_id: "a",
          confidence: "100",
          answered_at: NOW_MS - 60_000,
        },
        {
          client_answer_id: "a2",
          qref: "C-LL1-002:v1",
          selected_option_id: "c",
          confidence: "100",
          answered_at: NOW_MS - 3 * DAY_MS,
        },
        {
          client_answer_id: "a3",
          qref: "C-LL1-001:v1",
          selected_option_id: null,
          answered_at: NOW_MS - 30_000,
        },
      ],
    });
    const out = LearnAnswersResponse.parse(scoreAnswers(req, keys));
    const [a1, a2, a3] = out.results;
    assert.deepEqual([a1?.correct, a1?.rating, a1?.overconfident], [true, 4, false]);
    assert.deepEqual([a2?.correct, a2?.rating, a2?.overconfident], [false, 1, true]);
    assert.equal(a2?.reviewed_at, NOW_MS, "3 days off device time → receipt time (EC-15)");
    assert.equal(a1?.reviewed_at, NOW_MS - 60_000, "plausible device time kept");
    assert.deepEqual([a3?.correct, a3?.rating], [false, 1], "no answer is wrong");
    assert.ok((a1?.next_due_at ?? 0) > (a3?.next_due_at ?? 0), "Easy then Again: due moves in");
    assert.deepEqual(
      out.cards.map((c) => [c.cardId, c.reviews]),
      [
        ["C-LL1-001", 2],
        ["C-LL1-002", 2],
      ],
    );
  });
});

describe("learn routes over HTTP", () => {
  const built = buildContent();
  let dir: string;
  let v: Running;
  const qrefs = [...built.files.keys()]
    .filter((p) => p.startsWith("q/"))
    .slice(0, 3)
    .map((p) => LlAnswerKey.parse(built.files.get(p)));
  before(async () => {
    dir = join(mkdtempSync(join(tmpdir(), "verifier-learn-")), "content");
    writeContent(built, dir, null);
    v = await startVerifier({ store: new DirectoryContentStore(dir) });
  });
  after(async () => {
    await v.close();
    rmSync(join(dir, ".."), { recursive: true, force: true });
  });

  it("every new route is HMAC-signed", async () => {
    for (const path of ["/learn/answers", "/learn/state", "/gamification/evaluate"]) {
      const text = JSON.stringify({ now: NOW_MS });
      const r = await post(v.url, text, { path, header: null });
      problem(r, 401, "unauthorized");
      assert.equal(r.body["code"], "signature_missing");
      const wrong = await post(v.url, text, { path, secret: "nope", signAt: NOW - 1 });
      assert.equal(wrong.body["code"], "signature_mismatch");
      const header = sign(SECRET, NOW - 2, text);
      await post(v.url, text, { path, header });
      const replay = await post(v.url, text, { path, header });
      assert.equal(replay.body["code"], "signature_replayed");
      const get = await fetch(`${v.url}${path}`);
      assert.equal(get.status, 405);
    }
  });

  it("/learn/answers: correctness from the verifier's server keys", async () => {
    const [k1, k2, k3] = qrefs as [LlAnswerKey, LlAnswerKey, LlAnswerKey];
    const wrongOption = (k: LlAnswerKey) => (k.correctOptionId === "a" ? "b" : "a");
    const r = await call(v.url, "/learn/answers", {
      now: NOW_MS,
      reviewLog: [],
      answers: [
        {
          client_answer_id: "x1",
          qref: k1.qref,
          selected_option_id: k1.correctOptionId,
          confidence: "75",
          answered_at: NOW_MS - 1000,
        },
        {
          client_answer_id: "x2",
          qref: k2.qref,
          selected_option_id: wrongOption(k2),
          confidence: "100",
          answered_at: NOW_MS - 900,
        },
        {
          client_answer_id: "x3",
          qref: k3.qref,
          selected_option_id: k3.correctOptionId,
          confidence: "50",
          answered_at: NOW_MS - 800,
        },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const body = LearnAnswersResponse.parse(r.body);
    assert.deepEqual(
      body.results.map((x) => [
        x.client_answer_id,
        x.correct,
        x.rating,
        x.overconfident,
        x.card_id,
      ]),
      [
        ["x1", true, 3, false, k1.cardId],
        ["x2", false, 1, true, k2.cardId],
        ["x3", true, 2, false, k3.cardId],
      ],
    );
    for (const x of body.results) assert.ok(x.next_due_at > x.reviewed_at);
    assert.ok(!JSON.stringify(r.body).includes("correctOption"), "keys never leave the verifier");
  });

  it("/learn/answers: unknown question 422, unknown field and duplicates 400", async () => {
    const answer = {
      client_answer_id: "y1",
      qref: "C-LL9-999:v9",
      selected_option_id: "a",
      answered_at: NOW_MS,
    };
    const unknown = await call(v.url, "/learn/answers", {
      now: NOW_MS,
      reviewLog: [],
      answers: [answer],
    });
    problem(unknown, 422, "content-not-found");
    const extra = await call(v.url, "/learn/answers", {
      now: NOW_MS,
      reviewLog: [],
      answers: [answer],
      userId: "u1",
    });
    problem(extra, 400, "validation-failed");
    assert.ok((extra.body["errors"] as { path: string }[]).length > 0);
    const k = qrefs[0] as LlAnswerKey;
    const a = { ...answer, qref: k.qref };
    const dup = await call(v.url, "/learn/answers", {
      now: NOW_MS,
      reviewLog: [],
      answers: [a, a],
    });
    problem(dup, 400, "validation-failed");
    const noNow = await call(v.url, "/learn/answers", { reviewLog: [], answers: [a] });
    problem(noNow, 400, "validation-failed");
  });

  const stateBody = (log: unknown[]) => ({
    now: NOW_MS,
    reviewLog: log,
    ratedAnswers: answers(40, "50", 20),
    conceptCounts: { LL1: 30, LL2: 23, LL3: 10, LL4: 12, M1: 10 },
    stateCode: "JK",
    gameCriteriaMet: ["SK-LL1"],
  });
  const log = ["C-LL1-001", "C-LL1-002", "C-LL2-001", "C-M1-001"].flatMap((cardId, i) => [
    { cardId, rating: 3, reviewedAt: NOW_MS - (20 - i) * DAY_MS },
    { cardId, rating: 4, reviewedAt: NOW_MS - (10 - i) * DAY_MS },
  ]);

  it("/learn/state: deterministic, order-independent, full shape", async () => {
    const a = await call(v.url, "/learn/state", stateBody(log));
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await call(v.url, "/learn/state", stateBody([...log].reverse()));
    assert.deepEqual(b.body, a.body, "same log in any order → same state");
    const c = await call(v.url, "/learn/state", stateBody(log));
    assert.deepEqual(c.body, a.body);
    const s = LearnStateResponse.parse(a.body);
    assert.equal(s.cards.length, 4);
    assert.deepEqual(Object.keys(s.nodeStates).sort(), [...SKILL_NODES].sort());
    assert.equal(s.nodeStates["SK-LL1"], "learning");
    assert.equal(s.nodeStates["SK-M5"], "locked");
    assert.equal(s.masteryByTopic["LL1"]?.covered, 2);
    assert.equal(s.calibration.brier, 0.25);
    assert.equal(s.readiness.gate.bookAnywayVisible, true);
    assert.ok(s.readiness.gate.reasons.includes("no_mock_data"));
    assert.equal(s.roadReadiness.score, null, "no Nazar Score yet");
    assert.ok(s.roadReadiness.modules.includes("M14"), "J&K adds the hill module");
    const withNazar = await call(v.url, "/learn/state", { ...stateBody(log), nazarScore: 80 });
    assert.equal(typeof (withNazar.body["roadReadiness"] as { score: unknown }).score, "number");
  });

  it("/learn/state: readiness calibration penalty from the README example", async () => {
    const r = await call(v.url, "/learn/state", {
      ...stateBody([]),
      ratedAnswers: [...answers(8, "100", 6), ...answers(12, "75", 7)],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = LearnStateResponse.parse(r.body);
    assert.deepEqual(
      [s.readiness.knowledge, s.readiness.calPenalty, s.readiness.readiness],
      [0, 6, 0],
    );
    const tooMany = await call(v.url, "/learn/state", {
      ...stateBody([]),
      ratedAnswers: answers(41, "50", 1),
    });
    problem(tooMany, 400, "validation-failed");
  });

  it("/gamification/evaluate: XP, rank and streak over HTTP", async () => {
    const r = await call(
      v.url,
      "/gamification/evaluate",
      evaluateBody({ session: mock58, minutesToday: 45, currentRank: "R2" }),
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const body = r.body as {
      xp: { session: { xp: number } };
      rank: { rank: string };
      streak: { notify: boolean };
    };
    assert.equal(body.xp.session.xp, 12);
    assert.equal(body.rank.rank, "R2", "never below the held rank");
    assert.equal(body.streak.notify, false);
    const badWeek = await call(
      v.url,
      "/gamification/evaluate",
      evaluateBody({ weekKey: week(-1) }),
    );
    problem(badWeek, 422, "week-mismatch");
    const future = await call(
      v.url,
      "/gamification/evaluate",
      evaluateBody({ closedWeeks: [{ weekKey: week(0), sessions: 1 }] }),
    );
    problem(future, 422, "week-mismatch");
    const extra = await call(v.url, "/gamification/evaluate", evaluateBody({ coins: 5 }));
    problem(extra, 400, "validation-failed");
    const fullResult = await call(
      v.url,
      "/gamification/evaluate",
      evaluateBody({ session: { ...mock58, sid: "x" } }),
    );
    problem(fullResult, 400, "validation-failed");
  });
});

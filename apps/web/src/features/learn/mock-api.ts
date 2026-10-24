import {
  canJoinSquad,
  type GateInput,
  type NodeStates,
  type RankId,
  type RatedAnswer,
  squadWeeklyGoal,
} from "@margdarshak/gamification";
import type {
  Achievement,
  AnswerResult,
  AnswerSubmission,
  KhudLicenceDeclaration,
  Readiness,
  ReviewItem,
  Squad,
  SquadCreate,
  SquadJoin,
} from "./api-types";
import type { BankItem, LlTopicId } from "./content/bank-types";
import { deviceQueue, deviceReadiness } from "./learning";
import { LEARN_KEYS, readKv, writeKv } from "./offline/kv";
import { reviewStore } from "./offline/review-store";
import type { LearnerProfile } from "./profile";
import { type Declarations, deviceAchievement, rankKey, sessionsThisWeek } from "./progress";

/**
 * The device implementation of the learning API (mock mode, and the stand-in when the Go endpoint is
 * not live). It honours the same contract as the server: API-32 dedupes on `client_answer_id`, a
 * minor needs the parent's consent for squads (403 PARENT_CONSENT_REQUIRED), squads cap at 5 (409
 * SQUAD_FULL), invites expire after 7 days (409 INVITE_EXPIRED). Offline, calls that need "the
 * server" throw MockOffline, exactly as a real request would fail.
 */

export class MockOffline extends Error {}

export class MockProblem extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

function online(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new MockOffline();
}

// ---------- API-31 / API-33 (computed from the device log) ----------

export async function reviewQueue(
  items: readonly BankItem[],
  now: number,
  topic?: string | null,
): Promise<ReviewItem[]> {
  return deviceQueue(await reviewStore().log(), now, items, topic);
}

export interface LlMockRecord {
  sid: string;
  at: number;
  state: string;
  correct: number;
  total: number;
  pass: number;
  passed: boolean;
  pct: number;
  provisional: boolean;
  passPct: number;
  wrong: { itemId: string; optionId: string | null }[];
  selfEstimate?: number;
}

export function llMocks(): LlMockRecord[] {
  return readKv<LlMockRecord[]>(LEARN_KEYS.llsim, []);
}

export function gateInputFromMocks(mocks: readonly LlMockRecord[]): GateInput | undefined {
  const last = mocks.at(-1);
  if (!last) return undefined;
  return { llMockPcts: mocks.map((m) => m.pct), passMarkPct: last.passPct };
}

export async function readiness(
  now: number,
  conceptCounts: Record<LlTopicId, number>,
): Promise<{ data: Readiness; answered: number }> {
  const log = await reviewStore().log();
  const data = deviceReadiness(log, now, conceptCounts, gateInputFromMocks(llMocks()));
  return { data, answered: log.filter((e) => e.mode !== "mock").length };
}

// ---------- API-32 (the "server" side of the outbox, kept on this phone in mock mode) ----------

interface MockServer {
  answers: Record<string, true>;
  batches: number;
}

export async function submitAnswers(batch: readonly AnswerSubmission[]): Promise<AnswerResult[]> {
  online();
  const srv = readKv<MockServer>(LEARN_KEYS.mockServer, { answers: {}, batches: 0 });
  const answers = { ...srv.answers };
  const log = await reviewStore().log();
  const byId = new Map(log.map((e) => [e.id, e] as const));
  const results: AnswerResult[] = batch.map((a) => {
    const duplicate = answers[a.client_answer_id] === true;
    answers[a.client_answer_id] = true;
    const entry = byId.get(a.client_answer_id);
    return {
      client_answer_id: a.client_answer_id,
      correct: entry?.correct ?? false,
      rating: entry?.rating ?? 1,
      overconfident: entry?.overconfident ?? false,
      duplicate,
    };
  });
  writeKv(LEARN_KEYS.mockServer, { answers, batches: srv.batches + 1 });
  return results;
}

/** Test hook: how many distinct answers the mock server holds, and how many batches it took. */
export function mockServerStats(): { answers: number; batches: number } {
  const srv = readKv<MockServer>(LEARN_KEYS.mockServer, { answers: {}, batches: 0 });
  return { answers: Object.keys(srv.answers).length, batches: srv.batches };
}

// ---------- API-38 / API-44 ----------

export function achievements(
  now: number,
  nodeStates: NodeStates,
  answers: readonly RatedAnswer[],
): Achievement {
  return deviceAchievement(now, nodeStates, answers, true);
}

export function declareKhudLicence(body: KhudLicenceDeclaration | { no: true }): void {
  const prev = readKv<Declarations>(LEARN_KEYS.decl, {});
  if ("no" in body) {
    writeKv(LEARN_KEYS.decl, { ...prev, answeredNo: true });
    return;
  }
  writeKv(LEARN_KEYS.decl, {
    ...prev,
    answeredNo: false,
    khudLicence: { dlIssueDate: body.dl_issued_on },
    ...(body.first_attempt_pass === undefined ? {} : { firstAttemptPass: body.first_attempt_pass }),
  });
}

// ---------- API-39 squads (a squad "server" on this phone) ----------

interface MockSquad extends Squad {
  created_at: number;
}

interface SquadDb {
  squads: MockSquad[];
}

function db(): SquadDb {
  return readKv<SquadDb>(LEARN_KEYS.squads, { squads: [] });
}

function save(d: SquadDb): void {
  writeKv(LEARN_KEYS.squads, d);
}

const ID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function code(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

function myRank(): Squad["members"][number]["rank"] {
  const r = readKv<RankId | null>(LEARN_KEYS.rank, null);
  return r ? rankKey(r) : "gali";
}

function view(s: MockSquad, now: number): Squad {
  const mine = sessionsThisWeek(now);
  const members = s.members.map((m) =>
    m.is_me ? { ...m, rank: myRank(), weekly_goal_hit: mine >= 3 } : m,
  );
  const others = members.filter((m) => !m.is_me && m.weekly_goal_hit).length * 3;
  return {
    ...s,
    members,
    squad_score: null,
    weekly_progress: { done: Math.min(mine, 3) + others, goal: squadWeeklyGoal(members.length) },
  };
}

function guard(profile: LearnerProfile, memberCount: number, inviteCreatedAt: number, now: number) {
  const d = canJoinSquad(profile, { memberCount, inviteCreatedAt }, now);
  if (d.allowed) return;
  if (d.reason === "needs_parent_consent") throw new MockProblem(403, "PARENT_CONSENT_REQUIRED");
  if (d.reason === "needs_account") throw new MockProblem(401, "UNAUTHENTICATED");
  if (d.reason === "squad_full") throw new MockProblem(409, "SQUAD_FULL");
  throw new MockProblem(409, "INVITE_EXPIRED");
}

export function createSquad(body: SquadCreate, profile: LearnerProfile, now: number): Squad {
  online();
  guard(profile, 0, now, now);
  const s: MockSquad = {
    squad_id: `sqd_${code(10)}`,
    name: body.name.trim(),
    invite_code: `SQ-${code(4)}`,
    invite_expires_at: new Date(now + 7 * 86_400_000).toISOString(),
    created_at: now,
    members: [
      {
        display_name: body.display_name.trim(),
        rank: myRank(),
        weekly_goal_hit: false,
        role: "owner",
        is_me: true,
      },
    ],
    squad_score: null,
    weekly_progress: { done: 0, goal: 3 },
  };
  save({ squads: [...db().squads, s] });
  return view(s, now);
}

/** Like the server, only the create response carries the invite code (API-39). */
function withoutCode(sq: Squad): Squad {
  const { invite_code: _code, ...rest } = sq;
  return rest;
}

export function mySquads(now: number): Squad[] {
  return db()
    .squads.filter((s) => s.members.some((m) => m.is_me))
    .map((s) => withoutCode(view(s, now)));
}

/** Demo members of a squad that lives on someone else's phone (mock mode only). */
const DEMO_MEMBERS: Squad["members"] = [
  { display_name: "Tanvi", rank: "mohalla", weekly_goal_hit: true, role: "owner", is_me: false },
  { display_name: "Arjun", rank: "gali", weekly_goal_hit: false, role: "member", is_me: false },
];

export function joinSquad(
  squadId: string,
  body: SquadJoin,
  profile: LearnerProfile,
  now: number,
): Squad {
  online();
  const d = db();
  const found = d.squads.find((s) => s.squad_id === squadId);
  if (found && found.invite_code !== body.invite_code) throw new MockProblem(404, "NOT_FOUND");
  const base: MockSquad = found ?? {
    squad_id: squadId,
    name: "Squad",
    invite_code: body.invite_code,
    invite_expires_at: new Date(now + 7 * 86_400_000).toISOString(),
    created_at: now,
    members: DEMO_MEMBERS,
    squad_score: null,
    weekly_progress: { done: 0, goal: 9 },
  };
  if (base.members.some((m) => m.is_me)) return withoutCode(view(base, now));
  guard(profile, base.members.length, base.created_at, now);
  const joined: MockSquad = {
    ...base,
    members: [
      ...base.members,
      {
        display_name: body.display_name.trim(),
        rank: myRank(),
        weekly_goal_hit: false,
        role: "member",
        is_me: true,
      },
    ],
  };
  save({ squads: [...d.squads.filter((s) => s.squad_id !== squadId), joined] });
  return withoutCode(view(joined, now));
}

export function leaveSquad(squadId: string): void {
  online();
  // This phone only keeps the squads its learner is in: leaving forgets the squad here.
  save({ squads: db().squads.filter((s) => s.squad_id !== squadId) });
}

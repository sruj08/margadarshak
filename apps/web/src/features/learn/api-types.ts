/**
 * Wire types for the learning operations. The P2 shapes (API-30..33, API-38, API-39, API-44) come
 * from the generated client (`@margdarshak/api-client`, api/openapi.yaml); where the schema leaves
 * a field optional that the Go API always sends (topic rows, badge rows, the streak), the alias says
 * so, because the screens read them unconditionally. API-05 `LlFormat` stays hand-written: the web
 * builds it from the rule packs with explicit nulls. JSON is snake_case as on the wire.
 */
import type { Schemas } from "@margdarshak/api-client";

export type ConfidenceTag = NonNullable<Schemas["AnswerSubmission"]["confidence"]>;
export type RankKey = Schemas["Achievement"]["rank"];
export type BadgeKey = Schemas["BadgeId"];

export interface Provenance {
  source_title: string;
  source_url: string | null;
  verified_on: string | null;
  confidence: "high" | "medium" | "low" | null;
  verified: boolean;
}

/** API-05 `GET /v1/rules/{state}/ll-format` (LlFormat). */
export interface LlFormat {
  state: string;
  rule_id: string;
  known: boolean;
  questions: number | null;
  pass_correct: number | null;
  pass_pct: number | null;
  per_question_timer_s: number | null;
  total_timer_s: number | null;
  online_test_available: boolean;
  where: ("home_online" | "csc" | "rto")[];
  languages: string[];
  provenance: Provenance;
}

/** API-30 `GET /v1/learn/modules` (LearnModule). */
export type LearnModule = Schemas["LearnModule"];

export interface LearnModules {
  content_version: string;
  modules: LearnModule[];
}

/**
 * API-31 `GET /v1/learn/review-queue` (ReviewItem). The Go API sends `card_id` (the concept, e.g.
 * C-LL1-001), `topic_id`, `due_at` and `retrievability` only: no `question_id`/`variant_id`, so
 * the client maps each card to one of its question variants (variants.ts `pickVariant`). It lists
 * due cards only; new concepts are added on the device.
 */
export type ReviewItem = Schemas["ReviewItem"];

export interface ReviewQueueResponse {
  server_time: string;
  items: ReviewItem[];
}

/** API-32 `POST /v1/learn/answers` body item (AnswerSubmission); the server key is q:<question_id>:<variant_id>. */
export type AnswerSubmission = Schemas["AnswerSubmission"];

/** API-32 response item (AnswerResult). */
export type AnswerResult = Schemas["AnswerResult"];

/**
 * API-33 `road_readiness` (gamification RoadReadiness, mapped by the Go API): Road Readiness =
 * `knowledge_part` + `nazar_part` (each half of 100), `score` null until a Nazar Score exists;
 * `nazar_score` / `nazar_verified_sessions` are the subject's Nazar Score and its counted mocks;
 * `nodes` the skill-tree node states of the snapshot.
 */
export interface RoadReadiness {
  score: number | null;
  knowledge_part: number;
  nazar_part: number | null;
  modules: string[];
  nazar_score: number | null;
  nazar_verified_sessions: number;
  nodes: Record<string, string>;
}

type ReadinessTopic = Required<Schemas["Readiness"]["topics"][number]>;

/** API-33 `GET /v1/readiness` (Readiness). */
export type Readiness = Omit<Schemas["Readiness"], "topics" | "road_readiness"> & {
  topics: (Omit<ReadinessTopic, "coverage"> & { coverage?: number })[];
  road_readiness?: Partial<RoadReadiness>;
};

type AchievementBadge = Schemas["Achievement"]["badges"][number];

/** API-38 `GET /v1/me/achievements` (Achievement). Needs an account (403 for a device session). */
export type Achievement = Omit<
  Schemas["Achievement"],
  "badges" | "streak" | "rank_requirements"
> & {
  rank_requirements?: {
    next?: RankKey | null;
    xp_missing?: number;
    missing_nodes?: string[];
    nazar_mocks_missing?: number;
  };
  badges: (Required<Pick<AchievementBadge, "badge_id" | "self_declared">> & {
    awarded_at: string | null;
    label?: AchievementBadge["label"];
  })[];
  streak: Required<Schemas["Achievement"]["streak"]>;
};

/**
 * API-39 Squad (members see display name, rank and goal yes/no only). `invite_code` is sent only in
 * the create response; the device remembers it for the invite link (squads/invite.ts).
 */
export type Squad = Omit<Schemas["Squad"], "squad_score"> & { squad_score: number | null };

export type SquadCreate = Schemas["SquadCreate"];

export type SquadJoin = Schemas["SquadJoin"];

/** API-44 `POST /v1/me/declarations/khud-licence`. */
export type KhudLicenceDeclaration = Schemas["KhudLicenceDeclaration"];

/** Where a value came from: the Go API, or this phone standing in for it. */
export type Source = "server" | "device";

export interface Sourced<T> {
  data: T;
  source: Source;
}
